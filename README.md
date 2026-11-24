# HUSHHAWK PROPERTY MANAGEMENT

A standalone property communications workspace built around the HushHawk blueprint. The included release is an interactive demo with fictional records and browser-local persistence.

## Run the workspace

Serve the static files from a local HTTP server:

```sh
python3 -m http.server 8765 --bind 127.0.0.1 --directory dist
```

Open http://127.0.0.1:8765 and choose **Open interactive demo**. No demo sign-in is needed. The static server previews the product and demo only. Hosted admin access uses Sites authentication and D1. Build the Worker with `node scripts/build.mjs`.

## Accounts, plans and the super admin

HushHawk now has real accounts. Everyone signs in on the same page (`#login`), and what they see depends on who they are:

| Who | What happens |
| --- | --- |
| New company | `#signup` asks for the company name, their name, work email and password, then creates the account. |
| Company awaiting approval | Sees an account status page until a super admin approves them. |
| Approved company with no plan | Chooses a plan. The plan decides which features, how many team seats and properties, and what support they get. |
| Approved company with a plan | Opens its own workspace, stored on the server per company. Features outside the plan are locked. |
| Super admin | Opens the console at `#super`: approve, reject, suspend or reactivate companies; assign plans and turn individual features on or off per company; create and edit plans (price, features, seats, properties, support, availability); switch AI off platform-wide, pause sign-ups or turn off approval; and read the activity log. |

Plan limits and feature access are enforced by the server, not only in the browser. Passwords are hashed with PBKDF2-SHA256 (100,000 iterations), sessions are random tokens stored only as hashes and sent as `HttpOnly` cookies, and repeated failed sign-ins lock the account for 15 minutes. No payment provider is connected: choosing a plan records it, and invoicing happens outside HushHawk.

### Running the platform (super admin)

The super admin console at `#super` also covers:

| Section | What it does |
| --- | --- |
| Overview | Platform totals and a "Needs attention" list: missing provider keys, companies near or over a quota, provider errors in the last 24 hours, waiting number requests and support requests. |
| Usage & costs | Texts and AI replies per company this month against plan quotas, provider cost from your rates, plan revenue and margin. |
| Plans & packages | Also sets monthly quotas for texts and AI replies, and whether reaching a limit blocks the company or bills overage. |
| Providers & AI | Anthropic API key, model, effort and base instructions for AI drafts (with a connection test); Twilio Account SID, auth token and webhook base; your provider costs and overage prices. Keys are encrypted with AES-GCM and only the last four characters are shown. |
| Phone numbers | Add numbers you bought in Twilio, assign or unassign them, and answer company requests. Inbound texts are routed to the company that owns the number. |
| Support | Company requests sorted by status and plan support level, with replies and close/reopen. |
| Invoices | Prepare monthly drafts from plan price plus allowed overage, then mark sent, paid or void. Companies see invoices once they're sent. |
| Company detail | Monthly usage, assigned number and a read-only workspace view. Each view is recorded in the activity log. |

Company owners see usage meters, their texting number (or a request form) and invoices under Billing, and a Support page to contact HushHawk. "Draft with AI" calls Claude with the platform instructions plus the company's own knowledge, templates and tone, and puts the draft in the reply box for a person to review and send.

Not built yet: email sending and voice calls are not integrated, so they can't be configured or metered. No payment provider is connected; invoices are recorded by hand.

### Local preview with accounts

```sh
./dev-tools/node/bin/node scripts/dev.mjs
```

Open http://127.0.0.1:8766. This runs the real Worker code from `worker/` on Node, with a local SQLite database in `dev-data/` that behaves like D1, and serves `dist/`. Migrations in `drizzle/` apply on start. The first super admin is created from `scripts/dev.env` (`HUSHHAWK_SUPER_ADMIN_EMAIL`, `HUSHHAWK_SUPER_ADMIN_PASSWORD`), which also holds the local `HUSHHAWK_SECRETS_KEY`. Delete `dev-data/` to start over. Node is kept in `dev-tools/` (not committed); any Node 22.5 or later works.

Cookies are per host name, so you can stay signed in as the super admin at `127.0.0.1:8766` and as a company at `localhost:8766` at the same time.

Run the tests with:

```sh
./dev-tools/node/bin/node scripts/build.mjs && ./dev-tools/node/bin/node --test tests/*.test.mjs
```

### Subscriptions and payments

- Choosing a plan starts its free trial (if the plan has one and the company hasn't used a trial), or issues the first invoice. The workspace opens on trial start or when the first invoice is paid.
- Renewal invoices are issued 7 days before the period ends (at the end of a trial). An unpaid renewal makes the subscription past due; after the grace period (Invoices → Billing settings) access pauses until it's paid.
- Upgrades take effect immediately with a prorated invoice for the rest of the period. Downgrades are scheduled for the next renewal. Canceling keeps access to the end of the period.
- Payments: companies pay by bank transfer (the super admin records it under Invoices or the company's Subscription & billing tab) or by card through Stripe Checkout once a Stripe secret key is saved. Card payments are confirmed when the customer returns from Stripe and by the Stripe webhook at `/api/stripe/webhook` (`checkout.session.completed`).
- The billing cycle runs whenever someone signs in, when the super admin opens the console or clicks "Run billing cycle now", and on the Worker's cron trigger (add one, for example hourly, in your hosting settings).

### Storage, background jobs and automation

- **Per-record storage.** Each workspace is stored one row per record (`records`) and one row per message (`messages`), with the owning company on every row and a revision counter in `workspace_meta`. There is no workspace size limit beyond 200 KB per record. The browser sends only changed records, each with the version it was based on; if a teammate saved the same record first, the change is refused, the screen shows their version and says so, and new messages in a conversation are merged rather than lost. Migration `0004_records.sql` converts existing workspaces.
- **Job queue.** Incoming texts are verified, stored as a job and answered immediately; the job then updates the workspace, runs automation and sends any acknowledgment through the provider API. Scheduled texts and reminders are sent by the server (cron), not the browser. Jobs retry with backoff up to 5 times; duplicates are ignored by provider message ID. Jobs live in the `jobs` table.
- **Automation on real texts.** Every incoming text gets the built-in intake (emergency escalation, STOP handling, a ticket for maintenance with repeat-report tracking, a review task). The company's enabled rules for the message's category then run too (labels, follow-up tasks, reply approvals, escalation), and each run appears in Automations → execution history.
- **CSV import.** Owners and admins can import contacts and properties from Contacts or Properties → Import CSV: upload or paste, match columns (guessed from the headings), preview, then import. Duplicates (same email or phone, or same property name) and invalid rows are skipped and listed. Plan property limits apply.

### Email, MMS and system emails

- **Email (Postmark).** In Providers & AI → Email, save the Postmark server token, a verified sender address and the inbound address, then paste the two webhook addresses shown there into Postmark (inbound stream → Inbound webhook; outbound stream → Delivery, Bounce and Spam complaint). Each company gets its own address by plus-addressing the inbound address (for example `inbox+c2fb9d7b825@…`); replies carry a per-conversation Reply-To so answers land in the same conversation. Incoming email gets the same intake as texts (ticket, review task, company rules, optional acknowledgment under Integrations), attachments are stored, and staff reply from the inbox. Delivery events mark messages delivered; hard bounces stop further email to that address; spam complaints opt the contact out.
- **System emails** go through the job queue (retried on failure): new sign-up and support alerts to super admins (or the alert address), approval/suspension notices, team invites, password reset links, invoices, payment receipts, past-due and paused notices, and support replies. Without email connected, links are still shown on screen.
- **MMS and segments.** Photos sent by text are downloaded from Twilio and kept with the message. Text usage is counted in segments (GSM-7 160/153, Unicode 70/67). Replies go out from the number the tenant texted when a company has several numbers.
- **Attachments** are stored in the database in chunks by default, or in an R2 bucket when the Worker has a `FILES` binding. They're only served to signed-in members of the owning company.

### AI engine

- **Knowledge base.** Owners and admins upload PDFs, text, Markdown, CSV or HTML (or paste text) on the AI Assistant page. Documents are split into passages and indexed with SQLite full-text search (FTS5, BM25 ranking, prefix matching and property-management synonyms such as garbage/trash). PDFs are read by Claude once at upload. Replacing a document creates a new version. Each company's documents are only searchable by that company.
- **Classification.** Every incoming text and email is classified by Claude with structured output (category, urgency, sentiment, language, one-line summary, confidence). A confident AI result can raise a message to maintenance or emergency and drives the company's rules; the keyword safety check for emergencies always still applies. Upset tenants are labelled.
- **Grounded replies.** "Draft with AI", approval drafts and automatic answers use the platform instructions, the company's notes, templates and the best-matching knowledge passages, and return whether the question was actually covered, a confidence score and the sources used. Tenant text is treated as data, not instructions.
- **Modes** (Settings or AI Assistant → Assistant settings): Human approval (AI drafts every reply into the approval queue), Controlled automation (sends automatically only above the confidence threshold, for allowed topics, from knowledge, to verified tenants except general questions; never for emergencies; otherwise acknowledges and queues), Suggestion only, Off. Approving a reply sends it for real by text or email.
- **Also:** AI conversation summaries (shown in the conversation panel), a sandbox to test any message without sending, reply language, length, blocked topics and emergency instructions, and an AI activity log. AI replies count toward the plan's AI quota; classification, summaries and document reading are metered for cost only.

### Team logins and passwords

Owners and admins invite teammates from Team with a one-time link (valid 7 days, also emailed when email is connected). Roles: owner (everything, including billing and deleting the company), admin (team, settings and the whole workspace), property manager (workspace, no team or billing), communication agent (conversations, contacts, tasks, approvals and calls; not properties, tickets or settings), maintenance coordinator (tickets, tasks and their conversations), finance (billing and invoices, read-only workspace) and viewer (read-only). Roles other than owner and agent need the plan’s Advanced roles feature. The server enforces what each role can change, not only the screen. Seats count active people plus open invites. Forgotten passwords: an owner or admin creates a reset link from Team; the super admin can for anyone. Everyone can change their own password in Settings.

### Security, privacy and launch

- **Two-step sign-in (TOTP).** Anyone can turn it on in Settings with an authenticator app; they get 10 one-time recovery codes. Owners can require it for the whole company, and the super admin can require it for super admins (Platform controls). The super admin can reset a lost second step from the company’s Team tab. "Sign out everywhere" ends every session.
- **Abuse limits.** Sign-in (30 attempts per 10 minutes per address, plus the 15-minute account lock), sign-up (10 per hour) and demo requests (5 per hour, with a hidden spam field) are rate limited.
- **Headers.** Every response carries a Content Security Policy, HSTS, X-Frame-Options DENY, nosniff and a strict referrer policy.
- **Your data.** Owners and admins can export all company data as JSON (Settings → Security & data), set a retention period that removes old messages, calls and activity automatically, and request deletion: data is erased 30 days later unless canceled. The super admin can also delete a company’s data at once (typing the company name to confirm).
- **Website.** The homepage shows live plans from the database (`GET /api/public/plans`) and a demo request form; requests land in the super admin’s Demo requests page.
- **Legal pages.** `#terms`, `#privacy` and `#sms-terms` hold **draft** text marked for legal review; fill in the [bracketed] details and have a lawyer review them before launch. Sign-up and invite acceptance require agreeing to them, and the time is recorded.

### Demo deploy on Vercel

For showing the product before a real database is connected. `vercel.json` builds with `node scripts/build-vercel.mjs`, serves `dist/` as static files and sends `/api/*` to `api/index.mjs`, which runs the same Worker code on Node 24 with SQLite in `/tmp`.

1. Import the GitHub repository in Vercel (no framework preset; the settings come from `vercel.json`).
2. Add environment variables: `HUSHHAWK_SUPER_ADMIN_EMAIL`, `HUSHHAWK_SUPER_ADMIN_PASSWORD` (12+ characters) and `HUSHHAWK_SECRETS_KEY` (a long random string).
3. Optional demo client: also set `HUSHHAWK_DEMO_EMAIL`, `HUSHHAWK_DEMO_PASSWORD` (10+ characters), `HUSHHAWK_DEMO_COMPANY` and `HUSHHAWK_DEMO_NAME`. An approved company with an active Business plan is created for that login whenever the demo database starts fresh.
4. Redeploy after adding variables, then sign in.

**Demo limits:** the database resets whenever Vercel starts a fresh instance (after idle time or a redeploy), and two instances don't share data. Background jobs run on incoming requests instead of a cron trigger. Use Cloudflare Workers + D1 (below) or a hosted database for real use.

### Production (Worker + D1)

1. Apply the migrations in `drizzle/` in order (`0001` to `0007`) to the D1 database, and add a cron trigger (every minute or every few minutes) so queued jobs, scheduled texts, renewals and grace periods run on their own.
2. Set Worker secrets `HUSHHAWK_SUPER_ADMIN_EMAIL` and `HUSHHAWK_SUPER_ADMIN_PASSWORD` (at least 12 characters), and `HUSHHAWK_SECRETS_KEY` (a long random string used to encrypt provider keys; keep it, or saved keys can't be read). The super admin account is created on the first request if none exists.
3. Build with `node scripts/build.mjs` and run `node --test tests/*.test.mjs` (requires Node 22.5 or later for `node:sqlite`).

Server code: `worker/accounts.js` (accounts, plans, approvals), `worker/platform.js` (providers, AI, usage, numbers, support), `worker/billing.js` (subscriptions, invoices, payments, team, passwords). The local preview runs these same files.

## Walkthrough

1. Use the property filter on the overview and open the unified inbox.
2. Open Sarah Johnson’s SMS thread and choose **Draft with AI**. Edit the suggested text and queue it for approval.
3. Open the approval queue and approve the reply. Reopen Sarah’s thread to confirm the simulated outbound message appears.
4. Simulate an incoming text containing a repair request from a distinct phone number. The sender appears as unverified and the active maintenance rule adds a ticket.
5. Simulate the same event ID again to verify deduplication. Try a new SMS with `STOP` to verify consent enforcement.
6. Simulate a missed call, then view it under Voice Center and open the callback task.
7. Edit a property, contact, template or knowledge entry. Reload the app to verify browser-local persistence.
8. In Integrations, use the prefilled JSON example to import a fictional portfolio snapshot.

## What runs in the demo

| Area | Behavior |
| --- | --- |
| Product website | Product overview, features, plans, FAQ and locally captured demo requests |
| Workspace | Fictional sign-in, property filter, dashboard, notifications and CSV reports |
| Inbox | SMS, email, call and voicemail timelines, search, assignment, statuses, priority, notes, drafts and simulated replies |
| Voice | Simulated call log, voicemail text and callback tasks |
| AI and automation | Rules-based suggestions grounded in editable demo knowledge, review and approval, configurable event rules and run history |
| Portfolio operations | Property and unit relationships, contact history, maintenance, tasks, appointments and templates |
| Administration | Team and role records, company settings, plan selection and organization audit history |

Demo entry uses session storage and demo changes use browser local storage. Admin access is separate at `/admin/`, requires a Sites-authenticated account, and stores workspace data per authenticated site account in D1. A new admin workspace starts empty. This release uses owner-level access and has no live provider delivery or staff accounts.

## Production handoff

The blueprint’s operating and commercial phases require separate implementation and approval before processing tenant records.

| Milestone | Remaining work and dependency |
| --- | --- |
| Shared production workspace | Provision the target runtime and database. Implement server-side organization scoping, account lifecycle, MFA, permissions, durable jobs, audit retention, backup restoration and monitoring. |
| Live communications | Confirm the approved SMS and voice provider and number ownership. Verify TextNow port eligibility with the account owner. Connect the approved inbound and outbound mailbox. Implement and verify signed provider callbacks, idempotency and delivery reconciliation. |
| Advanced AI workflows | Confirm model provider and approved knowledge. Add server-side controls for policy, emergency escalation, consent, reviews, prompt injection resistance, logging and operator override. |
| Voice and RentRedi | Confirm routing and recording policies, and obtain authorized RentRedi access before implementing a live connector. |
| Commercial SaaS | Configure domain and approved pricing. Implement subscriptions, usage metering, entitlements, onboarding and organization administration. |

The design uses a dependency-free static implementation for the review release. The browser data model in `dist/model.js` is useful for exercising workflows today. It does not constitute a database migration or production API contract.

## Install and use across devices

Open **Settings → Install app**. HushHawk is a Progressive Web App with a standalone window, home-screen icons, a mobile inbox, and offline access to the previously loaded workspace shell. Installation is managed by the browser. Demo records are local to each browser profile. Admin workspace records are server-backed and accessible when signed into the same authorized account. Admin pages and API responses are excluded from offline caching.

- Use Quick search or Ctrl/Cmd + K to find workspace pages, contacts, conversations, and tickets.
- In an inbox thread, add labels, schedule a simulated reply, set a reminder, or pause rules. Use **Outbox & Reminders** to cancel future items and reschedule failures. The queue processes items while a signed-in app is open and catches up on return.
- In Automations, filter rules by channel, property, and priority, set execution order, test against a conversation, and restore the last ten saved versions. The workspace pause stops automatic rules. Manual test runs can still be performed.
- In Maintenance, switch between the board and table and update a ticket from either view. In Calendar, select a day to create an appointment or open an existing event to edit it.

Run the workspace regression checks with `node --test tests/workspace.test.mjs`.

## Live SMS and issue resolution

Use the protected **Admin → Integrations → Twilio SMS** screen. Copy the owner workspace ID and save SMS settings with acknowledgments off to create the workspace record. Configure these deployment values through Sites environment settings. Keep all credentials in server-side secrets.

| Name | Value |
| --- | --- |
| `HUSHHAWK_SMS_OWNER_ID` | Owner workspace ID shown in Admin Integrations |
| `TWILIO_ACCOUNT_SID` | Twilio account or subaccount SID that owns the number |
| `TWILIO_AUTH_TOKEN` | Auth token for the matching account, stored as a secret |
| `TWILIO_NUMBER` | SMS-capable Twilio number in E.164 format |
| `TWILIO_WEBHOOK_BASE` | HTTPS origin used by Twilio callbacks, with no path |

Confirm registration and messaging permissions for the intended number and region with your provider. The incoming message webhook is a POST to `/api/sms/inbound` at the configured origin. The Worker validates the Twilio signature against that origin, including the exact path and query. Outbound replies set their own callback at `/api/sms/status`.

The HushHawk Site is owner-private. If the hosting gateway requires visitor authentication for these callback paths, configure a separate public relay before pointing Twilio at the webhook. The optional `relay/index.mjs` Worker forwards only the two SMS paths using `HUSHHAWK_SITE_ORIGIN` and a secret `HUSHHAWK_SITE_SERVICE_TOKEN` issued by Sites. Set `TWILIO_WEBHOOK_BASE` to the relay's HTTPS origin. The relay requires the Site's service-access capability and separate hosting. Verify unauthenticated POST routing and signed callbacks before enabling delivery. Keep the Site private.

After configuration:

1. Send an SMS from an authorized test phone to the configured number. Confirm the message, ticket or review task appears in the admin workspace.
2. Enable **Automatic acknowledgments** in Admin Integrations. Send a new test message and confirm receipt on the test phone. Verify the final provider delivery status on the inbox timeline.
3. Open **Maintenance** to triage, assign, and track the ticket. Use **Record resolution** after the work is fixed. The tenant receives an acknowledgment during intake and any follow-up staff explicitly sends using **Send SMS** in the linked conversation.
4. Review **Tasks** and **Automations** for urgent reports and failed delivery. A timeout can leave delivery uncertain. Verify in Twilio before trying again.
5. Use a separate test number to validate opt-out and emergency routing. Emergency flags create a task for staff review, without dispatching outside responders.

The live intake path uses deterministic categories and bounded acknowledgments, and leaves unusual or sensitive messages for staff. No language-model service is configured. Messages with attachments are flagged for review in the provider console. Provider setup, registration, relay deployment where needed, and full handset delivery verification are external requirements.

Run the full local verification with `node scripts/build.mjs && node --test tests/*.test.mjs`.
