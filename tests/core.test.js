import test from "node:test";
import assert from "node:assert/strict";
import {
  localDateString,
  validDate,
  calculateQuote,
  calculateDetailedQuote,
  calculateDashboard,
  buildQuoteRecord,
  normalizeUKPhone,
  normalizeUKPostcode,
  validateBackup,
  advanceRepeat,
  calculateNextRepeatOccurrence,
  migrateLead,
  migrateQuote,
  findPotentialDuplicates,
  escapeCsvCell,
  isRepeatDue,
} from "../core.js";

const legacyLead = {
  id: "lead-a",
  name: "A Person",
  job: "Clean",
  stage: "New enquiry",
  created: "2026-01-01",
  phone: "07123 456789",
  email: "a@example.com",
  source: "",
  followUpDate: "",
  nextRepeat: "",
  repeatInterval: "",
  preparedMessage: "",
};

test("local calendar dates and impossible date validation", () => {
  assert.equal(localDateString(new Date(2026, 0, 2, 23, 30)), "2026-01-02");
  assert.equal(validDate("2024-02-29", false), true);
  assert.equal(validDate("2025-02-29", false), false);
  assert.equal(validDate("2026-13-01", false), false);
});

test("legacy quote calculator preserves public return shape and accurate VAT", () => {
  assert.deepEqual(
    calculateQuote(
      [
        { description: "Labour", qty: 2, price: 45 },
        { description: "Materials", qty: 1, price: 30 },
      ],
      10,
      20,
    ),
    {
      items: [
        { description: "Labour", qty: 2, price: 45 },
        { description: "Materials", qty: 1, price: 30 },
      ],
      discount: 10,
      vat: 20,
      subtotal: 120,
      discountAmount: 12,
      vatAmount: 21.6,
      total: 129.6,
    },
  );
  assert.throws(() =>
    calculateQuote([{ description: "", qty: 1, price: 2 }], 0, 0),
  );
  assert.throws(() =>
    calculateQuote([{ description: "x", qty: -1, price: 2 }], 0, 0),
  );
  assert.throws(() =>
    calculateQuote([{ description: "x", qty: 1, price: 2 }], 101, 0),
  );
});

test("detailed quote supports category lines, fixed discount and VAT", () => {
  const q = calculateDetailedQuote({
    items: [
      { category: "labour", description: "Labour", qty: 2, price: 50 },
      { category: "materials", description: "Paint", qty: 1, price: 25 },
    ],
    discountType: "fixed",
    discount: 10,
    vat: 20,
  });
  assert.equal(q.subtotal, 125);
  assert.equal(q.discountAmount, 10);
  assert.equal(q.net, 115);
  assert.equal(q.vatAmount, 23);
  assert.equal(q.total, 138);
  assert.equal(q.categoryTotals.labour, 100);
  assert.throws(() =>
    calculateDetailedQuote({
      items: [{ description: "x", qty: 1, price: 1 }],
      discountType: "fixed",
      discount: 2,
    }),
  );
});

test("dashboard reports actual records, excludes quote value from payments, conversion uses closed records", () => {
  const leads = [
    {
      ...legacyLead,
      id: "won",
      stage: "Accepted / booked",
      quote: {
        items: [{ description: "job", qty: 1, price: 100 }],
        discount: 0,
        vat: 0,
      },
      nextRepeat: "2026-01-01",
      repeatActive: true,
    },
    { ...legacyLead, id: "lost", stage: "Lost", quote: null },
    {
      ...legacyLead,
      id: "new",
      stage: "New enquiry",
      followUpDate: "2026-01-01",
      quote: null,
    },
    {
      ...legacyLead,
      id: "complete",
      stage: "Completed",
      nextRepeat: "2026-01-01",
      repeatActive: true,
    },
  ];
  const d = calculateDashboard(leads, "2026-01-02");
  assert.equal(d.enquiries, 4);
  assert.equal(d.conversionRate, 67);
  assert.equal(d.followUpsDue, 1);
  assert.equal(d.repeatDue, 2);
  assert.equal(d.wonValue, 100);
  assert.equal(d.confirmedPaidTotal, 0);
  assert.equal(isRepeatDue(leads[0], "2026-01-02"), true);
});

test("UK phone, postcode and CSV formula-injection normalisation", () => {
  assert.equal(normalizeUKPhone("07123 456789"), "447123456789");
  assert.equal(normalizeUKPhone("+44 7123 456789"), "447123456789");
  assert.equal(normalizeUKPhone("+44 (0) 7123 456789"), "447123456789");
  assert.equal(normalizeUKPhone("0044 7123 456789"), "447123456789");
  assert.equal(normalizeUKPhone("123"), null);
  assert.equal(normalizeUKPostcode("s1 2ab"), "S1 2AB");
  assert.match(escapeCsvCell("  =1+1"), /^"'\s+=1\+1"$/);
  assert.match(escapeCsvCell("\t@SUM(A1)"), /^"'\t@SUM/);
  assert.equal(escapeCsvCell("safe"), '"safe"');
});

test("repeat dates preserve month-end anchors and catch overdue schedules up", () => {
  assert.equal(advanceRepeat("2026-01-31", "monthly"), "2026-02-28");
  assert.equal(advanceRepeat("2026-02-28", "monthly", 31), "2026-03-31");
  assert.equal(advanceRepeat("2024-02-29", "yearly", 29), "2025-02-28");
  assert.equal(advanceRepeat("2026-01-15", "fortnightly"), "2026-01-29");
  assert.equal(
    calculateNextRepeatOccurrence({
      scheduledDate: "2026-01-31",
      interval: "monthly",
      completedDate: "2026-04-10",
      today: "2026-04-12",
      anchorDay: 31,
    }),
    "2026-04-30",
  );
  assert.equal(
    calculateNextRepeatOccurrence({
      scheduledDate: "2026-01-31",
      interval: "monthly",
      completedDate: "2026-04-30",
      today: "2026-05-02",
      anchorDay: 31,
    }),
    "2026-05-31",
  );
});

test("quote revisions receive unique references and retain the superseded revision", () => {
  const lead = {
    id: "lead-1",
    customerId: "customer-1",
    name: "Customer",
    job: "Kitchen clean",
  };
  const existingQuote = {
    id: "quote-1",
    reference: "LL-20261112-ABC123",
    version: 1,
    status: "Sent",
    leadId: lead.id,
    total: 100,
  };
  const calculated = calculateDetailedQuote({
    items: [{ description: "Labour", qty: 1, price: 120 }],
    discountType: "percent",
    discount: 0,
    vat: 0,
  });
  const built = buildQuoteRecord({
    existingQuote,
    lead,
    calculated,
    date: "2026-11-12",
    existingRefs: new Set([existingQuote.reference]),
  });
  assert.equal(built.isRevision, true);
  assert.equal(built.supersededQuote.id, "quote-1");
  assert.equal(built.quoteRecord.parentQuoteId, "quote-1");
  assert.equal(built.quoteRecord.version, 2);
  assert.match(built.quoteRecord.reference, /-R2$/);
  assert.equal(built.quoteRecord.total, 120);
});

test("backup validation normalises v1 to v3 and rejects duplicate or malformed records", () => {
  const v1 = {
    format: "leadloop-uk-backup",
    version: 1,
    leads: [
      {
        id: "a",
        customerName: "A",
        jobDetails: "Clean",
        phoneNumber: "07123 456789",
        enquiryDate: "2026-01-01",
        followupDate: "2026-01-02",
        nextBooking: "2026-02-01",
        interval: "monthly",
        status: "quoted",
        quotation: {
          ref: "Q1",
          quoteDate: "2026-01-01",
          lines: [{ name: "Labour", quantity: 2, unitPrice: 45 }],
          discount: 10,
          vat: 20,
        },
      },
    ],
    settings: { businessName: "Biz" },
  };
  const clean = validateBackup(v1);
  assert.equal(clean.version, 3);
  assert.equal(clean.leads[0].name, "A");
  assert.equal(clean.leads[0].quote.reference, "Q1");
  assert.equal(clean.leads[0].quote.total, 97.2);
  assert.deepEqual(clean.settings, [{ key: "business", value: "Biz" }]);
  const base = {
    format: "leadloop-uk-backup",
    version: 2,
    leads: [legacyLead],
    settings: [],
  };
  assert.equal(validateBackup(base).version, 3);
  assert.throws(
    () => validateBackup({ ...base, leads: [legacyLead, legacyLead] }),
    /duplicate/i,
  );
  assert.throws(() =>
    validateBackup({ ...base, leads: [{ ...legacyLead, stage: "invalid" }] }),
  );
});

test("legacy lead / quote migration and unambiguous customer duplicate warnings", () => {
  const migrated = migrateLead({
    id: "1",
    customerName: "A",
    jobDetails: "Clean",
    phoneNumber: "07123 456789",
    enquiryDate: "2026-01-01",
    followupDate: "2026-01-02",
    nextBooking: "2026-02-01",
    interval: "monthly",
    status: "quoted",
    quotation: {
      ref: "Q1",
      quoteDate: "2026-01-01",
      lines: [{ name: "Labour", quantity: 2, unitPrice: 45 }],
      discount: 10,
      vat: 20,
    },
  });
  assert.equal(migrated.stage, "Quotation prepared");
  assert.equal(migrated.quote.total, 97.2);
  assert.equal(migrateQuote({ items: [] }), undefined);
  const customers = [
    {
      id: "a",
      name: "Sam Example",
      phone: "07123 456789",
      normalizedPhone: "447123456789",
      email: "",
    },
  ];
  assert.equal(
    findPotentialDuplicates(customers, {
      name: "Sam Example",
      phone: "",
      email: "",
    }).length,
    1,
  );
});
