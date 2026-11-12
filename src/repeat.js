import { localDateString, validDate, round2, createId } from "./utils.js";

export function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

export function extractDayOfMonth(dateStr) {
  if (!validDate(dateStr, false)) return null;
  return Number(dateStr.split("-")[2]);
}

/**
 * Advances a YYYY-MM-DD date by one interval step.
 * When anchorDay (1..31) is supplied for monthly/quarterly/yearly schedules,
 * end-of-month clamping will not permanently drift the recurring day across short months
 * (e.g. Jan 31 -> Feb 28 -> Mar 31 -> Apr 30 -> May 31).
 */
export function advanceRepeat(date, interval, anchorDay = null) {
  if (!date || !interval) return "";
  const parts = String(date).split("-").map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return "";
  const [y, m, d] = parts;
  if (!validDate(String(date), false)) return "";

  if (interval === "weekly") {
    const dt = new Date(y, m - 1, d);
    dt.setDate(dt.getDate() + 7);
    return localDateString(dt);
  }
  if (interval === "fortnightly") {
    const dt = new Date(y, m - 1, d);
    dt.setDate(dt.getDate() + 14);
    return localDateString(dt);
  }

  let months = 0;
  if (interval === "monthly") months = 1;
  else if (interval === "quarterly") months = 3;
  else if (interval === "yearly") months = 12;
  else return "";

  const targetDay =
    Number.isInteger(anchorDay) && anchorDay >= 1 && anchorDay <= 31
      ? anchorDay
      : d;
  const totalMonths = y * 12 + (m - 1) + months;
  const ny = Math.floor(totalMonths / 12);
  const nm = (totalMonths % 12) + 1;
  const nd = Math.min(targetDay, daysInMonth(ny, nm));
  return `${String(ny).padStart(4, "0")}-${String(nm).padStart(2, "0")}-${String(nd).padStart(2, "0")}`;
}

export const advanceRepeatDate = advanceRepeat;
export const advanceDate = advanceRepeat;
export const nextRepeatDate = advanceRepeat;

/**
 * Calculates the next future reminder date when a repeat booking is marked complete.
 * - If interval is empty (a custom one-off reminder), returns "" unless customNextDate is supplied.
 * - Preserves the original recurring cadence (including anchorDay for end-of-month schedules).
 * - If the scheduled booking was completed late/overdue, advances along the cadence until
 *   the next occurrence is strictly after max(today, completedDate) so an overdue reminder
 *   never stays overdue or requires repeated clicks to catch up.
 */
export function calculateNextRepeatOccurrence({
  scheduledDate = "",
  interval = "",
  completedDate = localDateString(),
  today = localDateString(),
  anchorDay = null,
  customNextDate = "",
} = {}) {
  if (customNextDate && validDate(customNextDate, false)) {
    return customNextDate;
  }
  if (!interval) {
    return "";
  }
  const baseDate = validDate(scheduledDate, false)
    ? scheduledDate
    : validDate(completedDate, false)
      ? completedDate
      : today;
  const resolvedAnchor = anchorDay ?? extractDayOfMonth(baseDate);
  const cutoff = completedDate > today ? completedDate : today;

  let next = advanceRepeat(baseDate, interval, resolvedAnchor);
  let guard = 0;
  while (next && next <= cutoff && guard < 500) {
    next = advanceRepeat(next, interval, resolvedAnchor);
    guard++;
  }
  return next;
}

export function buildCompletedVisit(
  lead,
  {
    completedDate = localDateString(),
    today = localDateString(),
    customNextDate = "",
    amountPaid = null,
    notes = "",
  } = {},
) {
  if (!validDate(completedDate, false)) {
    throw new Error("Enter a valid completion date.");
  }
  const parsedAmount =
    amountPaid === "" || amountPaid == null ? null : round2(Number(amountPaid));
  if (
    parsedAmount !== null &&
    (!Number.isFinite(parsedAmount) || parsedAmount < 0)
  ) {
    throw new Error("Visit payment amount must be zero or positive.");
  }

  const anchorDay = lead.repeatAnchorDay || extractDayOfMonth(lead.nextRepeat);
  const nextScheduledDate = calculateNextRepeatOccurrence({
    scheduledDate: lead.nextRepeat,
    interval: lead.repeatInterval || "",
    completedDate,
    today,
    anchorDay,
    customNextDate,
  });

  const visit = {
    id: createId("vis"),
    leadId: lead.id,
    customerId: lead.customerId || "",
    customerName: lead.name || "",
    service: lead.job || "",
    scheduledFor: lead.nextRepeat || "",
    completedDate,
    interval: lead.repeatInterval || "",
    nextScheduledDate,
    amountPaid: parsedAmount,
    notes: String(notes || "").trim(),
    createdAt: new Date().toISOString(),
  };

  return {
    visit,
    nextRepeat: nextScheduledDate,
    repeatAnchorDay: nextScheduledDate
      ? customNextDate
        ? extractDayOfMonth(customNextDate)
        : anchorDay
      : null,
  };
}
