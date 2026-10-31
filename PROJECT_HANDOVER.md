# Quiz Integrity Guard — Project Handover

**Inspected:** 2026-10-31
**Repository:** `/Users/samriddhikapoor/Desktop/quiz-integrity-guard-github`
**Scope:** Read-only repository, Git, and database-schema inspection. This handover is the only file created for this request. Application files, existing uncommitted changes, migrations, and database records were not modified. Tests were not rerun during this documentation-only pass because the integration suite writes temporary fixtures to its test database. The latest recorded results are listed in §6.

## 1. Project overview

Quiz Integrity Guard is a local-first online quiz and monitoring prototype. Students register, sign in, see active quizzes, attempt questions, save answers, and submit for server-side scoring. Teachers create quizzes and questions, manage student batches, review attempts and violation reports, and receive live monitoring events. A Chrome Manifest V3 extension can send additional browser-observed signals for a selected attempt.

### Architecture and communication

```text
Teacher / student browser
  └─ portal/index.html + app.js + styles.css
       ├─ HTTPS/HTTP JSON requests with Bearer JWT ──> Express API ──> PostgreSQL
       └─ Socket.IO with teacher JWT ─────────────────> Socket.IO server

Chrome extension
  ├─ popup.js signs a student into the backend and selects an active attempt
  ├─ content.js observes browser/page events and sends extension messages
  └─ background.js validates the sender and posts violation reports ──> Express API
```

- **Portal:** `portal/index.html` is the active entry page. It loads `backend-config.js` and `app.js`; `app.js` attaches a Bearer token to API requests and renders the student and teacher interfaces. The API address defaults to `http://localhost:5050`.
- **Backend:** Node.js and Express expose JSON APIs on port `5050`. Middleware verifies JWTs and reloads the user and role from PostgreSQL. Controllers validate inputs, run parameterized SQL, and use transactions for state transitions.
- **Database:** PostgreSQL stores accounts, quizzes, questions, attempts, answers, violations, batches, invite codes (as hashes), and join requests.
- **Realtime:** Socket.IO is attached to the same HTTP server and port. Only authenticated teacher sockets join the shared `teachers` room. Attempt and violation events are published after the database transaction commits.
- **Extension:** Chrome injects `content.js` on Google Forms and the local portal. The popup logs in as a student, lists in-progress attempts, and saves the selected attempt in extension storage. The content script sends messages to the service worker, which sends supported violation reports to the backend.
- **Firebase:** The active `index.html` does not load Firebase. Firebase-era pages, configuration, hosting files, and a Firebase dependency remain as legacy artifacts; see §3.

## 2. Implemented features and verification status

“Implemented” means code is present. “Automated-tested” refers to the latest recorded automated suite. It does not mean the full feature has been walked through manually in a real browser.

| Module | Implemented | Automated-tested | Manual status |
| --- | --- | --- | --- |
| Backend setup and health route | Yes | Health is checked by prior local use; API integration suite covers database-backed routes | User previously observed `/api/health` returning `database: connected` |
| Authentication | Student registration, bcrypt password hashes, JWT login, `/me`, auth and role middleware, teacher provisioning/reset scripts | Auth end-to-end tests cover registration, duplicate/invalid data, login, token access and role rules | User previously reported teacher portal login success; no new full walkthrough in this handover pass |
| Quiz management | Active quiz listing/detail, teacher quiz creation and question creation; correct answers omitted from student quiz responses | Quiz integration test checks role rules, validation, active/inactive visibility, and answer secrecy | Not recently walked through in a real browser |
| Attempts and scoring | Start, resume, save/change/clear answers, submit, server-side scoring, elapsed-time enforcement and auto-submit | Attempt lifecycle integration test covers answer persistence and scoring; frontend tests cover navigation and answer-save behavior | Browser fullscreen and full timed attempt need local manual review |
| Violations | Student report for their own active attempt; server timestamps and transactionally updated count; third accepted report auto-submits | Violation integration test covers ownership, rejection cases and three-strike submission | Browser/extension signal delivery not fully manually verified |
| Teacher monitoring and Socket.IO | Monitoring snapshot/details, analytics, live teacher events; JWT-authenticated teacher sockets | Socket.IO integration test checks authentication and event delivery | Live dashboard and reconnect behavior still need browser review |
| Chrome extension | MV3 popup login and attempt selection; browser/page event reporting for supported pages | Portal tests cover shortcut mapping and reporting functions; extension behavior has no full Chrome automation suite | Load and exercise manually in Chrome; OS-level screenshot detection cannot be guaranteed |
| Batch management | Shared teacher workspace; create/list batches, view members/counts, add/remove registered students | Batch unit/API integration tests cover roles, validation, duplicates, concurrency and rollback | New UI should be manually reviewed |
| Batch invitation and approval | 14-day revocable invite links; student requests; teacher approve/reject; student sees request statuses | Invite integration test covers hash storage, expiration/revocation, role checks, duplicate/concurrent requests, concurrent decisions and membership updates | **Not yet manually walked through in the portal** |

### Batch management and invites

- Any authenticated teacher may manage any batch, matching the existing shared-teacher model.
- Teachers can add a registered student directly by account ID or email, or generate a shareable invite link.
- Invite codes contain 256 bits of random data. The raw code is returned once to the teacher portal; PostgreSQL stores a SHA-256 hash. Links expire after 14 days. Creating a replacement revokes the previous link.
- Students must be authenticated as students to submit a join request. Possessing the link never adds them automatically.
- Teachers can approve or reject a pending request. Approval and membership insertion occur in one transaction. A direct teacher add also resolves any pending request for that student as approved.
- Rejected students may request again using a still-valid invite. Revoking/replacing a link prevents new requests from that link but leaves submitted requests for review.
- Batch assignment does **not** affect quiz visibility or student eligibility yet.

## 3. File-by-file guide

Paths below are relative to the repository root stated above.

### Root files and extension

| Path | Purpose |
| --- | --- |
| `README.md` | Project overview, local startup links and high-level features. It contains earlier uncommitted documentation changes. |
| `.gitignore` | Excludes `node_modules`, `.env` files (except `.env.example`), Firebase local cache and OS artifacts. |
| `manifest.json` | MV3 permissions, host access, popup, service worker, and content-script match patterns. |
| `background.js` | Extension service worker; validates supported sender origins and violation types, reads extension storage, and posts violation reports. Its `TAKE_SCREENSHOT` handler requests a visible-tab capture but does not store or upload the image. |
| `content.js` | Page-side monitoring, warning display, portal duplicate-signal suppression, shortcut/event mapping and messaging to the background worker. |
| `popup.html` | Extension popup login, backend URL, active-attempt selection, and status UI. |
| `popup.js` | Extension popup API client; student login, attempt listing/selection, JWT and selected attempt storage. |

### Backend

| Path | Purpose |
| --- | --- |
| `backend/server.js` | Express setup, CORS and JSON limits, error handler, health route, API mounts, Socket.IO authentication, and port selection. |
| `backend/config/db.js` | PostgreSQL pool configuration. In test mode it uses `TEST_DB_NAME` (default `quiz_integrity_guard_test`) and rejects names not clearly marked as test databases. |
| `backend/middleware/auth.js` | `requireAuth` verifies the JWT and reloads the user; `requireRole` enforces student/teacher role requirements. |
| `backend/routes/auth.js` | Registration, login and current-user routes. |
| `backend/routes/quizzes.js` | Student quiz read routes and teacher quiz/question routes. |
| `backend/routes/attempts.js` | Student attempt/answer routes plus teacher monitoring and violation routes. |
| `backend/routes/batches.js` | Teacher batch routes and role-split student invite-request routes. |
| `backend/controllers/authController.js` | Registration, login, bcrypt hashing/checking, JWT creation and public user fields. |
| `backend/controllers/quizController.js` | Quiz and question validation, SQL operations, student-safe question selection and question ordering. |
| `backend/controllers/attemptController.js` | Attempt start/history/details, answer save, server-side score calculation, submission and teacher monitoring. |
| `backend/controllers/violationController.js` | Owner-checked violation reads, student violation writes, time/ownership checks and three-strike behavior. |
| `backend/controllers/batchController.js` | Batch create/list/member view, direct membership add/remove and membership counts. |
| `backend/controllers/batchInviteController.js` | Invite generation/revocation, student join requests, request status reads and teacher decisions. |
| `backend/realtime/events.js` | Small publisher module for committed attempt and violation events. |
| `backend/services/batchValidation.js` | Batch name, path ID and student identifier validation. |
| `backend/services/batchInvite.js` | Invite-code format validation, SHA-256 hashing and cryptographically secure code generation. |
| `backend/db/migrations/001_users_auth.sql` | Bootstrap definition for `users` on a new database only; not the migration to apply to the existing database. |
| `backend/db/migrations/002_batches.sql` | Additive `batches` and `batch_students` migration. |
| `backend/db/migrations/003_batch_join_requests.sql` | Additive `batch_invites` and `batch_join_requests` migration. |
| `backend/scripts/create-teacher.js` | Interactive one-time teacher provisioning; password entry is hidden and password is bcrypt-hashed. |
| `backend/scripts/reset-teacher-password.js` | Interactive password reset for an existing teacher. |
| `backend/scripts/seed-test-student.js` | Optional development test-student seed; safe/repeatable behavior is integration-tested. |
| `backend/package.json` | Backend scripts and dependencies. `npm test` sets `NODE_ENV=test`. |
| `backend/.env.example` | Placeholder environment-variable template. It contains no actual local credential values. |
| `backend/README.md` | Backend setup, route, migration, testing and local workflow documentation. |

### Tests

- `backend/test/auth.integration.test.js` — end-to-end authentication and roles.
- `backend/test/quizzes.integration.test.js` — quiz/question API role and answer-secrecy behavior.
- `backend/test/attempts.integration.test.js` — attempt lifecycle, saved answers and scoring.
- `backend/test/violations.integration.test.js` — ownership, validation, persistence and three-strike auto-submit.
- `backend/test/realtime.integration.test.js` — teacher Socket.IO authentication and events.
- `backend/test/seed-test-student.integration.test.js` — safe, repeatable test-student seeding against test DB.
- `backend/test/batches.unit.test.js` — input validation, invite token shape/hash, and portal markup/behavior hooks.
- `backend/test/batches.integration.test.js` — batch API permissions, memberships, duplicate concurrency and transaction rollback.
- `backend/test/batch-invites.integration.test.js` — invite, request, revoke/expiry, approval/rejection, and concurrent actions.
- `backend/test/teacher-quiz-form.test.js` — Node VM harness for selected portal functions: quiz forms, question navigation, screenshot shortcut mapping, results and monitoring UI behavior. It is not a real-browser test.

### Active portal and legacy files

| Path | Status / purpose |
| --- | --- |
| `portal/index.html` | Active portal page. Loads `backend-config.js` and `app.js`; it does not load Firebase scripts. |
| `portal/app.js` | Active portal state, auth, batch/invite UI, quiz authoring, student quiz/attempt flow, results and teacher monitoring. |
| `portal/styles.css` | Active portal styling, including current theme, responsive quiz/monitoring and batch sections. |
| `portal/backend-config.js` | Active frontend backend URL setting, defaulting to local port `5050`. |
| `portal/PORTAL-README.md` | Portal and extension setup notes. |
| `portal/package.json` | Legacy Firebase CLI/package metadata; the active local workflow uses the Python static server instead. |
| `portal/firebase-config.js` | Legacy Firebase initialization/mock configuration. Not loaded by active `index.html`; contains a Firebase web API key whose value is intentionally omitted here. |
| `portal/firebase.json`, `portal/.firebaserc` | Legacy Firebase Hosting project configuration. |
| `portal/dashboard.html`, `portal/realtime.html` | Earlier standalone dashboard/portal versions; not the active `index.html` experience. `realtime.html` loads Firebase scripts. |
| `portal/realtime-working.html` | Earlier realtime/dashboard prototype with demo/Firebase-era behavior. |
| `portal/simple.html` | Earlier self-contained portal/quiz prototype. |
| `portal/firebase-debug.log` | Local generated Firebase CLI debug log; untracked. Its contents were not copied into this handover. |
| `portal/package-lock.json` | Untracked dependency lockfile for the legacy portal package metadata. |

## 4. Database

The development PostgreSQL database is **`quiz_integrity_guard`**. The automated test database is **`quiz_integrity_guard_test`**. The latter is dedicated to tests; test connections use `TEST_DB_NAME`, never `DB_NAME`. This document contains no database credentials or `.env` values. A local `backend/.env` exists and was deliberately not read.

### Existing public tables and columns

Column types, nullability and defaults below were read from PostgreSQL catalog metadata for the development database on 2026-10-31.

| Table | Columns |
| --- | --- |
| `users` | `id integer PK`; `name varchar(100) NOT NULL`; `email varchar(150) NOT NULL`; `password_hash text NOT NULL`; `role varchar(20) NOT NULL`; `created_at timestamptz DEFAULT CURRENT_TIMESTAMP`. |
| `quizzes` | `id integer PK`; `title varchar(200) NOT NULL`; `description text NULL`; `duration_minutes integer NOT NULL`; `is_active boolean DEFAULT true`; `created_at timestamptz DEFAULT CURRENT_TIMESTAMP`. |
| `questions` | `id integer PK`; `quiz_id integer NOT NULL`; `question_text text NOT NULL`; `options jsonb NOT NULL`; `correct_answer integer NOT NULL`; `question_order integer NOT NULL`. `correct_answer` is a zero-based option index. |
| `attempts` | `id integer PK`; `user_id integer NOT NULL`; `quiz_id integer NOT NULL`; `attempt_number integer NOT NULL`; `status varchar(20) DEFAULT 'in_progress'`; `score integer NULL`; `percentage numeric(5,2) NULL`; `violation_count integer DEFAULT 0`; `start_time timestamptz DEFAULT CURRENT_TIMESTAMP`; `end_time timestamptz NULL`; `is_auto_submitted boolean DEFAULT false`. |
| `answers` | `id integer PK`; `attempt_id integer NOT NULL`; `question_id integer NOT NULL`; `selected_option integer NULL`; `answered_at timestamptz DEFAULT CURRENT_TIMESTAMP`. |
| `violations` | `id integer PK`; `attempt_id integer NOT NULL`; `type varchar(50) NOT NULL`; `message text NULL`; `question_number integer NULL`; `created_at timestamptz DEFAULT CURRENT_TIMESTAMP`. |
| `batches` | `id integer PK`; `name varchar(120) NOT NULL`; `created_by integer NOT NULL`; `created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP`. |
| `batch_students` | `batch_id integer NOT NULL`; `student_id integer NOT NULL`; `added_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP`. Composite primary key `(batch_id, student_id)`. |
| `batch_invites` | `id bigint PK`; `batch_id integer NOT NULL`; `token_hash char(64) NOT NULL UNIQUE`; `created_by integer NOT NULL`; `created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP`; `expires_at timestamptz NOT NULL`; `revoked_at timestamptz NULL`. |
| `batch_join_requests` | `id bigint PK`; `batch_id integer NOT NULL`; `student_id integer NOT NULL`; `status varchar(16) NOT NULL DEFAULT 'pending'`; `requested_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP`; `resolved_at timestamptz NULL`; `resolved_by integer NULL`. |

### Foreign keys and important constraints

- `questions.quiz_id → quizzes.id ON DELETE CASCADE`.
- `attempts.user_id → users.id` and `attempts.quiz_id → quizzes.id` (default PostgreSQL `NO ACTION`).
- `answers.attempt_id → attempts.id ON DELETE CASCADE`; `answers.question_id → questions.id` (default `NO ACTION`).
- `violations.attempt_id → attempts.id ON DELETE CASCADE`.
- `batches.created_by → users.id ON DELETE RESTRICT`.
- `batch_students.batch_id → batches.id ON DELETE CASCADE`; `student_id → users.id ON DELETE CASCADE`.
- `batch_invites.batch_id → batches.id ON DELETE CASCADE`; `created_by → users.id ON DELETE RESTRICT`.
- `batch_join_requests.batch_id → batches.id ON DELETE CASCADE`; `student_id → users.id ON DELETE CASCADE`; `resolved_by → users.id ON DELETE SET NULL`.
- Users: unique email and role constrained to `student` or `teacher`.
- Quiz duration must be positive. Attempt status is `in_progress`, `completed`, or `auto_submitted`; attempt number must be positive and violation count nonnegative.
- Question correct-answer index must be nonnegative; the API additionally validates it is less than the option count. Answer selection must be nonnegative; the API checks the selected index against that question's options.
- Answers are unique per `(attempt_id, question_id)`. Attempts are unique per `(user_id, quiz_id, attempt_number)`. Questions are unique per `(quiz_id, question_order)`.
- Batch names must be nonblank and unique case-insensitively. Batch membership has a composite primary key. Join-request status is `pending`, `approved` or `rejected`; a check requires pending requests to have no resolution fields and reviewed requests to have both.
- At most one unrevoked invite record exists per batch. At most one pending request exists for a given `(batch_id, student_id)`.

### Indexes

- `users`: `users_pkey(id)`, `users_email_key(email)`.
- `quizzes`: `quizzes_pkey(id)`.
- `questions`: `questions_pkey(id)`, `questions_quiz_id_question_order_key(quiz_id, question_order)`.
- `attempts`: `attempts_pkey(id)`, `attempts_user_id_quiz_id_attempt_number_key(user_id, quiz_id, attempt_number)`, `idx_attempts_quiz(quiz_id)`, `idx_attempts_status(status)`, `idx_attempts_user(user_id)`.
- `answers`: `answers_pkey(id)`, `answers_attempt_id_question_id_key(attempt_id, question_id)`, `idx_answers_attempt(attempt_id)`.
- `violations`: `violations_pkey(id)`, `idx_violations_attempt(attempt_id)`, `idx_violations_created(created_at)`.
- `batches`: `batches_pkey(id)`, `batches_name_lower_unique(lower(name))`, `idx_batches_created_by(created_by)`.
- `batch_students`: `batch_students_pkey(batch_id, student_id)`, `idx_batch_students_student_id(student_id)`.
- `batch_invites`: `batch_invites_pkey(id)`, `batch_invites_token_hash_key(token_hash)`, partial unique `idx_batch_invites_one_unrevoked_per_batch(batch_id) WHERE revoked_at IS NULL`.
- `batch_join_requests`: `batch_join_requests_pkey(id)`, partial unique `idx_batch_join_requests_one_pending(batch_id, student_id) WHERE status='pending'`, `idx_batch_join_requests_batch_status(batch_id, status, requested_at DESC)`, `idx_batch_join_requests_student(student_id, requested_at DESC)`.

### Migrations and status

There is no migration ledger table. Status is based on the live schema and the recorded application runs, not on a formal migration-history record.

1. `001_users_auth.sql` is a bootstrap `users` definition for a new database. The existing `users` table was already present and was inspected for compatibility; do **not** apply this file to the existing database.
2. `002_batches.sql` has been applied to the development and isolated test databases. It adds `batches` and `batch_students` only.
3. `003_batch_join_requests.sql` has been applied to the development and isolated test databases. It adds `batch_invites` and `batch_join_requests` only.

Both batch migrations are additive and transactional. A rollback after commit would delete batch data or invite/request history if those tables contain records. Back up/export it first; prefer forward fixes. Do not run a migration twice. The development database had the new invitation tables when inspected; the test database has been used for the latest integration run.

## 5. API documentation

All API requests/responses use JSON where a body is present. Protected endpoints require `Authorization: Bearer <JWT>`. JWT roles are reloaded from PostgreSQL on each HTTP request. Error handling normally returns `{ "error": "..." }`; malformed JSON is `400`, an oversized JSON body is `413`, and unexpected server/database failures return a generic `500` without exposing SQL details.

### Health and authentication

| Method and path | Permission | Request | Success response |
| --- | --- | --- | --- |
| `GET /api/health` | Public | None | `{ status, message, database }`; checks PostgreSQL with `SELECT 1`. |
| `POST /api/auth/register` | Public; student account only | `{ name, email, password, role? }`; `role` may only be omitted or `student`. | `201 { user: { id, name, email, role }, token }`. |
| `POST /api/auth/login` | Public | `{ email, password }` | `200 { user: { id, name, email, role }, token }`. |
| `GET /api/auth/me` | Any authenticated user | None | `{ user: { id, name, email, role } }`. |

Passwords are bcrypt-hashed and never returned. Name length is 2–100; email must be valid and at most 150 characters; passwords are 8–72 UTF-8 bytes. Duplicate registration returns `409`; invalid data `400`; invalid credentials `401`.

### Quizzes and questions

| Method and path | Permission | Request | Success response |
| --- | --- | --- | --- |
| `GET /api/quizzes` | Student | None | `{ quizzes: [...] }` active quizzes with question counts. |
| `GET /api/quizzes/manage` | Teacher | None | `{ quizzes: [...] }`, including inactive quizzes. |
| `GET /api/quizzes/:id` | Student | None | `{ quiz, questions }` for an active quiz. Student question objects omit `correct_answer`. |
| `POST /api/quizzes` | Teacher | `{ title, description?, duration_minutes, is_active? }` | `201 { quiz }`; `is_active` defaults true. |
| `POST /api/quizzes/:id/questions` | Teacher | `{ question_text, options, correct_answer }` | `201 { question }`; order assigned by server. |

Quiz title is 1–200 characters, description up to 5000, duration 1–1440 minutes. A question requires 2–10 nonempty option strings (each up to 1000 characters) and a zero-based integer `correct_answer` index within the options. Unknown/inactive student quiz reads return `404`. Adding questions is transactional and rejects changes while nonexpired attempts are in progress; expired attempts are scored and auto-submitted first.

### Attempts, answers and monitoring

| Method and path | Permission | Request | Success response |
| --- | --- | --- | --- |
| `POST /api/attempts` | Student | `{ "quiz_id": 1 }` | `201 { attempt, questions }`; questions omit correct answers. Quiz must be active and contain questions. |
| `GET /api/attempts?limit=50` | Student; own records | Optional `limit` query, default 50, range 1–100. | `{ attempts: [...] }`. |
| `GET /api/attempts/:id` | Student; own attempt only | None | `{ attempt, questions }`, including saved selections but not correct answers. Other students' attempt IDs return `404`. |
| `PUT /api/attempts/:id/answers/:questionId` | Student; own in-progress attempt | `{ "selected_option": 1 }`; `null` clears the answer. | `{ answer: { question_id, selected_option, answered_at } }`. |
| `POST /api/attempts/:id/submit` | Student; own in-progress attempt | Empty JSON object. | `{ result: { attempt, total_questions, elapsed_time_enforced } }`; score and percentage are computed server-side. |
| `GET /api/attempts/monitoring` | Teacher | None | `{ attempts, violations, summary, analytics }`; bounded recent dashboard data. |
| `GET /api/attempts/monitoring/:id` | Teacher | None | `{ attempt, answers, violations }`; correct answers included only after submission. |

Path IDs must be positive integers. Answers are locked to the authenticated user's attempt and a question in its quiz; selected option must exist. Writes after submission return `409`. Attempts are serialized per student when starting; score/status/end time come from the server. Expired attempts are auto-submitted.

### Violation reporting

| Method and path | Permission | Request | Success response |
| --- | --- | --- | --- |
| `POST /api/attempts/:id/violations` | Student; own active attempt | `{ type, message?, question_number? }` | `201 { violation, attempt, auto_submitted, result? }`. |
| `GET /api/attempts/:id/violations` | Student: own attempt; teacher: any attempt | None | `{ violations: [...] }`. |

Allowed types: `tab_switch`, `window_blur`, `copy_attempt`, `paste_attempt`, `cut_attempt`, `right_click`, `keyboard_shortcut`, `fullscreen_exit`, `inactivity`, `fast_submission`, `devtools_opened`, `screenshot_attempt`. Message is optional and at most 500 characters. `question_number` is optional and, when present, is 1-based and bounded by the quiz. Reports are tied to the authenticated student's attempt and timestamped by the server. Three accepted reports trigger auto-submit. Reports are client/browser-reported signals, not independent proof of conduct.

### Batches, invites and join requests

All existing batch-management routes require a teacher JWT unless marked student. Any teacher can manage any batch under the shared workspace model.

| Method and path | Permission | Request | Success response |
| --- | --- | --- | --- |
| `POST /api/batches` | Teacher | `{ "name": "CCE Semester 5" }` | `201 { batch }`, initially with `membership_count: 0`. |
| `GET /api/batches` | Teacher | None | `{ batches: [...] }` with membership and pending-request counts. |
| `GET /api/batches/:id/students` | Teacher | None | `{ batch, students }`. |
| `POST /api/batches/:id/students` | Teacher | Exactly one of `{ "student_id": 42 }` or `{ "email": "student@example.com" }`. | `201 { membership, student }`. Direct add resolves any pending request for that student as approved. |
| `DELETE /api/batches/:id/students/:studentId` | Teacher | None | `{ membership, removed: true }`. Does not delete the user account. |
| `POST /api/batches/:id/invite` | Teacher | None | `201 { invite: { code, expires_at, valid_days: 14 } }`. Raw code is returned only at creation. |
| `DELETE /api/batches/:id/invite` | Teacher | None | `{ revoked: true }`. Existing requests remain. |
| `POST /api/batches/join-requests` | Student | `{ "code": "64-character hex code" }` | `201 { request: { id, batch_id, status, requested_at, batch_name } }`. |
| `GET /api/batches/my-join-requests` | Student | None | `{ requests: [...] }` for the signed-in student only. |
| `GET /api/batches/:id/join-requests?status=pending` | Teacher | `status` optional: `pending`, `approved`, or `rejected`; defaults to pending. | `{ batch, requests }`, including student name/email and timestamps. |
| `POST /api/batches/:id/join-requests/:requestId/decision` | Teacher | `{ "decision": "approved" }` or `{ "decision": "rejected" }` | `{ request, membership_added }`. A request is resolved once. |

Batch names are trimmed, 1–120 characters, case-insensitively unique. IDs must be positive 32-bit integers. Only registered student accounts can be added. Invalid/unknown links return a generic `404`; invalid code shape returns `400`. Existing membership, an existing pending request, or a second decision returns `409` as applicable.

### Socket.IO events

Socket.IO shares the backend host/port and accepts the JWT in `auth.token` or a Bearer header. Current teacher database role is required; token expiry disconnects the socket. Authenticated connections join `teachers`.

- `attempt:started` — attempt/student/quiz identifiers, attempt number, status and start time.
- `attempt:completed` — completed attempt, score, percentage, end time and reason.
- `attempt:auto_submitted` — auto-submitted attempt details and reason (`time_limit` or `violation_threshold`).
- `violation:created` — violation, attempt and student summary.

## 6. Testing

### Latest recorded automated results

These are the latest test outputs recorded during the implementation turn on 2026-10-31. They were not rerun during this handover inspection.

```text
Focused batch/invite suite: 7 tests, 7 passed, 0 failed.
Full suite:                27 tests, 27 passed, 0 failed, 0 skipped.
```

Latest full-suite command and output summary:

```sh
TEST_DB_NAME=quiz_integrity_guard_test npm test
# Node test runner: 27 pass, 0 fail, 0 skipped; duration 2303.931791 ms.
```

The focused command was:

```sh
TEST_DB_NAME=quiz_integrity_guard_test NODE_ENV=test \
  node --test test/batch-invites.integration.test.js \
  test/batches.integration.test.js test/batches.unit.test.js
# 7 pass, 0 fail; duration 606.851209 ms.
```

Other checks recorded as passing after implementation: `node --check` on changed backend/portal JavaScript, `python3 -m json.tool manifest.json`, and `git diff --check`.

### What the automated suite covers

- **Database/API integration:** authentication, quizzes, attempts/scoring, violation ownership and threshold handling, Socket.IO authorization/events, seed script isolation, batch membership, invite validation/expiry/revocation, transactional decisions, role checks, concurrent duplicate requests/approvals, and simulated rollback.
- **Unit/frontend logic:** batch names/IDs/student identifiers/invite hashing; quiz form state; question navigation and delayed answer saves; screenshot-shortcut mapping; results/monitoring displays; portal DOM markup hooks. Portal tests use a Node test/VM harness, not a real browser renderer.
- **Security regression coverage:** JWT/role restrictions, account/attempt ownership, active quiz filtering and correct-answer suppression, answer/score server enforcement, invite hash-only storage, and transactional membership/decision behavior. There is no separate penetration-test or automated static-analysis report in this repository.

### Not verified by automated browser testing

- Visual and responsive rendering in a real Chrome browser.
- The complete teacher-create-link → student-open/login/request → teacher-approve/reject → student-status flow using two real browser sessions.
- Chrome extension install, popup behavior, service-worker suspension/reload, network loss/retry, and actual browser event delivery.
- Fullscreen user gesture behavior and operating-system screenshot shortcuts. Browser JavaScript cannot reliably observe screenshot actions intercepted by macOS/other OS tools.
- Live deployment, HTTPS, real external identity/service integrations, or production load/security testing.

## 7. Current status, known issues and security concerns

### Phase status

| Phase | Status |
| --- | --- |
| Backend and PostgreSQL setup | Implemented locally. |
| Authentication | Implemented; integration-tested. |
| Quiz management APIs | Implemented; integration-tested. |
| Attempts, answers and scoring | Implemented; integration-tested. |
| Violation tracking | Implemented; integration-tested. |
| Socket.IO teacher monitoring | Implemented; integration-tested. |
| Batch management, invite links and teacher approval | Implemented; migrations applied; integration-tested. Live portal flow still needs manual review. |
| Phase 2: batch-targeted quiz assignment and eligibility snapshots | Not implemented. |
| Scheduling / max-attempt policy | Not implemented. |
| Secure document upload | Not implemented. |
| Groq AI question generation | Not implemented; no Groq key/model integration is present. |
| Firebase retirement | Incomplete: old pages/config/hosting files and Firebase portal package metadata remain. |
| Deployment hardening | Not complete; no deployment-readiness claim. |

### Confirmed limitations / follow-up risks

1. **Violation reports are self-reported.** A student can directly call the API for their own active attempt and submit an allowed violation type. Three accepted reports can auto-submit that student's attempt. The student cannot use this route to alter another student's attempt or set a score, but these reports are not independently verified evidence. Consider marking them as unverified and corroborating them where possible.
2. **Extension coverage is bounded by browser context.** It cannot reliably observe operating-system actions or events outside supported pages. Screenshot-shortcut detection is best-effort. `background.js` logs failed reports but does not persist a retry queue; there is no extension heartbeat for teachers to distinguish inactive monitoring from a quiet student.
3. **No API rate limiter is configured.** Login and violation-report requests have no express rate-limiting middleware. Add rate limits and monitoring before broader deployment.
4. **Teacher workspace is intentionally shared.** The schema has no quiz or batch ownership isolation between teachers. Any authenticated teacher can manage any batch/quiz within the APIs that use this model.
5. **Audit trail is partial.** Batch creation records `created_by`; join-request decisions record `resolved_by`; invite creation records `created_by`. Direct membership rows store `added_at` but not the adding teacher, removal deletes the membership row, and invite revocation has a timestamp but no revoking actor. Quiz edits also lack a full teacher audit history.
6. **Port conflicts are operationally common.** The app has default ports `5050` (backend) and `5005` (portal). Starting another process when one already listens causes `EADDRINUSE`; check/stop the existing terminal process instead of launching duplicate servers.
7. **Legacy Firebase configuration remains.** `portal/firebase-config.js` contains a Firebase web API key (omitted from this report). It is not loaded by the active portal; still review Firebase project API-key restrictions and remove legacy config/dependencies only in an approved cleanup task.
8. **Database has no migration ledger.** Migration status is determined from actual schema/recorded runs, so future migration tracking should be introduced carefully without reapplying already-present DDL.
9. **No ownership rule for quiz targeting exists yet.** Current quizzes are global to students if active. Phase 2 must preserve that behavior unless a quiz is explicitly changed to batch-targeted.

## 8. Next phase plan — Phase 2: batch-based quiz assignment and invitation snapshots

This is a plan only. No Phase 2 code or database changes were made.

### Goals and proposed behavior

- A teacher can target a quiz to one or more batches.
- At publish/assignment time, the system records an eligibility snapshot of students in those batches. Later batch membership changes do not silently change the snapshot.
- A teacher action explicitly refreshes the snapshot when they want newly eligible students included.
- Existing global quizzes remain available to all students. The UI must make global versus batch-targeted scope explicit; do not infer a change of audience merely because a teacher starts selecting batches.
- A student is eligible if the quiz is globally available or the student's invitation snapshot is active. Enforce this in listing, detail, and attempt-start routes, not just the portal.

### Proposed additive schema

1. `quiz_batches`: `quiz_id`, `batch_id`, `assigned_by`, `assigned_at`; composite primary key `(quiz_id, batch_id)`. Foreign keys to `quizzes`, `batches`, and `users`; indexes for lookups by batch and quiz. It records which batches target a quiz.
2. `quiz_invitations`: one eligibility snapshot row per `(quiz_id, student_id)`, with state (`invited`/`revoked`), snapshot/creation time, and optional revocation time. Enforce uniqueness on `(quiz_id, student_id)` so students in multiple target batches are not duplicated.
3. **Provenance option:** if auditability requires knowing which assigned batches made a student eligible, add `quiz_invitation_batches(invitation_id, batch_id)` with a composite primary key. This is preferable to opaque JSON if teachers need to review or refresh batch sources.
4. A schema field or equivalent explicit mode must distinguish `global` from `batch` audience. Recommended: additive `quizzes.audience_mode` with default `global`; do not make an existing quiz restricted just because `quiz_batches` rows were created mid-edit. This is a design choice to confirm before implementation.

No attempt, answer, or existing quiz row should be destroyed or rebuilt. Existing quizzes should default to global access.

### Proposed API work

- Teacher assigns/removes batches on a quiz (teacher JWT; validate quiz and batch IDs; transactionally update assignment rows).
- Teacher publishes or explicitly refreshes the eligibility snapshot (teacher JWT; return eligible count and snapshot time; deduplicate students that belong to multiple batches).
- Teacher views assigned batches and invited students/status.
- Student list/detail routes filter targeted quizzes by their snapshot; attempt start repeats the eligibility check server-side.
- Existing active global quiz routes continue to work unchanged for quizzes in global mode.
- Response design should not expose correct answers or private student records to other students.

### Portal work

- Teacher quiz editor: visible global/batch audience control, batch multi-select, assigned-batch summary, eligible student count, publish/refresh action, confirmation when refresh changes eligibility, and snapshot timestamp.
- Student dashboard: clearly group global, batch-invited, upcoming/available items as scheduling work is separately approved; for Phase 2, show only quizzes the student may access and explain their invitation state.
- Empty/loading/error states and responsive layouts; do not redesign unrelated exam/monitoring flows.

### Security and consistency checks

- Parameterized SQL and teacher JWT/DB-role authorization for all assignment/snapshot routes.
- Student cannot forge quiz ID, batch ID, student ID, or eligibility in request payloads.
- Check eligibility in `GET /api/quizzes`, `GET /api/quizzes/:id`, and `POST /api/attempts` to prevent direct API bypass.
- Build snapshots in a transaction with a defined locking/isolation approach for concurrent membership changes and explicit refreshes.
- Deduplicate students across batches; do not silently invalidate in-progress attempts. Define what removing/revoking an invitation means for an already-started attempt before implementation.
- Preserve global behavior for existing quizzes and test migration defaults against existing rows.
- Continue treating client violation events as unverified signals.

### Phase 2 tests to add

- Unit: audience-mode validation/defaults, duplicate batch assignment, deduplication across batches, snapshot refresh rules and invalid IDs.
- Integration: teacher-only assignment/publish/refresh; students cannot assign or inspect others; global quizzes remain visible; targeted quiz visible only to snapshotted student; later batch additions do not gain access before explicit refresh; refresh adds newly eligible students; removing a student has the chosen effect; direct attempt start is denied when ineligible; transaction rollback and simultaneous refresh/membership changes.
- Regression: existing auth, quiz creation, correct-answer secrecy, attempts, scoring, violations, Socket.IO, batches and invite requests all pass on a dedicated test DB.
- Manual: teacher assigns batches and publishes; student in/out of batch tests from separate browser profiles; verify global existing quizzes remain unchanged.

### Decisions to resolve before Phase 2 coding

- Use an explicit `audience_mode` field or another explicit global/targeted state. Recommended: field defaulting to `global`.
- When membership is removed after a quiz invitation snapshot, should the existing invitation remain valid until explicitly refreshed/revoked? Recommended: snapshot remains stable, with an explicit teacher refresh/revoke operation.
- Should an in-progress attempt remain resumable after its invitation is revoked? Recommended: yes, finish the attempt already started; block new starts.
- Should teachers see source-batch provenance for students in the snapshot? Recommended if audit/support matters; use the optional relational provenance table.

## 9. How to resume locally

### Environment variables

Set local values in `backend/.env` (never paste the file into chat or commit it). Names used by the code:

- `PORT` (optional; default `5050`).
- `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` for the development database.
- `TEST_DB_NAME` (default `quiz_integrity_guard_test`); optional `TEST_DB_HOST`, `TEST_DB_PORT`, `TEST_DB_USER`, `TEST_DB_PASSWORD`. Test DB name must include a `test` segment and must not identify production. Test DB settings otherwise fall back to the `DB_*` connection values.
- `JWT_SECRET` (required for server start; at least 32 bytes); `JWT_EXPIRES_IN` (default `1d`).
- `CORS_ORIGIN` (comma-separated exact origins; local portal defaults are included if unset).
- `CHROME_EXTENSION_ID` (optional; a Chrome extension ID matching 32 characters in the `[a-p]` range).
- `NODE_ENV` (`development` locally; test runner sets `test`).
- `TEST_STUDENT_NAME`, `TEST_STUDENT_EMAIL`, `TEST_STUDENT_PASSWORD` for the optional local demo-student seed. These are local values, not committed secrets.
- `portal/backend-config.js` sets `window.QIG_BACKEND_URL` (defaults to `http://localhost:5050`).

There is no Groq configuration yet because AI generation is not implemented. `.env.example` has placeholders only. The local `.env` was not read for this handover.

### Database setup

The current local databases already exist. Do not recreate or drop them. To prepare a fresh local install, configure PostgreSQL and `.env` first, inspect the schema, then apply only migrations that are absent. Do not apply `001_users_auth.sql` over the existing application database. The current development DB already has `002_batches.sql` and `003_batch_join_requests.sql` applied.

For an isolated test database created from a schema-only dump of the current development DB:

```sh
cd ~/Desktop/quiz-integrity-guard-github/backend
createdb quiz_integrity_guard_test
pg_dump --schema-only --no-owner --no-privileges quiz_integrity_guard \
  | psql --set ON_ERROR_STOP=1 quiz_integrity_guard_test
```

A schema-only dump copies no application records and includes already-applied schema objects. Do not run migrations a second time after such a dump. If upgrading a test DB made from an older schema, inspect first and apply only missing files in order:

```sh
psql --set ON_ERROR_STOP=1 quiz_integrity_guard_test --file=db/migrations/002_batches.sql
psql --set ON_ERROR_STOP=1 quiz_integrity_guard_test --file=db/migrations/003_batch_join_requests.sql
```

### Start services

Use separate Terminal windows/tabs:

```sh
cd ~/Desktop/quiz-integrity-guard-github/backend
npm run dev
```

```sh
cd ~/Desktop/quiz-integrity-guard-github/portal
python3 -m http.server 5005
```

Open `http://localhost:5005`; backend health is `http://localhost:5050/api/health`. If either port is already occupied, do not launch a duplicate. Check the existing terminal or run `lsof -nP -iTCP:5050 -sTCP:LISTEN` / `lsof -nP -iTCP:5005 -sTCP:LISTEN`; stop the process from its terminal with Control-C only if you intend to replace it.

Install dependencies in a new checkout if needed: `cd backend && npm install`. For a local teacher account, run `npm run create-teacher` in `backend/`; for the optional demo student, configure `TEST_STUDENT_*` and run `npm run seed:test-student`.

### Tests and static checks

Run from `backend/`:

```sh
TEST_DB_NAME=quiz_integrity_guard_test npm test
node --check ../portal/app.js
node --check ../background.js
node --check ../content.js
python3 -m json.tool ../manifest.json >/dev/null
git -C .. diff --check
```

The integration suite creates uniquely named fixtures in the test DB and cleans them up. Never change its connection to the development/production database.

### Load Chrome extension

1. Open `chrome://extensions` and enable **Developer mode**.
2. Select **Load unpacked** and choose the repository root containing `manifest.json`.
3. Copy the extension ID shown by Chrome into local `backend/.env` as `CHROME_EXTENSION_ID` and restart the backend.
4. Sign in to the portal as a student, start a quiz, open the extension popup, sign in with the same backend student account, and select the in-progress attempt.
5. Test browser-observable events only in a controlled demo quiz. Screenshot and operating-system signals are best-effort and cannot guarantee detection.

## Git and handover notes

The repository had existing uncommitted modifications before this handover. They were preserved. No commit was created. The only new file for this request is `PROJECT_HANDOVER.md`.
