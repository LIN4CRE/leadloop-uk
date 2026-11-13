# LeadLoop UK

A lightweight, local-first enquiry, quotation and repeat-customer tracker for independent UK service businesses. It is a customer-testing pilot, not a hosted multi-user SaaS product.

## What it does

- Keeps **customers**, **enquiries/jobs**, **quotation revisions**, **completed visits**, **activity history**, settings and recovery records separately in IndexedDB (schema version 4; backups remain format version 3).
- Tracks enquiries through New enquiry, Contacted, Quotation prepared, Quotation sent, Follow-up required, Accepted / booked, Completed and Lost.
- Records optional customer contacts, service address, postcode, notes, dates, payment amounts confirmed by the user, and repeat service reminders.
- Creates quote drafts with multiple categorized lines, quantities, unit prices, discounts, configurable VAT calculation, dates, expiry and terms. Quotes are printable from the browser print dialog, where the user can choose “Save as PDF”. Revisions are retained.
- Prepares personalised WhatsApp and email drafts after an explicit click. It never sends messages. Draft preparation, external app opening and user-confirmed contact are separate events.
- Records repeat visits and advances overdue weekly, fortnightly, monthly, quarterly and annual reminders without losing a monthly anchor date.
- Shows dashboard figures from saved records only. Quote value is not described as revenue; payment figures are shown only when a user records payments.
- Provides JSON backup/restore, CSV exports with spreadsheet formula neutralisation, data-recovery review and a confirmed erase-all-data flow.
- Runs as an installable PWA where supported and provides an offline application shell.

## Requirements

- Node.js 20 or later (Node 22 LTS recommended) and npm.
- A current Chromium browser for browser tests. Playwright downloads browsers in normal CI/developer environments.

## Windows 11 PowerShell

From the repository directory:

```powershell
node --version
npm --version
npm ci
npm run dev
```

Open `http://localhost:8000`. For browser tests, install Playwright Chromium once:

```powershell
npx playwright install chromium
npm test
npm run test:e2e
```

To run the full local verification suite:

```powershell
npm run format:check
npm run test:unit
npm run test:e2e
npm run build:check
```

`Ctrl+C` stops the development server.

## Development

This is a no-runtime-dependency JavaScript application using browser APIs and ES modules. The Node static server (`scripts/dev-server.mjs`) binds to `0.0.0.0`, supports PowerShell and CI, serves the manifest with its correct MIME type, and rejects path traversal.

- Domain modules: `src/constants.js`, `utils.js`, `quotes.js`, `repeat.js`, `analytics.js`, `templates.js`, `csv.js`, `migration.js`.
- IndexedDB and atomic backup workflows: `src/db.js`.
- Quotation document: `src/print.js` and print styles in `styles.css`.
- Application: `index.html`, `app.js`, `styles.css`.
- PWA shell/update lifecycle: `manifest.webmanifest`, icons and `sw.js`.

Use `npm run format` to apply Prettier or `npm run format:check` to verify formatting. `npm run build:check` validates the static deliverable; there is no bundler or build output to deploy.

## Testing

- `npm run test:unit` runs domain, IndexedDB migration, rollback and backup/restore tests. Disposable database names are used.
- `npm run test:e2e` runs real Chromium browser tests for first use, customer/enquiry links, stages, quotations/print, WhatsApp click behaviour, manual contact confirmation, repeat completion, backup/restore, CSV, themes, four viewport widths, offline shell and automated axe accessibility checks.
- Visual screenshots at 390, 768, 1024 and 1440 CSS pixels are written to ignored `test-results/` during the browser suite.
- `npm run check` runs formatting, unit/DB and static build checks. CI also runs Playwright.

If Playwright's normal Chromium download is unavailable in a restricted environment, point it at an installed Chromium binary with `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`; Playwright still launches and exercises the application itself.

## Data, privacy and backup

LeadLoop stores information in the browser's IndexedDB on the current device and browser profile. It has no server account, cloud synchronisation or application-level encryption. Browser/device access controls and browser storage policies still apply; this application does not encrypt stored records. Data can be lost when browser storage is cleared, the browser profile is removed, or the device fails. Export a JSON backup regularly and store it securely; backups contain personal customer information. Restoring replaces the current LeadLoop records on that device after complete validation. CSV files may also contain personal information.

The application is not legal, privacy or tax advice and does not itself establish regulatory compliance. The ICO’s small-organisation guidance notes that sole traders may be controllers and that customer names/contact details are personal data; it highlights transparency, data minimisation, accuracy, retention and security. Using local storage does not discharge those responsibilities. Businesses remain responsible for deciding what data they collect, providing appropriate information to customers, how long records are kept, handling customer requests and which requirements apply. See the [ICO guide for sole traders](https://ico.org.uk/for-organisations/advice-for-small-organisations/news-blogs-and-events/blogs/data-protection-when-it-s-just-you-top-three-tips-for-sole-traders/) and [data protection principles](https://ico.org.uk/for-organisations/advice-for-small-organisations/getting-started-with-gdpr/data-protection-principles-definitions-and-key-terms/). This product does not collect consent or provide a privacy notice generator. VAT is only a user-configured calculation rate, not tax status determination, tax advice or accounting.

## Pilot testing

See [PILOT.md](./PILOT.md) for a beginner setup guide, realistic test tasks, a copyable feedback form, validation questions and evidence-based success measures.

## Deployment

The app is static and can be hosted on Vercel or another static HTTPS host without a backend. `vercel.json` sets static output and conservative security/cache headers. Use a Vercel project owned by the deployment administrator, connect the repository and deploy a preview first. The service worker requires HTTPS outside localhost. No production deployment, billing change or project creation is automated by this repository.

## Known limitations

- Local data does not sync across devices or browsers. There are no user accounts, team roles, access controls, remote backup or hosted support console.
- Browser-based printing delegates PDF creation to the operating system/browser; there is no generated PDF binary download component.
- WhatsApp and email links prepare drafts only. Delivery and actual contact must be confirmed by the user; the app cannot verify delivery.
- Reminders are in-app when LeadLoop is open. It does not provide background push notifications.
- Payment fields are user-entered records, not payment processing or accounting.
- Migrations quarantine malformed legacy records rather than guessing. Review the recovery report and make a separate backup before restore or destructive actions.

## Commercial SaaS roadmap

A paid multi-device service would require a deliberately designed backend and migration path: authentication and account recovery, tenant-scoped authorisation, encrypted transport, database encryption and key management, data export/deletion operations, retention and incident processes, operational monitoring and support, reliable backup/restore drills, security/privacy review, terms and onboarding, and genuine subscription billing/webhook handling. These services are intentionally not simulated in this pilot. Commercial pricing should be validated with target sole traders and reflect actual support, hosting and compliance operations rather than added as a non-functional upgrade button.

## Repository / licence

No new licence is asserted by this implementation. Consult the repository owner before redistributing or commercialising the source under a new licence.
