# Quiz Integrity Guard portal

The existing portal screens now use the Node.js + Express + PostgreSQL backend for registration, login, quiz management, attempts, answer saving, scoring, and violation tracking. Teacher monitoring uses Socket.IO. Firebase Authentication and Firestore are not loaded by the active portal page; their old configuration files are retained temporarily until final migration cleanup.

## Run locally

Terminal 1 — backend:

```bash
cd ~/Desktop/quiz-integrity-guard-github/backend
npm run dev
```

Terminal 2 — static portal server (no Firebase account needed):

```bash
cd ~/Desktop/quiz-integrity-guard-github/portal
python3 -m http.server 5005
```

Open [http://localhost:5005](http://localhost:5005). If port `5005` is occupied by a previous `firebase serve`, stop that process with **Ctrl+C** first.

## Use the portal

- Create student accounts from **Sign Up**. Public sign-up always creates a student.
- Sign in as a student to see active quizzes, start an attempt, save answers, submit, and view past results.
- Sign in as a teacher to create quizzes and questions, manage student batches, and view attempts and recent violations. Batch management supports direct add/remove of registered students, plus reusable 14-day invite links with teacher approval or rejection of join requests.
- Students can open a teacher's batch invite link, sign in or create a student account, and submit a join request. The link does not add them automatically; their request status appears on the student dashboard until a teacher reviews it.
- Teacher accounts are provisioned from the backend folder with `npm run create-teacher`. Existing teacher passwords can be reset with `npm run reset-teacher-password`; Terminal hides password input.

The backend calculates scores from saved answers. Student quiz responses do not contain correct answers.

## Connect the Chrome extension

1. Open `chrome://extensions`, turn on **Developer mode**, and select **Load unpacked**.
2. Select the repository root folder containing `manifest.json`.
3. Copy the extension ID shown in Chrome. In `backend/.env`, set `CHROME_EXTENSION_ID` to that ID.
4. Restart the backend.
5. Start a quiz in the portal. Open the Exam Monitor extension popup, sign in with the same student backend account, and select the in-progress attempt.

The extension injects into Google Forms and the local portal origin. In the portal it only records extension-specific signals such as inactivity, screenshot shortcut keys, and a developer-tools size heuristic; the portal itself already reports tab switching, focus, copy/paste, right-click, keyboard shortcuts, and fullscreen changes, so the extension skips those duplicates. On Google Forms it can report its supported browser events. A screenshot key or developer-tools heuristic is best-effort and cannot prove intent. If it cannot identify the current question, it leaves the question number blank. The extension stores the JWT in Chrome extension storage and does not retain the password.

## Local configuration

- Portal API address: `portal/backend-config.js` (default `http://localhost:5050`).
- Backend portal origin: `http://localhost:5005` is allowed by default.
- Extension CORS origin: set `CHROME_EXTENSION_ID` in `backend/.env` as described above. Restart the backend after changing configuration.
- For deployment, use HTTPS for the portal and API, add the exact portal origin to `CORS_ORIGIN`, update `portal/backend-config.js`, and add the deployed API host to the extension manifest permissions.

Violation events originate from the browser and are useful for monitoring, but a browser report alone cannot prove student intent.
