import { STAGES, WON_STAGES, CLOSED_STAGES } from "./constants.js";
import { localDateString, round2 } from "./utils.js";
import { quoteTotal } from "./quotes.js";

export function isFollowUpDue(lead, today = localDateString()) {
  return Boolean(
    lead &&
    lead.followUpDate &&
    lead.followUpDate <= today &&
    !CLOSED_STAGES.includes(lead.stage),
  );
}

export function isFollowUpOverdue(lead, today = localDateString()) {
  return Boolean(
    lead &&
    lead.followUpDate &&
    lead.followUpDate < today &&
    !CLOSED_STAGES.includes(lead.stage),
  );
}

export function isRepeatDue(lead, today = localDateString()) {
  return Boolean(
    lead &&
    lead.stage !== "Lost" &&
    lead.repeatActive !== false &&
    lead.nextRepeat &&
    lead.nextRepeat <= today,
  );
}

export function isNeedsFollowUpAttention(lead, today = localDateString()) {
  if (!lead || CLOSED_STAGES.includes(lead.stage)) return false;
  if (isFollowUpDue(lead, today)) return true;
  if (!lead.lastContactConfirmedAt && !lead.followUpDate) return true;
  return false;
}

export function filterLeads(leads, filters = {}, today = localDateString()) {
  const {
    search = "",
    stage = "",
    customerId = "",
    dueFilter = "",
    fromDate = "",
    toDate = "",
  } = filters;
  const q = String(search || "")
    .trim()
    .toLowerCase();

  return leads.filter((l) => {
    if (stage && l.stage !== stage) return false;
    if (customerId && l.customerId !== customerId) return false;
    if (fromDate && l.created < fromDate) return false;
    if (toDate && l.created > toDate) return false;

    if (dueFilter === "due") {
      if (!isFollowUpDue(l, today)) return false;
    } else if (dueFilter === "overdue") {
      if (!isFollowUpOverdue(l, today)) return false;
    } else if (dueFilter === "today") {
      if (CLOSED_STAGES.includes(l.stage) || l.followUpDate !== today)
        return false;
    } else if (dueFilter === "later") {
      if (
        !l.followUpDate ||
        l.followUpDate <= today ||
        CLOSED_STAGES.includes(l.stage)
      )
        return false;
    } else if (dueFilter === "unfollowed") {
      if (CLOSED_STAGES.includes(l.stage) || l.lastContactConfirmedAt)
        return false;
    } else if (dueFilter === "repeat-due") {
      if (!isRepeatDue(l, today)) return false;
    }

    if (q) {
      const haystack = [
        l.name,
        l.email,
        l.phone,
        l.job,
        l.jobCategory,
        l.source,
        l.serviceAddress,
        l.postcode,
        l.notes,
        l.quote?.reference,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });
}

export function calculateDashboard(
  leads = [],
  today = localDateString(),
  options = {},
) {
  const visits = Array.isArray(options.visits) ? options.visits : [];

  const active = leads.filter((l) => !CLOSED_STAGES.includes(l.stage));
  const newEnquiries = leads.filter((l) => l.stage === "New enquiry");
  const accepted = leads.filter((l) =>
    ["Accepted / booked", "Won"].includes(l.stage),
  );
  const completed = leads.filter((l) => l.stage === "Completed");
  const won = leads.filter((l) => WON_STAGES.includes(l.stage));
  const lost = leads.filter((l) => l.stage === "Lost");

  const outstandingQuotes = leads.filter(
    (l) =>
      l.quote && ["Quotation sent", "Follow-up required"].includes(l.stage),
  );
  const draftQuotes = leads.filter(
    (l) =>
      l.quote &&
      ["New enquiry", "Contacted", "Quotation prepared"].includes(l.stage),
  );
  const allQuotedActiveOrWon = leads.filter(
    (l) => l.quote && l.stage !== "Lost",
  );

  const followUpsDueToday = active.filter(
    (l) => l.followUpDate && l.followUpDate === today,
  );
  const overdueFollowUps = active.filter(
    (l) => l.followUpDate && l.followUpDate < today,
  );
  const followUpsDue = followUpsDueToday.length + overdueFollowUps.length;
  const unfollowedEnquiries = active.filter(
    (l) => !l.lastContactConfirmedAt,
  ).length;

  // Won (Accepted / booked & Completed) customers ARE eligible for repeat reminders; only Lost or paused are excluded.
  const repeatEligible = leads.filter(
    (l) =>
      l.stage !== "Lost" && l.repeatActive !== false && Boolean(l.nextRepeat),
  );
  const repeatDueToday = repeatEligible.filter(
    (l) => l.nextRepeat === today,
  ).length;
  const repeatOverdue = repeatEligible.filter(
    (l) => l.nextRepeat < today,
  ).length;
  const repeatDue = repeatDueToday + repeatOverdue;
  const repeatUpcoming = repeatEligible.filter(
    (l) => l.nextRepeat > today,
  ).length;

  const estimatedPipelineValue = round2(
    active
      .filter((l) => !l.quote && Number(l.estimatedValue) > 0)
      .reduce((sum, l) => sum + Number(l.estimatedValue), 0),
  );
  const draftQuoteValue = round2(
    draftQuotes.reduce((sum, l) => sum + quoteTotal(l), 0),
  );
  const outstandingValue = round2(
    outstandingQuotes.reduce((sum, l) => sum + quoteTotal(l), 0),
  );
  const quotedValue = round2(
    allQuotedActiveOrWon.reduce((sum, l) => sum + quoteTotal(l), 0),
  );
  const acceptedValue = round2(
    accepted.reduce((sum, l) => sum + quoteTotal(l), 0),
  );
  const completedValue = round2(
    completed.reduce((sum, l) => sum + quoteTotal(l), 0),
  );
  const wonValue = round2(won.reduce((sum, l) => sum + quoteTotal(l), 0));
  const lostValue = round2(lost.reduce((sum, l) => sum + quoteTotal(l), 0));

  const leadPayments = leads.reduce((sum, l) => {
    const amt = Number(l.paidAmount);
    return Number.isFinite(amt) && amt > 0 ? sum + amt : sum;
  }, 0);
  const visitPayments = visits.reduce((sum, v) => {
    const amt = Number(v.amountPaid);
    return Number.isFinite(amt) && amt > 0 ? sum + amt : sum;
  }, 0);
  const confirmedPaidTotal = round2(leadPayments + visitPayments);
  const hasRecordedPayments =
    confirmedPaidTotal > 0 ||
    leads.some(
      (l) => l.paymentStatus === "paid" || l.paymentStatus === "part_paid",
    );

  const closed = won.length + lost.length;
  const conversionRate = closed
    ? Math.round((won.length / closed) * 100)
    : null;

  const stageBreakdown = STAGES.map((stage) => {
    const matching = leads.filter((l) => l.stage === stage);
    return {
      stage,
      count: matching.length,
      quotedValue: round2(matching.reduce((sum, l) => sum + quoteTotal(l), 0)),
    };
  });

  return {
    enquiries: leads.length,
    newEnquiries: newEnquiries.length,
    activeEnquiries: active.length,
    draftQuotes: draftQuotes.length,
    draftQuoteValue,
    outstandingQuotes: outstandingQuotes.length,
    outstandingValue,
    quotedValue,
    estimatedPipelineValue,
    acceptedJobs: accepted.length,
    acceptedValue,
    completedJobs: completed.length,
    completedValue,
    wonJobs: won.length,
    wonValue,
    lost: lost.length,
    lostValue,
    confirmedPaidTotal,
    hasRecordedPayments,
    followUpsDueToday: followUpsDueToday.length,
    overdueFollowUps: overdueFollowUps.length,
    followUpsDue,
    unfollowedEnquiries,
    repeatDueToday,
    repeatOverdue,
    repeatDue,
    repeatUpcoming,
    completedVisits: visits.length,
    conversionRate,
    stageBreakdown,
  };
}
