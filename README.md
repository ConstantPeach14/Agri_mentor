# agriMentor

agriMentor is a mobile agricultural mentorship application intended to connect
farmers, agricultural graduates, and small agricultural businesses with
experienced mentors. It aims to support mentor discovery, mentorship requests,
goal-setting, session records, and progress tracking.

## Current project status

The mobile app now uses the Express API for registration, sign-in, session
restore/logout, and profile retrieval/updates. Native clients store opaque
session tokens using Expo SecureStore; the web preview keeps its token in
memory and requires sign-in again after a reload. Device-local demo accounts
are no longer used for authentication. Legacy Sprint 1 data is left untouched
on each device and is not imported or treated as a shared account.

The backend has PostgreSQL-backed auth/profile and mentorship endpoints.
Following explicit approval on 2026-11-06, migrations
`002_mentorship_requests.sql` and `003_mentorship_management.sql` were applied
in order to the existing agriMentor Neon production branch. Before application,
read-only checks verified the configured application and migration URLs against
the expected project ID, branch ID, `neondb` database, and `public` schema; the
ledger's Migration 001 checksum matched the local file. Post-apply catalog
checks confirmed all six mentorship tables and 21 mentorship triggers. No
production user, request, relationship, session, goal, or milestone records
were created or modified.

The broader design references remain in
[docs/database-design.md](./docs/database-design.md) and
[docs/phase-2-database-review.md](./docs/phase-2-database-review.md). The
mentorship API and mobile workflows are implemented and their required schema
is present. Live CRUD workflows against real mentorship records have not yet
been exercised; automated mentorship repository tests use mocks, and
production records were not used for testing.

Public registration supports `mentee` and `mentor` accounts. Programme Staff
accounts cannot be self-registered. Operator-issued, one-time invitations can
create a Staff account for the invitation email and assign it to one programme;
an existing Staff account can accept a further programme invitation while
signed in. Staff dashboard, participant and oversight APIs are implemented
against the proposed programme schema, but remain unavailable until Migration
005 is separately approved and applied. Login sends only email/password; the
API returns the saved role and the app routes to matching dashboard content.
Backend profile updates enforce role-specific fields and reject role changes.
Existing provisioned Programme Staff accounts can retrieve and update their
own validated organization/job-title profile. Profile retrieval checks the
authenticated role. Migrations 001–003 and their checksums have been verified in PostgreSQL. The
Sprint 4 workflow enforces roles and ownership in the API and the applied
migrations add corresponding database constraints and triggers. Hiding tabs is
not backend authorization.

Neon connection, backup/rollback, PostgreSQL integration, and the
Android-to-computer cross-device test plan are documented in
[docs/phase-2-database-review.md](./docs/phase-2-database-review.md). A
standalone migration runner supports checksum inspection and explicit
transactional `--apply`; it is never invoked by Express startup. Its dry-run does not connect
to a database. The health endpoint reports connection availability but does
not validate every application schema object.

Cloudinary upload support is implemented locally but not configured: the
backend reads server-only placeholder environment variables, authenticated
profile and agricultural-image endpoints validate signatures and a 5 MiB
limit, and the mobile profile screen supports image selection and display.
Cloudinary assets use HTTPS delivery URLs and public IDs stored in the
applied PostgreSQL schema. Delivered Cloudinary URLs are public; upload
authorization does not make resulting images private. No credentials have
been configured and no external image has been uploaded.

NativeWind **5.0.0-rc.0** is configured with `react-native-css` 3.1.0-rc.0
and Tailwind CSS 4.1.12. Its Expo SDK 58 compatibility is **BLOCKED /
UNVERIFIED** until styling and navigation are checked in Expo Go on a physical
device. Successful bundle exports do not establish native runtime
compatibility. Expo SDK and React Native were not changed.

## Original 30-day project tracker

The original six-sprint, 30-day plan remains the project roadmap. Sprint 1
frontend work is implemented and awaiting Expo Go review. Sprint 4 discovery,
matching, requests and relationships are implemented in code and their
production schema is applied; live shared workflows still need isolated
record-level integration testing. Sprint 5 sessions and goals have the same
status.

| Sprint | Original focus | Status |
|---|---|---|
| 1 — 5 days | Project foundation and mobile setup | **REVIEW PENDING —** Expo SDK 58 UI foundation is present; device review remains outstanding. |
| 2 — 5 days | Database and backend foundation | **FOUNDATION IMPLEMENTED —** auth/profile API and PostgreSQL adapter are in use; migration 001 is applied and verified. |
| 3 — 5 days | Authentication and user profiles | **NOT STARTED AS A SPRINT —** the auth/profile foundation was prepared early for Sprint 2; live database connectivity is verified, with full account-workflow integration testing still pending. |
| 4 — 5 days | Mentor discovery and matching | **IMPLEMENTED, SCHEMA APPLIED —** API discovery, profile-backed recommendations, requests and relationships have their production schema; live record workflows remain unverified. |
| 5 — 5 days | Mentorship management and progress tracking | **IMPLEMENTED, SCHEMA APPLIED —** sessions, goals, milestones, history and progress views have their production schema; live record workflows remain unverified. Programme Staff dashboard, participants and read-only oversight are implemented in code; Migration 005 remains a proposal and live Staff data is blocked. |
| 6 — 5 days | Testing, integration and finalisation | **NOT STARTED.** |

The project remains on Expo SDK 58, React Native 0.88, and Expo Router. The
NativeWind RC is an installed experimental styling dependency; keep existing
inline styles unless further native runtime verification is completed.

## Technology

- Mobile: React Native, Expo SDK 58, TypeScript, Expo Router.
- Backend: Node.js, Express 5, JavaScript (CommonJS), Helmet, CORS, dotenv,
  `pg`, Multer, and Cloudinary SDK.
- Database: PostgreSQL adapter connected to the verified Neon branch;
  migrations 001, 002, and 003 are applied.
- API: REST with JSON.

## Testing the API with Postman

Import [server/postman/agriMentor.postman_collection.json](./server/postman/agriMentor.postman_collection.json)
into Postman. It includes GET and POST requests with executable response
assertions. Start the API with `cd server` followed by `npm run dev`, then send
**Health → GET API health**. The collection defaults to
`http://localhost:3000/api`; change its `baseUrl` collection variable if your
API is hosted elsewhere. For a phone-to-computer setup, use the computer's LAN
IP address rather than `localhost`.

Use an existing test account, or register a Mentee/Mentor in the collection,
then send **Authentication and profile → POST Login**. The collection stores
the returned bearer token for subsequent authenticated requests. Update the
email/password and UUID variables with records appropriate to the role being
tested. POST requests that create programmes, requests, sessions, goals, or
uploads create real records; use test data and avoid repeating them
unintentionally. Programme Staff routes require an already provisioned Staff
account. Image uploads use a multipart `image` file and require the server's
Cloudinary configuration.

## Project structure

```text
.
├── docs/
│   ├── database-design.md       # Original proposed schema
│   └── phase-2-database-review.md # Approved design baseline and implementation gate
├── mobile/
│   ├── src/
│   │   ├── app/                 # Auth, role-based tabs, and mentor route
│   │   ├── components/          # Shared UI and reusable starter components
│   │   └── lib/                 # API auth, secure token storage, matching, and app models
│   ├── .env.example             # Mobile API URL template
│   └── package.json
└── server/
    ├── migrations/              # Numbered SQL; never automatically executed
    ├── src/
    │   ├── app.js               # Express middleware, auth/profile routes, errors
    │   ├── auth-service.js      # Registration, login, sessions, profile validation
    │   ├── passwords.js         # Scrypt password hash/verify
    │   ├── database-pool-options.js # PostgreSQL URL/TLS validation
    │   ├── postgres-auth-repository.js # Auth, profile, and mentorship queries
    │   ├── mentorship-service.js
    │   ├── migration-runner.js
    │   ├── config.js            # Environment configuration
    │   └── index.js             # Server entry point
    ├── scripts/
    │   └── migrate.js           # Explicit dry-run / apply command
    ├── test/
    │   ├── app.test.js
    │   ├── auth.test.js
    │   ├── migration-runner.test.js
    │   ├── mentorship.test.js
    │   └── postgres-auth.integration.test.js # Opt-in; not run by default
    ├── .env.example
    └── package.json
```

## Installation

From the repository root, install backend dependencies:

```powershell
Set-Location .\server
npm.cmd install
```

If you are setting up the mobile app as well, install its dependencies from
the repository root:

```powershell
Set-Location .\mobile
npm.cmd install
```

Local environment files are ignored by Git. Copy the example files and set
values for your environment. Keep `DATABASE_URL` only in `server/.env`; never
put it in a mobile `EXPO_PUBLIC_` variable. The database target and migration
must be approved before connecting or applying SQL.

```powershell
Copy-Item .\server\.env.example .\server\.env
Copy-Item .\mobile\.env.example .\mobile\.env
```

Set `DATABASE_URL` in the server environment only after an approved database
target is selected. Set `EXPO_PUBLIC_API_URL` in the mobile environment to the
backend URL reachable from each client. The server example contains
nonfunctional placeholders for both database URLs; replace them only after a
separate database authorization.

### Configure the mobile API URL

Set `EXPO_PUBLIC_API_URL` in `mobile/.env` to the backend's `/api` base URL
(include `/api`; the backend routes are mounted under that prefix). For local
browser testing use `http://localhost:3000/api`; the phone or emulator must be
able to reach its configured address:

- Android emulator: `http://10.0.2.2:3000/api`
- iOS simulator: `http://localhost:3000/api`
- Physical phone: `http://<computer-LAN-IP>:3000/api`

For a physical phone, use the computer's LAN IPv4 address (not `localhost`) and
connect the phone and computer to the same network. Allow the chosen port
through the computer's firewall if needed. Change `EXPO_PUBLIC_API_URL` to the
matching device URL and restart Expo after editing `.env`.
`EXPO_PUBLIC_` variables are included in the client bundle; do not put secrets
in them.
For Expo Go on a physical Android device, also start Expo with `--lan`. The
current local workstation address is `192.168.137.184`; use
`http://192.168.137.184:3000/api` as the API URL on this network. For the
Android emulator, use the `10.0.2.2` URL above.

For Expo Web, set `CORS_ORIGIN` in `server/.env` to the exact web app origin.
The local example permits `http://localhost:8081` and
`http://127.0.0.1:8081`; add another origin only if Expo uses a different port.
Native phone requests do not use browser CORS.

## Run locally

From the repository root, start the backend:

```powershell
Set-Location .\server
npm.cmd run dev
```

In a second terminal, start Expo from the repository root:

```powershell
Set-Location .\mobile
npm.cmd start -- --lan
```

Do not run `npx expo start` from `server`; Expo belongs to the mobile package.
The backend uses `PORT` (default `3000`) and `HOST` (default `0.0.0.0`).

## API

Unauthenticated:

- `GET /api/health`
- `POST /api/auth/register` — validates a role, creates a user/profile, hashes
  the password, and returns a bearer session.
- `POST /api/auth/login` — returns a generic invalid-credentials response.

Bearer-token protected:

- `GET /api/auth/me` — current account and profile.
- `POST /api/auth/logout` — revokes the current server session.
- `GET /api/profile` and `PATCH /api/profile` — only the authenticated user's
  account/profile; role-specific profile fields are validated.
- `POST /api/profile/image` — authenticated multipart image upload for the
  signed-in user's role-matched profile.
- `GET /api/agricultural-images`, `POST /api/agricultural-images`, and
  `DELETE /api/agricultural-images/:id` — authenticated image listing, upload,
  and owner-only deletion for the signed-in user.
- `GET /api/mentors` and `GET /api/mentors/:id` — mentee-only mentor discovery
  and profile details, with search, expertise, location, and experience filters.
- `GET` / `POST /api/mentorship/requests` and
  `PATCH /api/mentorship/requests/:id` — list, submit, accept, decline, or
  cancel role-authorized mentorship requests.
- `GET /api/mentorship/relationships` and
  `PATCH /api/mentorship/relationships/:id` — participant-only active and
  ended relationship history, including confirmed termination.
- `GET`, `POST`, and `PATCH /api/mentorship/sessions` — participant-only
  session scheduling, rescheduling, preparation/outcome notes, completion,
  cancellation, and history.
- `GET` and `POST /api/mentorship/goals`, `PATCH /api/mentorship/goals/:id`,
  `POST /api/mentorship/goals/:id/milestones`, and
  `PATCH /api/mentorship/milestones/:id` — participant-only measurable goals,
  revisions, milestones, completion, reopening and activity history.

Staff invitation and read-only oversight routes:

- `POST /api/auth/staff-invitations/consume` — creates a Staff account only from a
  valid, unused, unexpired operator-issued invitation for the submitted email.
- `POST /api/staff/invitations/accept` — an existing Staff account accepts a
  further invitation matching its authenticated email.
- `GET /api/staff/programmes`, `/api/staff/dashboard`,
  `/api/staff/programmes/:programmeId/participants`,
  `/api/staff/participants/:participantId`, and
  `/api/staff/programmes/:programmeId/oversight` — read-only Staff views scoped
  to the authenticated Staff member's active programme assignments.

Requests, relationships and discovery capacity are provided by the applied
`002_mentorship_requests.sql`; sessions, goals, milestones and history are
provided by the applied `003_mentorship_management.sql`. If a deployment is
pointed at a database missing these objects, the corresponding endpoints
return an explicit database-migration-pending error.
For now, a mentee cannot request the same mentor again after an accepted
request, even if that mentorship relationship later ends. The partial unique
request index intentionally preserves that behavior; changing the lifecycle
requires a separately reviewed migration.

Programme Staff endpoints are read-only and use the authenticated server
session to derive staff identity. Unassigned programmes and participants
outside assigned programmes return not found; Staff cannot accept, decline,
cancel, or end a participant's mentorship. Participant queries omit account
email, phone, password and session data. Migration proposals 004–006 are not
applied: 004 adds auditable relationship termination metadata, 005 provides
programme membership/assignment and invitation storage, and 006 adds a mentor
availability note. The Staff experience remains unavailable against databases
without 005. Proposals 004–006 have not been validated against PostgreSQL.

### Programme Staff operator provisioning

Programme creation, Staff invitation issuance, and participant membership
assignment are deliberately operator-only; no public invitation issuer or
Admin role exists. After Migration 005 has been separately approved and
applied, an authorized operator should verify the intended database project,
branch and host in the provider console, configure the approved `DATABASE_URL`,
and run an applicable command from `server`. Both the exact database host and
database name must be confirmed; these checks are guardrails, not substitutes
for verifying the project and branch.

```powershell
Set-Location .\server
node .\scripts\programme-operator.js create-programme --name "Regional Growers" --description "Approved programme" --email "coordinator@example.org" --confirm-target "<verified-database-host>" --confirm-database "<verified-database-name>"
node .\scripts\programme-operator.js invite-staff --programme-id "<programme-uuid>" --email "additional-staff@example.org" --expires-hours 72 --confirm-target "<verified-database-host>" --confirm-database "<verified-database-name>"
node .\scripts\programme-operator.js assign-participant --programme-id "<programme-uuid>" --email "mentee@example.org" --role mentee --confirm-target "<verified-database-host>" --confirm-database "<verified-database-name>"
node .\scripts\programme-operator.js assign-participant --programme-id "<programme-uuid>" --email "mentor@example.org" --role mentor --confirm-target "<verified-database-host>" --confirm-database "<verified-database-name>"
```

The operator command prints a random invitation token once; only its SHA-256
hash is stored. Do not redirect command output to a shared log. Deliver the
token through an approved private channel. The invitee chooses the Staff role
flow and enters the token with the invited email. For an existing Staff
account, sign in first and accept the additional invite from Profile.
Invitations expire within at most seven days, are single-use, and are bound to
one email and programme. The operator assigns existing Mentee and Mentor
accounts to programmes explicitly; no account is auto-enrolled. No operator
command was run as part of this implementation.

Session tokens are random opaque values; only their SHA-256 digests are stored
in PostgreSQL. Passwords use Node's scrypt with per-password random salts.
Session duration defaults to 24 hours and can be set with
`SESSION_TTL_HOURS`. Password recovery, email verification, refresh tokens,
and a distributed rate limiter are not implemented.

## Database

The broader model for users, profiles, expertise, requests, relationships,
sessions, goals, and progress is documented in
[docs/phase-2-database-review.md](./docs/phase-2-database-review.md). A
read-only check confirmed that the expected Neon project, branch, database,
and schema were selected and that Migration 001's ledger checksum matched the
local migration. After explicit approval, the migration runner applied
Migrations 002 and 003 in order. A subsequent read-only catalog check confirmed
all three checksums, the six mentorship tables, and 21 mentorship triggers.
Migrations 001–003 must not be edited or reapplied. Proposals 004–006 are
unapplied and must not be applied without separate explicit approval.

Inspect the migration plan without opening a database connection:

```powershell
Set-Location .\server
npm.cmd run migrate -- --dry-run
```

Applying migrations requires the explicitly approved target,
`MIGRATION_DATABASE_URL`, and an explicit `--apply` flag. The command does not
fall back to the application `DATABASE_URL`; Express startup never applies
migrations. Do not run `--apply` until the exact migration and target are
explicitly authorized.
The application and migration URLs in `server/.env.example` are placeholders,
not usable credentials.

The PostgreSQL auth and mentorship integration tests are skipped by default
and never call `dotenv.config()` or fall back to `server/.env` for their test
URL. On explicit opt-in they reject reuse of the application database. The
mentorship test creates a uniquely named schema in the confirmed disposable
database, applies migrations 001, 002, and 003 only inside that schema, and
drops it after the test. Before opting in, verify the disposable test project's project
ID, branch ID, database name, and exact endpoint host in Neon Console. Explicit
target-confirmation environment values are required, but are not a substitute
for verifying the target in Neon Console. Do not run these tests until the
isolated target and operation are separately authorized. See
[docs/phase-2-database-review.md](./docs/phase-2-database-review.md) for the
required test variables and safeguards.
The Sprint 5 tests use mocked repositories unless run against an explicitly
confirmed disposable PostgreSQL target; no live persistence is implied by
mocked results.

## Validation results — 2026-11-06

- Read-only Neon identity check: **PASS** for both application and migration
  URLs; database `neondb`, schema `public`, and the expected project and branch
  IDs matched. The migration ledger recorded 001–003 with checksums matching
  the local migration files.
- Backend `npm.cmd run migrate -- --dry-run`: **PASS**; listed the local
  migration checksums without connecting. The explicitly approved
  `npm.cmd run migrate -- --apply` then reported 001 already applied and 002
  and 003 applied.
- Post-apply read-only catalog check: **PASS**; all six mentorship tables and
  21 mentorship triggers were present.
- Express `GET /api/health` using a local app instance and the live PostgreSQL
  pool: **HTTP 200**, API available, database available.
- Backend `npm.cmd test`: **49 passed, 0 failed, 2 skipped**. Tests use
  in-memory/mocked repositories; the gated PostgreSQL integration tests were
  skipped because no disposable test target was configured. These results do
  not verify live CRUD persistence.
- Mobile `npm.cmd test`: **4 passed, 0 failed**.
- Mobile `npm.cmd run lint` and `npx.cmd tsc --noEmit`: **PASS**.
- Android JavaScript bundle export: **PASS**; no native Expo Go/device runtime
  verification was performed, so this is not evidence of NativeWind native
  rendering.
- Cloudinary and image validation tests: **PASS** for credential handling,
  secure HTTPS URLs, provider failures, MIME/signature checks, size limits,
  and authenticated uploads for all three account roles.
- Backend and mobile `npm.cmd audit`: **0 vulnerabilities** after updating
  the transitive `minimatch` and `glob` overrides and Zod to patched versions.
  The updated tree passed backend tests, mobile lint/type-check, and both
  Expo exports.
- Mentorship workflow unit tests use mocked repositories. The opt-in PostgreSQL
  integration coverage was skipped because no confirmed disposable PostgreSQL
  test target was configured. Migrations are applied, but live request,
  relationship, session, goal and milestone CRUD has not been tested with
  actual records.
- Expo Go on a physical phone and native styling/rendering were not tested.
- Legacy device-local information is not uploaded or treated as a real
  account. The previous storage key is left untouched on the device.

## Programme Staff implementation and verification — 2026-11-09

The Staff dashboard, assigned-programme participant/profile views, read-only
oversight, invitation acceptance, role restrictions, and operator provisioning
are implemented locally. Migration 005 remains an unapplied proposal. The
migration runner dry-run listed it with SHA-256
`6a78c93e70fad9aaef7b7c76b1c1d733f976c9a7fe183c1b03dcfc2a806a1c0d`; that
only confirms the local migration inventory/checksum and is not PostgreSQL
syntax validation. No database connection, SQL application, operator command,
deployment, commit, or push was performed for this Staff implementation.

Verification performed after the latest code changes:

- Backend `npm.cmd test`: **77 passed, 0 failed, 2 skipped**. These are unit,
  in-memory, and mocked repository/API tests. The skipped tests are gated
  PostgreSQL integration tests; no real PostgreSQL result is claimed.
- Mobile `npm.cmd test`: **8 passed, 0 failed**.
- Mobile `npm.cmd run lint`: **PASS**.
- Mobile `npm.cmd exec -- tsc --noEmit`: **PASS**.
- `npm.cmd run migrate -- --dry-run`: **PASS**, lists all local migration
  checksums without opening a database connection. It does not validate SQL
  against PostgreSQL.
- Mobile `npm.cmd run build:android`: **PASS**, Android JavaScript bundle
  exported. This is not a physical Expo Go or NativeWind runtime test.
- `git diff --check`: **PASS** for tracked changes. The implementation files
  are currently untracked in this worktree; no files were committed.

Migration 005, Staff account provisioning, and Staff data access remain blocked
until the proposal is reviewed/approved and applied to an explicitly
authorized database. No disposable PostgreSQL target was confirmed, so do not
run the integration tests or provisioning CLI against production. Native
Expo Go and NativeWind rendering remain unverified on a physical phone.

## Checks

Run backend tests:

```powershell
Set-Location .\server
npm.cmd test
```

Run mobile lint and type checks:

```powershell
Set-Location .\mobile
npm.cmd run lint
npm.cmd exec -- tsc --noEmit
```

Physical device-to-backend connectivity depends on setting a reachable
`EXPO_PUBLIC_API_URL`, an approved database configuration, and testing with the
intended device/network.

## Outstanding items

- Run end-to-end request, acceptance, session, and goal workflows against an
  explicitly confirmed disposable PostgreSQL target. Do not use production
  records for test writes.
- Test the end-to-end workflow in Expo Go on a physical phone and verify
  native NativeWind rendering.
- Configure Cloudinary credentials only in the backend environment after
  approving public-image visibility, retention, and upload policy.
- Confirm HTTPS deployment settings, account recovery, email verification,
  and rate-limiting policy.
- Complete Android native/device and iOS runtime validation for the current
  NativeWind RC trial before adopting it as a stable project dependency.
- Sessions, goal tracking, and progress analytics are implemented in code and
  have database schema, but still need isolated PostgreSQL integration and
  physical-device workflow verification.
