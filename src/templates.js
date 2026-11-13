import { DEFAULT_TEMPLATES } from "./constants.js";
import { formatDisplayDate, money } from "./utils.js";
import { quoteTotal } from "./quotes.js";

export const TEMPLATE_CATEGORIES = [
  { id: "initial", label: "Initial enquiry follow-up" },
  { id: "quote", label: "Outstanding quotation" },
  { id: "repeat", label: "Repeat service reminder" },
  { id: "postjob", label: "Post-job check-in" },
];

export const TEMPLATE_VARIABLES = [
  ["{firstName}", "Customer first name"],
  ["{name}", "Customer full name"],
  ["{job}", "Enquiry / service description"],
  ["{business}", "Your business name"],
  ["{quoteRef}", "Latest quotation reference"],
  ["{quoteTotal}", "Latest quotation total"],
  ["{nextRepeat}", "Next repeat reminder date"],
  ["{phone}", "Your business phone"],
  ["{email}", "Your business email"],
];

export function validateMessageTemplate(template) {
  if (!template || typeof template !== "object" || Array.isArray(template))
    throw new Error("Choose a valid template.");
  const name = String(template.name || "").trim();
  const body = String(template.body || "").trim();
  if (!name || name.length > 80)
    throw new Error("Enter a name (1–80 characters).");
  if (!body || body.length > 2000)
    throw new Error("Enter message content (1–2,000 characters).");
  const category = TEMPLATE_CATEGORIES.some((x) => x.id === template.category)
    ? template.category
    : "initial";
  return {
    id: String(template.id || ""),
    category,
    name,
    subject: String(template.subject || "Following up")
      .trim()
      .slice(0, 140),
    body,
    custom: true,
  };
}

export function parseCustomTemplates(rawJson) {
  if (!rawJson) return [];
  try {
    const parsed = typeof rawJson === "string" ? JSON.parse(rawJson) : rawJson;
    if (!Array.isArray(parsed)) return [];
    return parsed.map((t, idx) =>
      validateMessageTemplate({
        ...t,
        id: t?.id || `custom-${idx}`,
      }),
    );
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
          category: "initial",
          name: "Default business template",
          subject: "Following up on {job}",
          body: primaryBody,
        },
      ]
    : [];
  const custom = parseCustomTemplates(settings.customTemplates);
  const replacements = new Map(custom.map((x) => [x.id, x]));
  const builtins = DEFAULT_TEMPLATES.map((x) => replacements.get(x.id) || x);
  const customOnly = custom.filter(
    (x) => !DEFAULT_TEMPLATES.some((builtin) => builtin.id === x.id),
  );
  return [...primary, ...builtins, ...customOnly];
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
