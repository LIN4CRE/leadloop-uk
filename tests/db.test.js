import test, { after } from "node:test";
import assert from "node:assert/strict";
import { indexedDB } from "fake-indexeddb";
import { migrateLead } from "../src/migration.js";
import {
  openDatabase,
  loadAllState,
  createBackupPayload,
  restoreBackupToDB,
  eraseAllDataInDB,
  putInStore,
} from "../src/db.js";

globalThis.indexedDB = indexedDB;
const names = new Set();
const newName = () => {
  const n = `leadloop-test-${Date.now()}-${Math.random()}`;
  names.add(n);
  return n;
};
function deleteDb(name) {
  return new Promise((resolve) => {
    const r = indexedDB.deleteDatabase(name);
    r.onsuccess = r.onerror = r.onblocked = () => resolve();
  });
}
function seedLegacy(name, version, stores) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, version);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const [storeName, rows, keyPath = "id"] of stores) {
        const store = db.createObjectStore(storeName, { keyPath });
        for (const row of rows) store.put(row);
      }
    };
    req.onsuccess = () => {
      req.result.close();
      resolve();
    };
    req.onerror = () => reject(req.error);
  });
}
const oldLead = {
  id: "legacy-1",
  customerName: "Legacy Customer",
  jobDetails: "Garden tidy",
  phoneNumber: "07123 456789",
  email: "legacy@example.com",
  enquiryDate: "2026-01-01",
  followupDate: "2026-01-10",
  nextBooking: "2026-02-01",
  interval: "monthly",
  status: "quoted",
  quotation: {
    ref: "OLD-1",
    quoteDate: "2026-01-01",
    lines: [{ name: "Labour", quantity: 2, unitPrice: 45 }],
    discount: 10,
    vat: 20,
  },
};

after(async () => {
  for (const name of names) await deleteDb(name);
});

test("fresh database creates all v4 stores and persists records", async () => {
  const name = newName();
  const db = await openDatabase(name);
  assert.equal(db.version, 4);
  for (const store of [
    "customers",
    "leads",
    "quotes",
    "visits",
    "activities",
    "settings",
    "quarantine",
  ])
    assert.equal(db.objectStoreNames.contains(store), true);
  await putInStore(db, "customers", {
    id: "c1",
    name: "New Customer",
    phone: "",
    email: "",
    address: "",
    postcode: "",
    notes: "",
  });
  assert.equal((await loadAllState(db)).customers.length, 1);
  db.close();
});

test("version 1 migration preserves enquiry, quote, settings and repeat dates", async () => {
  const name = newName();
  await seedLegacy(name, 1, [
    ["leads", [oldLead, { id: "unreadable-1", arbitrary: "preserve me" }]],
    ["settings", [{ key: "business", value: "Old business" }], "key"],
  ]);
  const db = await openDatabase(name);
  const s = await loadAllState(db);
  assert.equal(s.leads.length, 1);
  assert.equal(s.leads[0].name, "Legacy Customer");
  assert.equal(s.leads[0].nextRepeat, "2026-02-01");
  assert.equal(s.leads[0].quote.total, 97.2);
  assert.equal(s.quotes.length, 1);
  assert.equal(s.settings.business, "Old business");
  assert.equal(s.customers.length, 1);
  assert.equal(s.quarantine.length, 1);
  assert.equal(s.quarantine[0].rawRecord.arbitrary, "preserve me");
  assert.equal(JSON.parse(s.settings.migrationReport).quarantinedCount, 1);
  db.close();
});

test("version 2 flat customers store profiles migrate without losing profile details", async () => {
  const name = newName();
  await seedLegacy(name, 2, [
    [
      "customers",
      [
        {
          id: "cust-flat",
          name: "Profile Customer",
          phone: "07123 456789",
          email: "person@example.com",
          address: "1 High Street",
          postcode: "S1 2AB",
          notes: "Gate code in person",
        },
      ],
    ],
    [
      "leads",
      [
        {
          id: "lead-flat",
          name: "Profile Customer",
          job: "Window clean",
          phone: "07123 456789",
          email: "person@example.com",
          created: "2026-05-01",
          stage: "Won",
          followUpDate: "",
          nextRepeat: "2026-06-01",
          repeatInterval: "monthly",
        },
      ],
    ],
    ["settings", [], "key"],
  ]);
  const db = await openDatabase(name);
  const s = await loadAllState(db);
  assert.equal(s.customers.length, 1);
  assert.equal(s.customers[0].id, "cust-flat");
  assert.equal(s.customers[0].address, "1 High Street");
  assert.equal(s.customers[0].notes, "Gate code in person");
  assert.equal(s.leads.length, 1);
  assert.equal(s.leads[0].customerId, "cust-flat");
  assert.equal(s.leads[0].stage, "Accepted / booked");
  db.close();
});

test("failed upgrade aborts and leaves legacy database version and records intact", async () => {
  const name = newName();
  await seedLegacy(name, 2, [
    ["leads", [oldLead]],
    ["settings", [], "key"],
  ]);
  await assert.rejects(
    openDatabase(name, { simulateUpgradeFailure: true }),
    /Simulated migration failure/,
  );
  const req = indexedDB.open(name);
  const db = await new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  assert.equal(db.version, 2);
  const rows = await new Promise((resolve, reject) => {
    const r = db.transaction("leads").objectStore("leads").getAll();
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, "legacy-1");
  db.close();
});

test("backup restores atomically, validates before mutation, resets settings and can erase", async () => {
  const name = newName();
  const db = await openDatabase(name);
  await putInStore(db, "customers", {
    id: "old-c",
    name: "Old",
    phone: "",
    email: "",
    address: "",
    postcode: "",
    notes: "",
  });
  await putInStore(db, "settings", {
    key: "business",
    value: "Current business",
  });
  const payload = {
    format: "leadloop-uk-backup",
    version: 3,
    customers: [
      {
        id: "new-c",
        name: "New",
        phone: "",
        email: "",
        address: "",
        postcode: "",
        notes: "",
      },
    ],
    leads: [],
    quotes: [],
    visits: [],
    activities: [],
    settings: [{ key: "ownerName", value: "Owner" }],
    quarantine: [],
  };
  await assert.rejects(
    restoreBackupToDB(db, { ...payload, customers: [{ id: "bad" }] }),
  );
  assert.equal((await loadAllState(db)).customers[0].id, "old-c");
  await restoreBackupToDB(db, payload);
  const state = await loadAllState(db);
  assert.equal(state.customers.length, 1);
  assert.equal(state.customers[0].id, "new-c");
  assert.equal(state.settings.business, "");
  assert.equal(state.settings.ownerName, "Owner");
  const backup = await createBackupPayload(db);
  assert.equal(backup.version, 3);
  assert.equal(backup.customers.length, 1);
  await eraseAllDataInDB(db);
  assert.equal((await loadAllState(db)).customers.length, 0);
  db.close();
});

test("v3 to v4 additive upgrade retains existing records and adds missing indexes", async () => {
  const name = newName();
  await seedLegacy(name, 3, [
    ["customers", [{ id: "customer-v3", name: "Retained" }]],
    ["leads", [{ id: "lead-v3", customerId: "customer-v3" }]],
    ["quotes", []],
    ["visits", []],
    ["activities", []],
    ["settings", [], "key"],
    ["quarantine", []],
  ]);
  const db = await openDatabase(name);
  assert.equal(db.version, 4);
  const customers = await new Promise((resolve, reject) => {
    const request = db
      .transaction("customers")
      .objectStore("customers")
      .getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  assert.equal(customers[0].id, "customer-v3");
  assert.equal(
    db
      .transaction("leads")
      .objectStore("leads")
      .indexNames.contains("by_customerId"),
    true,
  );
  db.close();
});

test("unsafe key-path upgrade aborts without deleting or rewriting the existing store", async () => {
  const name = newName();
  await seedLegacy(name, 3, [
    [
      "leads",
      [{ id: "raw-key", customerId: "keep", data: "untouched" }],
      "customerId",
    ],
  ]);
  await assert.rejects(openDatabase(name), /key path differs/i);
  const request = indexedDB.open(name);
  const db = await new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  assert.equal(db.version, 3);
  const rows = await new Promise((resolve, reject) => {
    const get = db.transaction("leads").objectStore("leads").get("keep");
    get.onsuccess = () => resolve(get.result);
    get.onerror = () => reject(get.error);
  });
  assert.deepEqual(rows, {
    id: "raw-key",
    customerId: "keep",
    data: "untouched",
  });
  db.close();
});

test("open connection closes on versionchange so another application tab can upgrade", async () => {
  const name = newName();
  const db = await openDatabase(name);
  await putInStore(db, "customers", {
    id: "concurrent-customer",
    name: "Concurrent",
  });
  const newer = await new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 5);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () =>
      reject(new Error("Versionchange was unexpectedly blocked"));
  });
  // The old connection is closed promptly, allowing the version upgrade to continue.
  assert.throws(
    () => db.transaction("customers"),
    /closed|not connected|inactive/i,
  );
  const customer = await new Promise((resolve, reject) => {
    const request = newer
      .transaction("customers")
      .objectStore("customers")
      .get("concurrent-customer");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  assert.equal(customer.name, "Concurrent");
  newer.close();
});

test("restore migrates v1 and v2 backups into linked current records without loss", async () => {
  for (const version of [1, 2]) {
    const name = newName();
    const db = await openDatabase(name);
    const backup = {
      format: "leadloop-uk-backup",
      version,
      leads: [version === 1 ? oldLead : migrateLead(oldLead)],
      settings:
        version === 1
          ? { businessName: "Legacy business" }
          : [{ key: "business", value: "Legacy business" }],
    };
    const restored = await restoreBackupToDB(db, backup);
    const state = await loadAllState(db);
    assert.equal(restored.version, 3);
    assert.equal(state.leads.length, 1);
    assert.equal(state.customers.length, 1);
    assert.equal(state.leads[0].customerId, state.customers[0].id);
    assert.equal(state.settings.business, "Legacy business");
    assert.equal(state.quotes.length, 1);
    db.close();
  }
});
