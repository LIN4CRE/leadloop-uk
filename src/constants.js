export const DB_NAME = "leadloop-uk";
export const DB_VERSION = 3;
export const CACHE_PREFIX = "leadloop-uk-";

export const STAGES = [
  "New enquiry",
  "Contacted",
  "Quotation prepared",
  "Quotation sent",
  "Follow-up required",
  "Accepted / booked",
  "Completed",
  "Lost",
];

export const WON_STAGES = ["Accepted / booked", "Completed", "Won"];
export const CLOSED_STAGES = ["Accepted / booked", "Completed", "Won", "Lost"];
export const ACTIVE_STAGES = STAGES.filter((s) => !CLOSED_STAGES.includes(s));

export const QUOTE_STATUSES = [
  "Draft",
  "Sent",
  "Accepted",
  "Declined",
  "Superseded",
];

export const LINE_CATEGORIES = [
  { value: "service", label: "Service / Work" },
  { value: "labour", label: "Labour" },
  { value: "materials", label: "Materials" },
  { value: "travel", label: "Travel / Call-out" },
];

export const REPEAT_INTERVALS = [
  { value: "", label: "Custom / One-off date" },
  { value: "weekly", label: "Weekly" },
  { value: "fortnightly", label: "Fortnightly (2 weeks)" },
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly (3 months)" },
  { value: "yearly", label: "Annual (12 months)" },
];

export const PAYMENT_STATUSES = [
  { value: "unpaid", label: "Unpaid / Not recorded" },
  { value: "part_paid", label: "Deposit / Part paid" },
  { value: "paid", label: "Paid in full" },
];

export const TRADE_CATEGORIES = [
  "Cleaning",
  "Gardening & Landscaping",
  "Mobile Valeting",
  "Painting & Decorating",
  "Handyman & Repairs",
  "Window & Gutter Cleaning",
  "Other Service",
];

export const DEFAULT_TEMPLATES = [
  {
    id: "tpl-initial",
    name: "Initial enquiry follow-up",
    subject: "Following up on your {job} enquiry",
    body: "Hi {firstName}, thanks for getting in touch about {job}. Just checking if you have any questions or if you would like to arrange a convenient time. Best wishes, {business}",
  },
  {
    id: "tpl-quote",
    name: "Quotation follow-up",
    subject: "Quotation {quoteRef} for {job}",
    body: "Hi {firstName}, just checking you received quotation {quoteRef} ({quoteTotal}) for {job}. Happy to talk through any details whenever suits you. Thanks, {business}",
  },
  {
    id: "tpl-repeat",
    name: "Repeat service reminder",
    subject: "Time for your next {job}",
    body: "Hi {firstName}, hope all is well. Your regular {job} is due around {nextRepeat} — let me know which day works best for you and I will get you booked in. Thanks, {business}",
  },
  {
    id: "tpl-postjob",
    name: "Post-job check-in",
    subject: "Thank you from {business}",
    body: "Hi {firstName}, thanks again for having me round for your {job}. Please let me know if you need anything else in future. Best wishes, {business}",
  },
];

export const DEFAULT_SETTINGS = {
  business: "",
  ownerName: "",
  email: "",
  phone: "",
  address: "",
  postcode: "",
  vatNumber: "",
  defaultVat: "0",
  defaultValidityDays: "30",
  defaultTerms:
    "Quotation valid for 30 days from date of issue. Payment due upon satisfactory completion unless agreed otherwise.",
  template:
    "Hi {name}, just checking in about {job}. Please let me know if you have any questions. Thanks, {business}",
  customTemplates: "[]",
  migrationReport: "",
};

export const ALLOWED_SETTING_KEYS = Object.keys(DEFAULT_SETTINGS);
