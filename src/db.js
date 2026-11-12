import { DB_NAME, DB_VERSION, DEFAULT_SETTINGS } from "./constants.js";
import { createId } from "./utils.js";
import {
  migrateLead,
  migrateSettings,
  linkLeadsToCustomers,
  deriveQuotesAndActivitiesFromLeads,
  validateBackup,
} from "./migration.js";

export const ALL_STORES = [
  "customers",
  "leads",
  "quotes",
  "visits",
  "activities",
  "settings",
  "quarantine",
];

function ensureStoresAndIndexes(db, tx) {
  const specs = [
    { name: "customers", keyPath: "id", indexes: [] },
    {
      name: "leads",
      keyPath: "id",
      indexes: [["by_customerId", "customerId"]],
    },
    {
      name: "quotes",
      keyPath: "id",
      indexes: [
        ["by_leadId", "leadId"],
        ["by_customerId", "customerId"],
        ["by_reference", "reference"],
      ],
    },
    {
      name: "visits",
      keyPath: "id",
      indexes: [
        ["by_leadId", "leadId"],
        ["by_customerId", "customerId"],
      ],
    },
    {
      name: "activities",
      keyPath: "id",
      indexes: [
        ["by_leadId", "leadId"],
        ["by_customerId", "customerId"],
      ],
    },
    { name: "settings", keyPath: "key", indexes: [] },
    { name: "quarantine", keyPath: "id", indexes: [] },
  ];

  for (const spec of specs) {
    let store;
    if (db.objectStoreNames.contains(spec.name)) {
      store = tx.objectStore(spec.name);
      if (store.keyPath !== spec.keyPath) {
        db.deleteObjectStore(spec.name);
        store = db.createObjectStore(spec.name, { keyPath: spec.keyPath });
      }
    } else {
      store = db.createObjectStore(spec.name, { keyPath: spec.keyPath });
    }
    for (const [idxName, keyPath] of spec.indexes) {
      if (!store.indexNames.contains(idxName)) {
        store.createIndex(idxName, keyPath, { unique: false });
      }
    }
  }
}

export function openDatabase(dbName = DB_NAME, options = {}) {
  return new Promise((resolve, reject) => {
    let abortedReason = null;
    const req = indexedDB.open(dbName, DB_VERSION);

    req.onupgradeneeded = (event) => {
      const db = req.result;
      const tx = req.transaction;
      const oldVersion = event.oldVersion || 0;

      tx.onerror = () => {
        if (!abortedReason)
          abortedReason = tx.error || new Error("Database migration failed.");
      };

      try {
        if (oldVersion === 0) {
          ensureStoresAndIndexes(db, tx);
          if (options.simulateUpgradeFailure) {
            abortedReason = new Error("Simulated migration failure.");
            tx.abort();
          }
          return;
        }

        if (oldVersion < 3) {
          // Read all legacy lead and setting stores inside the atomic versionchange transaction
          const legacyLeadStoreNames = [
            "leads",
            "customers",
            "enquiries",
            "records",
            "leads_v1",
          ].filter((n) => db.objectStoreNames.contains(n));
          const legacySettingStoreNames = [
            "settings",
            "business",
            "config",
            "settings_v1",
          ].filter((n) => db.objectStoreNames.contains(n));

          const storesToRead = [
            ...legacyLeadStoreNames.map((name) => ({ kind: "leads", name })),
            ...legacySettingStoreNames.map((name) => ({
              kind: "settings",
              name,
            })),
          ];

          const collectedLeads = [];
          const collectedSettings = [];

          const finishUpgrade = () => {
            try {
              const migratedLeads = [];
              const legacyCustomers = [];
              const quarantined = [];
              const seenIds = new Map();
              const seenRawIds = new Map();
              let renamedDuplicates = 0;

              for (const { storeName, raw } of collectedLeads) {
                const rawId =
                  raw && typeof raw === "object"
                    ? String(raw.id ?? raw.customerId ?? raw._id ?? "").trim()
                    : "";
                const rawSignature = JSON.stringify(raw);
                if (rawId && seenRawIds.has(`${storeName}:${rawId}`)) {
                  if (seenRawIds.get(`${storeName}:${rawId}`) === rawSignature)
                    continue;
                  quarantined.push({
                    id: createId("quar"),
                    sourceStore: storeName,
                    reason: `Duplicate legacy identifier ${rawId} had conflicting data; both records were preserved for review.`,
                    rawRecord: raw,
                    quarantinedAt: new Date().toISOString(),
                  });
                  continue;
                }
                if (rawId)
                  seenRawIds.set(`${storeName}:${rawId}`, rawSignature);

                // Some v1 installations stored customer profiles in a flat "customers" store.
                // Preserve these as customers unless they clearly contain an enquiry/service record.
                if (
                  storeName === "customers" &&
                  raw &&
                  typeof raw === "object" &&
                  !Array.isArray(raw)
                ) {
                  const hasWork = [
                    "job",
                    "jobDetails",
                    "details",
                    "description",
                    "service",
                    "work",
                    "job_details",
                  ].some((k) => String(raw[k] ?? "").trim());
                  if (!hasWork) {
                    const name = String(
                      raw.name ?? raw.customerName ?? raw.fullName ?? "",
                    ).trim();
                    if (name) {
                      legacyCustomers.push({
                        id: String(
                          raw.id ??
                            raw.customerId ??
                            raw._id ??
                            createId("cus"),
                        ),
                        name,
                        phone: String(
                          raw.phone ??
                            raw.phoneNumber ??
                            raw.mobile ??
                            raw.telephone ??
                            "",
                        ).trim(),
                        email: String(raw.email ?? raw.emailAddress ?? "")
                          .trim()
                          .toLowerCase(),
                        normalizedPhone: "",
                        address: String(
                          raw.address ?? raw.serviceAddress ?? "",
                        ).trim(),
                        postcode: String(raw.postcode ?? "")
                          .trim()
                          .toUpperCase(),
                        notes: String(raw.notes ?? "").trim(),
                        createdAt: String(
                          raw.createdAt ??
                            raw.created ??
                            new Date().toISOString(),
                        ),
                        updatedAt: String(
                          raw.updatedAt ?? new Date().toISOString(),
                        ),
                      });
                      continue;
                    }
                  }
                }

                const rawHadQuote = Boolean(
                  raw &&
                  typeof raw === "object" &&
                  !Array.isArray(raw) &&
                  (raw.quote ||
                    raw.quotation ||
                    raw.quoteData ||
                    raw.quotationData ||
                    raw.quote_data),
                );
                const migrated = migrateLead(raw);
                if (!migrated) {
                  quarantined.push({
                    id: createId("quar"),
                    sourceStore: storeName,
                    reason:
                      "Record could not be automatically migrated (missing identifiable customer or job fields).",
                    rawRecord: raw,
                    quarantinedAt: new Date().toISOString(),
                  });
                  continue;
                }

                if (rawHadQuote && !migrated.quote) {
                  quarantined.push({
                    id: createId("quar"),
                    sourceStore: storeName,
                    reason: `Lead "${migrated.name}" migrated, but its legacy quotation data was malformed and preserved here for manual review.`,
                    rawRecord:
                      raw.quote ??
                      raw.quotation ??
                      raw.quoteData ??
                      raw.quotationData ??
                      raw.quote_data,
                    relatedLeadId: migrated.id,
                    quarantinedAt: new Date().toISOString(),
                  });
                }

                if (seenIds.has(migrated.id)) {
                  const prevJson = seenIds.get(migrated.id);
                  const currJson = JSON.stringify({
                    ...migrated,
                    updatedAt: "",
                  });
                  if (prevJson === currJson) {
                    continue;
                  }
                  let suffix = 2;
                  while (seenIds.has(`${migrated.id}-dup-${suffix}`)) suffix++;
                  migrated.id = `${migrated.id}-dup-${suffix}`;
                  renamedDuplicates++;
                }
                seenIds.set(
                  migrated.id,
                  JSON.stringify({ ...migrated, updatedAt: "" }),
                );
                migratedLeads.push(migrated);
              }

              const migratedSettings = migrateSettings(collectedSettings);

              // Ensure v3 object stores and indexes exist cleanly
              ensureStoresAndIndexes(db, tx);

              const uniqueLegacyCustomers = [];
              const customerIds = new Set();
              for (const customer of legacyCustomers) {
                let id = customer.id;
                if (customerIds.has(id)) {
                  let suffix = 2;
                  while (customerIds.has(`${id}-dup-${suffix}`)) suffix++;
                  id = `${id}-dup-${suffix}`;
                  renamedDuplicates++;
                }
                customerIds.add(id);
                uniqueLegacyCustomers.push({ ...customer, id });
              }
              const linked = linkLeadsToCustomers(
                migratedLeads,
                uniqueLegacyCustomers,
              );
              const derived = deriveQuotesAndActivitiesFromLeads(
                linked.leads,
                [],
                [],
              );

              const custStore = tx.objectStore("customers");
              const leadStore = tx.objectStore("leads");
              const quoteStore = tx.objectStore("quotes");
              const actStore = tx.objectStore("activities");
              const setStore = tx.objectStore("settings");
              const quarStore = tx.objectStore("quarantine");

              custStore.clear();
              leadStore.clear();
              setStore.clear();

              for (const c of linked.customers) custStore.put(c);
              for (const l of derived.leads) leadStore.put(l);
              for (const q of derived.quotes) quoteStore.put(q);
              for (const a of derived.activities) actStore.put(a);
              for (const s of migratedSettings) setStore.put(s);
              for (const qr of quarantined) quarStore.put(qr);

              const report = {
                migratedFromVersion: oldVersion,
                migratedAt: new Date().toISOString(),
                migratedLeadsCount: derived.leads.length,
                customersCreatedCount: linked.customers.length,
                quarantinedCount: quarantined.length,
                renamedDuplicatesCount: renamedDuplicates,
              };
              setStore.put({
                key: "migrationReport",
                value: JSON.stringify(report),
              });

              if (options.simulateUpgradeFailure) {
                abortedReason = new Error(
                  "Simulated migration failure during upgrade.",
                );
                tx.abort();
              }
            } catch (innerErr) {
              abortedReason = innerErr;
              tx.abort();
            }
          };

          if (storesToRead.length === 0) {
            finishUpgrade();
            return;
          }

          let remaining = storesToRead.length;
          for (const item of storesToRead) {
            const store = tx.objectStore(item.name);
            const getAllReq = store.getAll();
            getAllReq.onsuccess = () => {
              const rows = Array.isArray(getAllReq.result)
                ? getAllReq.result
                : [];
              if (item.kind === "leads") {
                for (const raw of rows)
                  collectedLeads.push({ storeName: item.name, raw });
              } else {
                for (const raw of rows) collectedSettings.push(raw);
              }
              remaining--;
              if (remaining === 0) {
                finishUpgrade();
              }
            };
            getAllReq.onerror = () => {
              abortedReason =
                getAllReq.error ||
                new Error(`Failed reading legacy store ${item.name}`);
              tx.abort();
            };
          }
        }
      } catch (err) {
        abortedReason = err;
        try {
          tx.abort();
        } catch {}
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () =>
      reject(
        abortedReason || req.error || new Error("Could not open database."),
      );
    req.onblocked = () =>
      reject(
        new Error(
          "Database upgrade is blocked by another open LeadLoop tab. Close other tabs and reload.",
        ),
      );
  });
}

export function getAllFromStore(db, storeName) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const req = tx.objectStore(storeName).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

export function putInStore(db, storeName, record) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    tx.objectStore(storeName).put(record);
    tx.oncomplete = () => resolve(record);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () =>
      reject(tx.error || new Error("Write transaction aborted."));
  });
}

export function runTransaction(db, storeNames, mode, callback) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeNames, mode);
    let result;
    try {
      const stores = {};
      for (const name of storeNames) stores[name] = tx.objectStore(name);
      result = callback(stores, tx);
    } catch (err) {
      try {
        tx.abort();
      } catch {}
      reject(err);
      return;
    }
    tx.oncomplete = () => resolve(result);
    tx.onerror = () =>
      reject(tx.error || new Error("Database transaction failed."));
    tx.onabort = () =>
      reject(tx.error || new Error("Database transaction aborted."));
  });
}

export async function loadAllState(db) {
  const [
    customers,
    leads,
    quotes,
    visits,
    activities,
    settingsRows,
    quarantine,
  ] = await Promise.all([
    getAllFromStore(db, "customers"),
    getAllFromStore(db, "leads"),
    getAllFromStore(db, "quotes"),
    getAllFromStore(db, "visits"),
    getAllFromStore(db, "activities"),
    getAllFromStore(db, "settings"),
    getAllFromStore(db, "quarantine"),
  ]);

  // Always reset settings cleanly to defaults before applying persisted rows
  const settings = { ...DEFAULT_SETTINGS };
  for (const row of settingsRows) {
    if (
      row &&
      typeof row.key === "string" &&
      Object.prototype.hasOwnProperty.call(DEFAULT_SETTINGS, row.key)
    ) {
      settings[row.key] = String(row.value ?? "");
    }
  }

  return {
    customers,
    leads,
    quotes,
    visits,
    activities,
    settings,
    settingsRows,
    quarantine,
  };
}

export async function createBackupPayload(db) {
  const state = await loadAllState(db);
  return {
    format: "leadloop-uk-backup",
    version: 3,
    exportedAt: new Date().toISOString(),
    customers: state.customers,
    leads: state.leads,
    quotes: state.quotes,
    visits: state.visits,
    activities: state.activities,
    settings: state.settingsRows,
    quarantine: state.quarantine,
  };
}

export async function restoreBackupToDB(db, rawInput) {
  // Full validation occurs in memory BEFORE opening any write transaction
  const clean = validateBackup(rawInput);

  await runTransaction(db, ALL_STORES, "readwrite", (stores) => {
    for (const name of ALL_STORES) {
      stores[name].clear();
    }
    for (const c of clean.customers) stores.customers.put(c);
    for (const l of clean.leads) stores.leads.put(l);
    for (const q of clean.quotes) stores.quotes.put(q);
    for (const v of clean.visits) stores.visits.put(v);
    for (const a of clean.activities) stores.activities.put(a);
    for (const s of clean.settings) stores.settings.put(s);
    for (const qr of clean.quarantine) stores.quarantine.put(qr);
  });

  return clean;
}

export async function eraseAllDataInDB(db) {
  await runTransaction(db, ALL_STORES, "readwrite", (stores) => {
    for (const name of ALL_STORES) {
      stores[name].clear();
    }
  });
}
