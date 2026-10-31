# Quiz Integrity Guard backend: authentication

## 1. Configure PostgreSQL and secrets

From the repository root:

```sh
cd backend
npm install
cp .env.example .env
```

Edit `.env` with the PostgreSQL connection details for the `quiz_integrity_guard` database. Set `JWT_SECRET` to a private random value of at least 32 bytes. One way to generate one on macOS is:

```sh
openssl rand -base64 48
```

Copy that output into `.env`; do not commit `.env` or share the secret. Set `CORS_ORIGIN` to the exact portal origin(s), such as `http://localhost:5005`. After loading the unpacked extension, copy its ID from `chrome://extensions` into `CHROME_EXTENSION_ID` in `.env`; this adds only that extension origin to CORS. Restart the backend after changing `.env`.

The current database already contains a compatible `users` table. Its `id` is integer, `name` is `VARCHAR(100)`, `email` is `VARCHAR(150)`, `password_hash` is text, and `role` allows only `student` or `teacher`. **Do not apply `db/migrations/001_users_auth.sql` to that existing database.** It is only a bootstrap definition for a new database with no `users` table.

To inspect the schema before any future migration, connect with `psql` using your own local credentials and run:

```sql
\d+ public.users
```

## 2. Start and check the API

```sh
npm run dev
```

The default port is `5050`. In another terminal:

```sh
curl -i http://localhost:5050/api/health
```

A healthy response includes `"database":"connected"`.

## 3. Exercise registration, duplicate protection, login, and `/me`

Choose a unique email for the test account and replace the sample value below:

```sh
curl -i -X POST http://localhost:5050/api/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"name":"Test Student","email":"student-test@example.com","password":"CorrectHorse42!"}'
```

The response contains a student profile and a JWT in `token`. Repeat the registration request to confirm it returns HTTP `409`. Try an invalid email or a password shorter than eight characters to confirm HTTP `400`.

Log in with the same credentials:

```sh
curl -i -X POST http://localhost:5050/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"student-test@example.com","password":"CorrectHorse42!"}'
```

A wrong password returns HTTP `401`. Copy the returned token, then call the protected route:

```sh
curl -i http://localhost:5050/api/auth/me \
  -H 'Authorization: Bearer PASTE_TOKEN_HERE'
```

Missing, malformed, invalid, and expired tokens return HTTP `401`. API responses contain only the public profile fields `id`, `name`, `email`, and `role`; they never return `password_hash`.

## Authentication flow in plain language

Registration validates the submitted values, hashes the password with bcrypt, and stores only that hash. Login compares the submitted password with the stored hash and issues a signed JWT if they match. For protected requests, `requireAuth` verifies the JWT and reloads the user from PostgreSQL, so the role comes from the database. `requireRole("teacher")` can then restrict a route to teachers. Public registration always creates a student; teacher accounts must be provisioned through a trusted process.

## Current routes

- `POST /api/auth/register` — create a student account.
- `POST /api/auth/login` — verify credentials and issue a JWT.
- `GET /api/auth/me` — return the signed-in user profile.
- `GET /api/health` — check API and database connectivity.

## Batch management APIs

Batch management uses the additive `db/migrations/002_batches.sql` migration. It creates `batches` and `batch_students` only; existing quiz visibility and attempt behavior are unchanged. Any authenticated teacher can manage any batch under the shared-teacher model.

- `POST /api/batches` — teacher JWT; body `{ "name": "CCE Semester 5" }`; returns `201 { "batch": { ... , "membership_count": 0 } }`. Names are trimmed, 1–120 characters, and unique without regard to case. A duplicate returns `409`.
- `GET /api/batches` — teacher JWT; returns `{ "batches": [...] }` with membership counts.
- `GET /api/batches/:id/students` — teacher JWT; returns `{ "batch": {...}, "students": [...] }`.
- `POST /api/batches/:id/students` — teacher JWT; accept exactly one of `{ "student_id": 42 }` or `{ "email": "student@example.com" }`. Only registered student accounts are accepted. Success returns `201`; an existing membership returns `409`.
- `DELETE /api/batches/:id/students/:studentId` — teacher JWT; removes only that membership and returns `{ "membership": {...}, "removed": true }`. Unknown IDs or a missing membership return `404`.

The database uses a case-insensitive unique index for batch names and a composite primary key on `(batch_id, student_id)` to prevent duplicate membership. Removing a student from a batch does not delete the student account.

### Batch invite links and teacher review

Teachers can create a reusable, revocable invite link for a batch. Links expire after 14 days. Creating a replacement revokes the previous link. The API returns the raw 256-bit code once so the portal can build the share link; PostgreSQL stores only its SHA-256 hash. Students must be signed in and have the `student` role to submit a request. A link does not add a student automatically.

- `POST /api/batches/:id/invite` — teacher JWT; create or replace the link. Returns `{ "invite": { "code": "...", "expires_at": "...", "valid_days": 14 } }`.
- `DELETE /api/batches/:id/invite` — teacher JWT; revoke the current unexpired or expired link. Existing requests remain pending for teacher review.
- `POST /api/batches/join-requests` — student JWT; body `{ "code": "64-character invite code" }`. Creates a pending request; an existing membership or pending request returns `409`.
- `GET /api/batches/my-join-requests` — student JWT; list only the signed-in student's request statuses.
- `GET /api/batches/:id/join-requests?status=pending` — teacher JWT; list requests for any batch in the shared workspace. `status` may be `pending`, `approved`, or `rejected`.
- `POST /api/batches/:id/join-requests/:requestId/decision` — teacher JWT; body `{ "decision": "approved" }` or `{ "decision": "rejected" }`. Approval adds the student to `batch_students` in the same transaction as recording the decision. A request can be reviewed only once.

Rejected students may request again while they have a valid invite link. Replacing or revoking a link stops new requests through the old link but does not erase or cancel requests already submitted. The teacher portal displays the invite link, pending requests, and student-side request status.

## Quiz Management APIs

These routes use the existing `quizzes` and `questions` tables. No schema migration is needed or used. Quiz IDs are positive integers. Quiz durations use minutes (as stored in PostgreSQL); question options are arrays of strings, and `correct_answer` is a zero-based option index.

Authorization follows the shared-teacher model: students can read active quizzes; any teacher can create a quiz or add questions to any quiz. The database does not record which teacher created a quiz. Student quiz responses explicitly omit `correct_answer`.

- `GET /api/quizzes` — student JWT required; returns active quizzes, including `question_count`.
- `GET /api/quizzes/manage` — teacher JWT required; returns all quizzes, including inactive ones, for management.
- `GET /api/quizzes/:id` — student JWT required; returns `{ "quiz": {...}, "questions": [...] }` for active quizzes. Inactive and unknown quiz IDs both return `404`.
- `POST /api/quizzes` — teacher JWT required. JSON body: `{ "title": "Physics Basics", "description": "Optional", "duration_minutes": 15, "is_active": true }`. `description` and `is_active` are optional; active defaults to `true`. Duration must be 1–1440 minutes.
- `POST /api/quizzes/:id/questions` — teacher JWT required. JSON body: `{ "question_text": "What is 2 + 2?", "options": ["3", "4", "5", "6"], "correct_answer": 1 }`. There must be 2–10 non-empty options, and `correct_answer` must be an integer index in that array. Question order is assigned by the server in a transaction.

Send tokens with `Authorization: Bearer <token>`. Public registration creates student accounts only, so teacher accounts must be provisioned by a trusted process. The integration suite provisions temporary student and teacher records directly, exercises the API, and removes its uniquely named fixtures afterward.

### Isolated test database

`npm test` sets `NODE_ENV=test`. In that mode, the backend uses `TEST_DB_NAME` (default `quiz_integrity_guard_test`) and never uses `DB_NAME`. The test suite fails closed if the test database name is not clearly marked as a test database. Seed integration tests also point their subprocess at this dedicated database.

Create an empty test database and copy the current application schema without copying any records:

```sh
createdb quiz_integrity_guard_test
pg_dump --schema-only --no-owner --no-privileges quiz_integrity_guard | psql --set ON_ERROR_STOP=1 quiz_integrity_guard_test
```

Run these from `backend/` using the same PostgreSQL account/host configured in `.env`. A schema-only dump from the current development database already includes applied migrations; do not apply those migrations a second time. If you are upgrading an older test database, inspect its tables and apply only missing migrations in order (`002_batches.sql`, then `003_batch_join_requests.sql`). If the test database already exists, do not recreate it. To use another test database name, set `TEST_DB_NAME` in the local `.env`; it must contain a `test` segment and must not be a production database. Tests create and clean up uniquely named fixtures in the test database only.

From `backend/`, run the suite with:

```sh
npm test
```

The batch migrations are additive and transactional. On a database that has not received them, inspect whether the new tables already exist, then apply each missing migration once in order:

```sh
psql --set ON_ERROR_STOP=1 quiz_integrity_guard --file=db/migrations/002_batches.sql
psql --set ON_ERROR_STOP=1 quiz_integrity_guard --file=db/migrations/003_batch_join_requests.sql
```

The development database for this project already has both migrations applied. Do not run the commands above against it again.

If application fails before commit, PostgreSQL rolls the migration back. After commit, prefer a forward repair. Rolling back migration 003 deletes invite and request history; rolling back migration 002 deletes memberships and batches. Back up that data first and remove only the new tables in dependency order if you explicitly choose to discard it.

To call an endpoint manually after starting the server, substitute a real student or teacher token as appropriate:

```sh
curl -i http://localhost:5050/api/quizzes \
  -H 'Authorization: Bearer STUDENT_TOKEN'

curl -i http://localhost:5050/api/quizzes/1 \
  -H 'Authorization: Bearer STUDENT_TOKEN'

curl -i -X POST http://localhost:5050/api/quizzes \
  -H 'Authorization: Bearer TEACHER_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{"title":"Physics Basics","description":"Motion and forces","duration_minutes":15}'

curl -i -X POST http://localhost:5050/api/quizzes/1/questions \
  -H 'Authorization: Bearer TEACHER_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{"question_text":"What is 2 + 2?","options":["3","4","5","6"],"correct_answer":1}'
```

## Attempt Management APIs

All attempt endpoints require a student JWT. The API uses the existing `attempts` and `answers` tables; it does not add or alter database columns. Scores are calculated on the server from saved answers and `questions.correct_answer`. The client cannot set a score.

- `POST /api/attempts` — start an attempt for an active quiz with `{ "quiz_id": 1 }`. The response contains the attempt and student-safe questions, with no correct-answer field.
- `GET /api/attempts/monitoring` — teacher JWT required; returns recent attempts, active attempt count, and recent violations for the teacher dashboard.
- `GET /api/attempts?limit=50` — list the signed-in student's attempts. `limit` defaults to 50 and must be 1–100.
- `GET /api/attempts/:id` — fetch one of the signed-in student's attempts and its questions with saved selections. Other students' attempts return `404`.
- `PUT /api/attempts/:id/answers/:questionId` — save or replace an answer with `{ "selected_option": 1 }`. Send `null` to clear it. The question must belong to the attempt's quiz and the selected option must exist.
- `POST /api/attempts/:id/submit` — submit and score the attempt. The server calculates score and percentage. Submitting after the quiz time limit marks it `auto_submitted`; expired attempts cannot save more answers.

Question additions are paused while a quiz has an unexpired attempt in progress so its question count cannot change underneath a student. If attempts are overdue, adding a question first auto-submits them using the saved answers and server-side score calculation. Each accepted violation is recorded in the existing `violations` table and increments `attempts.violation_count`. The third violation auto-submits and scores the attempt.

Example commands (substitute a real student token and IDs):

```sh
curl -i -X POST http://localhost:5050/api/attempts \
  -H 'Authorization: Bearer STUDENT_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{"quiz_id":1}'

curl -i -X PUT http://localhost:5050/api/attempts/1/answers/1 \
  -H 'Authorization: Bearer STUDENT_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{"selected_option":1}'

curl -i http://localhost:5050/api/attempts?limit=50 \
  -H 'Authorization: Bearer STUDENT_TOKEN'

curl -i http://localhost:5050/api/attempts/1 \
  -H 'Authorization: Bearer STUDENT_TOKEN'

curl -i -X POST http://localhost:5050/api/attempts/1/submit \
  -H 'Authorization: Bearer STUDENT_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{}'
```

Run `npm test` from `backend/` to verify authentication, quiz management, and attempt lifecycle behavior. The integration tests create uniquely named temporary records and remove them afterward.

## Violation Tracking API

The API stores client-reported violations in the existing `violations` table; it does not change the schema. Students can report violations only for their own in-progress attempt. Teachers can read violation records for any attempt under the shared-teacher model. Allowed types include portal events (`tab_switch`, `window_blur`, `copy_attempt`, `paste_attempt`, `cut_attempt`, `right_click`, `keyboard_shortcut`, `fullscreen_exit`) and extension events (`inactivity`, `fast_submission`, `devtools_opened`, `screenshot_attempt`).

- `POST /api/attempts/:id/violations` — student JWT required. Body: `{ "type": "tab_switch", "message": "User switched tabs", "question_number": 2 }`. Message is optional (up to 500 characters). `question_number` is optional when the reporting client cannot determine it; when provided, it is 1-based and must be within that quiz.
- `GET /api/attempts/:id/violations` — student JWT may read only their own attempt; teacher JWT may read any attempt.
- `GET /api/attempts/monitoring` — teacher JWT required; returns recent attempts, active counts, and recent violations for the teacher dashboard.
- `GET /api/attempts/monitoring/:id` — teacher JWT required; returns student/quiz details, saved answers and violation history. Correct answers are included only after an attempt is submitted.

For extension-reported events where the active question cannot be determined from the monitored page, `question_number` may be omitted and is stored as `NULL`; portal-reported events continue to include the known question number.

Each report and counter update are written in a transaction. The third violation auto-submits and scores the attempt. Reports after submission or time expiration are rejected (expired attempts are auto-submitted). These are browser-reported events: the API validates and stores reports, but a client-side signal alone cannot prove what happened on a student's device.

Example:

```sh
curl -i -X POST http://localhost:5050/api/attempts/1/violations \
  -H 'Authorization: Bearer STUDENT_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{"type":"tab_switch","message":"User switched tabs","question_number":2}'

curl -i http://localhost:5050/api/attempts/1/violations \
  -H 'Authorization: Bearer STUDENT_TOKEN'
```

## Socket.IO teacher events

The teacher dashboard connects to this Socket.IO server after teacher login. The HTTP API and Socket.IO share port `5050`. A Socket.IO connection must present a valid JWT for a current teacher account; student, missing-token, and invalid-token connections are rejected. Authenticated teachers join the shared `teachers` room. Events are broadcast only after the database transaction commits.

- `violation:created` — `{ violation, attempt, student }`, including the violation details, quiz/attempt summary, and reporting student's ID, name and email.
- `attempt:started` — attempt ID, student ID, quiz ID/title, attempt number, status and start time.
- `attempt:completed` — attempt ID, student ID, quiz ID/title, attempt number, score, percentage, end time and `student_submitted` reason.
- `attempt:auto_submitted` — attempt summary with score, percentage, end time, and `reason` (`violation_threshold` or `time_limit`).

The teacher portal now loads the Socket.IO client and subscribes after backend teacher login:

```html
<script src="http://localhost:5050/socket.io/socket.io.js"></script>
<script>
  const socket = io("http://localhost:5050", {
    auth: { token: "TEACHER_TOKEN" }
  });
  socket.on("violation:created", event => console.log(event));
  socket.on("attempt:started", event => console.log(event));
  socket.on("attempt:completed", event => console.log(event));
  socket.on("attempt:auto_submitted", event => console.log(event));
</script>
```

Restart the backend with `npm run dev` after code changes so it serves the Socket.IO endpoint. `npm test` also runs an integration test that verifies teacher authentication and both event types.

## Development test student

Set these local values in `backend/.env` (do not commit the file). Pick a private password of 8–72 UTF-8 bytes:

```dotenv
NODE_ENV=development
TEST_STUDENT_NAME=Demo Student
TEST_STUDENT_EMAIL=student.demo@example.com
TEST_STUDENT_PASSWORD=choose-a-private-local-password
```

Then run from `backend/`:

```sh
npm run seed:test-student
```

The command refuses `NODE_ENV=production` and database names containing `prod`/`production`. It creates a student row with bcrypt and never prints or stores the password in plaintext. Running it again reports that the account exists and does not update its name or password. Log in through the student tab with the values you configured. To select a new password for a new demo account, change the email as well; the seed intentionally never resets an existing account's password.

## Teacher dashboard and Chrome demonstration

Start each process in its own Terminal tab/window:

```sh
cd ~/Desktop/quiz-integrity-guard-github/backend
npm run dev
```

```sh
cd ~/Desktop/quiz-integrity-guard-github/portal
python3 -m http.server 5005
```

Open [http://localhost:5005](http://localhost:5005). Sign in on **Teacher Login** with an existing backend teacher account (create one locally with `npm run create-teacher` from `backend/` if needed). Create a quiz, add at least one question with separate option fields, and make sure it is active. Dashboard totals and charts are queried from PostgreSQL; the attempt table can be searched/filtered, and **Details** opens a teacher-only view of the student's saved answers and violations. Correct answers appear there only after submission.

For a student account, configure `TEST_STUDENT_*` in `backend/.env` and run `npm run seed:test-student` as described above. Use a separate Chrome profile or Incognito window (allow Incognito for the unpacked extension if testing it) and sign in via **Student Login**. Select the active quiz, begin, save answers, then submit. Return to the teacher session: the Socket.IO feed and table refresh on events, and reconnecting causes a fresh database snapshot. The HTTP monitoring endpoints remain the persistent source of truth.

To load the unpacked extension, open `chrome://extensions`, enable **Developer mode**, click **Load unpacked**, and select the repository root containing `manifest.json`. After loading, copy its extension ID into `CHROME_EXTENSION_ID` in `.env` and restart the backend. Begin a test from the portal and manually allow fullscreen when Chrome prompts; browser automation cannot grant that gesture. Use the extension popup or trigger supported portal events (such as leaving the exam tab) to check violation reports.

Run automated checks from `backend/`:

```sh
npm test
node --check ../portal/app.js
node --check ../background.js
node --check ../content.js
python3 -m json.tool ../manifest.json >/dev/null
git -C .. diff --check
```

The seed test creates and removes a uniquely named temporary student. The database integration tests similarly use temporary records. Manual Chrome validation is still required to verify visual behavior, fullscreen prompts and extension reporting on your machine.

## Provision a backend teacher for portal login

The portal uses backend JWT authentication. Create a teacher account from an interactive local terminal (password input is hidden):

```sh
cd backend
npm run create-teacher
```

This command only inserts a new `teacher` user with a bcrypt password hash. It refuses to change an existing account.

For local portal hosting, serve `portal/` with `python3 -m http.server 5005`; that origin is allowed by default. For deployment, set `CORS_ORIGIN` to the exact portal origin and `portal/backend-config.js` to the backend's HTTPS URL. For the extension, set `CHROME_EXTENSION_ID` in `.env` to the ID shown on `chrome://extensions`. Restart the backend after changing `.env`.

## Reset a teacher password

To recover access to an existing backend teacher account, run this in an interactive Terminal from the backend folder:

```bash
npm run reset-teacher-password
```

Enter the teacher email, then type the new password twice when prompted. Password input is hidden and the backend stores only a bcrypt hash. This updates only an existing teacher row in PostgreSQL. The backend-connected portal uses this password directly; Firebase password reset is not needed.
