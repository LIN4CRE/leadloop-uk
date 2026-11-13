import { STAGES, QUOTE_STATUSES, ALLOWED_SETTING_KEYS } from "./constants.js";
import {
  localDateString,
  validDate,
  normalizeUKPhone,
  normalizeUKPostcode,
  normalizeEmail,
  normalizeNameKey,
  createId,
  round2,
} from "./utils.js";
import { calculateQuote, validQuoteObject } from "./quotes.js";
import { extractDayOfMonth } from "./repeat.js";

const LEGACY_VALID_V2_STAGES = new Set([...STAGES, "Won"]);

function normalizeDate(value) {
  if (value == null || value === "") return "";
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return validDate(value, false) ? value : "";
  }
  const dt = new Date(value);
  if (!Number.isNaN(dt.getTime())) return localDateString(dt);
  return "";
}

function normalizeTimestamp(value) {
  if (value == null || value === "") return undefined;
  if (typeof value === "string") {
    if (Number.isFinite(Date.parse(value)))
      return new Date(Date.parse(value)).toISOString();
    return undefined;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const dt = new Date(value);
    if (!Number.isNaN(dt.getTime())) return dt.toISOString();
  }
  return undefined;
}

export function normalizeInterval(value) {
  const v = String(value ?? "")
    .trim()
    .toLowerCase();
  const map = {
    weekly: "weekly",
    week: "weekly",
    w: "weekly",
    fortnightly: "fortnightly",
    biweekly: "fortnightly",
    "bi-weekly": "fortnightly",
    "two-weekly": "fortnightly",
    monthly: "monthly",
    month: "monthly",
    m: "monthly",
    quarterly: "quarterly",
    quarter: "quarterly",
    q: "quarterly",
    yearly: "yearly",
    annual: "yearly",
    annually: "yearly",
    year: "yearly",
    y: "yearly",
    custom: "",
    oneoff: "",
    "one-off": "",
    none: "",
    "": "",
  };
  return Object.prototype.hasOwnProperty.call(map, v) ? map[v] : "";
}

export function normalizeStage(value) {
  if (STAGES.includes(value)) return value;
  const key = String(value ?? "")
    .trim()
    .toLowerCase();
  const map = {
    "new enquiry": "New enquiry",
    new: "New enquiry",
    "new lead": "New enquiry",
    enquiry: "New enquiry",
    lead: "New enquiry",
    contacted: "Contacted",
    contact: "Contacted",
    "quotation prepared": "Quotation prepared",
    "quote prepared": "Quotation prepared",
    quoted: "Quotation prepared",
    quote: "Quotation prepared",
    quotation: "Quotation prepared",
    "quotation sent": "Quotation sent",
    "quote sent": "Quotation sent",
    sent: "Quotation sent",
    "follow-up required": "Follow-up required",
    "follow up required": "Follow-up required",
    "follow-up": "Follow-up required",
    "follow up": "Follow-up required",
    followup: "Follow-up required",
    "accepted / booked": "Accepted / booked",
    accepted: "Accepted / booked",
    booked: "Accepted / booked",
    won: "Accepted / booked",
    "closed won": "Accepted / booked",
    complete: "Completed",
    completed: "Completed",
    "job completed": "Completed",
    finished: "Completed",
    lost: "Lost",
    declined: "Lost",
    "closed lost": "Lost",
    cancelled: "Lost",
    canceled: "Lost",
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
  const reference = String(
    raw.reference ?? raw.ref ?? raw.quoteReference ?? raw.id ?? "",
  ).trim();
  const date =
    normalizeDate(raw.date ?? raw.quoteDate ?? raw.createdAt ?? raw.created) ||
    (fallbackDate ? normalizeDate(fallbackDate) : "") ||
    localDateString();
  const expiryDate = normalizeDate(
    raw.expiryDate ?? raw.validUntil ?? raw.expiresAt ?? "",
  );
  const discount = Number(
    raw.discount ?? raw.discountPercent ?? raw.discount_percentage ?? 0,
  );
  const vat = Number(
    raw.vat ?? raw.vatPercent ?? raw.vat_percentage ?? raw.tax ?? 0,
  );
  const srcItems = Array.isArray(raw.items)
    ? raw.items
    : Array.isArray(raw.lines)
      ? raw.lines
      : Array.isArray(raw.quoteItems)
        ? raw.quoteItems
        : Array.isArray(raw.lineItems)
          ? raw.lineItems
          : [];
  const items = srcItems
    .map((i) => {
      const item = {
        description: String(
          i?.description ?? i?.name ?? i?.item ?? i?.desc ?? i?.title ?? "",
        ).trim(),
        qty: Number(i?.qty ?? i?.quantity ?? i?.count ?? i?.units ?? 1),
        price: Number(
          i?.price ?? i?.unitPrice ?? i?.unit_price ?? i?.cost ?? i?.rate ?? 0,
        ),
      };
      if (
        i?.category &&
        ["service", "labour", "materials", "travel"].includes(i.category)
      ) {
        item.category = i.category;
      }
      return item;
    })
    .filter((i) => i.description);
  if (!items.length) return undefined;
  try {
    const safeDiscount =
      Number.isFinite(discount) && discount >= 0 && discount <= 100
        ? discount
        : 0;
    const safeVat = Number.isFinite(vat) && vat >= 0 && vat <= 100 ? vat : 0;
    const calc = calculateQuote(items, safeDiscount, safeVat);
    const out = {
      ...calc,
      reference:
        reference ||
        `LL-MIGRATED-${Math.random().toString(36).slice(2, 10).toUpperCase()}`,
      date,
    };
    if (expiryDate) out.expiryDate = expiryDate;
    if (raw.status && QUOTE_STATUSES.includes(raw.status))
      out.status = raw.status;
    if (raw.terms) out.terms = String(raw.terms).trim();
    if (raw.version && Number.isInteger(raw.version)) out.version = raw.version;
    return out;
  } catch {
    return undefined;
  }
}

export function migrateLead(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const rawName = String(
    pick(
      raw,
      "name",
      "customerName",
      "customer",
      "clientName",
      "fullName",
      "customer_name",
    ) || "",
  ).trim();
  const rawJob = String(
    pick(
      raw,
      "job",
      "jobDetails",
      "details",
      "description",
      "service",
      "work",
      "job_details",
    ) || "",
  ).trim();
  const rawPhone = String(
    pick(
      raw,
      "phone",
      "phoneNumber",
      "mobile",
      "tel",
      "telephone",
      "phone_number",
    ) || "",
  ).trim();
  const rawEmail = String(
    pick(raw, "email", "emailAddress", "mail", "email_address") || "",
  ).trim();

  // Reject completely empty/corrupt objects that contain no recognisable enquiry or contact fields
  if (
    !rawName &&
    !rawJob &&
    !rawPhone &&
    !rawEmail &&
    !raw.quote &&
    !raw.quotation
  ) {
    return null;
  }

  const createdRaw = pick(
    raw,
    "created",
    "createdAt",
    "enquiryDate",
    "enquiry_date",
    "date",
    "createdOn",
    "created_at",
  );
  const created = normalizeDate(createdRaw) || localDateString();
  const id =
    String(raw.id ?? raw.leadId ?? raw._id ?? raw.uuid ?? "").trim() ||
    createId("migrated");

  const nextRepeat = normalizeDate(
    pick(
      raw,
      "nextRepeat",
      "nextRepeatDate",
      "repeatDate",
      "nextBooking",
      "repeatReminder",
      "nextService",
      "next_repeat",
      "next_booking",
    ),
  );
  const repeatInterval = normalizeInterval(
    pick(
      raw,
      "repeatInterval",
      "interval",
      "repeat",
      "frequency",
      "cadence",
      "repeat_interval",
    ),
  );

  const stage = normalizeStage(
    pick(raw, "stage", "status", "pipelineStage", "state", "pipeline_stage"),
  );
  const paidAmountNum = Number(raw.paidAmount ?? raw.amountPaid ?? 0);
  const safePaid =
    Number.isFinite(paidAmountNum) && paidAmountNum > 0
      ? round2(paidAmountNum)
      : 0;
  const estNum =
    raw.estimatedValue != null && raw.estimatedValue !== ""
      ? Number(raw.estimatedValue)
      : null;

  const lead = {
    id,
    customerId: String(raw.customerId || "").trim(),
    name: rawName || "Unnamed customer",
    phone: rawPhone,
    email: rawEmail,
    serviceAddress: String(
      pick(
        raw,
        "serviceAddress",
        "address",
        "propertyAddress",
        "siteAddress",
      ) || "",
    ).trim(),
    postcode: normalizeUKPostcode(
      pick(raw, "postcode", "postCode", "zip", "postal_code"),
    ),
    source: String(
      pick(
        raw,
        "source",
        "enquirySource",
        "leadSource",
        "origin",
        "enquiry_source",
      ) || "",
    ).trim(),
    job: rawJob || "General service enquiry",
    jobCategory: String(raw.jobCategory || raw.category || "").trim(),
    notes: String(pick(raw, "notes", "enquiryNotes", "jobNotes") || "").trim(),
    estimatedValue:
      estNum !== null && Number.isFinite(estNum) && estNum >= 0
        ? round2(estNum)
        : null,
    created,
    scheduledDate: normalizeDate(raw.scheduledDate ?? raw.bookedDate ?? ""),
    completedDate: normalizeDate(
      raw.completedDate ?? (stage === "Completed" ? raw.updatedAt : ""),
    ),
    followUpDate: normalizeDate(
      pick(
        raw,
        "followUpDate",
        "followupDate",
        "followUp",
        "followup",
        "nextFollowUp",
        "follow_up_date",
        "followup_date",
      ),
    ),
    nextRepeat,
    repeatInterval,
    repeatAnchorDay: Number.isInteger(raw.repeatAnchorDay)
      ? raw.repeatAnchorDay
      : nextRepeat
        ? extractDayOfMonth(nextRepeat)
        : null,
    repeatActive: raw.repeatActive === false ? false : true,
    stage,
    lostReason: String(raw.lostReason || "").trim(),
    paymentStatus: ["unpaid", "part_paid", "paid"].includes(raw.paymentStatus)
      ? raw.paymentStatus
      : safePaid > 0
        ? "paid"
        : "unpaid",
    paidAmount: safePaid,
    paidDate: normalizeDate(raw.paidDate || ""),
    paymentMethod: String(raw.paymentMethod || "").trim(),
    preparedMessage: String(
      pick(raw, "preparedMessage", "message", "draft", "prepared_message") ||
        "",
    ).trim(),
    lastPreparedAt: normalizeTimestamp(
      raw.lastPreparedAt ?? raw.preparedAt ?? raw.last_prepared_at,
    ),
    lastOpenedAt: normalizeTimestamp(
      raw.lastOpenedAt ?? raw.openedAt ?? raw.last_opened_at,
    ),
    lastContactConfirmedAt: normalizeTimestamp(
      raw.lastContactConfirmedAt ??
        raw.contactConfirmedAt ??
        raw.contactedAt ??
        raw.last_contact_confirmed_at,
    ),
    stageHistory: Array.isArray(raw.stageHistory) ? raw.stageHistory : [],
    updatedAt:
      normalizeTimestamp(raw.updatedAt ?? raw.modifiedAt ?? raw.updated_at) ||
      new Date().toISOString(),
  };

  const rawQuoteCandidate =
    raw.quote ??
    raw.quotation ??
    raw.quoteData ??
    raw.quotationData ??
    raw.quote_data;
  const q = migrateQuote(rawQuoteCandidate, created);
  if (q) lead.quote = q;

  for (const k of [
    "lastPreparedAt",
    "lastOpenedAt",
    "lastContactConfirmedAt",
  ]) {
    if (lead[k] === undefined) delete lead[k];
  }
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
    business: "business",
    businessName: "business",
    business_name: "business",
    companyName: "business",
    company_name: "business",
    name: "business",
    organisation: "business",
    organization: "business",
    ownerName: "ownerName",
    owner: "ownerName",
    email: "email",
    businessEmail: "email",
    business_email: "email",
    mail: "email",
    phone: "phone",
    businessPhone: "phone",
    business_phone: "phone",
    telephone: "phone",
    address: "address",
    businessAddress: "address",
    postcode: "postcode",
    businessPostcode: "postcode",
    vatNumber: "vatNumber",
    defaultVat: "defaultVat",
    defaultValidityDays: "defaultValidityDays",
    defaultTerms: "defaultTerms",
    template: "template",
    followUpTemplate: "template",
    follow_up_template: "template",
    messageTemplate: "template",
    message_template: "template",
    customTemplates: "customTemplates",
    migrationReport: "migrationReport",
  };
  const out = [];
  const seen = new Set();
  for (const s of arr || []) {
    if (!s || typeof s !== "object" || Array.isArray(s)) continue;
    let key = s.key ?? s.name ?? s.setting ?? s.id ?? s.field;
    key = keyMap[String(key ?? "").trim()] || String(key ?? "").trim();
    if (!ALLOWED_SETTING_KEYS.includes(key)) continue;
    const value = String(s.value ?? s.val ?? s.content ?? s.text ?? "");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ key, value: value.slice(0, 10000) });
  }
  return out;
}

/**
 * Finds an unambiguous matching customer in `customers` for `candidate`.
 * NEVER merges ambiguous records:
 * - Requires exact normalized name match PLUS at least one shared strong contact identifier
 *   (normalized UK phone or normalized email) AND zero conflicting contact identifiers.
 */
export function findUnambiguousCustomerMatch(customers, candidate) {
  if (!Array.isArray(customers) || !candidate) return null;
  if (candidate.customerId) {
    const byId = customers.find((c) => c.id === candidate.customerId);
    if (byId) return byId;
  }
  const candName = normalizeNameKey(candidate.name);
  if (!candName) return null;

  const candPhone =
    normalizeUKPhone(candidate.phone) ||
    String(candidate.phone || "").replace(/\D/g, "");
  const candEmail = normalizeEmail(candidate.email);

  // Without phone or email, two records with the same name ("John Smith") are ambiguous — never auto-merge.
  if (!candPhone && !candEmail) return null;

  const sameName = customers.filter(
    (c) => normalizeNameKey(c.name) === candName,
  );
  const matches = sameName.filter((c) => {
    const cPhone =
      c.normalizedPhone ||
      normalizeUKPhone(c.phone) ||
      String(c.phone || "").replace(/\D/g, "");
    const cEmail = normalizeEmail(c.email);

    if (candPhone && cPhone && candPhone !== cPhone) return false;
    if (candEmail && cEmail && candEmail !== cEmail) return false;

    const phoneMatches = Boolean(candPhone && cPhone && candPhone === cPhone);
    const emailMatches = Boolean(candEmail && cEmail && candEmail === cEmail);
    return phoneMatches || emailMatches;
  });

  return matches.length === 1 ? matches[0] : null;
}

/**
 * Identifies potential duplicate customers to warn the user in the UI without auto-merging.
 */
export function findPotentialDuplicates(
  customers,
  candidate,
  excludeId = null,
) {
  if (!Array.isArray(customers) || !candidate) return [];
  const candName = normalizeNameKey(candidate.name);
  const candPhone =
    normalizeUKPhone(candidate.phone) ||
    String(candidate.phone || "").replace(/\D/g, "");
  const candEmail = normalizeEmail(candidate.email);

  return customers.filter((c) => {
    if (excludeId && c.id === excludeId) return false;
    const cName = normalizeNameKey(c.name);
    const cPhone =
      c.normalizedPhone ||
      normalizeUKPhone(c.phone) ||
      String(c.phone || "").replace(/\D/g, "");
    const cEmail = normalizeEmail(c.email);

    if (candPhone && candPhone.length >= 10 && cPhone === candPhone)
      return true;
    if (candEmail && cEmail && cEmail === candEmail) return true;
    if (candName && candName.length >= 3 && cName === candName) return true;
    return false;
  });
}

export function buildCustomerFromLead(lead) {
  const now = lead.updatedAt || new Date().toISOString();
  return {
    id: lead.customerId || createId("cust"),
    name: String(lead.name || "").trim() || "Unnamed customer",
    phone: String(lead.phone || "").trim(),
    normalizedPhone: normalizeUKPhone(lead.phone) || "",
    email: normalizeEmail(lead.email),
    address: String(lead.serviceAddress || "").trim(),
    postcode: normalizeUKPostcode(lead.postcode),
    notes: "",
    createdAt: lead.created ? `${lead.created}T09:00:00.000Z` : now,
    updatedAt: now,
  };
}

export function linkLeadsToCustomers(leads, existingCustomers = []) {
  const customers = existingCustomers.map((c) => ({
    ...c,
    normalizedPhone: c.normalizedPhone || normalizeUKPhone(c.phone) || "",
    email: normalizeEmail(c.email),
    postcode: normalizeUKPostcode(c.postcode),
  }));

  const updatedLeads = leads.map((lead) => {
    const copy = { ...lead };
    let matched = findUnambiguousCustomerMatch(customers, copy);
    if (!matched) {
      matched = buildCustomerFromLead({
        ...copy,
        customerId: copy.customerId || createId("cust"),
      });
      customers.push(matched);
    } else {
      // Backfill missing contact/address fields on customer without overwriting existing values
      if (!matched.phone && copy.phone) {
        matched.phone = copy.phone;
        matched.normalizedPhone = normalizeUKPhone(copy.phone) || "";
      }
      if (!matched.email && copy.email)
        matched.email = normalizeEmail(copy.email);
      if (!matched.address && copy.serviceAddress)
        matched.address = copy.serviceAddress;
      if (!matched.postcode && copy.postcode)
        matched.postcode = normalizeUKPostcode(copy.postcode);
    }
    copy.customerId = matched.id;
    return copy;
  });

  return { customers, leads: updatedLeads };
}

export function deriveQuotesAndActivitiesFromLeads(
  leads,
  existingQuotes = [],
  existingActivities = [],
) {
  const quotes = [...existingQuotes];
  const activities = [...existingActivities];
  const quoteRefs = new Set(quotes.map((q) => q.reference));
  const leadsWithQuoteIds = leads.map((l) => {
    const copy = { ...l };
    if (
      copy.quote &&
      !quotes.some(
        (q) => q.leadId === copy.id && q.reference === copy.quote.reference,
      )
    ) {
      let ref = copy.quote.reference;
      if (quoteRefs.has(ref)) {
        ref = `${ref}-${copy.id.slice(0, 4).toUpperCase()}`;
        copy.quote = { ...copy.quote, reference: ref };
      }
      quoteRefs.add(ref);
      const qId = copy.activeQuoteId || createId("q");
      copy.activeQuoteId = qId;
      quotes.push({
        id: qId,
        seriesId: qId,
        version: copy.quote.version || 1,
        parentQuoteId: null,
        leadId: copy.id,
        customerId: copy.customerId || "",
        reference: ref,
        date: copy.quote.date || copy.created || localDateString(),
        expiryDate: copy.quote.expiryDate || "",
        status:
          copy.quote.status && QUOTE_STATUSES.includes(copy.quote.status)
            ? copy.quote.status
            : "Draft",
        items: copy.quote.items,
        discountType: copy.quote.discountType || "percent",
        discount: copy.quote.discount || 0,
        vat: copy.quote.vat || 0,
        subtotal: copy.quote.subtotal,
        discountAmount: copy.quote.discountAmount,
        net: round2(copy.quote.subtotal - copy.quote.discountAmount),
        vatAmount: copy.quote.vatAmount,
        total: copy.quote.total,
        terms: copy.quote.terms || "",
        notes: copy.quote.notes || "",
        jobSummary: copy.job || "",
        customerSnapshot: {
          name: copy.name || "",
          phone: copy.phone || "",
          email: copy.email || "",
          address: copy.serviceAddress || "",
          postcode: copy.postcode || "",
        },
        businessSnapshot: {},
        createdAt: `${copy.quote.date || copy.created || localDateString()}T10:00:00.000Z`,
        updatedAt: copy.updatedAt || new Date().toISOString(),
      });
    }

    if (!activities.some((a) => a.leadId === copy.id)) {
      if (copy.lastPreparedAt) {
        activities.push({
          id: createId("act"),
          leadId: copy.id,
          customerId: copy.customerId || "",
          type: "draft_prepared",
          summary: "Follow-up message draft prepared",
          channel: "",
          message: copy.preparedMessage || "",
          createdAt: copy.lastPreparedAt,
        });
      }
      if (copy.lastOpenedAt) {
        activities.push({
          id: createId("act"),
          leadId: copy.id,
          customerId: copy.customerId || "",
          type: "whatsapp_opened",
          summary: "Message application link opened",
          channel: "",
          message: copy.preparedMessage || "",
          createdAt: copy.lastOpenedAt,
        });
      }
      if (copy.lastContactConfirmedAt) {
        activities.push({
          id: createId("act"),
          leadId: copy.id,
          customerId: copy.customerId || "",
          type: "contact_confirmed",
          summary: "Customer contact confirmed by user",
          channel: "",
          message: "",
          createdAt: copy.lastContactConfirmedAt,
        });
      }
    }
    return copy;
  });

  return { leads: leadsWithQuoteIds, quotes, activities };
}

export function validLeadRecord(l, allowLegacyWon = false) {
  if (!l || typeof l !== "object" || Array.isArray(l)) return false;
  if (
    typeof l.id !== "string" ||
    !l.id.trim() ||
    typeof l.name !== "string" ||
    !l.name.trim() ||
    typeof l.job !== "string" ||
    !l.job.trim()
  ) {
    return false;
  }
  const validStage = allowLegacyWon
    ? LEGACY_VALID_V2_STAGES.has(l.stage)
    : STAGES.includes(l.stage);
  if (!validStage) return false;

  for (const k of [
    "phone",
    "email",
    "source",
    "followUpDate",
    "nextRepeat",
    "repeatInterval",
    "preparedMessage",
  ]) {
    if (l[k] != null && typeof l[k] !== "string") return false;
  }
  if (
    !validDate(l.created, false) ||
    !validDate(l.followUpDate) ||
    !validDate(l.nextRepeat)
  )
    return false;
  if (l.scheduledDate != null && !validDate(l.scheduledDate)) return false;
  if (l.completedDate != null && !validDate(l.completedDate)) return false;
  if (
    l.repeatInterval != null &&
    !["weekly", "fortnightly", "monthly", "quarterly", "yearly", ""].includes(
      l.repeatInterval,
    )
  ) {
    return false;
  }
  if (l.quote != null && !validQuoteObject(l.quote)) return false;
  for (const k of [
    "lastPreparedAt",
    "lastOpenedAt",
    "lastContactConfirmedAt",
    "updatedAt",
  ]) {
    if (
      l[k] != null &&
      (typeof l[k] !== "string" || !Number.isFinite(Date.parse(l[k])))
    )
      return false;
  }
  return true;
}

export function validCustomerRecord(c) {
  if (!c || typeof c !== "object" || Array.isArray(c)) return false;
  if (typeof c.id !== "string" || !c.id.trim()) return false;
  if (typeof c.name !== "string" || !c.name.trim() || c.name.length > 200)
    return false;
  for (const k of ["phone", "email", "address", "postcode", "notes"]) {
    if (c[k] != null && typeof c[k] !== "string") return false;
  }
  return true;
}

export function validVisitRecord(v) {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  if (typeof v.id !== "string" || !v.id.trim()) return false;
  if (typeof v.leadId !== "string" || !v.leadId.trim()) return false;
  if (!validDate(v.completedDate, false)) return false;
  if (v.scheduledFor != null && !validDate(v.scheduledFor)) return false;
  if (v.nextScheduledDate != null && !validDate(v.nextScheduledDate))
    return false;
  if (
    v.amountPaid != null &&
    (!Number.isFinite(Number(v.amountPaid)) || Number(v.amountPaid) < 0)
  )
    return false;
  return true;
}

export function validActivityRecord(a) {
  if (!a || typeof a !== "object" || Array.isArray(a)) return false;
  if (typeof a.id !== "string" || !a.id.trim()) return false;
  if (typeof a.summary !== "string" || !a.summary.trim()) return false;
  if (
    typeof a.createdAt !== "string" ||
    !Number.isFinite(Date.parse(a.createdAt))
  )
    return false;
  return true;
}

export function validateBackup(input) {
  if (
    !input ||
    typeof input !== "object" ||
    input.format !== "leadloop-uk-backup" ||
    ![1, 2, 3].includes(input.version) ||
    !Array.isArray(input.leads) ||
    !(
      Array.isArray(input.settings) ||
      (input.settings && typeof input.settings === "object")
    )
  ) {
    throw new Error("Not a supported LeadLoop backup.");
  }

  let rawLeads = input.leads;
  let rawSettings = input.settings;
  const isV1 = input.version === 1;
  const isV2 = input.version === 2;

  if (isV1) {
    const migratedLeads = [];
    for (const item of rawLeads) {
      const m = migrateLead(item);
      if (!m)
        throw new Error("Backup contains an unrecoverable enquiry record.");
      migratedLeads.push(m);
    }
    rawLeads = migratedLeads;
    rawSettings = migrateSettings(rawSettings);
  }

  const leadsCopy = [];
  const leadIds = new Set();
  const activeQuoteRefs = new Set();

  for (const raw of rawLeads) {
    if (!validLeadRecord(raw, isV2)) {
      throw new Error("Backup contains an invalid enquiry.");
    }
    if (leadIds.has(raw.id)) {
      throw new Error("Backup contains duplicate enquiry IDs.");
    }
    leadIds.add(raw.id);

    const normalizedStage =
      raw.stage === "Won" ? "Accepted / booked" : raw.stage;
    const copy = {
      ...raw,
      stage: normalizedStage,
      customerId: String(raw.customerId || "").trim(),
      serviceAddress: String(raw.serviceAddress || "").trim(),
      postcode: normalizeUKPostcode(raw.postcode || ""),
      jobCategory: String(raw.jobCategory || "").trim(),
      notes: String(raw.notes || "").trim(),
      followUpDate: raw.followUpDate || "",
      nextRepeat: raw.nextRepeat || "",
      repeatInterval: raw.repeatInterval || "",
      repeatAnchorDay: Number.isInteger(raw.repeatAnchorDay)
        ? raw.repeatAnchorDay
        : raw.nextRepeat
          ? extractDayOfMonth(raw.nextRepeat)
          : null,
      repeatActive: raw.repeatActive === false ? false : true,
      preparedMessage: raw.preparedMessage || "",
      paymentStatus: ["unpaid", "part_paid", "paid"].includes(raw.paymentStatus)
        ? raw.paymentStatus
        : "unpaid",
      paidAmount:
        Number.isFinite(Number(raw.paidAmount)) && Number(raw.paidAmount) > 0
          ? round2(raw.paidAmount)
          : 0,
      paidDate: raw.paidDate || "",
      paymentMethod: String(raw.paymentMethod || "").trim(),
      updatedAt: raw.updatedAt || new Date().toISOString(),
    };

    if (copy.quote) {
      if (activeQuoteRefs.has(copy.quote.reference)) {
        throw new Error("Backup contains duplicate quote references.");
      }
      activeQuoteRefs.add(copy.quote.reference);
    }
    leadsCopy.push(copy);
  }

  // Validate settings strictly
  const settingsArr = Array.isArray(rawSettings)
    ? rawSettings
    : migrateSettings(rawSettings);
  const settingsCopy = [];
  const settingKeys = new Set();
  for (const s of settingsArr) {
    if (
      !s ||
      typeof s.key !== "string" ||
      !ALLOWED_SETTING_KEYS.includes(s.key) ||
      typeof s.value !== "string" ||
      s.value.length > 20000 ||
      settingKeys.has(s.key)
    ) {
      throw new Error("Backup contains invalid business settings.");
    }
    settingKeys.add(s.key);
    settingsCopy.push({ key: s.key, value: s.value });
  }

  // Validate optional v3 collections (customers, quotes, visits, activities, quarantine)
  let customersCopy = [];
  if (input.customers != null) {
    if (!Array.isArray(input.customers))
      throw new Error("Backup customers collection must be an array.");
    const custIds = new Set();
    for (const c of input.customers) {
      if (!validCustomerRecord(c))
        throw new Error("Backup contains an invalid customer record.");
      if (custIds.has(c.id))
        throw new Error("Backup contains duplicate customer IDs.");
      custIds.add(c.id);
      customersCopy.push({
        ...c,
        normalizedPhone: normalizeUKPhone(c.phone) || "",
        email: normalizeEmail(c.email),
        postcode: normalizeUKPostcode(c.postcode),
      });
    }
  }

  const linked = linkLeadsToCustomers(leadsCopy, customersCopy);
  customersCopy = linked.customers;
  let finalLeads = linked.leads;

  let quotesCopy = [];
  if (input.quotes != null) {
    if (!Array.isArray(input.quotes))
      throw new Error("Backup quotes collection must be an array.");
    const qIds = new Set();
    const qRefs = new Set();
    for (const q of input.quotes) {
      if (
        !q ||
        typeof q.id !== "string" ||
        !q.id.trim() ||
        !validQuoteObject(q)
      ) {
        throw new Error("Backup contains an invalid quotation record.");
      }
      if (qIds.has(q.id))
        throw new Error("Backup contains duplicate quotation IDs.");
      if (qRefs.has(q.reference))
        throw new Error("Backup contains duplicate quote references.");
      qIds.add(q.id);
      qRefs.add(q.reference);
      quotesCopy.push({ ...q });
    }
  }

  let visitsCopy = [];
  if (input.visits != null) {
    if (!Array.isArray(input.visits))
      throw new Error("Backup visits collection must be an array.");
    const vIds = new Set();
    for (const v of input.visits) {
      if (!validVisitRecord(v))
        throw new Error("Backup contains an invalid repeat visit record.");
      if (vIds.has(v.id))
        throw new Error("Backup contains duplicate visit IDs.");
      vIds.add(v.id);
      visitsCopy.push({ ...v });
    }
  }

  let activitiesCopy = [];
  if (input.activities != null) {
    if (!Array.isArray(input.activities))
      throw new Error("Backup activities collection must be an array.");
    const aIds = new Set();
    for (const a of input.activities) {
      if (!validActivityRecord(a))
        throw new Error("Backup contains an invalid activity record.");
      if (aIds.has(a.id))
        throw new Error("Backup contains duplicate activity IDs.");
      aIds.add(a.id);
      activitiesCopy.push({ ...a });
    }
  }

  const derived = deriveQuotesAndActivitiesFromLeads(
    finalLeads,
    quotesCopy,
    activitiesCopy,
  );
  finalLeads = derived.leads;
  quotesCopy = derived.quotes;
  activitiesCopy = derived.activities;

  const customersById = new Map(customersCopy.map((c) => [c.id, c]));
  const leadsById = new Map(finalLeads.map((l) => [l.id, l]));
  for (const lead of finalLeads) {
    if (!customersById.has(lead.customerId))
      throw new Error("Backup enquiry refers to a missing customer.");
  }
  for (const quote of quotesCopy) {
    const lead = leadsById.get(quote.leadId);
    if (
      !lead ||
      !customersById.has(quote.customerId) ||
      quote.customerId !== lead.customerId
    )
      throw new Error(
        "Backup quotation refers to a missing or mismatched enquiry/customer.",
      );
  }
  for (const visit of visitsCopy) {
    const lead = leadsById.get(visit.leadId);
    if (!lead || (visit.customerId && visit.customerId !== lead.customerId))
      throw new Error(
        "Backup visit refers to a missing or mismatched enquiry/customer.",
      );
    if (visit.customerId && !customersById.has(visit.customerId))
      throw new Error("Backup visit refers to a missing customer.");
  }
  for (const activity of activitiesCopy) {
    const lead = activity.leadId ? leadsById.get(activity.leadId) : null;
    if (activity.leadId && !lead)
      throw new Error("Backup activity refers to a missing enquiry.");
    if (activity.customerId && !customersById.has(activity.customerId))
      throw new Error("Backup activity refers to a missing customer.");
    if (lead && activity.customerId && activity.customerId !== lead.customerId)
      throw new Error(
        "Backup activity refers to a mismatched enquiry/customer.",
      );
  }

  const quarantineCopy = [];
  if (input.quarantine != null) {
    if (!Array.isArray(input.quarantine)) {
      throw new Error("Backup quarantine collection must be an array.");
    }
    const quarantineIds = new Set();
    for (const q of input.quarantine) {
      if (
        !q ||
        typeof q !== "object" ||
        Array.isArray(q) ||
        typeof q.id !== "string" ||
        !q.id.trim()
      ) {
        throw new Error(
          "Backup contains an invalid quarantined recovery record.",
        );
      }
      if (quarantineIds.has(q.id))
        throw new Error("Backup contains duplicate quarantine IDs.");
      if (q.reason != null && typeof q.reason !== "string")
        throw new Error("Backup quarantine reason must be text.");
      quarantineIds.add(q.id);
      quarantineCopy.push({ ...q });
    }
  }

  return {
    format: "leadloop-uk-backup",
    version: 3,
    customers: customersCopy,
    leads: finalLeads,
    quotes: quotesCopy,
    visits: visitsCopy,
    activities: activitiesCopy,
    settings: settingsCopy,
    quarantine: quarantineCopy,
  };
}
