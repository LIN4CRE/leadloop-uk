import {test,expect} from "@playwright/test";

test.beforeEach(async({page})=>{
  await page.goto("/blank.html");
  await page.evaluate(async()=>{
    await new Promise((resolve)=>{
      const req=indexedDB.deleteDatabase("leadloop-uk");
      req.onsuccess=()=>resolve();
      req.onerror=()=>resolve();
      req.onblocked=()=>resolve();
    });
  });
  await page.goto("/");
});

async function addEnquiry(page,name="Test customer"){
  await page.getByRole("button",{name:/add enquiry/i}).first().click();
  await page.locator("#name").fill(name);
  await page.locator("#job").fill("Regular house clean");
  await page.locator("#phone").fill("07123 456789");
  await page.locator("#email").fill("test@example.com");
  await page.getByRole("button",{name:"Save enquiry"}).click();
  await expect(page.locator(".lead")).toHaveCount(1);
}

test("fresh start and empty-state action add first enquiry",async({page})=>{
  await expect(page.getByText("Start with your first enquiry")).toBeVisible();
  await page.locator('[data-action="empty-add"]').click();
  await page.locator("#name").fill("First customer");
  await page.locator("#job").fill("Garden tidy");
  await page.getByRole("button",{name:"Save enquiry"}).click();
  await expect(page.getByText("First customer")).toBeVisible();
});
test("add, edit, delete and persist a record after reload",async({page})=>{
  await addEnquiry(page);
  await page.reload();await expect(page.getByText("Test customer")).toBeVisible();
  await page.locator(".editBtn").click();
  await page.locator("#name").fill("Edited customer");
  await page.getByRole("button",{name:"Save enquiry"}).click();
  await expect(page.getByText("Edited customer")).toBeVisible();
  page.once("dialog",d=>d.accept());
  await page.locator(".deleteBtn").click();
  await expect(page.locator(".lead")).toHaveCount(0);
});
test("search and stage filtering work",async({page})=>{
  await addEnquiry(page,"Alice");
  await page.getByRole("button",{name:/add enquiry/i}).first().click();
  await page.locator("#name").fill("Bob");await page.locator("#job").fill("Hedge trim");
  await page.getByRole("button",{name:"Save enquiry"}).click();
  await expect(page.locator(".lead")).toHaveCount(2);
  await page.locator("#search").fill("Alice");await expect(page.locator(".lead")).toHaveCount(1);
  await page.locator("#search").fill("");
  await page.locator(".stageSelect").first().selectOption({label:"Won"});
  await page.waitForTimeout(300);
  await page.locator("#stageFilter").selectOption({label:"Won"});
  await expect(page.locator(".lead")).toHaveCount(1);
});
test("quote persists before print and rendered document has totals",async({page})=>{
  await addEnquiry(page);
  await page.locator(".quoteBtn").click();
  await page.locator("#items").fill("Labour | 2 | 45\nMaterials | 1 | 30");
  await page.locator("#discount").fill("10");await page.locator("#vat").fill("20");
  await page.evaluate(()=>{window.print=()=>{document.body.dataset.printed="yes";};});
  await page.getByRole("button",{name:/save quote & print/i}).click();
  await expect(page.locator("#printArea")).toContainText("£129.60");
  await expect(page.locator("#printArea")).toContainText("Quotation LL-");
  await expect(page.locator(".lead")).toContainText("£129.60");
  expect(await page.locator("body").getAttribute("data-printed")).toBe("yes");
});
test("follow-up link opening does not confirm contact",async({page})=>{
  await addEnquiry(page);
  await page.locator(".followBtn").click();
  await page.locator("#message").fill("Hello");
  const popup=page.waitForEvent("popup");
  await page.getByRole("button",{name:"Open WhatsApp"}).click();
  const opened=await popup;await expect(opened).toHaveURL(/447123456789/);
  await expect(page.locator(".lead")).toContainText("Link opened");
  await expect(page.locator(".lead")).not.toContainText("Contact confirmed");
});
test("repeatedly preparing and editing a message works",async({page})=>{
  await addEnquiry(page);
  await page.locator(".followBtn").click();
  for (let i=0;i<3;i++){
    await page.locator("#message").fill(`Draft ${i}`);
    await page.getByRole("button",{name:"Prepare draft"}).click();
    await page.waitForTimeout(300);
    await expect(page.locator("#message")).toHaveValue(`Draft ${i}`);
  }
});
test("invalid backup is rejected without clearing existing records",async({page})=>{
  await addEnquiry(page);
  const invalidHandler = d => { page.off("dialog", invalidHandler); d.accept(); };
  page.on("dialog", invalidHandler);
  await page.locator("#restoreFile").setInputFiles({
    name:"bad.json",mimeType:"application/json",
    buffer:Buffer.from(JSON.stringify({format:"leadloop-uk-backup",version:2,leads:[{id:"bad"}],settings:[]}))
  });
  await expect(page.getByText("Test customer")).toBeVisible();
});
test("valid backup restores and refreshes the UI",async({page})=>{
  await addEnquiry(page,"Backup customer");
  const backup=await page.evaluate(async()=>{
    const db=await new Promise((res,rej)=>{const r=indexedDB.open("leadloop-uk",2);r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);});
    const leads=await new Promise(res=>{const r=db.transaction("leads").objectStore("leads").getAll();r.onsuccess=()=>res(r.result);});
    return {format:"leadloop-uk-backup",version:2,leads,settings:[]};
  });
  const restoreHandler = d => { page.off("dialog", restoreHandler); d.accept(); };
  page.on("dialog", restoreHandler);
  await page.locator("#restoreFile").setInputFiles({name:"backup.json",mimeType:"application/json",buffer:Buffer.from(JSON.stringify(backup))});
  await expect(page.getByText("Backup customer")).toBeVisible();
});
test("migrates version 1 database records",async({page})=>{
  await page.goto("/blank.html");
  await page.evaluate(async()=>{
    await new Promise((resolve)=>{
      const req=indexedDB.deleteDatabase("leadloop-uk");
      req.onsuccess=()=>resolve();
      req.onerror=()=>resolve();
      req.onblocked=()=>resolve();
    });
  });
  await page.evaluate(async()=>{
    await new Promise((resolve,reject)=>{
      const req=indexedDB.open("leadloop-uk",1);
      req.onupgradeneeded=()=>{
        const db=req.result;
        const leads=db.createObjectStore("leads",{keyPath:"id"});
        const settings=db.createObjectStore("settings",{keyPath:"key"});
        leads.put({id:"legacy",customerName:"Legacy customer",jobDetails:"Old job",phoneNumber:"07123 456789",enquiryDate:"2026-01-01",followupDate:"2026-01-02",nextBooking:"2026-02-01",interval:"monthly",status:"quoted",quotation:{ref:"OLD-1",quoteDate:"2026-01-01",lines:[{name:"Labour",quantity:2,unitPrice:45}],discount:10,vat:20}});
        settings.put({key:"business",value:"Old Biz"});
      };
      req.onsuccess=()=>{req.result.close();resolve();};
      req.onerror=()=>reject(req.error);
    });
  });
  await page.goto("/");
  await expect(page.getByText("Legacy customer")).toBeVisible();
  await page.locator(".followBtn").click();
  await expect(page.locator("#message")).toBeVisible();
});
test("service worker registers and shell loads after going offline",async({page,context})=>{
  await page.goto("/");
  await page.evaluate(()=>navigator.serviceWorker.ready);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole("heading",{name:/LeadLoop/})).toBeVisible();
  await context.setOffline(false);
});
test("manifest is valid and lists required icons",async({page})=>{
  const res=await page.goto("/manifest.webmanifest");
  const json=await res.json();
  expect(json.icons.some(i=>i.sizes==="192x192")).toBe(true);
  expect(json.icons.some(i=>i.sizes==="512x512")).toBe(true);
});