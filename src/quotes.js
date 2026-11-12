import { LINE_CATEGORIES, QUOTE_STATUSES } from "./constants.js";
import {
  round2,
  validDate,
  localDateString,
  createId,
  newQuoteReference,
  nextRevisionReference,
} from "./utils.js";

const VALID_CATEGORIES = new Set(LINE_CATEGORIES.map((c) => c.value));

export function calculateQuote(items, discount = 0, vat = 0) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error("Add at least one quote line.");
  }
  discount = Number(discount);
  vat = Number(vat);
  if (
    !Number.isFinite(discount) ||
    discount < 0 ||
    discount > 100 ||
    !Number.isFinite(vat) ||
    vat < 0 ||
    vat > 100
  ) {
    throw new Error("Discount and VAT must be between 0 and 100.");
  }
  const clean = items.map((i) => {
    const description = String(i?.description || "").trim();
    const qty = Number(i?.qty);
    const price = Number(i?.price);
    if (
      !description ||
      description.length > 300 ||
      !Number.isFinite(qty) ||
      qty <= 0 ||
      !Number.isFinite(price) ||
      price < 0
    ) {
      throw new Error(
        "Quote lines need a description, positive quantity and non-negative unit price.",
      );
    }
    const row = { description, qty: round2(qty), price: round2(price) };
    if (i?.category && VALID_CATEGORIES.has(i.category)) {
      row.category = i.category;
    }
    return row;
  });
  const subtotal = round2(
    clean.reduce((s, i) => s + round2(i.qty * i.price), 0),
  );
  const discountAmount = round2((subtotal * discount) / 100);
  const net = round2(subtotal - discountAmount);
  const vatAmount = round2((net * vat) / 100);
  return {
    items: clean,
    discount: round2(discount),
    vat: round2(vat),
    subtotal,
    discountAmount,
    vatAmount,
    total: round2(net + vatAmount),
  };
}

export function calculateDetailedQuote(input = {}) {
  const rawItems = Array.isArray(input.items) ? input.items : [];
  const labourCost = Number(input.labourCost || 0);
  const materialsCost = Number(input.materialsCost || 0);
  const travelCharge = Number(input.travelCharge || 0);

  if (
    !Number.isFinite(labourCost) ||
    labourCost < 0 ||
    !Number.isFinite(materialsCost) ||
    materialsCost < 0 ||
    !Number.isFinite(travelCharge) ||
    travelCharge < 0
  ) {
    throw new Error(
      "Labour, materials and travel charges must be zero or positive amounts.",
    );
  }

  // Synthesize or validate items
  const combinedItems = rawItems.map((i) => {
    const description = String(i?.description || "").trim();
    const qty = Number(i?.qty);
    const price = Number(i?.price);
    const category = VALID_CATEGORIES.has(i?.category) ? i.category : "service";
    if (
      !description ||
      description.length > 300 ||
      !Number.isFinite(qty) ||
      qty <= 0 ||
      !Number.isFinite(price) ||
      price < 0
    ) {
      throw new Error(
        "Each quote line needs a description, positive quantity and non-negative unit price.",
      );
    }
    return {
      category,
      description,
      qty: round2(qty),
      price: round2(price),
    };
  });

  if (labourCost > 0) {
    combinedItems.push({
      category: "labour",
      description: "Labour",
      qty: 1,
      price: round2(labourCost),
    });
  }
  if (materialsCost > 0) {
    combinedItems.push({
      category: "materials",
      description: "Materials",
      qty: 1,
      price: round2(materialsCost),
    });
  }
  if (travelCharge > 0) {
    combinedItems.push({
      category: "travel",
      description: "Travel / Call-out charge",
      qty: 1,
      price: round2(travelCharge),
    });
  }

  if (combinedItems.length === 0) {
    throw new Error("Add at least one line item or cost entry.");
  }

  const discountType = input.discountType === "fixed" ? "fixed" : "percent";
  const discount = Number(input.discount || 0);
  const vat = Number(input.vat || 0);

  if (!Number.isFinite(vat) || vat < 0 || vat > 100) {
    throw new Error("VAT percentage must be between 0 and 100.");
  }
  if (!Number.isFinite(discount) || discount < 0) {
    throw new Error("Discount cannot be negative.");
  }
  if (discountType === "percent" && discount > 100) {
    throw new Error("Percentage discount must be between 0 and 100.");
  }

  const categoryTotals = { service: 0, labour: 0, materials: 0, travel: 0 };
  for (const item of combinedItems) {
    const lineTotal = round2(item.qty * item.price);
    categoryTotals[item.category || "service"] = round2(
      (categoryTotals[item.category || "service"] || 0) + lineTotal,
    );
  }

  const subtotal = round2(
    combinedItems.reduce((sum, i) => sum + round2(i.qty * i.price), 0),
  );
  if (discountType === "fixed" && discount > subtotal) {
    throw new Error("Fixed discount cannot exceed the quotation subtotal.");
  }

  const discountAmount =
    discountType === "fixed"
      ? round2(discount)
      : round2((subtotal * discount) / 100);
  const net = round2(subtotal - discountAmount);
  const vatAmount = round2((net * vat) / 100);
  const total = round2(net + vatAmount);

  return {
    items: combinedItems,
    categoryTotals,
    discountType,
    discount: round2(discount),
    vat: round2(vat),
    subtotal,
    discountAmount,
    net,
    vatAmount,
    total,
  };
}

export function quoteTotal(leadOrQuote) {
  const q = leadOrQuote?.quote ? leadOrQuote.quote : leadOrQuote;
  if (!q || !Array.isArray(q.items) || !q.items.length) return 0;
  if (q.discountType === "fixed") {
    return calculateDetailedQuote(q).total;
  }
  return calculateQuote(q.items, q.discount ?? 0, q.vat ?? 0).total;
}

export function validQuoteObject(q) {
  if (!q || typeof q !== "object" || Array.isArray(q)) return false;
  if (typeof q.reference !== "string" || !q.reference.trim()) return false;
  if (!validDate(q.date, false)) return false;
  if (
    q.expiryDate != null &&
    q.expiryDate !== "" &&
    !validDate(q.expiryDate, false)
  )
    return false;
  if (q.status != null && !QUOTE_STATUSES.includes(q.status)) return false;
  if (!Array.isArray(q.items) || !q.items.length) return false;
  try {
    const totals =
      q.discountType === "fixed"
        ? calculateDetailedQuote(q)
        : calculateQuote(q.items, q.discount, q.vat);
    return ["subtotal", "discountAmount", "vatAmount", "total"].every(
      (k) =>
        Number.isFinite(Number(q[k])) &&
        Math.abs(Number(q[k]) - totals[k]) < 0.015,
    );
  } catch {
    return false;
  }
}

export function buildQuoteRecord({
  existingQuote = null,
  lead,
  customer = null,
  settings = {},
  calculated,
  date = localDateString(),
  expiryDate = "",
  terms = "",
  notes = "",
  existingRefs = new Set(),
  forceNewRevision = false,
}) {
  if (!validDate(date, false)) throw new Error("Enter a valid quotation date.");
  if (expiryDate && !validDate(expiryDate, false))
    throw new Error("Enter a valid quotation expiry date.");
  if (expiryDate && expiryDate < date)
    throw new Error(
      "Quotation expiry date cannot be earlier than the quotation date.",
    );

  const now = new Date().toISOString();
  const shouldRevise = Boolean(
    existingQuote &&
    (forceNewRevision ||
      ["Sent", "Accepted", "Declined"].includes(existingQuote.status)),
  );

  let id = existingQuote?.id || createId("q");
  let reference = existingQuote?.reference || "";
  let version = existingQuote?.version || 1;
  let seriesId = existingQuote?.seriesId || id;
  let supersededQuote = null;

  if (!existingQuote) {
    reference = newQuoteReference(existingRefs, date);
    version = 1;
    seriesId = id;
  } else if (shouldRevise) {
    id = createId("q");
    const rev = nextRevisionReference(
      existingQuote.reference,
      (existingQuote.version || 1) + 1,
      existingRefs,
    );
    reference = rev.reference;
    version = rev.version;
    supersededQuote = {
      ...existingQuote,
      status:
        existingQuote.status === "Draft" ? "Superseded" : existingQuote.status,
      supersededAt: now,
      supersededById: id,
    };
  }

  const customerSnapshot = {
    name: customer?.name || lead?.name || "",
    phone: customer?.phone || lead?.phone || "",
    email: customer?.email || lead?.email || "",
    address: lead?.serviceAddress || customer?.address || "",
    postcode: lead?.postcode || customer?.postcode || "",
  };

  const businessSnapshot = {
    business: settings.business || "",
    ownerName: settings.ownerName || "",
    email: settings.email || "",
    phone: settings.phone || "",
    address: settings.address || "",
    postcode: settings.postcode || "",
    vatNumber: settings.vatNumber || "",
  };

  const quoteRecord = {
    id,
    seriesId,
    version,
    parentQuoteId: shouldRevise
      ? existingQuote.id
      : existingQuote?.parentQuoteId || null,
    leadId: lead.id,
    customerId: lead.customerId || customer?.id || "",
    reference,
    date,
    expiryDate: expiryDate || "",
    status: shouldRevise ? "Draft" : existingQuote?.status || "Draft",
    items: calculated.items,
    categoryTotals: calculated.categoryTotals,
    discountType: calculated.discountType || "percent",
    discount: calculated.discount,
    vat: calculated.vat,
    subtotal: calculated.subtotal,
    discountAmount: calculated.discountAmount,
    net:
      calculated.net ?? round2(calculated.subtotal - calculated.discountAmount),
    vatAmount: calculated.vatAmount,
    total: calculated.total,
    terms: String(terms ?? "").trim(),
    notes: String(notes ?? "").trim(),
    jobSummary: lead.job || "",
    customerSnapshot,
    businessSnapshot,
    sentAt: shouldRevise ? null : existingQuote?.sentAt || null,
    acceptedAt: shouldRevise ? null : existingQuote?.acceptedAt || null,
    declinedAt: shouldRevise ? null : existingQuote?.declinedAt || null,
    createdAt: shouldRevise ? now : existingQuote?.createdAt || now,
    updatedAt: now,
  };

  return { quoteRecord, supersededQuote, isRevision: shouldRevise };
}
