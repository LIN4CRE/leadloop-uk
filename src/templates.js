import { DEFAULT_TEMPLATES } from "./constants.js";
import { formatDisplayDate, money } from "./utils.js";
import { quoteTotal } from "./quotes.js";

export function parseCustomTemplates(rawJson) {
  if (!rawJson) return [];
  try {
    const parsed = typeof rawJson === "string" ? JSON.parse(rawJson) : rawJson;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (t) =>
          t &&
          typeof t.name === "string" &&
          t.name.trim() &&
          typeof t.body === "string" &&
          t.body.trim(),
      )
      .map((t, idx) => ({
        id: String(t.id || `custom-${idx}`),
        name: t.name.trim().slice(0, 80),
        subject: String(t.subject || "Following up")
          .trim()
          .slice(0, 140),
        body: t.body.trim().slice(0, 2000),
        custom: true,
      }));
  } catch {
    return [];
  }
}

export function getAllTemplates(settings = {}) {
  const primaryBody = String(settings.template || "").trim();
  const primary = primaryBody
    ? [
        {
          id: "tpl-default",
          name: "Default business template",
          subject: "Following up on {job}",
          body: primaryBody,
        },
      ]
    : [];
  const custom = parseCustomTemplates(settings.customTemplates);
  return [...primary, ...DEFAULT_TEMPLATES, ...custom];
}

export function renderMessageTemplate(templateStr, lead = {}, settings = {}) {
  const fullName = String(lead.name || "there").trim();
  const firstName = fullName.split(/\s+/)[0] || fullName;
  const business = String(settings.business || "").trim();
  const qTotal = lead.quote ? money(quoteTotal(lead)) : "";
  const qRef = lead.quote?.reference || "";
  const nextRepeat = lead.nextRepeat ? formatDisplayDate(lead.nextRepeat) : "";

  let text = String(templateStr || "")
    .replaceAll("{name}", fullName)
    .replaceAll("{firstName}", firstName)
    .replaceAll("{job}", String(lead.job || "your enquiry").trim())
    .replaceAll("{business}", business)
    .replaceAll("{quoteRef}", qRef || "your quotation")
    .replaceAll("{quoteTotal}", qTotal || "")
    .replaceAll("{nextRepeat}", nextRepeat || "soon")
    .replaceAll("{phone}", String(settings.phone || "").trim())
    .replaceAll("{email}", String(settings.email || "").trim());

  // Clean up dangling sign-off punctuation if {business} was empty
  if (!business) {
    text = text
      .replace(/,\s*$/g, "")
      .replace(/(Thanks|Best wishes|Kind regards|Regards),\s*$/i, "$1.");
  }
  return text.replace(/[ \t]{2,}/g, " ").trim();
}
