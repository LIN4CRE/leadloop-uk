import { esc, money, formatDisplayDate, round2 } from "./utils.js";

const CATEGORY_LABELS = {
  service: "Service / Work",
  labour: "Labour",
  materials: "Materials",
  travel: "Travel",
};

export function renderQuotationDocumentHtml({
  quote,
  lead = {},
  customer = null,
  settings = {},
}) {
  const biz = {
    business:
      settings.business ||
      quote.businessSnapshot?.business ||
      "Independent Service Provider",
    ownerName: settings.ownerName || quote.businessSnapshot?.ownerName || "",
    email: settings.email || quote.businessSnapshot?.email || "",
    phone: settings.phone || quote.businessSnapshot?.phone || "",
    address: settings.address || quote.businessSnapshot?.address || "",
    postcode: settings.postcode || quote.businessSnapshot?.postcode || "",
    vatNumber: settings.vatNumber || quote.businessSnapshot?.vatNumber || "",
  };

  const cust = {
    name:
      customer?.name || quote.customerSnapshot?.name || lead.name || "Customer",
    phone: customer?.phone || quote.customerSnapshot?.phone || lead.phone || "",
    email: customer?.email || quote.customerSnapshot?.email || lead.email || "",
    address:
      lead.serviceAddress ||
      quote.customerSnapshot?.address ||
      customer?.address ||
      "",
    postcode:
      lead.postcode ||
      quote.customerSnapshot?.postcode ||
      customer?.postcode ||
      "",
  };

  const items = Array.isArray(quote.items) ? quote.items : [];
  const hasCategories = items.some(
    (i) => i.category && i.category !== "service",
  );
  const discountLabel =
    quote.discountType === "fixed"
      ? "Discount (fixed)"
      : `Discount (${Number(quote.discount || 0)}%)`;
  const net =
    quote.net != null
      ? quote.net
      : round2(Number(quote.subtotal || 0) - Number(quote.discountAmount || 0));

  const statusTextMap = {
    Draft: "Draft Proposal (Not yet marked sent)",
    Sent: "Quotation Sent (User confirmed)",
    Accepted: "Accepted by Customer (User confirmed)",
    Declined: "Declined",
    Superseded: "Superseded Revision",
  };
  const statusDisplay = statusTextMap[quote.status] || "Quotation Proposal";

  return `
    <div class="quote-doc">
      <div class="quote-doc-header">
        <div class="quote-doc-biz">
          <div class="quote-doc-biz-name">${esc(biz.business)}</div>
          ${biz.ownerName ? `<div class="quote-doc-meta-line">${esc(biz.ownerName)}</div>` : ""}
          ${biz.address || biz.postcode ? `<div class="quote-doc-meta-line">${esc([biz.address, biz.postcode].filter(Boolean).join(", "))}</div>` : ""}
          ${biz.phone || biz.email ? `<div class="quote-doc-meta-line">${esc([biz.phone, biz.email].filter(Boolean).join(" · "))}</div>` : ""}
          ${biz.vatNumber ? `<div class="quote-doc-meta-line">VAT Reg No: ${esc(biz.vatNumber)}</div>` : ""}
        </div>
        <div class="quote-doc-title-box">
          <div class="quote-doc-kicker">QUOTATION</div>
          <h1 class="quote-doc-ref">${esc(quote.reference)}${quote.version > 1 ? ` <span class="quote-doc-rev">(Rev ${Number(quote.version)})</span>` : ""}</h1>
          <dl class="quote-doc-dates">
            <div><dt>Date issued:</dt><dd>${esc(formatDisplayDate(quote.date))}</dd></div>
            ${quote.expiryDate ? `<div><dt>Valid until:</dt><dd>${esc(formatDisplayDate(quote.expiryDate))}</dd></div>` : ""}
            <div><dt>Record status:</dt><dd>${esc(statusDisplay)}</dd></div>
          </dl>
        </div>
      </div>

      <div class="quote-doc-parties">
        <div class="quote-doc-party">
          <div class="quote-doc-section-label">Prepared for</div>
          <div class="quote-doc-cust-name">${esc(cust.name)}</div>
          ${cust.address || cust.postcode ? `<div class="quote-doc-meta-line">${esc([cust.address, cust.postcode].filter(Boolean).join(", "))}</div>` : ""}
          ${cust.phone || cust.email ? `<div class="quote-doc-meta-line">${esc([cust.phone, cust.email].filter(Boolean).join(" · "))}</div>` : ""}
        </div>
        <div class="quote-doc-party">
          <div class="quote-doc-section-label">Work / Service Summary</div>
          <div class="quote-doc-job-title">${esc(quote.jobSummary || lead.job || "Service quotation")}</div>
          ${quote.notes ? `<div class="quote-doc-meta-line">${esc(quote.notes)}</div>` : ""}
        </div>
      </div>

      <table class="quote-doc-table">
        <thead>
          <tr>
            ${hasCategories ? `<th scope="col">Type</th>` : ""}
            <th scope="col">Description</th>
            <th scope="col" class="num">Qty</th>
            <th scope="col" class="num">Unit price</th>
            <th scope="col" class="num">Line total</th>
          </tr>
        </thead>
        <tbody>
          ${items
            .map(
              (i) => `
            <tr>
              ${hasCategories ? `<td>${esc(CATEGORY_LABELS[i.category] || "Service")}</td>` : ""}
              <td>${esc(i.description)}</td>
              <td class="num">${esc(i.qty)}</td>
              <td class="num">${esc(money(i.price))}</td>
              <td class="num">${esc(money(round2(i.qty * i.price)))}</td>
            </tr>
          `,
            )
            .join("")}
        </tbody>
      </table>

      <div class="quote-doc-summary-row">
        <div class="quote-doc-terms">
          ${
            quote.terms
              ? `
            <div class="quote-doc-section-label">Terms &amp; Notes</div>
            <p>${esc(quote.terms)}</p>
          `
              : ""
          }
        </div>
        <div class="quote-doc-totals">
          <div class="quote-doc-total-line"><span>Subtotal</span><span>${esc(money(quote.subtotal))}</span></div>
          ${Number(quote.discountAmount) > 0 ? `<div class="quote-doc-total-line"><span>${esc(discountLabel)}</span><span>−${esc(money(quote.discountAmount))}</span></div>` : `<div class="quote-doc-total-line muted"><span>Discount</span><span>${esc(money(0))}</span></div>`}
          ${Number(quote.vat) > 0 ? `<div class="quote-doc-total-line"><span>Net subtotal</span><span>${esc(money(net))}</span></div>` : ""}
          <div class="quote-doc-total-line"><span>VAT (${esc(Number(quote.vat || 0))}%)</span><span>${esc(money(quote.vatAmount))}</span></div>
          <div class="quote-doc-grand-total"><span>Total GBP</span><strong>${esc(money(quote.total))}</strong></div>
        </div>
      </div>

      <footer class="quote-doc-footer">
        <p>Quotation ${esc(quote.reference)} · Prepared with LeadLoop UK. Saving or printing this quotation does not send it automatically. VAT figures use the rate configured by the business above and do not constitute tax advice.</p>
      </footer>
    </div>
  `;
}
