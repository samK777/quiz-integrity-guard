# Quiz Integrity Guard 🛡️

A Chrome extension and web portal prototype designed to support online assessment integrity through tab-switch monitoring, violation tracking, and quiz management workflows.

## Overview

Quiz Integrity Guard combines a Chrome extension with a web-based portal to explore how suspicious activity during online assessments can be monitored and reviewed.

The repository contains the browser extension and a portal prototype with quiz interfaces, dashboard pages, and Firebase integration scaffolding.

## Features

### Chrome Extension
- Detects tab-focus changes during online assessments.
- Alerts users when suspicious activity is detected.
- Uses Chrome Extension Manifest V3.

### Web Portal
- Quiz interface with a timed assessment workflow.
- Violation threshold logic in the quiz application.
- Dashboard and supporting pages for assessment monitoring.
- Firebase Authentication and Firestore integration scaffolding.
- Real-time listener examples for monitoring data changes.

*Note: Feature availability depends on configuration. Real-time data, authentication, and database functionality must be tested against a properly configured Firebase project.*

## Tech Stack

- **Frontend:** HTML, CSS, JavaScript
- **Browser Extension:** Chrome Extension APIs, Manifest V3
- **Backend / Data:** Firebase Authentication and Cloud Firestore integration scaffolding
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

### 3. Configure the portal

1. Open the `portal/` directory.
2. Review `portal/PORTAL-README.md` and `portal/package.json`.
3. Configure Firebase credentials for your own Firebase project.
4. Enable the required Authentication and Cloud Firestore services.
5. Set appropriate Firestore Security Rules before using real assessment or student data.

The committed Firebase configuration uses demo values. The portal will require suitable configuration before it can connect to a live Firebase project.

## Security Notes

- Never commit service-account keys, private keys, or other server-side secrets.
- Restrict Firebase API keys appropriately and configure Firebase Security Rules.
- Do not use real student data until authentication, authorization, and database access have been tested.

## Future Improvements

- Integrate the extension and portal into a complete assessment workflow.
- Expand teacher-side quiz creation and management.
- Improve real-time violation review and reporting.
- Add assessment analytics and evaluation workflows.
- Explore additional methods for identifying suspicious assessment behavior.

## Author

**Samriddhi Kapoor**

GitHub: [@samK777](https://github.com/samK777)