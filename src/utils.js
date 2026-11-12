export function localDateString(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function validDate(value, optional = true) {
  if (value === "" || value == null) return optional;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return false;
  const [y, m, d] = value.split("-").map(Number);
  if (y < 1900 || y > 2200) return false;
  const dt = new Date(y, m - 1, d);
  return (
    dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d
  );
}

export function addDays(dateStr, days) {
  if (!validDate(dateStr, false)) return "";
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + Number(days || 0));
  return localDateString(dt);
}

export function formatDisplayDate(dateStr) {
  if (!dateStr || !validDate(dateStr, false)) return "—";
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function formatDateTime(isoStr) {
  if (!isoStr || !Number.isFinite(Date.parse(isoStr))) return "—";
  return new Date(isoStr).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function daysBetween(fromDateStr, toDateStr) {
  if (!validDate(fromDateStr, false) || !validDate(toDateStr, false)) return 0;
  const [y1, m1, d1] = fromDateStr.split("-").map(Number);
  const [y2, m2, d2] = toDateStr.split("-").map(Number);
  const utc1 = Date.UTC(y1, m1 - 1, d1);
  const utc2 = Date.UTC(y2, m2 - 1, d2);
  return Math.round((utc2 - utc1) / 86400000);
}

export function round2(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return Math.round((num + Number.EPSILON) * 100) / 100;
}

export function normalizeUKPhone(raw) {
  let digits = String(raw || "").replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("440")) digits = "44" + digits.slice(3);
  else if (digits.startsWith("0")) digits = "44" + digits.slice(1);
  if (!digits.startsWith("44") || digits.length < 11 || digits.length > 13)
    return null;
  return digits;
}

export function normalizeUKPostcode(raw) {
  const clean = String(raw || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
  if (!clean) return "";
  // Standard UK postcode outward + inward spacing (last 3 chars are inward code)
  if (/^[A-Z]{1,2}\d[A-Z\d]?\d[A-Z]{2}$/.test(clean)) {
    return `${clean.slice(0, -3)} ${clean.slice(-3)}`;
  }
  return String(raw || "")
    .trim()
    .toUpperCase()
    .slice(0, 16);
}

export function normalizeEmail(raw) {
  return String(raw || "")
    .trim()
    .toLowerCase();
}

export function normalizeNameKey(raw) {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

export function esc(s) {
  return String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[c],
  );
}

const gbpFormatter = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function money(n) {
  return gbpFormatter.format(Number(n) || 0);
}

export function createId(prefix = "") {
  const uuid =
    globalThis.crypto?.randomUUID?.() ||
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return prefix ? `${prefix}-${uuid}` : uuid;
}

export function newQuoteReference(
  existingRefs = new Set(),
  dateStr = localDateString(),
) {
  const day = (
    validDate(dateStr, false) ? dateStr : localDateString()
  ).replaceAll("-", "");
  const refSet =
    existingRefs instanceof Set ? existingRefs : new Set(existingRefs);
  for (let attempt = 0; attempt < 25; attempt++) {
    const suffix = (
      globalThis.crypto?.randomUUID?.() ||
      Math.random().toString(36).slice(2, 10)
    )
      .replace(/-/g, "")
      .slice(0, 6)
      .toUpperCase();
    const candidate = `LL-${day}-${suffix}`;
    if (!refSet.has(candidate)) return candidate;
  }
  return `LL-${day}-${Date.now().toString(36).toUpperCase()}`;
}

export function nextRevisionReference(
  baseRef,
  version,
  existingRefs = new Set(),
) {
  const root = String(baseRef || "").replace(/-R\d+$/i, "");
  const refSet =
    existingRefs instanceof Set ? existingRefs : new Set(existingRefs);
  let v = Math.max(2, Number(version) || 2);
  while (refSet.has(`${root}-R${v}`)) v++;
  return { reference: `${root}-R${v}`, version: v };
}
