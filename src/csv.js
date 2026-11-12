import { quoteTotal } from "./quotes.js";

/**
 * Neutralises spreadsheet formula injection (OWASP CSV Injection mitigation):
 * Prefixes a single quote if the cell begins with =, +, -, @, |, tab, CR, LF,
 * or leading whitespace followed by any formula trigger character.
 */
export function escapeCsvCell(value) {
  let s = String(value ?? "");
  if (/^[\t\r\n]/.test(s) || /^\s*[=+\-@|]/.test(s)) {
    s = "'" + s;
  }
  return `"${s.replaceAll('"', '""')}"`;
}

export function toCsvString(headers, rows) {
  const allRows = [headers, ...rows];
  return (
    "\uFEFF" +
    allRows.map((row) => row.map(escapeCsvCell).join(",")).join("\r\n")
  );
}

export function generateEnquiriesCsv(leads = []) {
  const headers = [
    "Enquiry ID",
    "Customer ID",
    "Customer Name",
    "Phone",
    "Email",
    "Service Address",
    "Postcode",
    "Job Details",
    "Category",
    "Source",
    "Enquiry Date",
    "Stage",
    "Estimated Value GBP",
    "Quote Reference",
    "Quote Status",
    "Quote Total GBP",
    "Payment Status",
    "Confirmed Paid GBP",
    "Follow-up Date",
    "Repeat Reminder Date",
    "Repeat Interval",
    "Draft Prepared At",
    "Message Link Opened At",
    "Contact Confirmed At",
    "Notes",
  ];
  const rows = leads.map((l) => [
    l.id || "",
    l.customerId || "",
    l.name || "",
    l.phone || "",
    l.email || "",
    l.serviceAddress || "",
    l.postcode || "",
    l.job || "",
    l.jobCategory || "",
    l.source || "",
    l.created || "",
    l.stage || "",
    l.estimatedValue != null && l.estimatedValue !== ""
      ? Number(l.estimatedValue).toFixed(2)
      : "",
    l.quote?.reference || "",
    l.quote?.status || "",
    l.quote ? quoteTotal(l).toFixed(2) : "",
    l.paymentStatus || "unpaid",
    Number(l.paidAmount) > 0 ? Number(l.paidAmount).toFixed(2) : "0.00",
    l.followUpDate || "",
    l.nextRepeat || "",
    l.repeatInterval || "",
    l.lastPreparedAt || "",
    l.lastOpenedAt || "",
    l.lastContactConfirmedAt || "",
    l.notes || "",
  ]);
  return toCsvString(headers, rows);
}

export function generateCustomersCsv(customers = [], leads = [], visits = []) {
  const headers = [
    "Customer ID",
    "Name",
    "Phone",
    "Email",
    "Address",
    "Postcode",
    "Enquiries Count",
    "Completed Visits Count",
    "Next Scheduled Service",
    "Notes",
  ];
  const rows = customers.map((c) => {
    const cLeads = leads.filter((l) => l.customerId === c.id);
    const cVisits = visits.filter((v) => v.customerId === c.id);
    const upcomingRepeats = cLeads
      .filter(
        (l) => l.stage !== "Lost" && l.repeatActive !== false && l.nextRepeat,
      )
      .map((l) => l.nextRepeat)
      .sort();
    return [
      c.id || "",
      c.name || "",
      c.phone || "",
      c.email || "",
      c.address || "",
      c.postcode || "",
      String(cLeads.length),
      String(cVisits.length),
      upcomingRepeats[0] || "",
      c.notes || "",
    ];
  });
  return toCsvString(headers, rows);
}
