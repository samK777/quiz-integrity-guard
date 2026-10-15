# Exam Portal - Real-time Quiz Monitoring System

A comprehensive, production-ready exam portal with strict monitoring, real-time teacher dashboard, and live deployment capabilities.

## Features

### Student Experience
- **Secure Login/Signup** with Firebase Authentication
- **Fullscreen Quiz Mode** with enforcement
- **One Question at a Time** interface
- **15-minute Timer** with progress tracking
- **Question Palette** for navigation
- **Multiple Attempts** tracking
- **Real-time Results** with violation tracking

### Teacher Dashboard
- **Live Monitoring** of active students
- **Real-time Activity Feed** showing violations
- **Student Statistics** and progress tracking
- **Violation Tracking** with question numbers
- **Attempt History** management

### Strict Exam Monitoring
- **3-Strike Violation System** - Auto-submit after 3 violations
- **Fullscreen Enforcement** - Violation if exited
- **Tab Switch Detection** - Tracks tab changes
- **Window Blur Detection** - Monitors focus loss
- **Copy/Paste Blocking** - Prevents content theft
- **Right-click Disable** - Blocks context menu
- **Keyboard Shortcut Blocking** - F12, Ctrl+Shift+I, etc.
- **Sound Alerts** on violations
- **Question-Level Tracking** - Violations linked to specific questions

### Real-time Features
- **Live Firestore Sync** - All data saved in real-time
- **Teacher Dashboard Updates** - Instant violation notifications
- **Cross-browser Compatibility** - Works on all modern browsers
- **Mobile Responsive** - Works on tablets and phones

## Quick Start

### 1. Firebase Setup
1. Create a Firebase project at [Firebase Console](https://console.firebase.google.com/)
2. Enable Authentication (Email/Password)
3. Enable Firestore Database
4. Update `firebase-config.js` with your configuration:

```javascript
const firebaseConfig = {
    apiKey: "your-api-key",
    authDomain: "your-project.firebaseapp.com",
    projectId: "your-project-id",
    storageBucket: "your-project.appspot.com",
    messagingSenderId: "your-sender-id",
    appId: "your-app-id"
};
```

### 2. Local Development
1. Install Firebase CLI:
```bash
npm install -g firebase-tools
```

2. Login to Firebase:
```bash
firebase login
```

3. Initialize Firebase in your project:
```bash
firebase init hosting
```

4. Run locally:
```bash
firebase serve --only hosting
```

5. Open `http://localhost:5000` in your browser

### 3. Deployment
1. Deploy to Firebase Hosting:
```bash
firebase deploy --only hosting
```

2. Your live site will be available at: `https://your-project.firebaseapp.com`

## Demo Accounts

### Student Login
- **Email**: `student@demo.com`
- **Password**: `student123`

### Teacher Login
- **Email**: `teacher@demo.com`
- **Password**: `teacher123`

## File Structure

```
exam-portal/
    index.html              # Main application HTML
    styles.css              # Complete styling with glassmorphism
    app.js                  # Full application logic
    firebase-config.js      # Firebase configuration
    firebase.json           # Firebase hosting config
    package.json            # Project metadata
    README.md               # This file
```

## How It Works

### Student Flow
1. **Login/Signup** - Student creates account or logs in
2. **Dashboard** - View available quizzes and attempt history
3. **Start Quiz** - Click "Start Quiz" button
4. **Fullscreen Required** - System requests fullscreen mode
5. **Quiz Interface** - Answer questions with strict monitoring
6. **Violations Tracked** - Any violation triggers warning
7. **3-Strike System** - Auto-submit after 3 violations
8. **Results** - View score, accuracy, and violations

### Teacher Flow
1. **Login** - Teacher logs in with credentials
2. **Dashboard** - View live monitoring panel
3. **Real-time Updates** - See student activity instantly
4. **Activity Feed** - Monitor violations as they happen
5. **Student Management** - Track progress and violations

### Violation System
- **Strike 1**: Warning popup, sound alert, logged to database
- **Strike 2**: Second warning, increased monitoring
- **Strike 3**: Auto-submit quiz, marked as violation-based submission

### Real-time Sync
All data is synchronized in real-time:
- **Student Progress**: Current question, answers, time remaining
- **Violations**: Type, timestamp, question number
- **Teacher Dashboard**: Live updates via Firestore listeners

## Database Structure

### Attempts Collection
```javascript
{
    userId: "user123",
    quizId: "physics_basic_001",
    attemptNumber: 1,
    startTime: timestamp,
    endTime: timestamp,
    answers: [0, 1, null, 2, ...],
    currentQuestion: 3,
    violationCount: 2,
    violations: [...],
    status: "in_progress|completed",
    isAutoSubmitted: false,
    score: 8,
    percentage: 80
}
```

### Violations Collection
```javascript
{
    userId: "user123",
    quizId: "physics_basic_001",
    attemptId: "attempt123",
    type: "tab_switch|fullscreen_exit|copy_attempt",
    message: "User switched to another tab",
    timestamp: timestamp,
    questionNumber: 3,
    timeRemaining: 720
}
```

## Browser Compatibility

- **Chrome** - Full support
- **Firefox** - Full support
- **Safari** - Full support
- **Edge** - Full support
- **Mobile** - Responsive design

## Security Features

- **Firebase Authentication** - Secure user management
- **Fullscreen Enforcement** - Prevents cheating
- **Tab Switch Detection** - Monitors focus changes
- **Input Blocking** - Prevents copy/paste
- **Keyboard Shortcuts** - Blocks developer tools
- **Real-time Logging** - All violations tracked
- **Secure Storage** - Data encrypted in transit

## Customization

### Adding New Quizzes
1. Add quiz data to `app.js` in the `physicsQuiz` object
2. Update quiz ID and questions array
3. Test with different question types

### Changing Violation Rules
1. Modify `QuizState.maxViolations` in `app.js`
2. Update violation detection functions
3. Adjust warning messages and thresholds

### Customizing UI
1. Modify CSS variables in `styles.css`
2. Update colors, spacing, and animations
3. Add new components as needed

## Troubleshooting

### Common Issues

**Fullscreen not working**
- Ensure browser supports fullscreen API
- Check if user interaction is required
- Verify HTTPS is enabled (required for fullscreen)

**Firebase connection issues**
- Check Firebase configuration
- Verify Firestore rules
- Ensure authentication is enabled

**Violations not being tracked**
- Check monitoring functions are active
- Verify event listeners are attached
- Check browser console for errors

**Real-time updates not working**
- Verify Firestore rules allow reads
- Check network connection
- Ensure Firebase is initialized

## Performance

- **Optimized for 100+ concurrent users**
- **Real-time updates with minimal latency**
- **Efficient Firestore queries**
- **Compressed assets**
- **CDN delivery via Firebase Hosting**

## Support

For issues and feature requests:
1. Check the troubleshooting section
2. Review browser console for errors
3. Verify Firebase configuration
4. Test with demo accounts

## License

MIT License - Free for commercial and personal use

---

**Built with**: HTML5, CSS3, Vanilla JavaScript, Firebase
**Deployment**: Firebase Hosting
**Real-time**: Firestore Database
**Authentication**: Firebase Auth
