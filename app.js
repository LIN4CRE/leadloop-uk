import {STAGES,localDateString,validDate,calculateQuote,calculateDashboard,quoteTotal,normalizeUKPhone,validateBackup,migrateLead,migrateSettings,advanceRepeat} from "./core.js";

const $=s=>document.querySelector(s);
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const money=n=>new Intl.NumberFormat("en-GB",{style:"currency",currency:"GBP"}).format(Number(n)||0);
const dateNow=()=>localDateString();
let db,leads=[],settings={business:"",email:"",phone:"",template:"Hi {name}, just checking in about {job}. Please let me know if you have any questions. Thanks, {business}"};

function openDB(){
  return new Promise((resolve,reject)=>{
    const r=indexedDB.open("leadloop-uk",2);
    r.onupgradeneeded=(event)=>{
      const d=r.result;
      const tx=r.transaction;
      const oldVersion=event.oldVersion||0;
      if(!d.objectStoreNames.contains("leads"))d.createObjectStore("leads",{keyPath:"id"});
      if(!d.objectStoreNames.contains("settings"))d.createObjectStore("settings",{keyPath:"key"});
      if (oldVersion < 2) {
        // Migrate same-named stores in place.
        try {
          const store=tx.objectStore("leads");
          const cursorReq=store.openCursor();
          cursorReq.onsuccess=(e)=>{
            const cursor=e.target.result;
            if(cursor){
              const migrated=migrateLead(cursor.value);
              if(migrated) cursor.update(migrated);
              cursor.continue();
            }
          };
        } catch (err) { console.error("lead migration failed", err); }
        // Migrate legacy stores with different names.
        for (const name of ["customers","enquiries","records","leads_v1"]) {
          if (!d.objectStoreNames.contains(name)) continue;
          try {
            const oldStore=tx.objectStore(name);
            const cursorReq=oldStore.openCursor();
            cursorReq.onsuccess=(e)=>{
              const cursor=e.target.result;
              if(cursor){
                const migrated=migrateLead(cursor.value);
                if(migrated) tx.objectStore("leads").put(migrated);
                cursor.continue();
              }
            };
          } catch (err) { console.error("legacy lead migration failed", err); }
        }
        // Settings: same-named store.
        try {
          const store=tx.objectStore("settings");
          const cursorReq=store.openCursor();
          cursorReq.onsuccess=(e)=>{
            const cursor=e.target.result;
            if(cursor){
              const raw=cursor.value;
              const migrated=migrateSettings([raw])[0];
              if(migrated) cursor.update(migrated);
              cursor.continue();
            }
          };
        } catch (err) { console.error("settings migration failed", err); }
        for (const name of ["business","config","settings_v1"]) {
          if (!d.objectStoreNames.contains(name)) continue;
          try {
            const oldStore=tx.objectStore(name);
            const cursorReq=oldStore.openCursor();
            cursorReq.onsuccess=(e)=>{
              const cursor=e.target.result;
              if(cursor){
                const migrated=migrateSettings([cursor.value])[0];
                if(migrated) tx.objectStore("settings").put(migrated);
                cursor.continue();
              }
            };
          } catch (err) { console.error("legacy settings migration failed", err); }
        }
      }
    };
    r.onsuccess=()=>resolve(r.result);
    r.onerror=()=>reject(r.error);
  });
}
function all(name){return new Promise((resolve,reject)=>{const r=db.transaction(name).objectStore(name).getAll();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
function put(name,row){return new Promise((resolve,reject)=>{const r=db.transaction(name,"readwrite").objectStore(name).put(row);r.onsuccess=resolve;r.onerror=()=>reject(r.error);});}
function del(id){return new Promise((resolve,reject)=>{const r=db.transaction("leads","readwrite").objectStore("leads").delete(id);r.onsuccess=resolve;r.onerror=()=>reject(r.error);});}
async function refresh(){leads=await all("leads");for(const s of await all("settings"))settings[s.key]=s.value;render();}
function due(l){return Boolean(l.followUpDate&&l.followUpDate<=dateNow()&&!["Won","Lost"].includes(l.stage));}

function render(){
  const d=calculateDashboard(leads);
  const values=[
    ["Enquiries",d.enquiries],["Outstanding quotes",d.outstandingQuotes],["Quote value",money(d.outstandingValue)],
    ["Won job value",money(d.wonValue)],["Won jobs",d.wonJobs],["Lost opportunities",d.lost],
    ["Follow-ups due",d.followUpsDue],["Repeat reminders due",d.repeatDue],
    ["Conversion rate",d.conversionRate===null?"—":`${d.conversionRate}%`]
  ];
  $("#stats").innerHTML=values.map(([a,b])=>`<article class="card stat"><div class="label">${esc(a)}</div><div class="value">${esc(b)}</div></article>`).join("");
  const stageFilterValue=$("#stageFilter")?$("#stageFilter").value:"";
  const dueFilterValue=$("#dueFilter")?$("#dueFilter").value:"";
  $("#stageFilter").innerHTML='<option value="">All stages</option>'+STAGES.map(s=>`<option>${esc(s)}</option>`).join("");
  if(stageFilterValue)$("#stageFilter").value=stageFilterValue;
  const q=$("#search").value.trim().toLowerCase(),stage=$("#stageFilter").value,filter=$("#dueFilter").value;
  if(dueFilterValue && $("#dueFilter"))$("#dueFilter").value=dueFilterValue;
  const rows=leads.filter(l=>{
    const text=[l.name,l.email,l.phone,l.job,l.source].join(" ").toLowerCase();
    return(!q||text.includes(q))&&(!stage||l.stage===stage)&&(!filter||(filter==="due"?due(l):l.followUpDate>dateNow()));
  }).sort((a,b)=>(b.updatedAt||b.created).localeCompare(a.updatedAt||a.created));
  $("#resultCount").textContent=`${rows.length} ${rows.length===1?"record":"records"}`;
  $("#leadList").innerHTML=rows.length?rows.map(l=>{
    const tags=`<span class="badge">${esc(l.stage)}</span>${l.source?`<span class="badge">${esc(l.source)}</span>`:""}${l.followUpDate?`<span class="badge ${due(l)?"overdue":""}">Follow-up ${esc(l.followUpDate)}</span>`:""}${l.nextRepeat?`<span class="badge ${l.nextRepeat<=dateNow()?"overdue":""}">Repeat ${esc(l.nextRepeat)}</span>`:""}`;
    const contact=l.lastContactConfirmedAt?`Contact confirmed ${new Date(l.lastContactConfirmedAt).toLocaleDateString("en-GB")}`:l.lastOpenedAt?`Link opened ${new Date(l.lastOpenedAt).toLocaleDateString("en-GB")}`:l.lastPreparedAt?"Message prepared":"No follow-up activity";
    return `<article class="card lead" data-id="${esc(l.id)}"><div><h3>${esc(l.name)}</h3><p>${esc(l.job)}</p><p>${esc(l.email)}${l.email&&l.phone?" · ":""}${esc(l.phone)}</p><p>${tags}</p><p>${l.quote?`Quote ${esc(l.quote.reference)} · ${money(quoteTotal(l))} · `:""}${esc(contact)}</p></div>
    <div class="lead-actions"><select class="stageSelect" aria-label="Stage for ${esc(l.name)}">${STAGES.map(s=>`<option ${l.stage===s?"selected":""}>${esc(s)}</option>`).join("")}</select>
    <button class="btn quoteBtn">Quote</button><button class="btn editBtn">Edit</button><button class="btn followBtn">Follow up</button>
    ${l.nextRepeat?'<button class="btn repeatBtn">Mark repeat done</button>':""}<button class="btn danger deleteBtn">Delete</button></div></article>`;
  }).join(""):`<div class="card empty"><h2>${leads.length?"No matching enquiries":"Start with your first enquiry"}</h2><p>${leads.length?"Try changing the search or filters.":"Your dashboard uses only records you add."}</p><button class="btn primary" data-action="empty-add">Add an enquiry</button></div>`;
  document.documentElement.dataset.theme=localStorage.getItem("ll-theme")||"dark";
}
function modal(title,body,buttons){$("#modalTitle").textContent=title;$("#modalBody").innerHTML=body;$("#modalFoot").innerHTML=buttons;const dialog=$("#modal");if(!dialog.open)dialog.showModal();}
function close(){if($("#modal").open)$("#modal").close();}
function leadForm(l={}){
  const isEdit=Boolean(l.id);
  modal(isEdit?"Edit enquiry":"Add enquiry",`<div class="form-grid">
  <div class="field"><label for="name">Customer name *</label><input id="name" name="name" maxlength="120" required value="${esc(l.name)}"></div>
  <div class="field"><label for="phone">Phone</label><input id="phone" name="phone" type="tel" maxlength="50" value="${esc(l.phone)}"></div>
  <div class="field"><label for="email">Email</label><input id="email" name="email" type="email" maxlength="150" value="${esc(l.email)}"></div>
  <div class="field"><label for="source">Enquiry source</label><input id="source" name="source" maxlength="100" value="${esc(l.source)}"></div>
  <div class="field full"><label for="job">Job details *</label><textarea id="job" name="job" required maxlength="2000">${esc(l.job)}</textarea></div>
  <div class="field"><label for="created">Enquiry date</label><input id="created" name="created" type="date" value="${esc(l.created||dateNow())}"></div>
  <div class="field"><label for="followUpDate">Follow-up date</label><input id="followUpDate" name="followUpDate" type="date" value="${esc(l.followUpDate)}"></div>
  <div class="field"><label for="nextRepeat">Next repeat booking reminder</label><input id="nextRepeat" name="nextRepeat" type="date" value="${esc(l.nextRepeat)}"></div>
  <div class="field"><label for="repeatInterval">Repeat interval</label><select id="repeatInterval" name="repeatInterval"><option value="">No interval</option>${[["weekly","Weekly"],["fortnightly","Fortnightly"],["monthly","Monthly"],["quarterly","Quarterly"],["yearly","Yearly"]].map(([v,t])=>`<option value="${v}" ${l.repeatInterval===v?"selected":""}>${t}</option>`).join("")}</select></div>
  <div class="field"><label for="stage">Pipeline stage</label><select id="stage" name="stage">${STAGES.map(s=>`<option ${l.stage===s?"selected":""}>${esc(s)}</option>`).join("")}</select></div></div>`,
  '<button class="btn" type="button" data-action="cancel">Cancel</button><button class="btn primary" type="submit">Save enquiry</button>');
  $("#modalForm").onsubmit=async e=>{
    e.preventDefault();const f=new FormData(e.currentTarget),created=f.get("created")||dateNow();
    if(!validDate(created,false)||!validDate(f.get("followUpDate"))||!validDate(f.get("nextRepeat")))return alert("Enter valid dates.");
    const row={...l,id:l.id||crypto.randomUUID(),name:f.get("name").trim(),phone:f.get("phone").trim(),email:f.get("email").trim(),source:f.get("source").trim(),job:f.get("job").trim(),created,followUpDate:f.get("followUpDate"),nextRepeat:f.get("nextRepeat"),repeatInterval:f.get("repeatInterval"),stage:f.get("stage"),updatedAt:new Date().toISOString()};
    if(!row.name||!row.job)return;await put("leads",row);close();await refresh();
  };
}
function parseLines(raw){
  return raw.trim().split("\n").filter(Boolean).map(line=>{
    const p=line.split("|").map(x=>x.trim());
    if(p.length!==3)throw new Error("Each quote line must be description | quantity | unit price.");
    return {description:p[0],qty:Number(p[1]),price:Number(p[2])};
  });
}
function newRef(){
  const day=dateNow().replaceAll("-","");
  return `LL-${day}-${crypto.randomUUID().slice(0,8).toUpperCase()}`;
}
function quoteForm(l){
  const q=l.quote||{items:[],discount:0,vat:0};
  modal(`Quote for ${l.name}`,`<p class="hint">Line format: description | quantity | unit price (GBP). Saving a quote does not send it or mean the customer accepted it.</p>
  <div class="form-grid"><div class="field full"><label for="items">Line items *</label><textarea id="items" required placeholder="Labour | 2 | 45&#10;Materials | 1 | 30">${esc(q.items.map(i=>`${i.description} | ${i.qty} | ${i.price}`).join("\n"))}</textarea></div>
  <div class="field"><label for="discount">Discount (%)</label><input id="discount" type="number" min="0" max="100" step=".01" value="${esc(q.discount||0)}"></div>
  <div class="field"><label for="vat">VAT (%)</label><input id="vat" type="number" min="0" max="100" step=".01" value="${esc(q.vat||0)}"></div>
  <p class="hint field full">VAT is a user-entered calculation setting, not tax advice. Check the correct treatment for your business.</p></div>`,
  '<button class="btn" type="button" data-action="cancel">Cancel</button><button class="btn" type="submit">Save quote</button><button class="btn primary" type="button" data-action="save-print">Save quote &amp; print</button>');
  const read=()=>calculateQuote(parseLines($("#items").value),$("#discount").value,$("#vat").value);
  $("#modalForm").onsubmit=async e=>{e.preventDefault();try{await persistQuote(l,read());close();await refresh();}catch(err){alert(err.message);}};
  $("#modalFoot [data-action=save-print]").onclick=async()=>{
    try{const saved=await persistQuote(l,read());await refresh();renderPrint(l,saved);window.print();}
    catch(err){alert(err.message);}
  };
}
async function persistQuote(l,calculated){
  const existing=l.quote;
  const ref=existing?.reference||newRef();
  const quote={...calculated,reference:ref,date:existing?.date||dateNow()};
  if(!existing){const allQuotes=leads.map(x=>x.quote?.reference).filter(Boolean);if(allQuotes.includes(ref))throw new Error("Could not create a unique quote reference. Try again.");}
  l.quote=quote;
  if(["New enquiry","Contacted"].includes(l.stage))l.stage="Quotation prepared";
  l.updatedAt=new Date().toISOString();
  await put("leads",l);
  return quote;
}
function renderPrint(l,q){
  $("#printArea").innerHTML=`<h1>Quotation ${esc(q.reference)}</h1><strong>${esc(settings.business||"")}</strong>
  <p>${esc(settings.email||"")}${settings.phone?` · ${esc(settings.phone)}`:""}</p><hr>
  <p><strong>Prepared for:</strong> ${esc(l.name)}<br><strong>Job:</strong> ${esc(l.job)}<br><strong>Date:</strong> ${esc(q.date)}</p>
  <table><thead><tr><th>Description</th><th>Qty</th><th>Unit price</th><th>Line total</th></tr></thead><tbody>
  ${q.items.map(i=>`<tr><td>${esc(i.description)}</td><td>${i.qty}</td><td>${money(i.price)}</td><td>${money(i.qty*i.price)}</td></tr>`).join("")}</tbody></table>
  <div class="total">Subtotal: ${money(q.subtotal)}<br>Discount (${q.discount}%): −${money(q.discountAmount)}<br>VAT (${q.vat}%): ${money(q.vatAmount)}<h2>Total: ${money(q.total)}</h2></div>
  <p>This quotation is a proposal and is not marked as sent or accepted by this document.</p>`;
}
function followForm(l){
  const text=(settings.template||"Hi {name}, just checking in about {job}. Thanks, {business}")
    .replaceAll("{name}",l.name).replaceAll("{job}",l.job).replaceAll("{business}",settings.business||"");
  modal(`Follow up · ${l.name}`,`<div class="field"><label for="message">Message draft</label><textarea id="message" maxlength="2000">${esc(l.preparedMessage||text)}</textarea>
  <span class="hint">Prepare, open a message link, then separately confirm contact if you actually contacted the customer. Nothing is sent automatically.</span>
  <p class="hint">Prepared: ${l.lastPreparedAt?esc(new Date(l.lastPreparedAt).toLocaleString("en-GB")):"not yet"} · Link opened: ${l.lastOpenedAt?esc(new Date(l.lastOpenedAt).toLocaleString("en-GB")):"not yet"} · Contact confirmed: ${l.lastContactConfirmedAt?esc(new Date(l.lastContactConfirmedAt).toLocaleString("en-GB")):"not yet"}</p></div>`,
  '<button class="btn" type="button" data-action="cancel">Close</button><button class="btn" type="button" data-action="prepare">Prepare draft</button><button class="btn" type="button" data-action="open-wa">Open WhatsApp</button><button class="btn" type="button" data-action="open-email">Open email</button><button class="btn primary" type="button" data-action="confirm-contact">Confirm contact</button>');
  const draft=()=>$("#message").value.trim();
  $("#modalFoot [data-action=prepare]").onclick=async()=>{
    if(!draft())return alert("Enter a message first.");
    l.preparedMessage=draft();l.lastPreparedAt=new Date().toISOString();await put("leads",l);await refresh();
    const updated=leads.find(x=>x.id===l.id)||l;
    followForm(updated);
  };
  $("#modalFoot [data-action=open-wa]").onclick=async()=>{
    const phone=normalizeUKPhone(l.phone);if(!phone)return alert("Enter a valid UK phone number, such as 07123 456789 or +44 7123 456789.");
    if(!draft())return alert("Enter a message first.");
    l.preparedMessage=draft();l.lastPreparedAt=new Date().toISOString();l.lastOpenedAt=new Date().toISOString();await put("leads",l);await refresh();
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(draft())}`,"_blank","noopener,noreferrer");
  };
  $("#modalFoot [data-action=open-email]").onclick=async()=>{
    if(!l.email||!draft())return alert("Add an email address and message first.");
    l.preparedMessage=draft();l.lastPreparedAt=new Date().toISOString();l.lastOpenedAt=new Date().toISOString();await put("leads",l);await refresh();
    const a=document.createElement("a");a.href=`mailto:${encodeURIComponent(l.email)}?subject=${encodeURIComponent("Following up")}&body=${encodeURIComponent(draft())}`;a.click();
  };
  $("#modalFoot [data-action=confirm-contact]").onclick=async()=>{
    if(!confirm("Confirm that you actually contacted this customer?"))return;
    l.lastContactConfirmedAt=new Date().toISOString();l.updatedAt=l.lastContactConfirmedAt;await put("leads",l);close();await refresh();
  };
}
function settingsForm(){
  modal("Business details and follow-up template",`<div class="form-grid">
  <div class="field"><label for="business">Business name</label><input id="business" name="business" value="${esc(settings.business)}"></div>
  <div class="field"><label for="bizEmail">Business email</label><input id="bizEmail" name="email" type="email" value="${esc(settings.email)}"></div>
  <div class="field"><label for="bizPhone">Business phone</label><input id="bizPhone" name="phone" value="${esc(settings.phone)}"></div>
  <div class="field full"><label for="template">Follow-up template</label><textarea id="template" name="template">${esc(settings.template)}</textarea><span class="hint">Placeholders: {name}, {job}, {business}.</span></div></div>`,
  '<button class="btn" type="button" data-action="cancel">Cancel</button><button class="btn primary" type="submit">Save details</button>');
  $("#modalForm").onsubmit=async e=>{e.preventDefault();for(const [key,value]of new FormData(e.currentTarget)) {settings[key]=String(value).trim();await put("settings",{key,value:settings[key]});}close();render();};
}
function download(blob,name){const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);}
function csv(){
  const head=["Customer","Phone","Email","Job","Source","Enquiry date","Stage","Follow-up date","Repeat reminder","Quote reference","Quote total GBP","Prepared","Link opened","Contact confirmed"];
  const rows=leads.map(l=>[l.name,l.phone,l.email,l.job,l.source,l.created,l.stage,l.followUpDate,l.nextRepeat,l.quote?.reference||"",l.quote?quoteTotal(l).toFixed(2):"",l.lastPreparedAt||"",l.lastOpenedAt||"",l.lastContactConfirmedAt||""]);
  const cell=v=>{let s=String(v??"");if(/^[=+\-@]/.test(s))s="'"+s;return `"${s.replaceAll('"','""')}"`;};
  download(new Blob(["\uFEFF"+[head,...rows].map(r=>r.map(cell).join(",")).join("\r\n")],{type:"text/csv;charset=utf-8"}),"leadloop-enquiries.csv");
}
async function backup(){download(new Blob([JSON.stringify({format:"leadloop-uk-backup",version:2,leads,settings:await all("settings")},null,2)],{type:"application/json"}),"leadloop-backup.json");}
async function restore(file){
  try{
    const parsed=JSON.parse(await file.text());
    const clean=validateBackup(parsed); // Entire file checked before opening a write transaction.
    if(!confirm(`Replace ${leads.length} current records with ${clean.leads.length} backup records?`))return;
    await new Promise((resolve,reject)=>{
      const tx=db.transaction(["leads","settings"],"readwrite");
      const leadStore=tx.objectStore("leads"), settingsStore=tx.objectStore("settings");
      leadStore.clear();settingsStore.clear();
      for(const l of clean.leads)leadStore.put(l);
      for(const s of clean.settings)settingsStore.put(s);
      tx.oncomplete=resolve;
      tx.onabort=()=>reject(tx.error||new Error("Restore transaction aborted; existing data was kept."));
      tx.onerror=()=>reject(tx.error||new Error("Restore failed."));
    });
    await refresh();
  }catch(e){alert(`Restore failed: ${e.message}`);}
  finally{$("#restoreFile").value="";}
}
function advanceRepeatLocal(date,interval){return advanceRepeat(date,interval);}

const installInstructions=`<div class="field full"><p><strong>Chrome or Edge (desktop/Android):</strong> use the browser menu and choose “Install app” or “Add to Home screen”.</p><p><strong>Safari (iPhone/iPad):</strong> tap Share, then “Add to Home Screen”.</p><p><strong>Firefox:</strong> open the browser menu and choose “Install” if available, otherwise use “Add to Home screen”.</p><p class="hint">Not every browser supports an automatic install prompt. If no button appears, use the manual steps above. The prompt is only shown after the browser decides installation is available.</p></div>`;

$("#addBtn").onclick=()=>leadForm();
$("#settingsBtn").onclick=settingsForm;
$("#csvBtn").onclick=csv;
$("#backupBtn").onclick=backup;
$("#restoreBtn").onclick=()=>$("#restoreFile").click();
$("#restoreFile").onchange=e=>e.target.files[0]&&restore(e.target.files[0]);
$("#themeBtn").onclick=()=>{localStorage.setItem("ll-theme",document.documentElement.dataset.theme==="dark"?"light":"dark");render();};
$("#search").oninput=render;$("#stageFilter").onchange=render;$("#dueFilter").onchange=render;
$("#closeModal").onclick=close;
$("#modal").addEventListener("click",e=>{if(e.target===$("#modal"))close();});
$("#modalFoot").addEventListener("click",e=>{if(e.target.closest('[data-action="cancel"]'))close();});
const installBtn=$("#installBtn");
const installHelpBtn=$("#installHelpBtn");
let deferredInstallPrompt=null;
function updateInstallButton(){if(installBtn)installBtn.hidden=!deferredInstallPrompt;}
window.addEventListener("beforeinstallprompt",(e)=>{e.preventDefault();deferredInstallPrompt=e;updateInstallButton();});
window.addEventListener("appinstalled",()=>{deferredInstallPrompt=null;updateInstallButton();});
if(installBtn)installBtn.onclick=async()=>{if(!deferredInstallPrompt)return;deferredInstallPrompt.prompt();const choice=await deferredInstallPrompt.userChoice;if(choice.outcome==="accepted"){deferredInstallPrompt=null;updateInstallButton();}};
if(installHelpBtn)installHelpBtn.onclick=()=>modal("Install LeadLoop UK",installInstructions,'<button class="btn primary" type="button" data-action="cancel">Close</button>');
$("#leadList").addEventListener("click",async e=>{
  if(e.target.closest('[data-action="empty-add"]'))return leadForm();
  const card=e.target.closest(".lead");if(!card)return;
  const l=leads.find(x=>x.id===card.dataset.id);if(!l)return;
  if(e.target.closest(".editBtn"))leadForm(l);
  if(e.target.closest(".quoteBtn"))quoteForm(l);
  if(e.target.closest(".followBtn"))followForm(l);
  if(e.target.closest(".deleteBtn")&&confirm(`Delete ${l.name}'s enquiry? This cannot be undone.`)){await del(l.id);await refresh();}
  if(e.target.closest(".repeatBtn")){
    if(!l.repeatInterval)return alert("Set a repeat interval in Edit first.");
    l.nextRepeat=advanceRepeat(l.nextRepeat||dateNow(),l.repeatInterval);l.updatedAt=new Date().toISOString();await put("leads",l);await refresh();
  }
});
$("#leadList").addEventListener("change",async e=>{
  if(!e.target.matches(".stageSelect"))return;
  const l=leads.find(x=>x.id===e.target.closest(".lead").dataset.id);
  if(l){l.stage=e.target.value;l.updatedAt=new Date().toISOString();await put("leads",l);await refresh();}
});
openDB().then(async d=>{db=d;await refresh();}).catch(e=>{console.error(e);alert("LeadLoop could not open browser storage. Enable site storage and try a current browser.");});
if("serviceWorker"in navigator&&location.protocol!=="file:")navigator.serviceWorker.register("./sw.js").catch(console.error);
window.addEventListener("pagehide",()=>{try{if(db){db.close();db=null;}}catch{}});