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
  await expect(page.locator("html")).toHaveAttribute("data-app-ready", "true");
  const onboarding = page.getByRole("dialog", { name: "Welcome to LeadLoop" });
  if (await onboarding.isVisible()) {
    await page.getByRole("button", { name: "Not now" }).click();
    await expect(onboarding).not.toBeVisible();
  }
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
  await page.locator('#desktopNav [data-nav="customers"]').click();
  await expect(
    page.getByRole("heading", { name: "Quote Customer" }),
  ).toBeVisible();
  await expect(page.getByText("Quotation history (2)")).toBeVisible();
  await expect(page.getByText(/Revision 2/).first()).toBeVisible();
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
  await page.locator('[data-action="edit-lead"]').click();
  await page.locator("#leadRepeat").fill("2020-01-15");
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
  expect(result.lead.repeatAnchorDay).toBe(15);
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
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator("#mobileNav")).toBeVisible();
  await expect(page.locator("#mobileNav [data-nav]")).toHaveCount(6);
  await page.locator('#mobileNav [data-nav="quotes"]').click();
  await expect(
    page.getByRole("heading", { name: "Quotations", exact: true }),
  ).toBeVisible();
  await page.locator('#mobileNav [data-nav="followups"]').click();
  await expect(
    page.getByRole("heading", { name: "Follow-ups & Repeat" }),
  ).toBeVisible();
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
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open("leadloop-uk");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise((resolve, reject) => {
      const tx = db.transaction("customers", "readwrite");
      tx.objectStore("customers").put({
        id: "offline-customer",
        name: "Offline retained",
      });
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    await caches.open("unrelated-product-cache");
  });
  const managedCaches = await page.evaluate(() => caches.keys());
  expect(managedCaches.some((key) => key.startsWith("leadloop-uk-"))).toBe(
    true,
  );
  expect(managedCaches).toContain("unrelated-product-cache");
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  const persisted = await page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open("leadloop-uk");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const result = await new Promise((resolve, reject) => {
      const request = db
        .transaction("customers")
        .objectStore("customers")
        .get("offline-customer");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return result?.name;
  });
  expect(persisted).toBe("Offline retained");
  const failedUncached = await page.evaluate(async () => {
    try {
      await fetch("/uncached-offline-asset.js");
      return false;
    } catch {
      return true;
    }
  });
  expect(failedUncached).toBe(true);
  await context.setOffline(false);
  expect(
    await page.evaluate(async () => (await fetch("/index.html")).status),
  ).toBe(200);
});

test("first-run onboarding explains local storage and leads into a real first enquiry", async ({
  page,
}) => {
  await page.goto("/tests/fixtures/blank.html");
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      const r = indexedDB.deleteDatabase("leadloop-uk");
      r.onsuccess = r.onerror = r.onblocked = resolve;
    });
  });
  await page.goto("/");
  const dialog = page.getByRole("dialog", { name: "Welcome to LeadLoop" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("There is no cloud sync");
  const onboardingA11y = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(
    onboardingA11y.violations.filter((v) =>
      ["serious", "critical"].includes(v.impact),
    ),
  ).toEqual([]);
  await page.locator("#onboardBusiness").fill("North Star Garden Care");
  await page
    .locator("#onboardType")
    .selectOption({ label: "Gardening & Landscaping" });
  await page
    .getByRole("button", { name: "Save and add first enquiry" })
    .click();
  await expect(page.getByRole("dialog", { name: "Add enquiry" })).toBeVisible();
  await page.locator("#leadName").fill("Sam Sample");
  await page.locator("#leadJob").fill("Lawn tidy");
  await page.getByRole("button", { name: "Save enquiry" }).click();
  await expect(page.locator("[data-lead-card]")).toContainText("Sam Sample");
});

test("visual template manager creates, previews, duplicates, selects and deletes a template", async ({
  page,
}) => {
  await addEnquiry(page, "Template Customer", "Regular window clean");
  await page.locator('[data-nav="settings"]').first().click();
  await page.getByRole("button", { name: "Create template" }).click();
  const templateA11y = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(
    templateA11y.violations.filter((v) =>
      ["serious", "critical"].includes(v.impact),
    ),
  ).toEqual([]);
  await page.locator("#templateName").fill("Pilot enquiry note");
  await page.locator("#templateCategory").selectOption("initial");
  await page.locator("#templateSubject").fill("Checking in about {job}");
  await page.locator("#templateBody").fill("Hello ");
  await page.getByRole("button", { name: "{firstName}" }).click();
  await page.keyboard.type(", thanks for asking about {job}.");
  await expect(page.locator("#templateBody")).toHaveValue(
    "Hello {firstName}, thanks for asking about {job}.",
  );
  await expect(page.locator("#templatePreview")).toContainText("Alex");
  await page.getByRole("button", { name: "Save template" }).click();
  const custom = page
    .locator(".template-card")
    .filter({ hasText: "Pilot enquiry note" });
  await expect(custom).toBeVisible();
  await page
    .locator("#defaultTemplate")
    .selectOption({ label: "Pilot enquiry note · custom" });
  await custom.getByRole("button", { name: "Preview" }).click();
  await expect(page.getByRole("dialog")).toContainText("Hello Alex");
  await page.getByRole("button", { name: "Close" }).last().click();
  await custom.getByRole("button", { name: "Duplicate" }).click();
  await expect(page.locator("#templateName")).toHaveValue(
    "Pilot enquiry note copy",
  );
  await page.getByRole("button", { name: "Save template" }).click();
  const copy = page
    .locator(".template-card")
    .filter({ hasText: "Pilot enquiry note copy" });
  await copy.getByRole("button", { name: "Delete" }).click();
  await page.getByRole("button", { name: "Delete template" }).click();
  await expect(
    page
      .locator(".template-card")
      .filter({ hasText: "Pilot enquiry note copy" }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Restore built-in templates" })
    .click();
  await page.getByRole("button", { name: "Restore templates" }).click();
  await expect(
    page.locator(".template-card").filter({ hasText: "Pilot enquiry note" }),
  ).toHaveCount(0);
  await expect(page.locator("#defaultTemplate")).toHaveValue("tpl-initial");
});

test("application update waits for user action and preserves IndexedDB data", async ({
  page,
  context,
}) => {
  await addEnquiry(page, "Update Safe Customer", "Hedge trim");
  let serveUpgrade = false;
  await page.evaluate(async () => {
    await caches.open("leadloop-uk-stale-test");
    await caches.open("unrelated-product-cache");
  });
  await context.route("**/sw.js", async (route) => {
    const response = await route.fetch();
    let body = await response.text();
    if (serveUpgrade) body = body.replaceAll("shell-v5", "shell-v6");
    await route.fulfill({
      status: response.status(),
      headers: {
        "content-type": "text/javascript; charset=utf-8",
        "cache-control": "no-cache",
      },
      body,
    });
  });
  serveUpgrade = true;
  await page.evaluate(async () => {
    await navigator.serviceWorker.register("./sw.js?pilot-update-check=1");
  });
  await expect(page.locator("#swUpdateBanner")).toBeVisible({ timeout: 15000 });
  const waitingState = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    return {
      waiting: Boolean(registration?.waiting),
      active: registration?.active?.state,
    };
  });
  expect(waitingState).toEqual({ waiting: true, active: "activated" });
  await page.locator("#applyUpdateBtn").click();
  await page.locator('[data-nav="enquiries"]').first().click();
  await expect(page.locator("[data-lead-card]")).toContainText(
    "Update Safe Customer",
    { timeout: 15000 },
  );
  const result = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open("leadloop-uk");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const leads = await new Promise((resolve, reject) => {
      const request = db.transaction("leads").objectStore("leads").getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return {
      script: registration.active?.scriptURL,
      leads: leads.map((x) => x.name),
      caches: await caches.keys(),
    };
  });
  expect(result.script).toContain("sw.js");
  expect(result.leads).toContain("Update Safe Customer");
  expect(result.caches).toContain("unrelated-product-cache");
  expect(result.caches).toContain("leadloop-uk-shell-v6");
  expect(result.caches).not.toContain("leadloop-uk-stale-test");
});

test("application startup has no uncaught browser errors or failed same-origin requests", async ({
  page,
}) => {
  const pageErrors = [];
  const consoleErrors = [];
  const failedRequests = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("requestfailed", (request) => {
    if (new URL(request.url()).origin === new URL(page.url()).origin)
      failedRequests.push(`${request.url()}: ${request.failure()?.errorText}`);
  });
  await page.reload();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
  expect(failedRequests).toEqual([]);
});

test("local-day rollover refreshes follow-up badges without a reload", async ({
  page,
}) => {
  await page.clock.install({ time: new Date("2026-06-01T23:59:50") });
  await page.reload();
  await page.getByRole("button", { name: "+ Add enquiry" }).first().click();
  await page.locator("#leadName").fill("Midnight Customer");
  await page.locator("#leadJob").fill("Window clean");
  await page.locator("#leadFollow").fill("2026-06-02");
  await page.getByRole("button", { name: "Save enquiry" }).click();
  await expect(page.locator("#navDueCount")).toBeHidden();
  await page.clock.fastForward(11000);
  await expect(page.locator("#navDueCount")).toBeVisible();
  await expect(page.locator("#navDueCount")).toHaveText("1");
});

test("separate tabs refresh committed records without relying on server sync", async ({
  page,
  context,
}) => {
  const secondTab = await context.newPage();
  await secondTab.goto("/");
  await expect(secondTab.locator("html")).toHaveAttribute(
    "data-app-ready",
    "true",
  );
  await page.getByRole("button", { name: "+ Add enquiry" }).first().click();
  await page.locator("#leadName").fill("Shared Tab Customer");
  await page.locator("#leadJob").fill("Gutter clean");
  await page.getByRole("button", { name: "Save enquiry" }).click();
  await secondTab.locator('[data-nav="enquiries"]').first().click();
  await expect(secondTab.locator("[data-lead-card]")).toContainText(
    "Shared Tab Customer",
  );
  await secondTab.close();
});

test("PWA install prompt is user-triggered and installed state updates visibly", async ({
  page,
}) => {
  await page.evaluate(() => {
    const event = new Event("beforeinstallprompt", { cancelable: true });
    event.prompt = async () => {};
    event.userChoice = Promise.resolve({ outcome: "accepted" });
    window.dispatchEvent(event);
  });
  await expect(page.locator("#installBtn")).toBeVisible();
  await page.locator("#installBtn").click();
  await expect(page.locator("#toastRegion")).toContainText(
    "Installation accepted",
  );
  await page.evaluate(() => {
    window.matchMedia = (query) => ({
      matches: query === "(display-mode: standalone)",
    });
    window.dispatchEvent(new Event("appinstalled"));
  });
  await expect(page.locator("#installBtn")).toBeHidden();
  await page.locator('[data-nav="settings"]').first().click();
  await expect(page.locator("#pwaStatusDetail")).toContainText(
    "Installed on this device",
  );
});

test("possible customer duplicates are flagged without automatically merging records", async ({
  page,
}) => {
  await addEnquiry(page, "Duplicate Check", "Window clean");
  await page.getByRole("button", { name: "+ Add enquiry" }).first().click();
  await page.locator("#leadName").fill("Duplicate Check");
  await page.locator("#leadJob").fill("Gutter clean");
  await page.locator("#leadPhone").fill("07123 456789");
  await page.locator("#leadEmail").fill("test@example.com");
  await expect(page.locator("#duplicateWarning")).toContainText(
    "Possible matching customer",
  );
  await page.getByRole("button", { name: "Save enquiry" }).click();
  await page.getByRole("button", { name: "Save separate record" }).click();
  await expect(page.locator("[data-lead-card]")).toHaveCount(1);
  await page.locator('[data-nav="customers"]').first().click();
  await expect(
    page.getByText("Possible matching customer", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("LeadLoop does not merge customer records"),
  ).toBeVisible();
});
