import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

async function resetLocalData(page) {
  await page.goto("/tests/fixtures/blank.html");
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      const request = indexedDB.deleteDatabase("leadloop-uk");
      request.onsuccess = request.onerror = request.onblocked = () => resolve();
    });
    for (const key of await caches.keys())
      if (key.startsWith("leadloop-uk-")) await caches.delete(key);
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
}

async function addEnquiry(
  page,
  name = "Test Customer",
  job = "Regular house clean",
) {
  await page.getByRole("button", { name: "+ Add enquiry" }).first().click();
  await page.locator("#leadName").fill(name);
  await page.locator("#leadJob").fill(job);
  await page.locator("#leadPhone").fill("07123 456789");
  await page.locator("#leadEmail").fill("test@example.com");
  await page.getByRole("button", { name: "Save enquiry" }).click();
  await expect(page.locator("[data-lead-card]")).toHaveCount(1);
}

test.beforeEach(async ({ page }) => resetLocalData(page));

test("first launch shows honest empty state, adding enquiry persists a linked customer", async ({
  page,
}) => {
  await expect(page.getByText("Your pipeline starts here")).toBeVisible();
  await addEnquiry(page, "Mina Example", "Garden tidy");
  await page.reload();
  await page.locator('[data-nav="customers"]').first().click();
  await expect(
    page.getByRole("heading", { name: "Mina Example" }),
  ).toBeVisible();
  await expect(page.getByText("1 linked enquiries")).toBeVisible();
});

test("customer can be edited and hold multiple separate enquiries", async ({
  page,
}) => {
  await addEnquiry(page, "Taylor Example", "Driveway clean");
  await page.locator('[data-nav="customers"]').first().click();
  await page.getByRole("button", { name: /Edit details/ }).click();
  await page.locator("#customerName").fill("Taylor Updated");
  await page.getByRole("button", { name: "Save customer" }).click();
  await expect(
    page.getByRole("heading", { name: "Taylor Updated" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "+ Enquiry" }).click();
  await page.locator("#leadJob").fill("Monthly window clean");
  await page.getByRole("button", { name: "Save enquiry" }).click();
  await expect(page.getByText("Enquiry & job history (2)")).toBeVisible();
});

test("enquiry stages can be changed and stage transitions persist", async ({
  page,
}) => {
  await addEnquiry(page);
  await page.locator(".stageSelect").selectOption({ label: "Contacted" });
  await expect(page.locator(".stageSelect")).toHaveValue("Contacted");
  await page.reload();
  await page.locator('[data-nav="enquiries"]').first().click();
  await expect(page.locator(".stageSelect")).toHaveValue("Contacted");
});

test("quotation builder calculates, saves revisions, and prints business document", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.print = () => {
      document.body.dataset.printed = "yes";
    };
  });
  await addEnquiry(page, "Quote Customer", "Two-room decoration");
  await page.getByRole("button", { name: "Quote", exact: true }).click();
  await page.locator("[data-price]").first().fill("100");
  await page.locator("#qDiscount").fill("10");
  await page.locator("#qVat").fill("20");
  await expect(page.locator("#quoteSummary")).toContainText("£108.00");
  await page.getByRole("button", { name: "Save quotation draft" }).click();
  await expect(page.locator("[data-lead-card]")).toContainText("LL-");
  await page.locator('[data-nav="quotes"]').first().click();
  await expect(page.getByText("Quote Customer").first()).toBeVisible();
  const row = page.locator("[data-quote-row]").first();
  await page.evaluate(() => {
    window.print = () => {
      document.body.dataset.printed = "yes";
    };
  });
  await row.getByRole("button", { name: "Print" }).click();
  await expect(page.locator("#printArea")).toContainText("QUOTATION");
  await expect(page.locator("#printArea")).toContainText("£108.00");
  expect(await page.locator("body").getAttribute("data-printed")).toBe("yes");
  await row.getByRole("button", { name: "Update" }).click();
  await page.locator("#quoteStatus").selectOption("Sent");
  await page.getByRole("button", { name: "Save status" }).click();
  await page
    .locator("[data-quote-row]")
    .first()
    .getByRole("button", { name: "Revise" })
    .click();
  await page.getByRole("button", { name: "Save quotation draft" }).click();
  await expect(page.locator("[data-quote-row]")).toHaveCount(2);
});

test("WhatsApp link opens only on explicit click; prepared and confirmed actions are distinct", async ({
  page,
  context,
}) => {
  await context.route("https://wa.me/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "Mocked external WhatsApp landing page",
    }),
  );
  await addEnquiry(page);
  await page.getByRole("button", { name: "Message" }).click();
  await page.locator("#msgBody").fill("Hello, this is a draft.");
  const popupPromise = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Open message app" }).click();
  const popup = await popupPromise;
  await expect(popup).toHaveURL(/wa\.me\/447123456789/);
  await popup.close();
  await expect(page.locator("[data-lead-card]")).toContainText(
    "Confirm contact",
  );
  const facts = await page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const r = indexedDB.open("leadloop-uk");
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    const leads = await new Promise((resolve) => {
      const r = db.transaction("leads").objectStore("leads").getAll();
      r.onsuccess = () => resolve(r.result);
    });
    db.close();
    return leads[0];
  });
  expect(facts.preparedMessage).toBe("Hello, this is a draft.");
  expect(facts.lastOpenedAt).toBeTruthy();
  expect(facts.lastContactConfirmedAt).toBeFalsy();
  await page.getByRole("button", { name: "Confirm contact" }).click();
  await page.getByRole("button", { name: "Record contact" }).click();
  const confirmed = await page.evaluate(async () => {
    const db = await new Promise((resolve) => {
      const r = indexedDB.open("leadloop-uk");
      r.onsuccess = () => resolve(r.result);
    });
    const rows = await new Promise((resolve) => {
      const r = db.transaction("leads").objectStore("leads").getAll();
      r.onsuccess = () => resolve(r.result);
    });
    db.close();
    return rows[0];
  });
  expect(confirmed.lastContactConfirmedAt).toBeTruthy();
  await page.getByRole("button", { name: "Message" }).click();
  await page.locator("#msgChannel").selectOption("email");
  await page.getByRole("button", { name: "Open message app" }).click();
  const emailOpened = await page.evaluate(async () => {
    const db = await new Promise((resolve) => {
      const r = indexedDB.open("leadloop-uk");
      r.onsuccess = () => resolve(r.result);
    });
    const rows = await new Promise((resolve) => {
      const r = db.transaction("leads").objectStore("leads").getAll();
      r.onsuccess = () => resolve(r.result);
    });
    db.close();
    return rows[0];
  });
  expect(emailOpened.lastOpenedChannel).toBe("email");
});

test("repeat completion records a visit and advances an overdue won customer's schedule", async ({
  page,
}) => {
  await addEnquiry(page, "Repeat Customer", "Monthly garden visit");
  await page
    .locator(".stageSelect")
    .selectOption({ label: "Accepted / booked" });
  await page.locator('[data-action="edit-lead"]').click();
  await page.locator("#leadRepeat").fill("2020-01-31");
  await page.locator("#leadInterval").selectOption("monthly");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.locator('[data-action="complete-repeat"]')).toBeVisible();
  await page.locator('[data-action="complete-repeat"]').click();
  await page.getByRole("button", { name: "Record visit" }).click();
  await expect(page.locator("#toastRegion")).toContainText(/Visit recorded/);
  const result = await page.evaluate(async () => {
    const db = await new Promise((resolve) => {
      const r = indexedDB.open("leadloop-uk");
      r.onsuccess = () => resolve(r.result);
    });
    const read = (name) =>
      new Promise((resolve) => {
        const r = db.transaction(name).objectStore(name).getAll();
        r.onsuccess = () => resolve(r.result);
      });
    const [leads, visits] = await Promise.all([read("leads"), read("visits")]);
    db.close();
    return { lead: leads[0], visits };
  });
  expect(result.visits).toHaveLength(1);
  expect(result.lead.nextRepeat > new Date().toISOString().slice(0, 10)).toBe(
    true,
  );
});

test("JSON backup, invalid restore rejection, and CSV export work", async ({
  page,
}) => {
  await addEnquiry(page, "Backup Customer", "Gutter clearing");
  await page.locator('[data-nav="settings"]').first().click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download JSON backup" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/leadloop-backup-.*\.json/);
  await page.getByRole("button", { name: "Restore JSON backup" }).click();
  await page.locator("#restoreFile").setInputFiles({
    name: "invalid.json",
    mimeType: "application/json",
    buffer: Buffer.from("{}"),
  });
  await page
    .getByRole("button", { name: "Choose and validate backup" })
    .click();
  await expect(page.locator("#toastRegion")).toContainText(
    /Restore stopped safely/,
  );
  await page.locator('[data-nav="customers"]').first().click();
  await expect(page.getByText("Backup Customer").first()).toBeVisible();
  await page.locator('[data-nav="settings"]').first().click();
  await page.getByRole("button", { name: "Restore JSON backup" }).click();
  await page.locator("#restoreFile").setInputFiles({
    name: "valid.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({
        format: "leadloop-uk-backup",
        version: 3,
        customers: [
          {
            id: "restored-customer",
            name: "Restored Customer",
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
        settings: [{ key: "business", value: "Restored business" }],
        quarantine: [],
      }),
    ),
  });
  await page
    .getByRole("button", { name: "Choose and validate backup" })
    .click();
  await expect(page.locator("#toastRegion")).toContainText(
    "Backup validated and restored",
  );
  await page.locator('[data-nav="customers"]').first().click();
  await expect(
    page.getByRole("heading", { name: "Restored Customer" }),
  ).toBeVisible();
  await page.locator('[data-nav="settings"]').first().click();
  const csvPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export enquiries CSV" }).click();
  expect((await csvPromise).suggestedFilename()).toMatch(/enquiries.*\.csv/);
});

test("dark and light themes toggle; mobile and desktop widths have no horizontal overflow", async ({
  page,
}) => {
  for (const width of [390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const dimensions = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
    }));
    expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.client + 1);
    await page.screenshot({
      path: `test-results/leadloop-${width}.png`,
      fullPage: true,
    });
  }
  await page.locator("#themeBtn").click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});

test("automated accessibility scan has no serious or critical violations on an empty dashboard", async ({
  page,
}) => {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  const serious = results.violations.filter((v) =>
    ["serious", "critical"].includes(v.impact),
  );
  expect(
    serious,
    JSON.stringify(
      serious.map((v) => ({
        id: v.id,
        description: v.description,
        nodes: v.nodes.map((n) => n.target),
      })),
      null,
      2,
    ),
  ).toEqual([]);
  await page.getByRole("button", { name: "+ Add enquiry" }).first().click();
  const modalResults = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  const modalSerious = modalResults.violations.filter((v) =>
    ["serious", "critical"].includes(v.impact),
  );
  expect(
    modalSerious,
    JSON.stringify(
      modalSerious.map((v) => ({
        id: v.id,
        nodes: v.nodes.map((n) => n.target),
      })),
      null,
      2,
    ),
  ).toEqual([]);
});

test("service worker caches app shell and the manifest exposes valid PWA assets", async ({
  page,
  context,
}) => {
  const response = await page.request.get("/manifest.webmanifest");
  expect(response.headers()["content-type"]).toContain(
    "application/manifest+json",
  );
  const manifest = await response.json();
  expect(manifest.icons.some((icon) => icon.sizes === "192x192")).toBe(true);
  expect(manifest.icons.some((icon) => icon.sizes === "512x512")).toBe(true);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await context.setOffline(false);
});
