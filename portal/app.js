// ========================================
// EXAM PORTAL - COMPLETE APPLICATION
// ========================================

// Application State
const AppState = {
    currentUser: null,
    currentPage: 'login',
    isFullscreen: false,
    quizInProgress: false,
    monitoringActive: false
};

// Quiz State with 3-Strike System
const QuizState = {
    currentQuestion: 0,
    answers: [],
    violations: [],
    violationCount: 0,
    maxViolations: 3,
    startTime: null,
    endTime: null,
    attemptNumber: 1,
    quizId: 'physics_basic_001',
    userId: null,
    isSubmitted: false,
    timer: null,
    timeRemaining: 900, // 15 minutes
    attemptId: null,
    isAutoSubmitted: false
};

// Demo Physics Quiz Questions
const physicsQuiz = {
    id: 'physics_basic_001',
    title: 'Basic Physics Quiz',
    duration: 900, // 15 minutes
    questions: [
        {
            id: 1,
            question: "What is the SI unit of force?",
            options: [
                "Newton",
                "Joule",
                "Watt",
                "Pascal"
            ],
            correctAnswer: 0
        },
        {
            id: 2,
            question: "Which of the following is a vector quantity?",
            options: [
                "Temperature",
                "Mass",
                "Velocity",
                "Energy"
            ],
            correctAnswer: 2
        },
        {
            id: 3,
            question: "What is the acceleration due to gravity on Earth?",
            options: [
                "8.9 m/s²",
                "9.8 m/s²",
                "10.8 m/s²",
                "11.8 m/s²"
            ],
            correctAnswer: 1
        },
        {
            id: 4,
            question: "Which law states that for every action there is an equal and opposite reaction?",
            options: [
                "Newton's First Law",
                "Newton's Second Law",
                "Newton's Third Law",
                "Law of Conservation of Energy"
            ],
            correctAnswer: 2
        },
        {
            id: 5,
            question: "What is the formula for kinetic energy?",
            options: [
                "mgh",
                "1/2 mv²",
                "mv",
                "ma"
            ],
            correctAnswer: 1
        },
        {
            id: 6,
            question: "Which of the following is not a fundamental unit?",
            options: [
                "Meter",
                "Kilogram",
                "Second",
                "Newton"
            ],
            correctAnswer: 3
        },
        {
            id: 7,
            question: "What is the unit of power?",
            options: [
                "Joule",
                "Watt",
                "Newton",
                "Pascal"
            ],
            correctAnswer: 1
        },
        {
            id: 8,
            question: "Which type of energy is stored in a compressed spring?",
            options: [
                "Kinetic Energy",
                "Potential Energy",
                "Thermal Energy",
                "Electrical Energy"
            ],
            correctAnswer: 1
        },
        {
            id: 9,
            question: "What is the speed of light in vacuum?",
            options: [
                "3×10^6 m/s",
                "3×10^7 m/s",
                "3×10^8 m/s",
                "3×10^9 m/s"
            ],
            correctAnswer: 2
        },
        {
            id: 10,
            question: "Which principle explains why ships float?",
            options: [
                "Pascal's Principle",
                "Archimedes' Principle",
                "Bernoulli's Principle",
                "Newton's Principle"
            ],
            correctAnswer: 1
        }
    ]
};

// Initialize Application
document.addEventListener('DOMContentLoaded', function() {
    initializeApp();
});

function initializeApp() {
    console.log('Initializing application...');

    // Setup event listeners first
    setupEventListeners();

    // Check authentication state
    if (auth && auth.onAuthStateChanged) {
        auth.onAuthStateChanged(user => {
            console.log('Auth state changed:', user ? user.email : 'No user');
            if (user) {
                AppState.currentUser = user;
                showDashboard(user);
            } else {
                AppState.currentUser = null;
                showPage('login');
            }
            hideLoadingScreen();
        });
    } else {
        // Fallback for demo mode
        console.log('Using demo mode - auto-login');
        setTimeout(() => {
            AppState.currentUser = {
                uid: 'demo_user',
                email: 'student@demo.com',
                displayName: 'Demo Student'
            };
            showDashboard(AppState.currentUser);
            hideLoadingScreen();
        }, 1000);
    }

    console.log('Application initialized');
}

function hideLoadingScreen() {
    const loadingScreen = document.getElementById('loadingScreen');
    loadingScreen.style.opacity = '0';
    setTimeout(() => {
        loadingScreen.style.display = 'none';
    }, 300);
}

function showPage(pageId) {
    console.log('Showing page:', pageId);

    // Hide all pages
    document.querySelectorAll('.page').forEach(page => {
        page.classList.remove('active');
        page.style.display = 'none';
    });

    // Show target page
    const targetPage = document.getElementById(pageId + 'Page');
    if (targetPage) {
        targetPage.style.display = 'block';
        targetPage.classList.add('active');
        AppState.currentPage = pageId;
        console.log('Page shown successfully:', pageId);
    } else {
        console.error('Page not found:', pageId + 'Page');
        // Fallback to login page
        const loginPage = document.getElementById('loginPage');
        if (loginPage) {
            loginPage.style.display = 'block';
            loginPage.classList.add('active');
            AppState.currentPage = 'login';
        }
    }
}

function setupEventListeners() {
    // Tab switching
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            const tab = this.dataset.tab;
            switchAuthTab(tab);
        });
    });

    // Form submissions
    document.getElementById('studentLoginForm').addEventListener('submit', handleStudentLogin);
    document.getElementById('teacherLoginForm').addEventListener('submit', handleTeacherLogin);
    document.getElementById('signupForm').addEventListener('submit', handleSignup);

    // Fullscreen change detection
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
    document.addEventListener('mozfullscreenchange', handleFullscreenChange);
    document.addEventListener('MSFullscreenChange', handleFullscreenChange);
}

function switchAuthTab(tab) {
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    document.querySelector(`[data-tab="${tab}"]`).classList.add('active');

    document.querySelectorAll('.auth-form').forEach(form => {
        form.classList.remove('active');
    });

    if (tab === 'student') {
        document.getElementById('studentLoginForm').classList.add('active');
    } else if (tab === 'teacher') {
        document.getElementById('teacherLoginForm').classList.add('active');
    } else if (tab === 'signup') {
        document.getElementById('signupForm').classList.add('active');
    }
}

// Authentication Functions
async function handleStudentLogin(e) {
    e.preventDefault();
    const email = document.getElementById('studentEmail').value;
    const password = document.getElementById('studentPassword').value;

    try {
        // For demo, create demo user
        await auth.signInWithEmailAndPassword(email, password);
        showToast('success', 'Login successful!');
    } catch (error) {
        // Create demo user if not exists
        try {
            await auth.createUserWithEmailAndPassword(email, password);
            showToast('success', 'Account created and logged in!');
        } catch (signupError) {
            showToast('error', 'Login failed: ' + error.message);
        }
    }
}

async function handleTeacherLogin(e) {
    e.preventDefault();
    const email = document.getElementById('teacherEmail').value;
    const password = document.getElementById('teacherPassword').value;

    try {
        await auth.signInWithEmailAndPassword(email, password);
        showToast('success', 'Teacher login successful!');
    } catch (error) {
        showToast('error', 'Login failed: ' + error.message);
    }
}

async function handleSignup(e) {
    e.preventDefault();
    const name = document.getElementById('signupName').value;
    const email = document.getElementById('signupEmail').value;
    const password = document.getElementById('signupPassword').value;
    const role = document.querySelector('input[name="role"]:checked').value;

    try {
        const result = await auth.createUserWithEmailAndPassword(email, password);
        // Update profile with name and role
        await result.user.updateProfile({
            displayName: name,
            customData: { role: role }
        });
        showToast('success', 'Account created successfully!');
    } catch (error) {
        showToast('error', 'Signup failed: ' + error.message);
    }
}

function showDashboard(user) {
    const role = user.displayName ? 'teacher' : 'student'; // Simple role detection

    if (role === 'teacher') {
        showPage('teacher');
        loadTeacherDashboard();
    } else {
        showPage('student');
        loadStudentDashboard();
    }
}

function loadStudentDashboard() {
    const user = AppState.currentUser;
    document.getElementById('studentName').textContent = user.displayName || user.email;
    document.getElementById('studentEmailDisplay').textContent = user.email;
    document.getElementById('studentAvatar').textContent = (user.displayName || user.email).charAt(0).toUpperCase();

    // Load student attempts
    loadStudentAttempts();
}

function loadTeacherDashboard() {
    const user = AppState.currentUser;
    document.getElementById('teacherName').textContent = user.displayName || user.email;
    document.getElementById('teacherEmailDisplay').textContent = user.email;
    document.getElementById('teacherAvatar').textContent = (user.displayName || user.email).charAt(0).toUpperCase();

    // Start real-time monitoring
    startTeacherMonitoring();
}

async function loadStudentAttempts() {
    const attemptsList = document.getElementById('studentAttemptsList');
    attemptsList.innerHTML = '<p>Loading attempts...</p>';

    try {
        const snapshot = await db.collection('attempts')
            .where('userId', '==', AppState.currentUser.uid)
            .orderBy('startTime', 'desc')
            .get();

        if (snapshot.empty) {
            attemptsList.innerHTML = '<p>No attempts yet. Start a quiz to see your attempts here.</p>';
            return;
        }

        attemptsList.innerHTML = snapshot.docs.map(doc => {
            const data = doc.data();
            const score = data.score || 0;
            const total = physicsQuiz.questions.length;
            const percentage = Math.round((score / total) * 100);

            return `
                <div class="attempt-item">
                    <div class="attempt-info">
                        <h4>Attempt ${data.attemptNumber || 1}</h4>
                        <p>${new Date(data.startTime?.toDate()).toLocaleDateString()} - Score: ${score}/${total} (${percentage}%)</p>
                        <p>Violations: ${data.violationCount || 0} | Status: ${data.status || 'Unknown'}</p>
                    </div>
                    <div class="attempt-stats">
                        <div class="attempt-stat">
                            <div class="attempt-stat-value">${score}/${total}</div>
                            <div class="attempt-stat-label">Score</div>
                        </div>
                        <div class="attempt-stat">
                            <div class="attempt-stat-value">${data.violationCount || 0}</div>
                            <div class="attempt-stat-label">Violations</div>
                        </div>
                    </div>
                </div>
            `;
        }).join('');
    } catch (error) {
        console.error('Error loading attempts:', error);
        attemptsList.innerHTML = '<p>Error loading attempts.</p>';
    }
}

function startTeacherMonitoring() {
    // Listen for active attempts
    db.collection('attempts')
        .where('status', '==', 'in_progress')
        .onSnapshot(snapshot => {
            updateLiveStudents(snapshot.docs);
            updateStats(snapshot.docs);
        });

    // Listen for violations
    db.collection('violations')
        .orderBy('timestamp', 'desc')
        .limit(20)
        .onSnapshot(snapshot => {
            updateActivityFeed(snapshot.docs);
        });
}

function updateLiveStudents(attempts) {
    const studentsGrid = document.getElementById('liveStudentsGrid');

    if (attempts.length === 0) {
        studentsGrid.innerHTML = '<p>No active students at the moment.</p>';
        return;
    }

    studentsGrid.innerHTML = attempts.map(doc => {
        const data = doc.data();
        const initials = data.userId ? data.userId.substring(0, 2).toUpperCase() : 'ST';
        const currentQ = data.currentQuestion ? data.currentQuestion + 1 : 1;

        return `
            <div class="student-card">
                <div class="student-info">
                    <div class="student-avatar">${initials}</div>
                    <div class="student-details">
                        <div class="student-name">Student ${data.userId ? data.userId.substring(0, 8) : 'Unknown'}</div>
                        <div class="student-email">Question ${currentQ} of ${physicsQuiz.questions.length}</div>
                    </div>
                </div>
                <div class="student-stats">
                    <div class="student-stat">
                        <div class="student-stat-value">${data.answers ? data.answers.filter(a => a !== null).length : 0}/${physicsQuiz.questions.length}</div>
                        <div class="attempt-stat-label">Answered</div>
                    </div>
                    <div class="student-stat ${data.violationCount > 0 ? 'violations' : ''}">
                        <div class="student-stat-value">${data.violationCount || 0}</div>
                        <div class="attempt-stat-label">Violations</div>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

function updateStats(attempts) {
    document.getElementById('activeStudentsCount').textContent = attempts.length;

    const totalViolations = attempts.reduce((sum, doc) => sum + (doc.data().violationCount || 0), 0);
    document.getElementById('violationsCount').textContent = totalViolations;

    // Calculate average score from completed attempts
    db.collection('attempts')
        .where('status', '==', 'completed')
        .get()
        .then(snapshot => {
            if (snapshot.empty) {
                document.getElementById('avgScoreCount').textContent = '0%';
                return;
            }

            const scores = snapshot.docs.map(doc => {
                const data = doc.data();
                return data.percentage || 0;
            });

            const avgScore = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
            document.getElementById('avgScoreCount').textContent = avgScore + '%';
        });

    document.getElementById('totalAttemptsCount').textContent = attempts.length;
}

function updateActivityFeed(violations) {
    const activityFeed = document.getElementById('teacherActivityFeed');

    if (violations.length === 0) {
        activityFeed.innerHTML = '<p>No recent activity.</p>';
        return;
    }

    activityFeed.innerHTML = violations.map(doc => {
        const violation = doc.data();
        const timeAgo = getTimeAgo(violation.timestamp.toDate());
        const questionNum = violation.questionNumber || 'Unknown';

        return `
            <div class="activity-item">
                <div class="activity-icon">!</div>
                <div class="activity-content">
                    <div class="activity-text">${getViolationMessage(violation)} at Q${questionNum}</div>
                    <div class="activity-time">${timeAgo}</div>
                </div>
            </div>
        `;
    }).join('');
}

function getViolationMessage(violation) {
    const messages = {
        'tab_switch': 'Student switched tab',
        'window_blur': 'Student lost focus',
        'fullscreen_exit': 'Student exited fullscreen',
        'copy_attempt': 'Copy attempt detected',
        'paste_attempt': 'Paste attempt detected',
        'cut_attempt': 'Cut attempt detected',
        'right_click': 'Right-click blocked',
        'keyboard_shortcut': 'Keyboard shortcut blocked'
    };

    return messages[violation.type] || 'Violation detected';
}

function getTimeAgo(date) {
    const seconds = Math.floor((new Date() - date) / 1000);

    if (seconds < 60) return 'Just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)} hours ago`;
    return `${Math.floor(seconds / 86400)} days ago`;
}

// Quiz Functions
async function startQuiz(quizId) {
    if (quizId !== 'physics_basic_001') {
        showToast('error', 'Quiz not found');
        return;
    }

    // Check if user is already in a quiz
    if (QuizState.quizInProgress) {
        showToast('warning', 'Quiz already in progress');
        return;
    }

    // Request fullscreen
    if (!document.fullscreenElement) {
        showFullscreenWarning();
        return;
    }

    // Initialize quiz
    QuizState.quizInProgress = true;
    QuizState.userId = AppState.currentUser.uid;
    QuizState.startTime = new Date();
    QuizState.answers = new Array(physicsQuiz.questions.length).fill(null);
    QuizState.violations = [];
    QuizState.violationCount = 0;
    QuizState.currentQuestion = 0;
    QuizState.isSubmitted = false;
    QuizState.timeRemaining = physicsQuiz.duration;

    // Load attempt number
    await loadAttemptNumber();

    // Create attempt in Firestore
    await createQuizAttempt();

    // Show quiz page
    showPage('quiz');

    // Load first question
    loadQuestion(0);

    // Initialize question palette
    initializeQuestionPalette();

    // Start timer
    startTimer();

    // Start monitoring
    startMonitoring();

    // Update UI
    document.getElementById('attemptNumber').textContent = QuizState.attemptNumber;
    document.getElementById('attemptTime').textContent = formatTime(new Date());
    document.getElementById('violationCount').textContent = 0;

    showToast('info', 'Quiz started! Fullscreen mode enforced.');
}

async function loadAttemptNumber() {
    try {
        const snapshot = await db.collection('attempts')
            .where('userId', '==', QuizState.userId)
            .where('quizId', '==', QuizState.quizId)
            .get();

        QuizState.attemptNumber = snapshot.size + 1;
    } catch (error) {
        console.error('Error loading attempt number:', error);
        QuizState.attemptNumber = 1;
    }
}

async function createQuizAttempt() {
    try {
        const attemptData = {
            userId: QuizState.userId,
            quizId: QuizState.quizId,
            attemptNumber: QuizState.attemptNumber,
            startTime: QuizState.startTime,
            answers: QuizState.answers,
            currentQuestion: QuizState.currentQuestion,
            violationCount: QuizState.violationCount,
            violations: QuizState.violations,
            status: 'in_progress',
            timeRemaining: QuizState.timeRemaining,
            isAutoSubmitted: false
        };

        const docRef = await db.collection('attempts').add(attemptData);
        QuizState.attemptId = docRef.id;

        console.log('Quiz attempt created:', docRef.id);
    } catch (error) {
        console.error('Error creating quiz attempt:', error);
        showToast('error', 'Failed to start quiz');
    }
}

function loadQuestion(index) {
    if (index < 0 || index >= physicsQuiz.questions.length) return;

    QuizState.currentQuestion = index;
    const question = physicsQuiz.questions[index];

    // Update question content
    const questionContent = document.getElementById('questionContent');
    questionContent.innerHTML = `
        <div class="question-text">${question.question}</div>
        <div class="options-list">
            ${question.options.map((option, i) => `
                <div class="option-item ${QuizState.answers[index] === i ? 'selected' : ''}"
                     onclick="selectOption(${i})" data-option="${i}">
                    <div class="option-indicator">${String.fromCharCode(65 + i)}</div>
                    <div class="option-text">${option}</div>
                </div>
            `).join('')}
        </div>
    `;

    // Update progress
    updateProgress();

    // Update question palette
    updateQuestionPalette();

    // Update navigation buttons
    updateNavigationButtons();

    // Update question counter
    document.getElementById('currentQuestion').textContent = index + 1;
    document.getElementById('totalQuestions').textContent = physicsQuiz.questions.length;

    // Save current question to Firestore
    saveCurrentQuestion();
}

function selectOption(optionIndex) {
    if (QuizState.isSubmitted) return;

    QuizState.answers[QuizState.currentQuestion] = optionIndex;

    // Update UI
    const optionItems = document.querySelectorAll('.option-item');
    optionItems.forEach(item => item.classList.remove('selected'));
    document.querySelector(`[data-option="${optionIndex}"]`).classList.add('selected');

    // Update palette
    updateQuestionPalette();

    // Save to Firestore
    saveAnswerToFirestore(QuizState.currentQuestion, optionIndex);
}

function nextQuestion() {
    if (QuizState.currentQuestion < physicsQuiz.questions.length - 1) {
        loadQuestion(QuizState.currentQuestion + 1);
    }
}

function previousQuestion() {
    if (QuizState.currentQuestion > 0) {
        loadQuestion(QuizState.currentQuestion - 1);
    }
}

function updateProgress() {
    const progress = ((QuizState.currentQuestion + 1) / physicsQuiz.questions.length) * 100;
    document.getElementById('progressFill').style.width = progress + '%';
}

function updateQuestionPalette() {
    const paletteItems = document.querySelectorAll('.palette-item');
    paletteItems.forEach((item, index) => {
        item.classList.remove('current', 'answered');
        if (index === QuizState.currentQuestion) {
            item.classList.add('current');
        } else if (QuizState.answers[index] !== null) {
            item.classList.add('answered');
        }
    });
}

function initializeQuestionPalette() {
    const paletteGrid = document.getElementById('questionPalette');
    paletteGrid.innerHTML = physicsQuiz.questions.map((_, index) => `
        <div class="palette-item" onclick="loadQuestion(${index})">${index + 1}</div>
    `).join('');
}

function updateNavigationButtons() {
    const prevBtn = document.getElementById('prevBtn');
    const nextBtn = document.getElementById('nextBtn');
    const submitBtn = document.getElementById('submitBtn');

    prevBtn.style.display = QuizState.currentQuestion === 0 ? 'none' : 'flex';
    nextBtn.style.display = QuizState.currentQuestion === physicsQuiz.questions.length - 1 ? 'none' : 'flex';
    submitBtn.style.display = QuizState.currentQuestion === physicsQuiz.questions.length - 1 ? 'flex' : 'none';
}

function startTimer() {
    QuizState.timer = setInterval(() => {
        QuizState.timeRemaining--;

        const minutes = Math.floor(QuizState.timeRemaining / 60);
        const seconds = QuizState.timeRemaining % 60;
        document.getElementById('timeRemaining').textContent =
            `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;

        if (QuizState.timeRemaining <= 0) {
            clearInterval(QuizState.timer);
            autoSubmitQuiz('Time expired');
        }
    }, 1000);
}

async function submitQuiz() {
    if (QuizState.isSubmitted) return;

    QuizState.isSubmitted = true;
    QuizState.endTime = new Date();
    clearInterval(QuizState.timer);

    // Calculate score
    let correctCount = 0;
    physicsQuiz.questions.forEach((question, index) => {
        if (QuizState.answers[index] === question.correctAnswer) {
            correctCount++;
        }
    });

    const score = correctCount;
    const percentage = Math.round((score / physicsQuiz.questions.length) * 100);

    // Save to Firestore
    await saveQuizResult(score, percentage);

    // Show results
    showResults(score, percentage);

    // Stop monitoring
    stopMonitoring();

    QuizState.quizInProgress = false;
}

async function autoSubmitQuiz(reason) {
    QuizState.isSubmitted = true;
    QuizState.endTime = new Date();
    QuizState.isAutoSubmitted = true;
    clearInterval(QuizState.timer);

    // Calculate score
    let correctCount = 0;
    physicsQuiz.questions.forEach((question, index) => {
        if (QuizState.answers[index] === question.correctAnswer) {
            correctCount++;
        }
    });

    const score = correctCount;
    const percentage = Math.round((score / physicsQuiz.questions.length) * 100);

    // Save to Firestore
    await saveQuizResult(score, percentage);

    // Show results
    showResults(score, percentage);

    // Stop monitoring
    stopMonitoring();

    QuizState.quizInProgress = false;

    showToast('warning', `Quiz auto-submitted: ${reason}`);
}

function showResults(score, percentage) {
    // Hide quiz, show results
    showPage('result');

    // Update result display
    document.getElementById('finalScore').textContent = `${score}/${physicsQuiz.questions.length}`;
    document.getElementById('scorePercentage').textContent = `${percentage}%`;
    document.getElementById('correctAnswers').textContent = score;
    document.getElementById('incorrectAnswers').textContent = physicsQuiz.questions.length - score;
    document.getElementById('finalViolations').textContent = QuizState.violationCount;

    const timeTaken = Math.floor((QuizState.endTime - QuizState.startTime) / 1000);
    const minutes = Math.floor(timeTaken / 60);
    const seconds = timeTaken % 60;
    document.getElementById('timeTaken').textContent =
        `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;

    // Update quiz status
    let status = 'Completed';
    if (QuizState.isAutoSubmitted) {
        if (QuizState.violationCount >= QuizState.maxViolations) {
            status = 'Auto-submitted (3 violations)';
        } else {
            status = 'Auto-submitted (Time expired)';
        }
    }
    document.getElementById('quizStatus').textContent = status;
}

function retakeQuiz() {
    // Reset state
    QuizState.currentQuestion = 0;
    QuizState.answers = [];
    QuizState.violations = [];
    QuizState.violationCount = 0;
    QuizState.startTime = new Date();
    QuizState.endTime = null;
    QuizState.isSubmitted = false;
    QuizState.isAutoSubmitted = false;
    QuizState.timeRemaining = physicsQuiz.duration;
    QuizState.attemptNumber++;

    // Restart quiz
    startQuiz('physics_basic_001');
}

function goToDashboard() {
    showDashboard(AppState.currentUser);
}

function exitQuiz() {
    if (QuizState.quizInProgress && !QuizState.isSubmitted) {
        const confirmed = confirm('Are you sure you want to exit the quiz? Your progress will be lost.');
        if (confirmed) {
            stopMonitoring();
            QuizState.quizInProgress = false;
            showDashboard(AppState.currentUser);
        }
    } else {
        showDashboard(AppState.currentUser);
    }
}

// ========================================
// STRICT EXAM MONITORING SYSTEM
// ========================================

function startMonitoring() {
    if (QuizState.monitoringActive) return;

    QuizState.monitoringActive = true;
    console.log('Starting strict exam monitoring...');

    // Tab switching detection
    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Window focus/blur detection
    window.addEventListener('blur', handleWindowBlur);
    window.addEventListener('focus', handleWindowFocus);

    // Copy/paste detection
    document.addEventListener('copy', handleCopyAttempt);
    document.addEventListener('paste', handlePasteAttempt);
    document.addEventListener('cut', handleCutAttempt);

    // Right-click disable
    document.addEventListener('contextmenu', handleContextMenu);

    // Keyboard shortcuts
    document.addEventListener('keydown', handleKeyboardShortcuts);

    // Fullscreen monitoring
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
    document.addEventListener('mozfullscreenchange', handleFullscreenChange);
    document.addEventListener('MSFullscreenChange', handleFullscreenChange);
}

function stopMonitoring() {
    QuizState.monitoringActive = false;
    console.log('Stopping exam monitoring...');

    document.removeEventListener('visibilitychange', handleVisibilityChange);
    window.removeEventListener('blur', handleWindowBlur);
    window.removeEventListener('focus', handleWindowFocus);
    document.removeEventListener('copy', handleCopyAttempt);
    document.removeEventListener('paste', handlePasteAttempt);
    document.removeEventListener('cut', handleCutAttempt);
    document.removeEventListener('contextmenu', handleContextMenu);
    document.removeEventListener('keydown', handleKeyboardShortcuts);
    document.removeEventListener('fullscreenchange', handleFullscreenChange);
    document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
    document.removeEventListener('mozfullscreenchange', handleFullscreenChange);
    document.removeEventListener('MSFullscreenChange', handleFullscreenChange);
}

function handleVisibilityChange() {
    if (document.hidden && QuizState.quizInProgress && !QuizState.isSubmitted) {
        recordViolation('tab_switch', 'User switched to another tab');
    }
}

function handleWindowBlur() {
    if (QuizState.quizInProgress && !QuizState.isSubmitted) {
        recordViolation('window_blur', 'User lost focus on quiz window');
    }
}

function handleWindowFocus() {
    // User returned to quiz window
    console.log('User returned to quiz window');
}

function handleCopyAttempt(e) {
    if (QuizState.quizInProgress && !QuizState.isSubmitted) {
        e.preventDefault();
        recordViolation('copy_attempt', 'User attempted to copy content');
    }
}

function handlePasteAttempt(e) {
    if (QuizState.quizInProgress && !QuizState.isSubmitted) {
        e.preventDefault();
        recordViolation('paste_attempt', 'User attempted to paste content');
    }
}

function handleCutAttempt(e) {
    if (QuizState.quizInProgress && !QuizState.isSubmitted) {
        e.preventDefault();
        recordViolation('cut_attempt', 'User attempted to cut content');
    }
}

function handleContextMenu(e) {
    if (QuizState.quizInProgress && !QuizState.isSubmitted) {
        e.preventDefault();
        recordViolation('right_click', 'User attempted to right-click');
    }
}

function handleKeyboardShortcuts(e) {
    if (!QuizState.quizInProgress || QuizState.isSubmitted) return;

    // Prevent common shortcuts
    const key = e.key;
    const ctrl = e.ctrlKey;
    const shift = e.shiftKey;

    if (key === 'F12' ||
        (ctrl && shift && (key === 'I' || key === 'J' || key === 'C' || key === 'D')) ||
        (ctrl && key === 'u') ||
        (ctrl && key === 'c' && e.shiftKey) ||
        (ctrl && key === 'r')) {
        e.preventDefault();
        recordViolation('keyboard_shortcut', `User attempted blocked shortcut: ${key}`);
    }
}

function handleFullscreenChange() {
    const isFullscreen = !!(document.fullscreenElement || document.webkitFullscreenElement ||
                          document.mozFullScreenElement || document.msFullscreenElement);

    AppState.isFullscreen = isFullscreen;

    if (QuizState.quizInProgress && !QuizState.isSubmitted && !isFullscreen) {
        recordViolation('fullscreen_exit', 'User exited fullscreen mode');
    }
}

function recordViolation(type, message) {
    if (QuizState.isSubmitted) return;

    const violation = {
        type: type,
        message: message,
        timestamp: new Date(),
        questionNumber: QuizState.currentQuestion + 1,
        timeRemaining: QuizState.timeRemaining
    };

    QuizState.violations.push(violation);
    QuizState.violationCount++;

    // Update UI
    document.getElementById('violationCount').textContent = QuizState.violationCount;

    // Show warning
    showViolationWarning(message, QuizState.violationCount);

    // Play sound
    playViolationSound();

    // Save to Firestore
    saveViolationToFirestore(violation);

    // Check for auto-submit (3 strikes)
    if (QuizState.violationCount >= QuizState.maxViolations) {
        autoSubmitQuiz('Maximum violations reached (3)');
    }

    console.log('Violation recorded:', violation);
}

function showViolationWarning(message, strikeNumber) {
    const warning = document.getElementById('violationWarning');
    document.getElementById('violationMessage').textContent = message;
    document.getElementById('currentStrike').textContent = strikeNumber;

    warning.classList.add('show');

    // Auto-hide after 4 seconds
    setTimeout(() => {
        warning.classList.remove('show');
    }, 4000);
}

function closeViolationWarning() {
    document.getElementById('violationWarning').classList.remove('show');
}

function showFullscreenWarning() {
    const warning = document.getElementById('fullscreenWarning');
    warning.classList.add('show');
}

function closeFullscreenWarning() {
    document.getElementById('fullscreenWarning').classList.remove('show');
}

function requestFullscreen() {
    const elem = document.documentElement;

    if (elem.requestFullscreen) {
        elem.requestFullscreen();
    } else if (elem.webkitRequestFullscreen) {
        elem.webkitRequestFullscreen();
    } else if (elem.msRequestFullscreen) {
        elem.msRequestFullscreen();
    }

    closeFullscreenWarning();

    // Start quiz after fullscreen
    setTimeout(() => {
        startQuiz('physics_basic_001');
    }, 500);
}

function playViolationSound() {
    // Create a simple beep sound
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);

    oscillator.frequency.value = 800;
    oscillator.type = 'sine';

    gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.2);

    oscillator.start(audioContext.currentTime);
    oscillator.stop(audioContext.currentTime + 0.2);
}

// ========================================
// FIRESTORE INTEGRATION
// ========================================

async function saveAnswerToFirestore(questionIndex, answer) {
    if (!QuizState.attemptId) return;

    try {
        await db.collection('attempts').doc(QuizState.attemptId).update({
            [`answers.${questionIndex}`]: answer,
            lastActivity: new Date()
        });
    } catch (error) {
        console.error('Error saving answer:', error);
    }
}

async function saveCurrentQuestion() {
    if (!QuizState.attemptId) return;

    try {
        await db.collection('attempts').doc(QuizState.attemptId).update({
            currentQuestion: QuizState.currentQuestion,
            lastActivity: new Date()
        });
    } catch (error) {
        console.error('Error saving current question:', error);
    }
}

async function saveViolationToFirestore(violation) {
    try {
        // Save to violations collection
        await db.collection('violations').add({
            userId: QuizState.userId,
            quizId: QuizState.quizId,
            attemptId: QuizState.attemptId,
            ...violation
        });

        // Update attempt
        if (QuizState.attemptId) {
            await db.collection('attempts').doc(QuizState.attemptId).update({
                violationCount: QuizState.violationCount,
                violations: QuizState.violations,
                lastActivity: new Date()
            });
        }
    } catch (error) {
        console.error('Error saving violation:', error);
    }
}

async function saveQuizResult(score, percentage) {
    if (!QuizState.attemptId) return;

    try {
        await db.collection('attempts').doc(QuizState.attemptId).update({
            score: score,
            percentage: percentage,
            endTime: QuizState.endTime,
            status: 'completed',
            timeTaken: Math.floor((QuizState.endTime - QuizState.startTime) / 1000),
            violationCount: QuizState.violationCount,
            violations: QuizState.violations,
            isAutoSubmitted: QuizState.isAutoSubmitted,
            finalQuestion: QuizState.currentQuestion
        });

        console.log('Quiz result saved');
    } catch (error) {
        console.error('Error saving quiz result:', error);
    }
}

// ========================================
// UTILITY FUNCTIONS
// ========================================

function logout() {
    auth.signOut().then(() => {
        showToast('info', 'Logged out successfully');
        showPage('login');
    }).catch(error => {
        showToast('error', 'Logout failed: ' + error.message);
    });
}

function showToast(message, type = 'info') {
    const toastContainer = document.getElementById('toastContainer');

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
        <div class="toast-icon">${type.charAt(0).toUpperCase()}</div>
        <div class="toast-message">${message}</div>
    `;

    toastContainer.appendChild(toast);

    // Auto-remove after 5 seconds
    setTimeout(() => {
        toast.style.animation = 'slideOut 0.3s ease';
        setTimeout(() => {
            toastContainer.removeChild(toast);
        }, 300);
    }, 5000);
}

function formatTime(date) {
    return date.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit'
    });
}

// Export for global access
window.startQuiz = startQuiz;
window.selectOption = selectOption;
window.nextQuestion = nextQuestion;
window.previousQuestion = previousQuestion;
window.submitQuiz = submitQuiz;
window.retakeQuiz = retakeQuiz;
window.goToDashboard = goToDashboard;
window.exitQuiz = exitQuiz;
window.requestFullscreen = requestFullscreen;
window.closeFullscreenWarning = closeFullscreenWarning;
window.closeViolationWarning = closeViolationWarning;
window.logout = logout;
window.showToast = showToast;

console.log('Exam Portal application loaded successfully');
