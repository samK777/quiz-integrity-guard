// ========================================
// FIREBASE CONFIGURATION
// ========================================

// Demo Firebase configuration (replace with your actual config)
const firebaseConfig = {
    apiKey: "AIzaSyDemoKey-ReplaceWithActualKey",
    authDomain: "exam-portal-demo.firebaseapp.com",
    projectId: "exam-portal-demo",
    storageBucket: "exam-portal-demo.appspot.com",
    messagingSenderId: "123456789",
    appId: "1:123456789:web:demo"
};

// Initialize Firebase with error handling
let db, auth;
try {
    firebase.initializeApp(firebaseConfig);
    db = firebase.firestore();
    auth = firebase.auth();
    console.log('Firebase initialized successfully');
} catch (error) {
    console.warn('Firebase initialization failed, using demo mode:', error);
    // Create mock Firebase for demo mode
    db = createMockFirestore();
    auth = createMockAuth();
}

// Export for use in other files
window.firebaseConfig = firebaseConfig;
window.db = db;
window.auth = auth;

// Mock Firestore for demo mode
function createMockFirestore() {
    const mockData = {
        attempts: [],
        violations: []
    };
    
    return {
        collection: (name) => ({
            where: () => ({
                get: () => Promise.resolve({ docs: [], empty: true }),
                onSnapshot: (callback) => {
                    // Mock real-time listener
                    setTimeout(() => callback({ docs: [] }), 100);
                    return () => {};
                }
            }),
            add: (data) => {
                const id = 'mock_' + Date.now();
                mockData[name].push({ id, ...data });
                return Promise.resolve({ id });
            },
            doc: (id) => ({
                get: () => Promise.resolve({ exists: false }),
                update: () => Promise.resolve(),
                set: () => Promise.resolve()
            }),
            get: () => Promise.resolve({ docs: [], empty: true })
        })
    };
}

// Mock Auth for demo mode
function createMockAuth() {
    return {
        signInWithEmailAndPassword: (email, password) => {
            return Promise.resolve({
                user: {
                    uid: 'demo_user_' + Date.now(),
                    email: email,
                    displayName: email.includes('teacher') ? 'Demo Teacher' : 'Demo Student'
                }
            });
        },
        createUserWithEmailAndPassword: (email, password) => {
            return Promise.resolve({
                user: {
                    uid: 'demo_user_' + Date.now(),
                    email: email,
                    displayName: email.includes('teacher') ? 'Demo Teacher' : 'Demo Student'
                }
            });
        },
        signOut: () => Promise.resolve(),
        onAuthStateChanged: (callback) => {
            // Auto-login with demo user
            setTimeout(() => {
                callback({
                    uid: 'demo_user_' + Date.now(),
                    email: 'student@demo.com',
                    displayName: 'Demo Student'
                });
            }, 100);
            return () => {};
        }
    };
}

console.log('Firebase configuration loaded');
