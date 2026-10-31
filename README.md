# Quiz Integrity Guard 🛡️

A Chrome extension and web portal prototype designed to support online assessment integrity through tab-switch monitoring, violation tracking, and quiz management workflows.

## Overview

Quiz Integrity Guard combines a Chrome extension with a web-based portal to explore how suspicious activity during online assessments can be monitored and reviewed.

The repository contains an existing browser extension and portal UI connected to a Node.js + Express + PostgreSQL backend. Firebase files remain as migration leftovers and are not loaded by the active portal page.

## Features

### Chrome Extension
- Detects tab-focus changes during online assessments.
- Alerts users when suspicious activity is detected.
- Uses Chrome Extension Manifest V3.

### Web Portal
- Quiz interface with a timed assessment workflow.
- Violation threshold logic in the quiz application.
- Dashboard and supporting pages for assessment monitoring.
- JWT authentication and role-based backend APIs.
- PostgreSQL-backed quizzes, attempts, answers, scoring, and violation records.
- Teacher-managed student batches with direct membership and invite links that students can use to request entry pending teacher approval.
- Socket.IO teacher monitoring and a Chrome extension reporter.

## Tech Stack

- **Frontend:** HTML, CSS, JavaScript
- **Browser Extension:** Chrome Extension APIs, Manifest V3
- **Backend / Data:** Node.js, Express, PostgreSQL, JWT, bcrypt, and Socket.IO
- **Development:** Git and GitHub

## Repository Structure

```text
quiz-integrity-guard/
├── manifest.json
├── background.js
├── content.js
├── README.md
└── portal/
    ├── index.html
    ├── app.js
    ├── styles.css
    ├── dashboard.html
    ├── realtime.html
    ├── realtime-working.html
    ├── simple.html
    ├── firebase-config.js
    ├── package.json
    └── PORTAL-README.md
```

## Getting Started

### 1. Clone the repository

```bash
git clone https://github.com/samK777/quiz-integrity-guard.git
cd quiz-integrity-guard
```

### 2. Load the Chrome extension

1. Open Chrome and navigate to `chrome://extensions`.
2. Enable **Developer mode**.
3. Select **Load unpacked**.
4. Choose the repository root directory containing `manifest.json`.

### 3. Run the backend and portal

Follow [`backend/README.md`](backend/README.md) to configure PostgreSQL and start the API. In another terminal, serve the existing portal files locally without Firebase:

```bash
cd portal
python3 -m http.server 5005
```

Open `http://localhost:5005`. Current portal authentication, quizzes, attempts, scoring, and violation records use the Node.js + PostgreSQL backend. See [`portal/PORTAL-README.md`](portal/PORTAL-README.md) for Chrome extension setup.

## Security Notes

- Never commit `.env` secrets, service-account keys, private keys, or JWT secrets.
- Do not use real student data until authentication, authorization, and database access have been tested.

## Future Improvements

- Retire leftover Firebase files and package dependencies after final verification.
- Expand teacher-side quiz and attempt analytics.
- Improve real-time violation review and reporting.
- Add assessment analytics and evaluation workflows.
- Explore additional methods for identifying suspicious assessment behavior.

## Author

**Samriddhi Kapoor**

GitHub: [@samK777](https://github.com/samK777)

## Backend API

Backend setup, database compatibility notes, and authentication commands are documented in [`backend/README.md`](backend/README.md).
