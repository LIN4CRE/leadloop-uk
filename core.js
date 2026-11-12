export const STAGES = ["New enquiry","Contacted","Quotation prepared","Quotation sent","Follow-up required","Won","Lost"];

export function localDateString(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth()+1).padStart(2,"0");
  const d = String(date.getDate()).padStart(2,"0");
  return `${y}-${m}-${d}`;
}
export function validDate(value, optional = true) {
  if (value === "" || value == null) return optional;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y,m,d] = value.split("-").map(Number);
  const dt = new Date(y,m-1,d);
  return dt.getFullYear()===y && dt.getMonth()===m-1 && dt.getDate()===d;
}
export function round2(value) { return Math.round((Number(value)+Number.EPSILON)*100)/100; }

export function calculateQuote(items, discount = 0, vat = 0) {
  if (!Array.isArray(items) || items.length===0) throw new Error("Add at least one quote line.");
  discount=Number(discount); vat=Number(vat);
  if (!Number.isFinite(discount)||discount<0||discount>100||!Number.isFinite(vat)||vat<0||vat>100)
    throw new Error("Discount and VAT must be between 0 and 100.");
  const clean=items.map(i=>{
    const description=String(i.description||"").trim(), qty=Number(i.qty), price=Number(i.price);
    if(!description||description.length>300||!Number.isFinite(qty)||qty<=0||!Number.isFinite(price)||price<0)
      throw new Error("Quote lines need a description, positive quantity and non-negative unit price.");
    return {description,qty,price:round2(price)};
  });
  const subtotal=round2(clean.reduce((s,i)=>s+i.qty*i.price,0));
  const discountAmount=round2(subtotal*discount/100);
  const net=round2(subtotal-discountAmount);
  const vatAmount=round2(net*vat/100);
  return {items:clean,discount,vat,subtotal,discountAmount,vatAmount,total:round2(net+vatAmount)};
}
export function quoteTotal(lead) {
  if(!lead?.quote) return 0;
  return calculateQuote(lead.quote.items,lead.quote.discount,lead.quote.vat).total;
}
export function calculateDashboard(leads, today=localDateString()) {
  const active=leads.filter(l=>!["Won","Lost"].includes(l.stage));
  const won=leads.filter(l=>l.stage==="Won"), lost=leads.filter(l=>l.stage==="Lost");
  const quotes=leads.filter(l=>l.quote && ["Quotation sent","Follow-up required"].includes(l.stage));
  const closed=won.length+lost.length;
  return {
    enquiries:leads.length,
    outstandingQuotes:quotes.length,
    outstandingValue:round2(quotes.reduce((n,l)=>n+quoteTotal(l),0)),
    wonJobs:won.length,
    lost:lost.length,
    wonValue:round2(won.reduce((n,l)=>n+quoteTotal(l),0)),
    followUpsDue:active.filter(l=>l.followUpDate && l.followUpDate<=today).length,
    repeatDue:active.filter(l=>l.nextRepeat && l.nextRepeat<=today).length,
    conversionRate:closed?Math.round(won.length/closed*100):null
  };
}
export function normalizeUKPhone(raw) {
  let digits=String(raw||"").replace(/\D/g,"");
  if(digits.startsWith("00"))digits=digits.slice(2);
  if(digits.startsWith("440"))digits="44"+digits.slice(3);
  else if(digits.startsWith("0"))digits="44"+digits.slice(1);
  if(!digits.startsWith("44")||digits.length<11||digits.length>13)return null;
  return digits;
}

// Repeat booking date advancement with end-of-month clamping.
export function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}
export function advanceRepeat(date, interval) {
  if (!date || !interval) return "";
  const parts = String(date).split("-").map(Number);
  if (parts.length !== 3 || parts.some(n => !Number.isFinite(n))) return "";
  const [y, m, d] = parts;
  if (interval === "weekly") {
    const dt = new Date(y, m - 1, d);
    dt.setDate(dt.getDate() + 7);
    return localDateString(dt);
  }
  if (interval === "fortnightly") {
    const dt = new Date(y, m - 1, d);
    dt.setDate(dt.getDate() + 14);
    return localDateString(dt);
  }
  let months = 0;
  if (interval === "monthly") months = 1;
  else if (interval === "quarterly") months = 3;
  else if (interval === "yearly") months = 12;
  else return "";
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const nd = Math.min(d, daysInMonth(ny, nm));
  return `${String(ny).padStart(4,"0")}-${String(nm).padStart(2,"0")}-${String(nd).padStart(2,"0")}`;
}
// Aliases for compatibility with tests and callers.
export const advanceRepeatDate = advanceRepeat;
export const advanceDate = advanceRepeat;
export const nextRepeatDate = advanceRepeat;

function normalizeDate(value) {
  if (value == null || value === "") return "";
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const dt = new Date(value);
  if (!Number.isNaN(dt.getTime())) return localDateString(dt);
  return "";
}
function normalizeTimestamp(value) {
  if (value == null || value === "") return undefined;
  if (typeof value === "string") {
    if (Number.isFinite(Date.parse(value))) return value;
    return undefined;
  }
  if (typeof value === "number") {
    const dt = new Date(value);
    if (!Number.isNaN(dt.getTime())) return dt.toISOString();
  }
  return undefined;
}
function normalizeInterval(value) {
  const v = String(value ?? "").trim().toLowerCase();
  const map = {
    "weekly": "weekly", "week": "weekly", "w": "weekly",
    "fortnightly": "fortnightly", "biweekly": "fortnightly", "bi-weekly": "fortnightly", "two-weekly": "fortnightly",
    "monthly": "monthly", "month": "monthly", "m": "monthly",
    "quarterly": "quarterly", "quarter": "quarterly", "q": "quarterly",
    "yearly": "yearly", "annual": "yearly", "annually": "yearly", "year": "yearly", "y": "yearly",
    "": ""
  };
  return Object.prototype.hasOwnProperty.call(map, v) ? map[v] : "";
}
function normalizeStage(value) {
  if (STAGES.includes(value)) return value;
  const key = String(value ?? "").trim().toLowerCase();
  const map = {
    "new enquiry": "New enquiry", "new": "New enquiry", "new lead": "New enquiry", "enquiry": "New enquiry", "lead": "New enquiry",
    "contacted": "Contacted", "contact": "Contacted",
    "quotation prepared": "Quotation prepared", "quote prepared": "Quotation prepared", "quoted": "Quotation prepared", "quote": "Quotation prepared", "quotation": "Quotation prepared",
    "quotation sent": "Quotation sent", "quote sent": "Quotation sent", "sent": "Quotation sent",
    "follow-up required": "Follow-up required", "follow up required": "Follow-up required", "follow-up": "Follow-up required", "follow up": "Follow-up required", "followup": "Follow-up required",
    "won": "Won", "accepted": "Won", "closed won": "Won", "complete": "Won", "completed": "Won",
    "lost": "Lost", "declined": "Lost", "closed lost": "Lost", "cancelled": "Lost", "canceled": "Lost"
  };
  return map[key] || "New enquiry";
}
function pick(obj, ...keys) {
  for (const k of keys) {
    if (obj && obj[k] != null && String(obj[k]).trim() !== "") return obj[k];
  }
  return "";
}

export function migrateQuote(raw, fallbackDate = "") {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const reference = String(raw.reference ?? raw.ref ?? raw.quoteReference ?? raw.id ?? "").trim();
  const date = normalizeDate(raw.date ?? raw.quoteDate ?? raw.createdAt ?? raw.created) || (fallbackDate ? normalizeDate(fallbackDate) : "") || localDateString();
  const discount = Number(raw.discount ?? raw.discountPercent ?? raw.discount_percentage ?? 0);
  const vat = Number(raw.vat ?? raw.vatPercent ?? raw.vat_percentage ?? raw.tax ?? 0);
  const srcItems = Array.isArray(raw.items) ? raw.items
    : Array.isArray(raw.lines) ? raw.lines
    : Array.isArray(raw.quoteItems) ? raw.quoteItems
    : Array.isArray(raw.lineItems) ? raw.lineItems
    : [];
  const items = srcItems.map(i => ({
    description: String(i?.description ?? i?.name ?? i?.item ?? i?.desc ?? i?.title ?? "").trim(),
    qty: Number(i?.qty ?? i?.quantity ?? i?.count ?? i?.units ?? 1),
    price: Number(i?.price ?? i?.unitPrice ?? i?.unit_price ?? i?.cost ?? i?.rate ?? 0)
  })).filter(i => i.description);
  if (!items.length) return undefined;
  try {
    const calc = calculateQuote(items, Number.isFinite(discount) ? discount : 0, Number.isFinite(vat) ? vat : 0);
    return {
      ...calc,
      reference: reference || `LL-MIGRATED-${Math.random().toString(36).slice(2, 10).toUpperCase()}`,
      date
    };
  } catch {
    return undefined;
  }
}

export function migrateLead(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const createdRaw = pick(raw, "created", "createdAt", "enquiryDate", "enquiry_date", "date", "createdOn", "created_at");
  const created = normalizeDate(createdRaw) || localDateString();
  const id = String(raw.id ?? raw.leadId ?? raw.customerId ?? raw._id ?? raw.uuid ?? "").trim()
    || (globalThis.crypto?.randomUUID?.() || `migrated-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const lead = {
    id,
    name: String(pick(raw, "name", "customerName", "customer", "clientName", "fullName", "customer_name") || "").trim() || "Migrated customer",
    phone: String(pick(raw, "phone", "phoneNumber", "mobile", "tel", "telephone", "phone_number") || "").trim(),
    email: String(pick(raw, "email", "emailAddress", "mail", "email_address") || "").trim(),
    source: String(pick(raw, "source", "enquirySource", "leadSource", "origin", "enquiry_source") || "").trim(),
    job: String(pick(raw, "job", "jobDetails", "details", "description", "service", "work", "job_details") || "").trim() || "Migrated enquiry",
    created,
    followUpDate: normalizeDate(pick(raw, "followUpDate", "followupDate", "followUp", "followup", "nextFollowUp", "follow_up_date", "followup_date")),
    nextRepeat: normalizeDate(pick(raw, "nextRepeat", "nextRepeatDate", "repeatDate", "nextBooking", "repeatReminder", "nextService", "next_repeat", "next_booking")),
    repeatInterval: normalizeInterval(pick(raw, "repeatInterval", "interval", "repeat", "frequency", "cadence", "repeat_interval")),
    stage: normalizeStage(pick(raw, "stage", "status", "pipelineStage", "state", "pipeline_stage")),
    preparedMessage: String(pick(raw, "preparedMessage", "message", "draft", "prepared_message") || "").trim(),
    lastPreparedAt: normalizeTimestamp(raw.lastPreparedAt ?? raw.preparedAt ?? raw.last_prepared_at),
    lastOpenedAt: normalizeTimestamp(raw.lastOpenedAt ?? raw.openedAt ?? raw.last_opened_at),
    lastContactConfirmedAt: normalizeTimestamp(raw.lastContactConfirmedAt ?? raw.contactConfirmedAt ?? raw.contactedAt ?? raw.last_contact_confirmed_at),
    updatedAt: normalizeTimestamp(raw.updatedAt ?? raw.modifiedAt ?? raw.updated_at) || new Date().toISOString()
  };
  const q = migrateQuote(raw.quote ?? raw.quotation ?? raw.quoteData ?? raw.quotationData ?? raw.quote_data, created);
  if (q) lead.quote = q;
  // Remove undefined timestamp keys.
  for (const k of ["lastPreparedAt","lastOpenedAt","lastContactConfirmedAt"]) if (lead[k] === undefined) delete lead[k];
  return lead;
}

export function migrateSettings(input) {
  let arr = input;
  if (!Array.isArray(input)) {
    if (input && typeof input === "object") {
      arr = Object.entries(input).map(([key, value]) => ({ key, value }));
    } else {
      arr = [];
    }
  }
  const keyMap = {
    business: "business", businessName: "business", business_name: "business", companyName: "business", company_name: "business", name: "business", organisation: "business", organization: "business",
    email: "email", businessEmail: "email", business_email: "email", mail: "email",
    phone: "phone", businessPhone: "phone", business_phone: "phone", telephone: "phone",
    template: "template", followUpTemplate: "template", follow_up_template: "template", messageTemplate: "template", message_template: "template"
  };
  const out = [];
  const seen = new Set();
  for (const s of arr || []) {
    if (!s || typeof s !== "object" || Array.isArray(s)) continue;
    let key = s.key ?? s.name ?? s.setting ?? s.id ?? s.field;
    key = keyMap[String(key ?? "").trim()] || String(key ?? "").trim();
    if (!["business","email","phone","template"].includes(key)) continue;
    const value = String(s.value ?? s.val ?? s.content ?? s.text ?? "");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ key, value });
  }
  return out;
}

function validQuote(q) {
  if(!q || typeof q!=="object" || typeof q.reference!=="string" || !q.reference.trim() ||
     !validDate(q.date,false) || !Array.isArray(q.items)||!q.items.length) return false;
  try {
    const totals=calculateQuote(q.items,q.discount,q.vat);
    return ["subtotal","discountAmount","vatAmount","total"].every(k=>
      Number.isFinite(Number(q[k])) && Math.abs(Number(q[k])-totals[k])<0.011);
  } catch { return false; }
}
function validLead(l) {
  if(!l||typeof l!=="object"||Array.isArray(l)) return false;
  if(typeof l.id!=="string"||!l.id.trim()||typeof l.name!=="string"||!l.name.trim()||
     typeof l.job!=="string"||!l.job.trim()||!STAGES.includes(l.stage)) return false;
  for(const k of ["phone","email","source","followUpDate","nextRepeat","repeatInterval","preparedMessage"])
    if(l[k]!=null && typeof l[k]!=="string") return false;
  if(!validDate(l.created,false)||!validDate(l.followUpDate)||!validDate(l.nextRepeat)) return false;
  if(l.repeatInterval!=null && !["weekly","fortnightly","monthly","quarterly","yearly",""].includes(l.repeatInterval)) return false;
  if(l.quote!=null&&!validQuote(l.quote)) return false;
  for(const k of ["lastPreparedAt","lastOpenedAt","lastContactConfirmedAt","updatedAt"])
    if(l[k]!=null && (typeof l[k]!=="string"||!Number.isFinite(Date.parse(l[k])))) return false;
  return true;
}
export function validateBackup(input) {
  if(!input||typeof input!=="object"||input.format!=="leadloop-uk-backup"||
     ![1,2].includes(input.version)||!Array.isArray(input.leads)||
     !(Array.isArray(input.settings) || (input.settings && typeof input.settings==="object")))
    throw new Error("Not a supported LeadLoop backup.");
  let leads=input.leads;
  let settings=input.settings;
  if (input.version === 1) {
    leads = leads.map(migrateLead).filter(Boolean);
    settings = migrateSettings(settings);
  }
  const leadsCopy=leads.map(l=>({...l}));
  const ids=new Set(), refs=new Set();
  for(const l of leadsCopy) {
    if(!validLead(l)) throw new Error("Backup contains an invalid enquiry.");
    if(ids.has(l.id)) throw new Error("Backup contains duplicate enquiry IDs.");
    ids.add(l.id);
    if(l.quote) {
      if(refs.has(l.quote.reference)) throw new Error("Backup contains duplicate quote references.");
      refs.add(l.quote.reference);
    }
    l.followUpDate ||= ""; l.nextRepeat ||= ""; l.repeatInterval ||= "";
    l.preparedMessage ||= "";
  }
  const settingsCopy=[], keys=new Set();
  for(const s of settings) {
    if(!s||typeof s.key!=="string"||!["business","email","phone","template"].includes(s.key)||
       typeof s.value!=="string"||s.value.length>3000||keys.has(s.key))
      throw new Error("Backup contains invalid business settings.");
    keys.add(s.key); settingsCopy.push({key:s.key,value:s.value});
  }
  return {format:"leadloop-uk-backup",version:2,leads:leadsCopy,settings:settingsCopy};
}