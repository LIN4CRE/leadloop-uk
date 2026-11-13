# LeadLoop UK pilot — tester pack

## What it is

LeadLoop is a local-first enquiry and repeat-work tracker for UK independent service businesses. It keeps customer details, separate jobs, quotations and revisions, follow-ups and completed visits together in the current browser profile. It prepares message drafts but never sends them. It is a pilot, not a hosted or multi-user service.

## Who should test it

Invite sole traders and very small service businesses who personally handle enquiries and repeat jobs: domestic cleaners, gardeners, window cleaners, mobile valeters, decorators, handypeople and similar local trades. Ideally include people who currently use a paper diary, phone notes, spreadsheets or messaging history. Do not invite customers or contact businesses through the app on someone else's behalf; obtain explicit authorisation first.

## Beginner-friendly setup

1. Open the preview or owner-provided HTTPS link in a modern browser. Installation is optional; it does not sync data.
2. Complete the welcome steps if useful. Enter the trading name and optional business contact details; no records are invented for you.
3. Create a customer, then add their first enquiry/job. If testing with a real person, follow your normal privacy practices and only record information you genuinely need. Anonymised sample details are safer for a first walkthrough.
4. Set a follow-up date, prepare a WhatsApp or email draft, and only open the external app when ready. Nothing sends automatically.
5. Create a quotation, revise it once, print it or use the browser's Save as PDF option, then record a status only after a real event.
6. Add an annual or monthly repeat reminder, record a completed visit and check that service history and the next date look right.
7. Download a JSON backup and one CSV export. Store them securely; files contain personal information. Restore should only be practised with a disposable test backup because restore replaces local LeadLoop records.
8. Before ending a test on a shared device, export only what you need and use Settings → Erase all local data if appropriate. Erase cannot be undone.

## Realistic tasks

Use a timer for each task and record where the tester hesitates. Do not coach unless requested; note the wording or control they expected.

- **Lost enquiry recovery:** enter a new cleaning enquiry, add an agreed follow-up date, find it again from the queue, prepare a message and record actual contact only if it happened.
- **Repeat customer:** add a garden maintenance enquiry for an existing customer, set a monthly date near month-end, record a completed visit and verify the next planned date and prior visit.
- **Quotation to job:** draft a two-line quote, apply a discount and VAT rate only if appropriate for the business, print/save as PDF, revise the price and confirm both revisions are visible.
- **Email vs WhatsApp:** prepare the same follow-up on both channels. Check the message and recipient before opening the external app; do not send a test to a real customer without consent.
- **Recovery confidence:** make a backup, inspect its filename, and describe what you expect restore and erase to do. Do not restore over business data during an observed test.
- **Find history:** locate a customer, review their prior enquiry, quote, visit and activity; try search and stage filters.

## Feedback form (copy per session)

- Tester role / trade (no customer names):
- Device and browser:
- Prior system used (paper, notes, spreadsheet, other):
- Task and outcome:
- Time to complete (seconds/minutes):
- Where they paused, misread a label or needed help:
- Anything they expected that was missing:
- Did any record look wrong, disappear or duplicate? Describe without personal data:
- Confidence before / after (1–5):
- Overall usefulness (1–5):
- Would they use this for the next real enquiry? Why / why not?
- One improvement that would matter most:
- Permission to quote feedback publicly? Yes / No (default: no). Name/testimonial permission is separate and must be explicit.

## Questions to validate

- Can a first-time user understand what a customer is versus a job/enquiry?
- Can they find today's follow-up without help, and does the date match their local calendar?
- Do they trust the quotation preview, revision history and Save as PDF flow?
- Does the repeat reminder model match how their service cadence actually works?
- Can they tell that WhatsApp/email are drafts, not messages sent by LeadLoop?
- Do they understand local-only storage, lack of encryption/sync, and the need to secure backups?
- Which records or actions do they need in the customer profile before calling it useful?

## Pilot evidence and success measures

Capture observed sessions, not impressions alone. Suggested early measures (baseline and target should be agreed with testers, not assumed):

- Median time from new enquiry entry to a correctly scheduled next action.
- Share of test enquiries with a follow-up date and a confirmed contact outcome recorded.
- Time to create, revise, retrieve and print a quotation; number of quote revisions users can find unaided.
- Share of repeat visits where the tester correctly finds due work and advances its next date.
- Number of errors, duplicate records, lost drafts or accidental external opens per session.
- Task completion without facilitator help; user-rated usefulness and confidence.
- Whether backup creation, file location and restore warning are understood.

Do not claim enquiries recovered, jobs won, revenue gained, time saved or satisfaction improved until measured with consent and a defensible baseline. Report sample size, task definitions, dates and limitations. Never fabricate testimonials or contact businesses without authorisation.

## Pilot scope vs future SaaS

**Pilot requirements:** reliable local records and migrations, tested core workflows, understandable responsive interface, accessible interactions, safe backup/restore, honest privacy and operating documentation, and feedback from real users.

**Future hosted SaaS work (not implemented here):** authentication and account recovery, tenant-scoped authorisation, encrypted transport and storage/key management, cloud sync/conflict resolution, server-side backup and restore drills, customer data export/deletion processes, privacy and security review, incident response, operational monitoring, support, and real subscription payments/webhooks. Do not promise launch or payment-readiness based only on the local pilot.
