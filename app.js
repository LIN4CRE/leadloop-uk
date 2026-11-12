import {
  STAGES,
  REPEAT_INTERVALS,
  LINE_CATEGORIES,
  PAYMENT_STATUSES,
  DEFAULT_SETTINGS,
  calculateDetailedQuote,
  buildQuoteRecord,
  buildCompletedVisit,
  calculateDashboard,
  filterLeads,
  findPotentialDuplicates,
  renderMessageTemplate,
  getAllTemplates,
  localDateString,
  addDays,
  validDate,
  normalizeUKPhone,
  normalizeUKPostcode,
  normalizeEmail,
  esc,
  money,
  createId,
  formatDisplayDate,
  formatDateTime,
  generateEnquiriesCsv,
  generateCustomersCsv,
} from "./core.js";
import {
  openDatabase,
  loadAllState,
  putInStore,
  runTransaction,
  createBackupPayload,
  restoreBackupToDB,
  eraseAllDataInDB,
} from "./src/db.js";
import { renderQuotationDocumentHtml } from "./src/print.js";
const $ = (s, r = document) => r.querySelector(s),
  $$ = (s, r = document) => [...r.querySelectorAll(s)],
  today = localDateString(),
  now = () => new Date().toISOString();
const state = {
  db: null,
  customers: [],
  leads: [],
  quotes: [],
  visits: [],
  activities: [],
  settings: { ...DEFAULT_SETTINGS },
  settingsRows: [],
  quarantine: [],
  view: "dashboard",
  search: "",
  stageFilter: "",
  dateRange: "all",
  selectedCustomerId: "",
  waitingWorker: null,
  deferredInstall: null,
};
const PAGE = {
  dashboard: [
    "Dashboard",
    "A clear view of work and follow-ups recorded on this device.",
  ],
  enquiries: [
    "Enquiries",
    "Track enquiries through quotation, booking and completion.",
  ],
  customers: [
    "Customers",
    "One customer record can hold multiple enquiries and service histories.",
  ],
  quotes: [
    "Quotations",
    "Build, revise, print and manually update quotation records.",
  ],
  followups: [
    "Follow-ups & Repeat",
    "Your follow-up queue and repeat service reminders.",
  ],
  settings: [
    "Settings & Data",
    "Business details, templates, backup, recovery and privacy.",
  ],
};
const byId = (a, id) => a.find((x) => x.id === id),
  escAttr = (v) => esc(v).replaceAll("`", "&#96;"),
  customerOf = (l) => byId(state.customers, l?.customerId),
  quotesFor = (id) =>
    state.quotes
      .filter((q) => q.leadId === id)
      .sort((a, b) => (b.version || 1) - (a.version || 1)),
  latestQuote = (l) => quotesFor(l.id)[0] || l.quote || null;
function toast(message, error = false) {
  const t = document.createElement("div");
  t.className = `toast${error ? " error" : ""}`;
  t.textContent = message;
  $("#toastRegion").append(t);
  setTimeout(() => t.remove(), 4200);
}
function closeModal() {
  if ($("#modal").open) $("#modal").close();
}
function modal(title, body, actions = [], narrow = false) {
  const d = $("#modal");
  d.classList.toggle("narrow", narrow);
  d.classList.toggle("wide", !narrow);
  $("#modalTitle").textContent = title;
  $("#modalBody").innerHTML = body;
  const f = $("#modalFoot");
  f.replaceChildren();
  for (const a of actions) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = `btn${a.primary ? " primary" : ""}${a.danger ? " danger" : ""}`;
    b.textContent = a.label;
    b.onclick = a.run;
    f.append(b);
  }
  if (!d.open) d.showModal();
  return d;
}
function confirmUser(title, text, label = "Confirm", danger = false) {
  return new Promise((resolve) => {
    const d = $("#confirmModal");
    $("#confirmTitle").textContent = title;
    $("#confirmBody").textContent = text;
    const f = $("#confirmFoot");
    f.replaceChildren();
    for (const [name, ok] of [
      ["Cancel", false],
      [label, true],
    ]) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = `btn${ok ? (danger ? " danger" : " primary") : ""}`;
      b.textContent = name;
      b.onclick = () => {
        d.close();
        resolve(ok);
      };
      f.append(b);
    }
    d.oncancel = () => resolve(false);
    d.showModal();
  });
}
async function refresh() {
  const d = await loadAllState(state.db);
  Object.assign(state, d);
  state.settings = { ...DEFAULT_SETTINGS, ...d.settings };
  state.settingsRows = d.settingsRows;
  updateChrome();
  render();
}
function updateChrome() {
  let reportData = {};
  try {
    reportData = JSON.parse(state.settings.migrationReport || "{}");
  } catch {
    /* older report strings are shown in Settings */
  }
  const needsReview =
    state.quarantine.length ||
    Number(reportData.quarantinedCount) > 0 ||
    Number(reportData.renamedDuplicatesCount) > 0;
  $("#quarantineBanner").hidden = !needsReview;
  $("#quarantineBannerText").textContent =
    `${state.quarantine.length} preserved record${state.quarantine.length === 1 ? "" : "s"} need manual review. Existing records were not discarded.`;
  $("#offlineBanner").hidden = navigator.onLine;
  const m = calculateDashboard(state.leads, today, { visits: state.visits }),
    due = m.followUpsDue + m.repeatDue;
  $("#navDueCount").hidden = !due;
  $("#navDueCount").textContent = String(due);
  $("#navDueCount").classList.toggle("alert", due > 0);
  $("#mobileDueBadge").hidden = !due;
  $("#mobileDueBadge").textContent = due > 9 ? "9+" : String(due);
  $("#navEnquiriesCount").textContent = String(state.leads.length);
  $("#navCustomersCount").textContent = String(state.customers.length);
  $("#navQuotesCount").textContent = String(state.quotes.length);
  $("#pwaStatusLabel").textContent =
    matchMedia("(display-mode: standalone)").matches || navigator.standalone
      ? "Installed on this device"
      : "Local-only browser storage";
}
async function log({
  leadId = "",
  customerId = "",
  type,
  summary,
  channel = "",
  message = "",
  metadata = {},
}) {
  const a = {
    id: createId("act"),
    leadId,
    customerId,
    type,
    summary,
    channel,
    message,
    metadata,
    createdAt: now(),
  };
  await putInStore(state.db, "activities", a);
  return a;
}
async function changeLead(l, patch, activity = null) {
  const updated = { ...l, ...patch, updatedAt: now() };
  await putInStore(state.db, "leads", updated);
  if (activity)
    await log({ leadId: l.id, customerId: l.customerId, ...activity });
  await refresh();
  return updated;
}
async function saveSettings(settings) {
  const rows = Object.entries({ ...DEFAULT_SETTINGS, ...settings }).map(
    ([key, value]) => ({ key, value: String(value ?? "") }),
  );
  await runTransaction(state.db, ["settings"], "readwrite", (s) => {
    s.settings.clear();
    rows.forEach((r) => s.settings.put(r));
  });
}
function nav(view) {
  state.view = view;
  for (const b of $$("[data-nav]"))
    b.dataset.nav === view
      ? b.setAttribute("aria-current", "page")
      : b.removeAttribute("aria-current");
  render();
  window.scrollTo({ top: 0, behavior: "smooth" });
}
function render() {
  const [title, sub] = PAGE[state.view] || PAGE.dashboard;
  $("#pageTitle").textContent = title;
  $("#pageSubtitle").textContent = sub;
  const views = {
    dashboard: dashboardView,
    enquiries: enquiriesView,
    customers: customersView,
    quotes: quotesView,
    followups: followupsView,
    settings: settingsView,
  };
  $("#viewContainer").innerHTML = views[state.view]();
  bindView();
}
function metric(label, value, sub, filter) {
  return `<button class="card stat interactive" data-dashboard-filter="${filter}"><span class="label">${esc(label)} <span aria-hidden="true">↗</span></span><span class="value">${esc(value)}</span><span class="kpi-sub">${esc(sub)}</span></button>`;
}
function dashboardView() {
  const m = calculateDashboard(state.leads, today, { visits: state.visits }),
    stages = m.stageBreakdown
      .map(
        (s) =>
          `<div class="pipeline-row"><span>${esc(s.stage)}</span><div class="pipeline-track" role="img" aria-label="${s.count} enquiries in ${esc(s.stage)}"><div class="pipeline-fill" style="width:${m.enquiries ? Math.max(s.count ? 3 : 0, (s.count / m.enquiries) * 100) : 0}%"></div></div><span class="pipeline-row-val">${s.count} enquiries</span></div>`,
      )
      .join("");
  const queue = (title, repeat = false) => {
    const rows = state.leads
      .filter((l) => {
        const d = repeat ? l.nextRepeat : l.followUpDate;
        return (
          d &&
          d <= today &&
          l.stage !== "Lost" &&
          (repeat ? l.repeatActive !== false : l.stage !== "Completed")
        );
      })
      .sort((a, b) =>
        (repeat ? a.nextRepeat : a.followUpDate).localeCompare(
          repeat ? b.nextRepeat : b.followUpDate,
        ),
      )
      .slice(0, 5);
    return `<section class="card"><div class="card-header"><h2 class="card-title">${title}</h2><button class="btn sm" data-nav="followups">Open queue</button></div><div class="card-body">${rows.length ? `<div class="queue-list">${rows.map((l) => `<div class="queue-item"><div><strong>${esc(l.name)} — ${esc(l.job)}</strong><div class="queue-item-sub">${formatDisplayDate(repeat ? l.nextRepeat : l.followUpDate)}</div></div><button class="btn sm" data-action="open-lead" data-id="${escAttr(l.id)}">View</button></div>`).join("")}</div>` : `<p class="hint">${repeat ? "No repeat reminders due. Accepted and completed customers remain eligible when a date is set." : "No follow-ups due today. Dates never send messages automatically."}</p>`}</div></section>`;
  };
  return `<section class="stats-grid grid" aria-label="Business metrics">${metric("Total enquiries", m.enquiries, `${m.activeEnquiries} active`, "enquiries")}${metric("New enquiries", m.newEnquiries, "Awaiting first action", "stage:new")}${metric("Outstanding quotations", m.outstandingQuotes, `${money(m.outstandingValue)} quoted`, "stage:quote")}${metric("Follow-ups due", m.followUpsDue, `${m.overdueFollowUps} overdue`, "followups")}${metric("Accepted / booked", m.acceptedJobs, `${money(m.acceptedValue)} accepted quote value`, "stage:accepted")}${metric("Completed jobs", m.completedJobs, `${money(m.completedValue)} completed quote value`, "stage:completed")}${metric("Repeat reminders due", m.repeatDue, `${m.repeatOverdue} overdue`, "repeat")}${metric("Lost opportunities", m.lost, `${money(m.lostValue)} lost quote value`, "stage:lost")}</section><div class="two-col"><section class="card"><div class="card-header"><h2 class="card-title">Enquiry pipeline</h2><span class="sub">${m.enquiries} saved records</span></div><div class="card-body">${m.enquiries ? `<div class="pipeline-bars">${stages}</div>` : `<div class="empty"><h3>Your pipeline starts here</h3><p>Add a real enquiry to track follow-up, quotation and completed work.</p><button class="btn primary" data-action="add-lead">+ Add enquiry</button></div>`}</div></section><section class="card"><div class="card-header"><h2 class="card-title">Business value (recorded)</h2></div><div class="card-body"><div class="queue-list"><div class="queue-item"><div><strong>Quoted value</strong><div class="queue-item-sub">Saved quotations, not revenue</div></div><strong>${money(m.quotedValue)}</strong></div><div class="queue-item"><div><strong>Accepted quote value</strong><div class="queue-item-sub">Accepted / booked jobs</div></div><strong>${money(m.wonValue)}</strong></div><div class="queue-item"><div><strong>Payments recorded</strong><div class="queue-item-sub">${m.hasRecordedPayments ? "User-recorded payments" : "No payment records yet"}</div></div><strong>${m.hasRecordedPayments ? money(m.confirmedPaidTotal) : "—"}</strong></div><div class="queue-item"><div><strong>Conversion rate</strong><div class="queue-item-sub">Won ÷ closed (won + lost)</div></div><strong>${m.conversionRate == null ? "—" : `${m.conversionRate}%`}</strong></div></div><p class="hint">Quotation values are not revenue or accounting figures.</p></div></section></div><div class="two-col">${queue("Follow-ups due")}${queue("Repeat service reminders", true)}</div><section class="card"><div class="card-header"><h2 class="card-title">Quick actions</h2></div><div class="card-body" style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn primary" data-action="add-lead">+ Add enquiry</button><button class="btn" data-action="add-customer">Add customer</button><button class="btn" data-nav="quotes">Create quotation</button><button class="btn" data-action="backup">Export JSON backup</button></div></section>`;
}
function filteredLeads() {
  const days =
    state.dateRange === "30d" ? 30 : state.dateRange === "90d" ? 90 : null;
  const from = days
    ? localDateString(new Date(Date.now() - days * 86400000))
    : state.dateRange === "year"
      ? `${new Date().getFullYear()}-01-01`
      : "";
  return filterLeads(state.leads, {
    search: state.search,
    stage: state.stageFilter,
    fromDate: from,
  });
}
function leadCard(l) {
  const q = latestQuote(l),
    due =
      l.followUpDate &&
      l.followUpDate <= today &&
      !["Lost", "Completed"].includes(l.stage),
    repeat =
      l.nextRepeat &&
      l.nextRepeat <= today &&
      l.repeatActive !== false &&
      l.stage !== "Lost";
  return `<article class="card lead" data-lead-card="${escAttr(l.id)}"><div><div class="lead-header"><button class="customer-link" data-action="customer-profile" data-id="${escAttr(l.customerId)}">${esc(l.name)}</button><span class="badge">${esc(l.stage)}</span>${due ? '<span class="badge overdue">Follow-up due</span>' : ""}${repeat ? '<span class="badge warning">Repeat due</span>' : ""}${!l.lastContactConfirmedAt && !["Lost", "Completed"].includes(l.stage) ? '<span class="badge warning">Contact not confirmed</span>' : ""}</div><p class="lead-job">${esc(l.job)}</p><p class="lead-meta">${esc([l.phone, l.email].filter(Boolean).join(" · ") || "No contact details")} · Added ${formatDisplayDate(l.created)}</p>${l.serviceAddress || l.postcode ? `<p class="lead-meta">${esc([l.serviceAddress, l.postcode].filter(Boolean).join(", "))}</p>` : ""}<div class="badge-row">${q ? `<span class="badge info">${esc(q.reference)} · ${money(q.total)}</span>` : ""}${l.followUpDate ? `<span class="badge">Follow-up ${formatDisplayDate(l.followUpDate)}</span>` : ""}${l.nextRepeat ? `<span class="badge">Repeat ${formatDisplayDate(l.nextRepeat)}${l.repeatInterval ? ` · ${esc(l.repeatInterval)}` : ""}</span>` : ""}${Number(l.paidAmount) > 0 ? `<span class="badge success">Payment recorded ${money(l.paidAmount)}</span>` : ""}</div>${l.notes ? `<p class="lead-meta">${esc(l.notes)}</p>` : ""}</div><div class="lead-actions"><select class="stageSelect" data-action="stage" data-id="${escAttr(l.id)}" aria-label="Change stage for ${escAttr(l.name)}">${STAGES.map((s) => `<option ${s === l.stage ? "selected" : ""}>${esc(s)}</option>`).join("")}</select><div class="lead-btn-row"><button class="btn sm" data-action="edit-lead" data-id="${escAttr(l.id)}">Edit</button><button class="btn sm" data-action="quote-lead" data-id="${escAttr(l.id)}">${q ? "Revise quote" : "Quote"}</button><button class="btn sm" data-action="followup" data-id="${escAttr(l.id)}">Message</button>${repeat ? `<button class="btn sm primary" data-action="complete-repeat" data-id="${escAttr(l.id)}">Complete visit</button>` : ""}${!l.lastContactConfirmedAt && !["Lost", "Completed"].includes(l.stage) ? `<button class="btn sm" data-action="confirm-contact" data-id="${escAttr(l.id)}">Confirm contact</button>` : ""}</div></div></article>`;
}
function enquiriesView() {
  const rows = filteredLeads();
  return `<div class="card toolbar"><div class="filters"><input id="leadSearch" type="search" placeholder="Search name, phone, service or postcode" value="${escAttr(state.search)}" aria-label="Search enquiries"><select id="stageFilter" aria-label="Filter by stage"><option value="">All stages</option>${STAGES.map((s) => `<option ${s === state.stageFilter ? "selected" : ""}>${esc(s)}</option>`).join("")}</select><select id="dateRange" aria-label="Filter by date"><option value="all">All dates</option><option value="30d" ${state.dateRange === "30d" ? "selected" : ""}>Last 30 days</option><option value="90d" ${state.dateRange === "90d" ? "selected" : ""}>Last 90 days</option><option value="year" ${state.dateRange === "year" ? "selected" : ""}>This year</option></select></div><span class="result-count">${rows.length} results</span><button class="btn primary" data-action="add-lead">+ Add enquiry</button></div>${rows.length ? `<div class="lead-list">${rows.map(leadCard).join("")}</div>` : `<div class="card empty"><h2>${state.leads.length ? "No enquiries match" : "No enquiries recorded"}</h2><p>${state.leads.length ? "Change search or filters to see records." : "Record a real enquiry to start a private pipeline on this device."}</p><button class="btn primary" data-action="add-lead">+ Add enquiry</button></div>`}`;
}
function customersView() {
  const q = state.search.toLowerCase(),
    rows = state.customers.filter(
      (c) =>
        !q ||
        [c.name, c.phone, c.email, c.address, c.postcode, c.notes]
          .join(" ")
          .toLowerCase()
          .includes(q),
    );
  let chosen = byId(state.customers, state.selectedCustomerId) || rows[0];
  if (chosen && !state.selectedCustomerId) state.selectedCustomerId = chosen.id;
  return `<div class="card toolbar"><div class="filters"><input type="search" id="customerSearch" value="${escAttr(state.search)}" placeholder="Search customers" aria-label="Search customers"></div><button class="btn primary" data-action="add-customer">+ Add customer</button></div><div class="customer-layout"><section class="card"><div class="card-header"><h2 class="card-title">Customers</h2><span>${rows.length}</span></div><div class="card-body" style="display:grid;gap:8px">${rows.length ? rows.map((c) => `<button class="customer-card-btn ${chosen?.id === c.id ? "selected" : ""}" data-action="select-customer" data-id="${escAttr(c.id)}"><strong>${esc(c.name)}</strong><span class="sub">${esc(c.phone || c.email || "No contact details")}</span><span class="sub">${state.leads.filter((l) => l.customerId === c.id).length} linked enquiries</span></button>`).join("") : `<div class="empty"><h3>No customers yet</h3><p>Customers are created from enquiries or added independently.</p></div>`}</div></section><section>${chosen ? customerProfile(chosen) : `<div class="card empty"><h2>Select a customer</h2><p>Choose a customer to review their history.</p></div>`}</section></div>`;
}
function customerProfile(c) {
  const leads = state.leads
      .filter((l) => l.customerId === c.id)
      .sort((a, b) => b.created.localeCompare(a.created)),
    visits = state.visits
      .filter(
        (v) => v.customerId === c.id || leads.some((l) => l.id === v.leadId),
      )
      .sort((a, b) => b.completedDate.localeCompare(a.completedDate)),
    next = leads
      .filter(
        (l) => l.nextRepeat && l.stage !== "Lost" && l.repeatActive !== false,
      )
      .sort((a, b) => a.nextRepeat.localeCompare(b.nextRepeat))[0],
    acts = state.activities
      .filter((a) => a.customerId === c.id)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 8);
  return `<article class="card"><div class="card-header"><div><h2 class="card-title">${esc(c.name)}</h2><span class="sub">Customer profile</span></div><button class="btn sm" data-action="edit-customer" data-id="${escAttr(c.id)}">Edit details</button></div><div class="card-body"><div class="queue-list"><div><strong>Phone</strong><div class="sub">${esc(c.phone || "Not recorded")}</div></div><div><strong>Email</strong><div class="sub">${esc(c.email || "Not recorded")}</div></div><div><strong>Address</strong><div class="sub">${esc([c.address, c.postcode].filter(Boolean).join(", ") || "Not recorded")}</div></div><div><strong>Notes</strong><div class="sub">${esc(c.notes || "No notes")}</div></div><div><strong>Next scheduled service</strong><div class="sub">${next ? `${formatDisplayDate(next.nextRepeat)} · ${esc(next.job)}` : "No repeat date recorded"}</div></div></div><div class="detail-section"><div style="display:flex;justify-content:space-between;gap:8px"><h3>Enquiry &amp; job history (${leads.length})</h3><button class="btn sm" data-action="add-lead-customer" data-id="${escAttr(c.id)}">+ Enquiry</button></div>${leads.length ? `<div class="queue-list">${leads.map((l) => `<div class="queue-item"><div><strong>${esc(l.job)}</strong><div class="queue-item-sub">${esc(l.stage)} · ${formatDisplayDate(l.created)}${latestQuote(l) ? ` · ${esc(latestQuote(l).reference)} ${money(latestQuote(l).total)}` : ""}</div></div><button class="btn sm" data-action="open-lead" data-id="${escAttr(l.id)}">Open</button></div>`).join("")}` : `<p class="hint">No enquiries linked yet.</p>`}</div><div class="detail-section"><h3>Completed visits (${visits.length})</h3>${visits.length ? `<ul class="timeline">${visits.map((v) => `<li class="timeline-item"><strong>${esc(v.service || "Service visit")}</strong> · completed ${formatDisplayDate(v.completedDate)}${v.amountPaid != null ? ` · payment recorded ${money(v.amountPaid)}` : ""}<div class="timeline-time">Next reminder: ${formatDisplayDate(v.nextScheduledDate)}</div></li>`).join("")}</ul>` : `<p class="hint">Completed visits will appear here.</p>`}</div><div class="detail-section"><h3>Recent activity</h3>${acts.length ? `<ul class="timeline">${acts.map((a) => `<li class="timeline-item">${esc(a.summary)}<div class="timeline-time">${formatDateTime(a.createdAt)}</div></li>`).join("")}</ul>` : `<p class="hint">Activity history will appear here.</p>`}</div></div></article>`;
}
function quotesView() {
  const rows = state.quotes
    .slice()
    .sort((a, b) =>
      String(b.updatedAt || b.date).localeCompare(
        String(a.updatedAt || a.date),
      ),
    );
  return `<div class="card toolbar"><div class="filters"><input type="search" id="quoteSearch" placeholder="Search reference, customer or service" aria-label="Search quotations"></div><span class="result-count">${rows.length} saved revisions</span><button class="btn primary" data-action="choose-quote-lead">+ Create quotation</button></div>${
    rows.length
      ? `<div class="card"><div class="table-wrap"><table class="data-table"><thead><tr><th>Reference</th><th>Customer</th><th>Service</th><th>Date</th><th class="num">Total</th><th>Status</th><th>Actions</th></tr></thead><tbody>${rows
          .map((q) => {
            const l = byId(state.leads, q.leadId);
            return `<tr data-quote-row><td><strong>${esc(q.reference)}</strong>${q.version > 1 ? `<div class="sub">Revision ${q.version}</div>` : ""}</td><td>${esc(q.customerSnapshot?.name || l?.name || "—")}</td><td>${esc(q.jobSummary || l?.job || "—")}</td><td>${formatDisplayDate(q.date)}</td><td class="num">${money(q.total)}</td><td><span class="badge">${esc(q.status || "Draft")}</span></td><td><div style="display:flex;gap:5px;flex-wrap:wrap"><button class="btn sm" data-action="print-quote" data-id="${escAttr(q.id)}">Print</button><button class="btn sm" data-action="quote-status" data-id="${escAttr(q.id)}">Update</button><button class="btn sm" data-action="revise-quote" data-id="${escAttr(q.leadId)}">Revise</button></div></td></tr>`;
          })
          .join("")}</tbody></table></div></div>`
      : `<div class="card empty"><h2>No quotations recorded</h2><p>Create a quotation from a saved enquiry. Revisions remain in history.</p><button class="btn primary" data-action="choose-quote-lead">+ Create quotation</button></div>`
  }`;
}
function followupsView() {
  const active = state.leads.filter(
    (l) => !["Lost", "Completed"].includes(l.stage),
  );
  const section = (title, rows, key, empty, repeat = false) =>
    `<section class="card" style="margin-bottom:16px"><div class="card-header"><h2 class="card-title">${title}</h2><span>${rows.length}</span></div><div class="card-body">${rows.length ? `<div class="queue-list">${rows.map((l) => `<div class="queue-item"><div><strong>${esc(l.name)} · ${esc(l.job)}</strong><div class="queue-item-sub">${repeat ? "Repeat" : "Follow-up"} ${formatDisplayDate(l[key])} · ${esc(l.stage)}${!l.lastContactConfirmedAt ? " · no contact confirmation" : ""}</div></div><div style="display:flex;gap:6px;flex-wrap:wrap"><button class="btn sm" data-action="followup" data-id="${escAttr(l.id)}">Prepare message</button>${repeat && l[key] <= today ? `<button class="btn sm primary" data-action="complete-repeat" data-id="${escAttr(l.id)}">Complete visit</button>` : ""}<button class="btn sm" data-action="edit-lead" data-id="${escAttr(l.id)}">Edit</button></div></div>`).join("")}</div>` : `<p class="hint">${empty}</p>`}</div></section>`;
  return (
    section(
      "Dated follow-ups",
      active
        .filter((l) => l.followUpDate)
        .sort((a, b) => a.followUpDate.localeCompare(b.followUpDate)),
      "followUpDate",
      "Add follow-up dates to place enquiries in this queue.",
    ) +
    section(
      "Not yet contact-confirmed",
      active.filter((l) => !l.lastContactConfirmedAt),
      "created",
      "No active enquiries are awaiting contact confirmation.",
    ) +
    section(
      "Repeat service schedule",
      state.leads
        .filter(
          (l) => l.nextRepeat && l.repeatActive !== false && l.stage !== "Lost",
        )
        .sort((a, b) => a.nextRepeat.localeCompare(b.nextRepeat)),
      "nextRepeat",
      "Accepted and completed customers remain eligible when repeat dates are set.",
      true,
    )
  );
}
function settingsView() {
  const s = state.settings,
    field = (label, key, type = "text", hint = "") =>
      `<div class="field"><label for="${key}">${label}</label><input id="${key}" name="${key}" type="${type}" value="${escAttr(s[key] || "")}" ${type === "number" ? 'min="0" step="0.01"' : ""}>${hint ? `<span class="hint">${hint}</span>` : ""}</div>`;
  return `<div class="settings-stack"><section class="card"><div class="card-header"><h2 class="card-title">Business details</h2></div><form id="settingsForm" class="card-body"><div class="form-grid">${field("Business or trading name", "business")}${field("Contact name", "ownerName")}${field("Business phone", "phone", "tel")}${field("Business email", "email", "email")}${field("Business address", "address")}${field("Postcode", "postcode")}${field("VAT number (optional)", "vatNumber")}${field("VAT calculation rate (%)", "defaultVat", "number", "Calculation setting only; not VAT advice")}${field("Quotation validity (days)", "defaultValidityDays", "number")}<div class="field full"><label for="defaultTerms">Default quotation terms</label><textarea id="defaultTerms" name="defaultTerms">${esc(s.defaultTerms)}</textarea></div></div><button class="btn primary" style="margin-top:14px">Save business details</button></form></section><section class="card"><div class="card-header"><h2 class="card-title">Message templates</h2><span class="sub">Drafts only; never sent by LeadLoop</span></div><div class="card-body"><label for="customTemplates">Custom templates (JSON array)</label><textarea id="customTemplates" style="min-height:150px;font-family:monospace">${esc(s.customTemplates || "[]")}</textarea><p class="hint">Each template needs name, subject and body. Placeholders: {firstName}, {name}, {job}, {business}, {quoteRef}, {quoteTotal}, {nextRepeat}.</p><button class="btn primary" id="saveTemplatesBtn">Save templates</button><div class="detail-section"><h3>Available templates</h3><ul>${getAllTemplates(
    s,
  )
    .map((t) => `<li><strong>${esc(t.name)}</strong> — ${esc(t.subject)}</li>`)
    .join(
      "",
    )}</ul></div></div></section><section class="card"><div class="card-header"><h2 class="card-title">Your data</h2></div><div class="card-body"><p>Customer and business records are stored in this browser's IndexedDB on this device. There is no cloud sync or automatic messaging. Browser storage is not encrypted by this application. Other people with access to this browser profile may access these records.</p><p class="hint">Export a JSON backup regularly and store it securely. Backups contain personal data. Restoring replaces local LeadLoop records.</p><div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn" data-action="backup">Download JSON backup</button><button class="btn" data-action="restore">Restore JSON backup</button><button class="btn" data-action="csv">Export enquiries CSV</button><button class="btn" data-action="customers-csv">Export customers CSV</button></div><div class="detail-section"><h3>Data recovery report</h3>${s.migrationReport ? `<pre style="white-space:pre-wrap;overflow-wrap:anywhere">${esc(s.migrationReport)}</pre>` : `<p class="hint">No migration report recorded.</p>`}${state.quarantine.length ? `<button class="btn" data-action="quarantine">Review ${state.quarantine.length} preserved records</button>` : ""}</div></div></section><section class="card danger-zone"><div class="card-header"><h2 class="card-title">Erase all local data</h2></div><div class="card-body"><p>This permanently removes all customers, enquiries, quotations, visits, activity, settings and recovery records on this browser. Download a backup first if needed.</p><button class="btn danger" data-action="erase">Erase all local data…</button></div></section><section class="card"><div class="card-header"><h2 class="card-title">Install &amp; updates</h2></div><div class="card-body"><p>Use Install App when supported, or the browser menu's Install app / Add to Home Screen option. Availability varies. Updates preserve local records.</p><button class="btn" data-action="install-guide">Installation guide</button></div></section><section class="card"><div class="card-header"><h2 class="card-title">Privacy &amp; limitations</h2></div><div class="card-body"><p>LeadLoop is a local-first pilot, not hosted SaaS. It has no authentication, roles, device sync, app-level encryption, accounting, tax determination, automated backups or background notifications. This product does not itself establish legal compliance; businesses remain responsible for their data handling and applicable obligations.</p><p class="hint">Multi-device SaaS requires a secured backend, authentication, tenant isolation, transport/storage protections, retention and incident processes, support, tested backups, privacy review and genuine billing integration.</p></div></section></div>`;
}
function bindView() {
  const q = $("#leadSearch");
  if (q)
    q.oninput = () => {
      state.search = q.value;
      render();
      $("#leadSearch")?.focus();
    };
  const c = $("#customerSearch");
  if (c)
    c.oninput = () => {
      state.search = c.value;
      render();
      $("#customerSearch")?.focus();
    };
  const s = $("#stageFilter");
  if (s)
    s.onchange = () => {
      state.stageFilter = s.value;
      render();
    };
  const r = $("#dateRange");
  if (r)
    r.onchange = () => {
      state.dateRange = r.value;
      render();
    };
  const f = $("#settingsForm");
  if (f)
    f.onsubmit = async (e) => {
      e.preventDefault();
      const n = { ...state.settings };
      for (const [k, v] of new FormData(f)) n[k] = String(v).trim();
      if (
        !Number.isFinite(+n.defaultVat) ||
        +n.defaultVat < 0 ||
        +n.defaultVat > 100
      )
        return toast("VAT rate must be between 0 and 100.", true);
      try {
        await saveSettings(n);
        await refresh();
        toast("Business details saved.");
      } catch (x) {
        toast(x.message, true);
      }
    };
  const t = $("#saveTemplatesBtn");
  if (t)
    t.onclick = async () => {
      try {
        const raw = $("#customTemplates").value,
          p = JSON.parse(raw || "[]");
        if (
          !Array.isArray(p) ||
          p.some(
            (x) =>
              !x || typeof x.name !== "string" || typeof x.body !== "string",
          )
        )
          throw Error("Templates need a JSON array with name and body.");
        await saveSettings({
          ...state.settings,
          customTemplates: JSON.stringify(p),
        });
        await refresh();
        toast("Templates saved.");
      } catch (e) {
        toast(e.message, true);
      }
    };
}
function openLeadForm(existing = null, customerId = "") {
  const cust = existing
    ? customerOf(existing)
    : byId(state.customers, customerId);
  const current = existing || {};
  const body = `<div id="formError" class="form-error" role="alert" hidden></div><div id="duplicateWarning" class="dup-warning" hidden></div><div class="form-grid"><div class="field"><label for="leadName">Customer name *</label><input id="leadName" maxlength="200" value="${escAttr(current.name || cust?.name || "")}" required></div><div class="field"><label for="leadLinkCustomer">Link to existing customer (optional)</label><select id="leadLinkCustomer"><option value="">Create a separate customer record</option>${state.customers.map((c) => `<option value="${escAttr(c.id)}" ${c.id === (current.customerId || customerId) ? "selected" : ""}>${esc(c.name)} · ${esc(c.phone || c.email || "no contact")}</option>`).join("")}</select><span class="hint">No records are automatically merged.</span></div><div class="field"><label for="leadPhone">Telephone</label><input id="leadPhone" type="tel" value="${escAttr(current.phone || cust?.phone || "")}"></div><div class="field"><label for="leadEmail">Email</label><input id="leadEmail" type="email" value="${escAttr(current.email || cust?.email || "")}"></div><div class="field full"><label for="leadJob">Service / job details *</label><input id="leadJob" maxlength="300" value="${escAttr(current.job || "")}" required></div><div class="field"><label for="leadDate">Enquiry date</label><input id="leadDate" type="date" value="${escAttr(current.created || today)}"></div><div class="field"><label for="leadStage">Stage</label><select id="leadStage">${STAGES.map((s) => `<option ${s === (current.stage || "New enquiry") ? "selected" : ""}>${esc(s)}</option>`).join("")}</select></div><div class="field"><label for="leadAddress">Service address</label><input id="leadAddress" value="${escAttr(current.serviceAddress || cust?.address || "")}"></div><div class="field"><label for="leadPostcode">Postcode</label><input id="leadPostcode" value="${escAttr(current.postcode || cust?.postcode || "")}"></div><div class="field"><label for="leadCategory">Service category</label><input id="leadCategory" value="${escAttr(current.jobCategory || "")}" placeholder="e.g. gardening"></div><div class="field"><label for="leadEstimate">Estimated value (£, optional)</label><input id="leadEstimate" type="number" min="0" step="0.01" value="${escAttr(current.estimatedValue || "")}"></div><div class="field"><label for="leadFollow">Follow-up date</label><input id="leadFollow" type="date" value="${escAttr(current.followUpDate || "")}"></div><div class="field"><label for="leadRepeat">Next repeat reminder</label><input id="leadRepeat" type="date" value="${escAttr(current.nextRepeat || "")}"></div><div class="field"><label for="leadInterval">Repeat interval</label><select id="leadInterval">${REPEAT_INTERVALS.map((o) => `<option value="${escAttr(o.value)}" ${o.value === (current.repeatInterval || "") ? "selected" : ""}>${esc(o.label)}</option>`).join("")}</select></div><div class="field"><label for="leadPayment">Payment status</label><select id="leadPayment">${PAYMENT_STATUSES.map((o) => `<option value="${o.value}" ${o.value === (current.paymentStatus || "unpaid") ? "selected" : ""}>${esc(o.label)}</option>`).join("")}</select></div><div class="field"><label for="leadPaid">Amount recorded paid (£)</label><input id="leadPaid" type="number" min="0" step="0.01" value="${escAttr(current.paidAmount || "")}"></div><div class="field full"><label for="leadNotes">Notes</label><textarea id="leadNotes">${esc(current.notes || "")}</textarea></div></div>`;
  modal(existing ? "Edit enquiry" : "Add enquiry", body, [
    { label: "Cancel", run: closeModal },
    {
      label: existing ? "Save changes" : "Save enquiry",
      primary: true,
      run: () => saveLead(existing, customerId),
    },
  ]);
  const warn = () => {
    const matches = findPotentialDuplicates(state.customers, {
      name: $("#leadName").value,
      phone: $("#leadPhone").value,
      email: $("#leadEmail").value,
    }).filter((c) => c.id !== $("#leadLinkCustomer").value);
    const el = $("#duplicateWarning");
    el.hidden = !matches.length;
    el.textContent = matches.length
      ? `Possible matching customer${matches.length > 1 ? "s" : ""}: ${matches.map((c) => c.name).join(", ")}. Choose a record to link, or create a separate record deliberately.`
      : "";
  };
  ["#leadName", "#leadPhone", "#leadEmail", "#leadLinkCustomer"].forEach(
    (sel) => $(sel).addEventListener("input", warn),
  );
}
async function saveLead(existing, initialCustomerId) {
  const err = $("#formError");
  const name = $("#leadName").value.trim(),
    job = $("#leadJob").value.trim(),
    created = $("#leadDate").value,
    phone = $("#leadPhone").value.trim(),
    email = normalizeEmail($("#leadEmail").value),
    linkedId = $("#leadLinkCustomer").value || initialCustomerId;
  if (!name || !job) {
    err.textContent = "Enter the customer name and service details.";
    err.hidden = false;
    return;
  }
  if (
    !validDate(created, false) ||
    ($("#leadFollow").value && !validDate($("#leadFollow").value, false)) ||
    ($("#leadRepeat").value && !validDate($("#leadRepeat").value, false))
  ) {
    err.textContent = "Check the enquiry, follow-up and repeat dates.";
    err.hidden = false;
    return;
  }
  const normalized = phone ? normalizeUKPhone(phone) : null;
  if (phone && !normalized) {
    err.textContent = "Enter a valid UK phone number or leave blank.";
    err.hidden = false;
    return;
  }
  let cust = byId(state.customers, linkedId);
  const duplicate = findPotentialDuplicates(
    state.customers.filter((c) => c.id !== cust?.id),
    { name, phone, email },
  );
  if (
    !cust &&
    duplicate.length &&
    !(await confirmUser(
      "Possible duplicate customer",
      `Possible match: ${duplicate.map((c) => c.name).join(", ")}. Save as a separate customer anyway?`,
      "Save separate record",
    ))
  )
    return;
  try {
    const stamp = now();
    if (!cust) {
      cust = {
        id: createId("cus"),
        name,
        phone,
        email,
        normalizedPhone: normalized || "",
        address: $("#leadAddress").value.trim(),
        postcode: normalizeUKPostcode($("#leadPostcode").value),
        notes: "",
        createdAt: stamp,
        updatedAt: stamp,
      };
      await putInStore(state.db, "customers", cust);
    }
    const l = {
      ...(existing || {}),
      id: existing?.id || createId("lead"),
      customerId: cust.id,
      name,
      phone,
      email,
      job,
      created,
      stage: $("#leadStage").value,
      serviceAddress: $("#leadAddress").value.trim(),
      postcode: normalizeUKPostcode($("#leadPostcode").value),
      jobCategory: $("#leadCategory").value.trim(),
      estimatedValue: Number($("#leadEstimate").value || 0),
      followUpDate: $("#leadFollow").value,
      nextRepeat: $("#leadRepeat").value,
      repeatInterval: $("#leadInterval").value,
      repeatAnchorDay:
        existing?.repeatAnchorDay ||
        ($("#leadRepeat").value
          ? Number($("#leadRepeat").value.slice(-2))
          : null),
      repeatActive: true,
      paymentStatus: $("#leadPayment").value,
      paidAmount: Number($("#leadPaid").value || 0),
      paidDate:
        Number($("#leadPaid").value || 0) > 0
          ? existing?.paidDate || today
          : "",
      notes: $("#leadNotes").value.trim(),
      updatedAt: stamp,
    };
    if (existing?.quote) {
      l.quote = existing.quote;
      l.quoteId = existing.quoteId;
      l.activeQuoteId = existing.activeQuoteId;
    }
    await putInStore(state.db, "leads", l);
    await log({
      leadId: l.id,
      customerId: cust.id,
      type: existing ? "enquiry_updated" : "enquiry_created",
      summary: existing ? "Enquiry details updated" : "Enquiry created",
    });
    if (existing && existing.stage !== l.stage)
      await log({
        leadId: l.id,
        customerId: cust.id,
        type: "stage_changed",
        summary: `Stage changed from ${existing.stage} to ${l.stage}`,
      });
    if (l.paidAmount > 0)
      await log({
        leadId: l.id,
        customerId: cust.id,
        type: "payment_recorded",
        summary: `Payment recorded: ${money(l.paidAmount)}`,
      });
    closeModal();
    state.selectedCustomerId = cust.id;
    await refresh();
    if (!existing && !initialCustomerId) nav("enquiries");
    toast(existing ? "Enquiry updated." : "Enquiry saved.");
  } catch (e) {
    err.textContent = e.message || "Could not save enquiry.";
    err.hidden = false;
  }
}
function openCustomerForm(c = null) {
  const body = `<div id="formError" class="form-error" hidden role="alert"></div><div class="form-grid"><div class="field"><label for="customerName">Customer name *</label><input id="customerName" value="${escAttr(c?.name || "")}"></div><div class="field"><label for="customerPhone">Telephone</label><input id="customerPhone" type="tel" value="${escAttr(c?.phone || "")}"></div><div class="field"><label for="customerEmail">Email</label><input id="customerEmail" type="email" value="${escAttr(c?.email || "")}"></div><div class="field"><label for="customerAddress">Service / property address</label><input id="customerAddress" value="${escAttr(c?.address || "")}"></div><div class="field"><label for="customerPostcode">Postcode</label><input id="customerPostcode" value="${escAttr(c?.postcode || "")}"></div><div class="field full"><label for="customerNotes">Notes</label><textarea id="customerNotes">${esc(c?.notes || "")}</textarea></div></div>`;
  modal(c ? "Edit customer" : "Add customer", body, [
    { label: "Cancel", run: closeModal },
    { label: "Save customer", primary: true, run: () => saveCustomer(c) },
  ]);
}
async function saveCustomer(c) {
  const name = $("#customerName").value.trim(),
    phone = $("#customerPhone").value.trim(),
    email = normalizeEmail($("#customerEmail").value),
    err = $("#formError");
  if (!name) {
    err.textContent = "Enter the customer name.";
    err.hidden = false;
    return;
  }
  const normalized = phone ? normalizeUKPhone(phone) : null;
  if (phone && !normalized) {
    err.textContent = "Enter a valid UK phone number or leave blank.";
    err.hidden = false;
    return;
  }
  const duplicate = findPotentialDuplicates(
    state.customers.filter((x) => x.id !== c?.id),
    { name, phone, email },
  )[0];
  if (
    duplicate &&
    !(await confirmUser(
      "Possible duplicate customer",
      `${duplicate.name} may match. Save a separate customer record anyway?`,
      "Save separate record",
    ))
  )
    return;
  const stamp = now(),
    row = {
      ...(c || {}),
      id: c?.id || createId("cus"),
      name,
      phone,
      email,
      normalizedPhone: normalized || "",
      address: $("#customerAddress").value.trim(),
      postcode: normalizeUKPostcode($("#customerPostcode").value),
      notes: $("#customerNotes").value.trim(),
      createdAt: c?.createdAt || stamp,
      updatedAt: stamp,
    };
  try {
    await putInStore(state.db, "customers", row);
    state.selectedCustomerId = row.id;
    closeModal();
    await refresh();
    toast("Customer saved.");
  } catch (e) {
    err.textContent = e.message;
    err.hidden = false;
  }
}

function quoteLine(item = {}, i = 0) {
  return `<div class="quote-line-row" data-quote-line><div><label class="hint">Type</label><select data-cat>${LINE_CATEGORIES.map((c) => `<option value="${c.value}" ${c.value === (item.category || "service") ? "selected" : ""}>${esc(c.label)}</option>`).join("")}</select></div><div class="line-desc-wrap"><label class="hint">Description</label><input data-desc maxlength="300" value="${escAttr(item.description || "")}" placeholder="Work or materials"></div><div><label class="hint">Qty</label><input data-qty type="number" min="0.01" step="0.01" value="${item.qty || 1}"></div><div><label class="hint">Unit £</label><input data-price type="number" min="0" step="0.01" value="${item.price || 0}"></div><button type="button" class="btn sm danger" data-action="remove-line" aria-label="Remove quotation line ${i + 1}">Remove</button></div>`;
}
function quoteLines() {
  return $$("[data-quote-line]").map((r) => ({
    category: r.querySelector("[data-cat]").value,
    description: r.querySelector("[data-desc]").value,
    qty: Number(r.querySelector("[data-qty]").value),
    price: Number(r.querySelector("[data-price]").value),
  }));
}
function openQuoteEditor(lead, existing = null) {
  if (!existing) existing = latestQuote(lead);
  const editing = existing?.status === "Draft";
  const items = existing?.items?.length
    ? existing.items
    : [{ category: "service", description: lead.job, qty: 1, price: 0 }];
  const body = `<div id="quoteError" class="form-error" hidden role="alert"></div><div class="form-grid"><div class="field full"><div class="queue-item"><strong>${esc(lead.name)} · ${esc(lead.job)}</strong><span class="badge">${esc(lead.stage)}</span></div></div><div class="field"><label for="qDate">Quotation date</label><input id="qDate" type="date" value="${escAttr(existing?.date || today)}"></div><div class="field"><label for="qExpiry">Expiry date</label><input id="qExpiry" type="date" value="${escAttr(existing?.expiryDate || addDays(today, Number(state.settings.defaultValidityDays) || 30))}"></div><div class="field"><label for="qDiscountType">Discount type</label><select id="qDiscountType"><option value="percent" ${existing?.discountType !== "fixed" ? "selected" : ""}>Percentage</option><option value="fixed" ${existing?.discountType === "fixed" ? "selected" : ""}>Fixed amount (£)</option></select></div><div class="field"><label for="qDiscount">Discount</label><input id="qDiscount" type="number" min="0" step="0.01" value="${existing?.discount || 0}"></div><div class="field"><label for="qVat">VAT calculation rate (%)</label><input id="qVat" type="number" min="0" max="100" step="0.01" value="${existing?.vat ?? state.settings.defaultVat ?? 0}"><span class="hint">Calculation only; confirm your own VAT treatment.</span></div><div class="field full"><label>Quotation line items</label><div id="quoteLineList" class="quote-lines-list">${items.map(quoteLine).join("")}</div><button type="button" class="btn sm" id="addQuoteLine">+ Add line item</button></div><div class="field full"><label for="qTerms">Terms</label><textarea id="qTerms">${esc(existing?.terms ?? state.settings.defaultTerms)}</textarea></div><div class="field full"><label for="qNotes">Customer-facing notes</label><textarea id="qNotes">${esc(existing?.notes || "")}</textarea></div><div class="field full"><div id="quoteSummary" class="quote-live-summary" aria-live="polite"></div></div></div>`;
  modal(
    existing ? `Quotation ${existing.reference}` : "Create quotation",
    body,
    [
      { label: "Cancel", run: closeModal },
      {
        label: editing ? "Save draft" : "Save quotation draft",
        primary: true,
        run: () => saveQuote(lead, existing, !!existing && !editing),
      },
    ],
  );
  const update = () => {
    try {
      const x = calculateDetailedQuote({
        items: quoteLines(),
        discountType: $("#qDiscountType").value,
        discount: Number($("#qDiscount").value || 0),
        vat: Number($("#qVat").value || 0),
      });
      $("#quoteSummary").innerHTML =
        `<div class="quote-live-row"><span>Subtotal</span><strong>${money(x.subtotal)}</strong></div><div class="quote-live-row"><span>Discount</span><strong>−${money(x.discountAmount)}</strong></div><div class="quote-live-row"><span>VAT (${x.vat}%)</span><strong>${money(x.vatAmount)}</strong></div><div class="quote-live-row grand"><span>Total</span><strong>${money(x.total)}</strong></div>`;
    } catch {
      $("#quoteSummary").textContent =
        "Enter valid line items to calculate the total.";
    }
  };
  $("#quoteLineList").addEventListener("input", update);
  $("#quoteLineList").addEventListener("change", update);
  $("#qDiscount").oninput = update;
  $("#qDiscountType").onchange = update;
  $("#qVat").oninput = update;
  $("#addQuoteLine").onclick = () => {
    $("#quoteLineList").insertAdjacentHTML(
      "beforeend",
      quoteLine(
        { category: "service", description: "", qty: 1, price: 0 },
        $$("[data-quote-line]").length,
      ),
    );
    update();
  };
  $("#quoteLineList").addEventListener("click", (e) => {
    if (e.target.matches('[data-action="remove-line"]')) {
      if ($$("[data-quote-line]").length === 1)
        return toast("A quotation needs at least one line.", true);
      e.target.closest("[data-quote-line]").remove();
      update();
    }
  });
  update();
}
async function saveQuote(lead, existing, revision) {
  try {
    const calculated = calculateDetailedQuote({
      items: quoteLines(),
      discountType: $("#qDiscountType").value,
      discount: Number($("#qDiscount").value || 0),
      vat: Number($("#qVat").value || 0),
    });
    const refs = new Set(state.quotes.map((q) => q.reference));
    const built = buildQuoteRecord({
      existingQuote: existing || null,
      lead,
      customer: customerOf(lead),
      settings: state.settings,
      calculated,
      date: $("#qDate").value,
      expiryDate: $("#qExpiry").value,
      terms: $("#qTerms").value,
      notes: $("#qNotes").value,
      existingRefs: refs,
      forceNewRevision: revision,
    });
    const quote = built.quoteRecord;
    const stage = ["New enquiry", "Contacted"].includes(lead.stage)
      ? "Quotation prepared"
      : lead.stage;
    const updated = {
      ...lead,
      quote,
      quoteId: quote.id,
      activeQuoteId: quote.id,
      stage,
      updatedAt: now(),
    };
    await runTransaction(
      state.db,
      ["quotes", "leads", "activities"],
      "readwrite",
      (s) => {
        if (built.supersededQuote) s.quotes.put(built.supersededQuote);
        s.quotes.put(quote);
        s.leads.put(updated);
        s.activities.put({
          id: createId("act"),
          leadId: lead.id,
          customerId: lead.customerId,
          type: built.isRevision ? "quote_revised" : "quote_created",
          summary: `Quotation ${quote.reference} prepared`,
          createdAt: now(),
        });
        if (stage !== lead.stage)
          s.activities.put({
            id: createId("act"),
            leadId: lead.id,
            customerId: lead.customerId,
            type: "stage_changed",
            summary: `Stage changed from ${lead.stage} to ${stage}`,
            createdAt: now(),
          });
      },
    );
    closeModal();
    await refresh();
    toast(`Quotation ${quote.reference} saved as a draft.`);
  } catch (e) {
    const el = $("#quoteError");
    el.textContent = e.message;
    el.hidden = false;
  }
}
function printQuote(q) {
  const lead = byId(state.leads, q.leadId) || {};
  $("#printArea").innerHTML = renderQuotationDocumentHtml({
    quote: q,
    lead,
    customer: customerOf(lead),
    settings: state.settings,
  });
  window.print();
  void log({
    leadId: lead.id,
    customerId: lead.customerId,
    type: "quote_print_dialog_opened",
    summary: `Print / PDF dialog opened for ${q.reference}`,
  });
}
async function setQuoteStatus(q) {
  const choices = ["Draft", "Sent", "Accepted", "Declined"];
  modal(
    `Update ${q.reference}`,
    `<p>Record a status only after confirming a real event. LeadLoop does not send or accept quotations automatically.</p><div class="field"><label for="quoteStatus">Status</label><select id="quoteStatus">${choices.map((s) => `<option ${s === q.status ? "selected" : ""}>${s}</option>`).join("")}</select></div>`,
    [
      { label: "Cancel", run: closeModal },
      {
        label: "Save status",
        primary: true,
        run: async () => {
          const status = $("#quoteStatus").value;
          const stamp = now(),
            updated = {
              ...q,
              status,
              updatedAt: stamp,
              ...(status === "Sent" ? { sentAt: stamp } : {}),
              ...(status === "Accepted" ? { acceptedAt: stamp } : {}),
              ...(status === "Declined" ? { declinedAt: stamp } : {}),
            };
          const l = byId(state.leads, q.leadId);
          const next = {
            ...l,
            quote: updated,
            quoteId: updated.id,
            activeQuoteId: updated.id,
            stage:
              status === "Sent"
                ? "Quotation sent"
                : status === "Accepted"
                  ? "Accepted / booked"
                  : status === "Declined"
                    ? "Lost"
                    : l.stage,
            updatedAt: stamp,
          };
          await runTransaction(
            state.db,
            ["quotes", "leads", "activities"],
            "readwrite",
            (s) => {
              s.quotes.put(updated);
              s.leads.put(next);
              s.activities.put({
                id: createId("act"),
                leadId: l.id,
                customerId: l.customerId,
                type: "quote_status",
                summary: `Quotation ${q.reference} marked ${status} by user`,
                createdAt: stamp,
              });
              if (next.stage !== l.stage)
                s.activities.put({
                  id: createId("act"),
                  leadId: l.id,
                  customerId: l.customerId,
                  type: "stage_changed",
                  summary: `Stage changed from ${l.stage} to ${next.stage}`,
                  createdAt: stamp,
                });
            },
          );
          closeModal();
          await refresh();
          toast(`Quotation status recorded: ${status}.`);
        },
      },
    ],
  );
}

function openFollowup(l) {
  const ts = getAllTemplates(state.settings);
  const t = ts[0];
  const subject = renderMessageTemplate(
    t?.subject || "Following up",
    l,
    state.settings,
  );
  const text = renderMessageTemplate(
    t?.body || state.settings.template,
    l,
    state.settings,
  );
  const body = `<div id="messageError" class="form-error" hidden role="alert"></div><div class="form-grid"><div class="field"><label for="msgTemplate">Template</label><select id="msgTemplate">${ts.map((x) => `<option value="${escAttr(x.id)}">${esc(x.name)}</option>`).join("")}</select></div><div class="field"><label for="msgChannel">Open with</label><select id="msgChannel"><option value="whatsapp">WhatsApp</option><option value="email">Email</option></select></div><div class="field"><label for="msgDate">Follow-up date</label><input id="msgDate" type="date" value="${escAttr(l.followUpDate || "")}"></div><div class="field full"><label for="msgSubject">Email subject</label><input id="msgSubject" value="${escAttr(subject)}"></div><div class="field full"><label for="msgBody">Personalised message draft</label><textarea id="msgBody" style="min-height:150px">${esc(text)}</textarea></div></div><p class="hint">This prepares a draft and opens an external app only after your click. Nothing is sent automatically.</p>`;
  modal(`Prepare follow-up — ${l.name}`, body, [
    { label: "Cancel", run: closeModal },
    { label: "Save draft only", run: () => saveMessage(l, null) },
    { label: "Open message app", primary: true, run: () => openMessage(l) },
  ]);
  $("#msgTemplate").onchange = () => {
    const x = ts.find((x) => x.id === $("#msgTemplate").value);
    if (x) {
      $("#msgSubject").value = renderMessageTemplate(
        x.subject,
        l,
        state.settings,
      );
      $("#msgBody").value = renderMessageTemplate(x.body, l, state.settings);
    }
  };
}
async function saveMessage(l, channel) {
  const date = $("#msgDate").value,
    text = $("#msgBody").value.trim(),
    err = $("#messageError");
  if ((date && !validDate(date, false)) || !text) {
    err.textContent = "Enter a valid follow-up date and message draft.";
    err.hidden = false;
    return;
  }
  const stamp = now(),
    updated = {
      ...l,
      preparedMessage: text,
      lastPreparedAt: stamp,
      ...(channel ? { lastOpenedAt: stamp, lastOpenedChannel: channel } : {}),
      followUpDate: date,
      stage: l.stage === "New enquiry" ? "Contacted" : l.stage,
      updatedAt: stamp,
    };
  try {
    await putInStore(state.db, "leads", updated);
    await log({
      leadId: l.id,
      customerId: l.customerId,
      type: "message_draft_prepared",
      summary: "Follow-up message draft prepared",
      channel: $("#msgChannel").value,
      message: text,
    });
    if (channel)
      await log({
        leadId: l.id,
        customerId: l.customerId,
        type: "message_app_opened",
        summary: `${channel} draft link opened`,
        channel,
        message: text,
      });
    closeModal();
    await refresh();
    toast(
      channel
        ? "Draft prepared and app link opened. Record contact separately."
        : "Draft saved; it has not been sent.",
    );
  } catch (e) {
    toast(e.message, true);
  }
}
function openMessage(l) {
  const channel = $("#msgChannel").value,
    text = $("#msgBody").value.trim(),
    date = $("#msgDate").value,
    err = $("#messageError");
  if (!text || (date && !validDate(date, false))) {
    err.textContent = "Enter a message and valid follow-up date.";
    err.hidden = false;
    return;
  }
  let url;
  if (channel === "email")
    url = `mailto:${encodeURIComponent(l.email || "")}?subject=${encodeURIComponent($("#msgSubject").value)}&body=${encodeURIComponent(text)}`;
  else {
    const phone = normalizeUKPhone(l.phone);
    if (!phone) {
      err.textContent = "A valid UK telephone number is needed for WhatsApp.";
      err.hidden = false;
      return;
    }
    url = `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
  }
  window.open(url, "_blank", "noopener,noreferrer");
  void saveMessage(l, channel);
}
async function confirmContact(l) {
  if (
    !(await confirmUser(
      "Confirm customer contact",
      `Record that you actually contacted ${l.name}? This is a manual record and does not verify delivery.`,
      "Record contact",
    ))
  )
    return;
  const stamp = now();
  await changeLead(
    l,
    {
      lastContactConfirmedAt: stamp,
      lastContactAt: stamp,
      lastContactChannel: "user-confirmed",
      followUpDate: "",
    },
    {
      type: "contact_confirmed",
      summary: "Customer contact confirmed by user",
    },
  );
  toast("Contact confirmation recorded.");
}
async function completeVisit(l) {
  const body = `<div id="visitError" class="form-error" hidden role="alert"></div><div class="form-grid"><div class="field"><label for="visitDate">Completion date</label><input id="visitDate" type="date" value="${today}"></div><div class="field"><label for="visitPaid">Payment recorded for visit (£)</label><input id="visitPaid" type="number" min="0" step="0.01" placeholder="Leave blank if not recorded"></div><div class="field"><label for="visitNext">Next custom reminder (optional)</label><input id="visitNext" type="date"></div><div class="field full"><label for="visitNotes">Visit notes</label><textarea id="visitNotes"></textarea></div></div><p class="hint">The next repeat date advances past today while retaining the recurring anchor. This records a completed visit only; it does not book another appointment.</p>`;
  modal(`Record completed visit — ${l.name}`, body, [
    { label: "Cancel", run: closeModal },
    {
      label: "Record visit",
      primary: true,
      run: async () => {
        try {
          const date = $("#visitDate").value,
            custom = $("#visitNext").value,
            amount = $("#visitPaid").value;
          if (!validDate(date, false) || (custom && !validDate(custom, false)))
            throw Error("Enter valid dates.");
          const built = buildCompletedVisit(l, {
            completedDate: date,
            today,
            customNextDate: custom,
            amountPaid: amount === "" ? null : Number(amount),
            notes: $("#visitNotes").value,
          });
          const stamp = now(),
            updated = {
              ...l,
              stage: l.stage === "Accepted / booked" ? "Completed" : l.stage,
              completedDate: l.completedDate || date,
              nextRepeat: built.nextRepeat,
              repeatAnchorDay: built.repeatAnchorDay,
              updatedAt: stamp,
            };
          await runTransaction(
            state.db,
            ["leads", "visits", "activities"],
            "readwrite",
            (s) => {
              s.leads.put(updated);
              s.visits.put(built.visit);
              s.activities.put({
                id: createId("act"),
                leadId: l.id,
                customerId: l.customerId,
                type: "visit_completed",
                summary: `Service visit completed on ${formatDisplayDate(date)}`,
                createdAt: stamp,
                metadata: {
                  visitId: built.visit.id,
                  nextRepeat: built.nextRepeat,
                },
              });
              if (updated.stage !== l.stage)
                s.activities.put({
                  id: createId("act"),
                  leadId: l.id,
                  customerId: l.customerId,
                  type: "stage_changed",
                  summary: `Stage changed from ${l.stage} to ${updated.stage}`,
                  createdAt: stamp,
                });
              if (built.visit.amountPaid > 0)
                s.activities.put({
                  id: createId("act"),
                  leadId: l.id,
                  customerId: l.customerId,
                  type: "payment_recorded",
                  summary: `Visit payment recorded: ${money(built.visit.amountPaid)}`,
                  createdAt: stamp,
                });
            },
          );
          closeModal();
          await refresh();
          toast(
            built.nextRepeat
              ? `Visit recorded. Next reminder ${formatDisplayDate(built.nextRepeat)}.`
              : "Visit recorded.",
          );
        } catch (e) {
          const x = $("#visitError");
          x.textContent = e.message;
          x.hidden = false;
        }
      },
    },
  ]);
}

function download(name, text, type) {
  const u = URL.createObjectURL(new Blob([text], { type })),
    a = document.createElement("a");
  a.href = u;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(u), 1000);
}
async function backup() {
  try {
    const p = await createBackupPayload(state.db);
    download(
      `leadloop-backup-${today}.json`,
      JSON.stringify(p, null, 2),
      "application/json",
    );
    toast("Backup downloaded. Store it somewhere secure.");
  } catch (e) {
    toast(e.message, true);
  }
}
async function restore(file) {
  if (!file) return;
  if (
    !(await confirmUser(
      "Replace local records?",
      "A valid backup restore replaces all current LeadLoop records and settings on this device.",
      "Choose and validate backup",
      true,
    ))
  )
    return;
  try {
    let p;
    try {
      p = JSON.parse(await file.text());
    } catch {
      throw Error("Selected file is not valid JSON.");
    }
    await restoreBackupToDB(state.db, p);
    state.selectedCustomerId = "";
    await refresh();
    toast("Backup validated and restored.");
  } catch (e) {
    toast(`Restore stopped safely: ${e.message}`, true);
  } finally {
    $("#restoreFile").value = "";
  }
}
async function eraseData() {
  if (
    !(await confirmUser(
      "Erase all local data?",
      "This permanently removes every LeadLoop record from this browser. Download a backup first if needed.",
      "Continue",
      true,
    ))
  )
    return;
  if (prompt("Type ERASE to confirm permanent removal:") !== "ERASE") {
    toast("Erase cancelled.");
    return;
  }
  try {
    await eraseAllDataInDB(state.db);
    state.selectedCustomerId = "";
    await refresh();
    toast("All local LeadLoop data erased.");
  } catch (e) {
    toast(e.message, true);
  }
}
function exportCsv(customers = false) {
  const rows = customers ? state.customers : state.leads;
  const result = customers
    ? generateCustomersCsv(state.customers, state.leads, state.visits)
    : generateEnquiriesCsv(state.leads);
  download(
    `leadloop-${customers ? "customers" : "enquiries"}-${today}.csv`,
    result,
    "text/csv;charset=utf-8",
  );
  toast("CSV downloaded. Review before sharing.");
}
function showQuarantine() {
  const report = state.settings.migrationReport;
  const body = `<p>Records that could not be safely converted remain preserved for manual review.</p>${report ? `<pre style="white-space:pre-wrap;overflow-wrap:anywhere">${esc(report)}</pre>` : ""}${state.quarantine.map((q, i) => `<details class="queue-item"><summary>Preserved record ${i + 1}: ${esc(q.reason || "Review required")}</summary><pre style="white-space:pre-wrap;overflow-wrap:anywhere">${esc(JSON.stringify(q.rawRecord ?? q, null, 2))}</pre></details>`).join("")}`;
  modal("Data recovery report", body, [
    { label: "Close", primary: true, run: closeModal },
  ]);
}
function installGuide() {
  modal(
    "Install LeadLoop UK",
    `<p>Use Install App when your browser offers it. Otherwise open the browser menu and choose Install app or Add to Home Screen. Availability varies by browser and platform.</p><p class="hint">Installation does not sync or encrypt local data. HTTPS is normally required.</p>`,
    [{ label: "Close", primary: true, run: closeModal }],
    true,
  );
}
async function chooseQuoteLead() {
  if (!state.leads.length) {
    toast("Add an enquiry before creating a quotation.", true);
    return;
  }
  modal(
    "Choose an enquiry",
    `<div class="queue-list">${state.leads.map((l) => `<button class="customer-card-btn" data-action="pick-quote" data-id="${escAttr(l.id)}"><strong>${esc(l.name)}</strong><span class="sub">${esc(l.job)} · ${esc(l.stage)}</span></button>`).join("")}</div>`,
    [{ label: "Cancel", run: closeModal }],
  );
}

async function act(action, id = "", el = null) {
  const l = byId(state.leads, id),
    c = byId(state.customers, id),
    q = byId(state.quotes, id);
  switch (action) {
    case "add-lead":
      openLeadForm();
      break;
    case "edit-lead":
      if (l) openLeadForm(l);
      break;
    case "open-lead":
      nav("enquiries");
      break;
    case "stage":
      if (l && el) {
        const prior = l.stage;
        await changeLead(
          l,
          { stage: el.value },
          {
            type: "stage_changed",
            summary: `Stage changed from ${prior} to ${el.value}`,
          },
        );
        toast(`Stage updated to ${el.value}.`);
      }
      break;
    case "customer-profile":
      if (id) {
        state.selectedCustomerId = id;
        nav("customers");
      }
      break;
    case "add-customer":
      openCustomerForm();
      break;
    case "edit-customer":
      if (c) openCustomerForm(c);
      break;
    case "select-customer":
      state.selectedCustomerId = id;
      render();
      break;
    case "add-lead-customer":
      closeModal();
      openLeadForm(null, id);
      break;
    case "quote-lead":
      if (l) openQuoteEditor(l);
      break;
    case "choose-quote-lead":
      chooseQuoteLead();
      break;
    case "pick-quote":
      closeModal();
      {
        const x = byId(state.leads, id);
        if (x) openQuoteEditor(x);
      }
      break;
    case "revise-quote": {
      const x = byId(state.leads, id);
      if (x) openQuoteEditor(x, latestQuote(x));
      break;
    }
    case "print-quote":
      if (q) printQuote(q);
      break;
    case "quote-status":
      if (q) setQuoteStatus(q);
      break;
    case "followup":
      if (l) openFollowup(l);
      break;
    case "confirm-contact":
      if (l) await confirmContact(l);
      break;
    case "complete-repeat":
      if (l) completeVisit(l);
      break;
    case "backup":
      await backup();
      break;
    case "restore":
      $("#restoreFile").click();
      break;
    case "csv":
      exportCsv(false);
      break;
    case "customers-csv":
      exportCsv(true);
      break;
    case "erase":
      await eraseData();
      break;
    case "quarantine":
      showQuarantine();
      break;
    case "install-guide":
      installGuide();
      break;
    default:
      break;
  }
}

document.addEventListener("click", (e) => {
  const n = e.target.closest("[data-nav]");
  if (n) {
    nav(n.dataset.nav);
    return;
  }
  const f = e.target.closest("[data-dashboard-filter]");
  if (f) {
    const k = f.dataset.dashboardFilter;
    if (k === "enquiries") state.stageFilter = "";
    else if (k.startsWith("stage:")) {
      const key = k.slice(6);
      state.stageFilter =
        {
          new: "New enquiry",
          quote: "Quotation sent",
          accepted: "Accepted / booked",
          completed: "Completed",
          lost: "Lost",
        }[key] || "";
    }
    if (k === "repeat" || k === "followups") nav("followups");
    else nav("enquiries");
    return;
  }
  const b = e.target.closest("[data-action]");
  if (b) {
    if (b.dataset.action === "stage") return;
    void act(b.dataset.action, b.dataset.id || "", b);
    return;
  }
  if (e.target.closest("#addBtn")) openLeadForm();
  if (e.target.closest("#backupBtn")) void backup();
});
document.addEventListener("change", (e) => {
  const el = e.target.closest('[data-action="stage"]');
  if (el) void act("stage", el.dataset.id, el);
});
$("#closeModal").onclick = closeModal;
$("#closeConfirmModal").onclick = () => $("#confirmModal").close();
$("#modal").addEventListener("click", (e) => {
  if (e.target === $("#modal")) closeModal();
});
$("#restoreFile").onchange = (e) => void restore(e.target.files?.[0]);
$("#viewQuarantineBtn").onclick = showQuarantine;
$("#installHelpBtn").onclick = installGuide;
$("#themeBtn").onclick = () =>
  setTheme(
    document.documentElement.dataset.theme === "dark" ? "light" : "dark",
  );
$("#applyUpdateBtn").onclick = () => {
  state.isUpdating = true;
  state.waitingWorker?.postMessage({ type: "SKIP_WAITING" });
};
function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem("leadloop-theme", theme);
  $("#themeColorMeta").content = theme === "light" ? "#f3f6fa" : "#0b0f17";
  $("#themeBtn").textContent = theme === "light" ? "Dark theme" : "Light theme";
}
function showInstall() {
  if (state.deferredInstall) {
    state.deferredInstall.prompt();
    state.deferredInstall.userChoice.then((r) => {
      state.deferredInstall = null;
      $("#installBtn").hidden = true;
      $("#sidebarInstallBtn").hidden = true;
      if (r.outcome === "accepted") toast("Installation accepted by browser.");
    });
  } else installGuide();
}
$("#installBtn").onclick = showInstall;
$("#sidebarInstallBtn").onclick = showInstall;
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  state.deferredInstall = e;
  $("#installBtn").hidden = false;
  $("#sidebarInstallBtn").hidden = false;
});
window.addEventListener("appinstalled", () => {
  state.deferredInstall = null;
  $("#installBtn").hidden = true;
  $("#sidebarInstallBtn").hidden = true;
  updateChrome();
  toast("LeadLoop installed on this device.");
});
window.addEventListener("online", () => ($("#offlineBanner").hidden = true));
window.addEventListener("offline", () => ($("#offlineBanner").hidden = false));
async function serviceWorker() {
  if (!("serviceWorker" in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.register("./sw.js");
    const pending = reg.waiting;
    if (pending && navigator.serviceWorker.controller) {
      state.waitingWorker = pending;
      $("#swUpdateBanner").hidden = false;
    }
    reg.addEventListener("updatefound", () => {
      const w = reg.installing;
      w?.addEventListener("statechange", () => {
        if (w.state === "installed" && navigator.serviceWorker.controller) {
          state.waitingWorker = w;
          $("#swUpdateBanner").hidden = false;
        }
      });
    });
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (state.isUpdating) location.reload();
    });
  } catch (e) {
    console.warn("Service worker registration unavailable", e);
  }
}
async function init() {
  const theme = localStorage.getItem("leadloop-theme");
  setTheme(theme === "light" ? "light" : "dark");
  try {
    state.db = await openDatabase();
    await refresh();
    await serviceWorker();
  } catch (e) {
    console.error("LeadLoop startup failed", e);
    $("#viewContainer").innerHTML =
      `<div class="card empty"><h2>LeadLoop could not open its local database</h2><p>${esc(e.message || "Unexpected database error")}</p><p>Do not clear browser storage if you need to preserve existing records. Close other LeadLoop tabs and reload.</p></div>`;
    toast(
      "Local database could not be opened. Existing data has not been intentionally erased.",
      true,
    );
  }
}
void init();
