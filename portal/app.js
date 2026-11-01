// ========================================
// EXAM PORTAL - COMPLETE APPLICATION
// ========================================

// Application State
const AppState = {
    currentUser: null,
    currentPage: 'login',
    isFullscreen: false,
    quizInProgress: false,
    monitoringActive: false,
    backendToken: null,
    backendRole: null,
    backendSocket: null,
    backendActivities: [],
    socketActivities: [],
    monitoringAttempts: [],
    teacherBatches: [],
    selectedBatchId: null,
    batchInviteUrl: null
};
let questionOptionFieldSequence = 0;
let lastScreenshotShortcutAt = 0;

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
    questions: [],
    quizTitle: '',
    pendingQuizId: null,
    isAutoSubmitted: false,
    statusPollTimer: null,
    statusCheckPending: false
};

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, character => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[character]));
}

async function backendRequest(path, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';
    if (AppState.backendToken) headers.Authorization = `Bearer ${AppState.backendToken}`;
    let response;
    try {
        response = await fetch(`${window.QIG_BACKEND_URL}${path}`, { ...options, headers });
    } catch (error) {
        throw new Error('Backend is unreachable. Check that the backend server is running.');
    }
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
        const error = new Error(payload.error || `Request failed (${response.status}).`);
        error.status = response.status;
        error.payload = payload;
        throw error;
    }
    return payload;
}

// Initialize Application
document.addEventListener('DOMContentLoaded', function() {
    initializeApp();
});

async function initializeApp() {
    setupEventListeners();
    const inviteCodeFromLink = new URLSearchParams(window.location.search).get('join');
    if (/^[a-f0-9]{64}$/i.test(inviteCodeFromLink || '')) {
        sessionStorage.setItem('qigPendingBatchInviteCode', inviteCodeFromLink.toLowerCase());
    }
    AppState.backendToken = sessionStorage.getItem('qigBackendToken');
    try {
        if (AppState.backendToken) {
            const { user } = await backendRequest('/api/auth/me');
            AppState.currentUser = user;
            AppState.backendRole = user.role;
            showDashboard(user);
        } else {
            showPage('login');
        }
    } catch (error) {
        clearBackendSession();
        AppState.currentUser = null;
        showPage('login');
        if (error.status !== 401) showToast('error', error.message);
    } finally {
        hideLoadingScreen();
    }
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
    const pageElementIds = {
        login: 'loginPage',
        student: 'studentDashboard',
        teacher: 'teacherDashboard',
        quiz: 'quizPage',
        result: 'resultPage'
    };
    const targetPage = document.getElementById(pageElementIds[pageId]);
    if (targetPage) {
        targetPage.classList.remove('hidden');
        targetPage.style.display = 'block';
        targetPage.classList.add('active');
        AppState.currentPage = pageId;
        console.log('Page shown successfully:', pageId);
    } else {
        console.error('Page not found:', pageElementIds[pageId] || pageId);
        // Fallback to login page
        const loginPage = document.getElementById('loginPage');
        if (loginPage) {
            loginPage.classList.remove('hidden');
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
    document.getElementById('createBatchForm').addEventListener('submit', handleCreateBatch);
    document.getElementById('batchList').addEventListener('click', event => {
        const button = event.target.closest('[data-view-batch]');
        if (button) openBatchDetails(button.dataset.viewBatch);
    });
    document.getElementById('addBatchStudentForm').addEventListener('submit', handleAddBatchStudent);
    document.getElementById('batchStudentList').addEventListener('click', event => {
        const button = event.target.closest('[data-remove-batch-student]');
        if (button) removeBatchStudent(button.dataset.removeBatchStudent);
    });
    document.getElementById('createBatchInvite').addEventListener('click', createBatchInviteLink);
    document.getElementById('revokeBatchInvite').addEventListener('click', revokeBatchInviteLink);
    document.getElementById('batchInviteOutput').addEventListener('click', event => {
        if (event.target.closest('[data-copy-batch-invite]')) copyBatchInviteLink();
    });
    document.getElementById('batchJoinRequests').addEventListener('click', event => {
        const button = event.target.closest('[data-batch-request-decision]');
        if (button) reviewBatchJoinRequest(button.dataset.requestId, button.dataset.batchRequestDecision);
    });
    document.getElementById('studentBatchJoinForm').addEventListener('submit', handleStudentBatchJoinRequest);
    document.getElementById('closeBatchDetail').addEventListener('click', () => {
        AppState.selectedBatchId = null;
        document.getElementById('batchDetailPanel').classList.add('hidden');
    });
    document.getElementById('createQuizForm').addEventListener('submit', handleCreateQuiz);
    document.getElementById('addQuestionForm').addEventListener('submit', handleAddQuestion);
    document.getElementById('addQuestionOption').addEventListener('click', () => addQuestionOptionRow());
    document.getElementById('teacherQuizList').addEventListener('click', handleTeacherQuizAction);
    document.getElementById('attemptSearch').addEventListener('input', renderMonitoringTable);
    document.getElementById('attemptStatusFilter').addEventListener('change', renderMonitoringTable);
    document.getElementById('monitoringTableBody').addEventListener('click', event => {
        const button = event.target.closest('[data-attempt-detail]');
        if (button) loadTeacherAttemptDetail(button.dataset.attemptDetail);
    });
    document.getElementById('closeAttemptDetail').addEventListener('click', () => document.getElementById('attemptDetailPanel').classList.add('hidden'));
    initializeQuestionOptions();

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
    const email = document.getElementById('studentEmail').value.trim();
    const password = document.getElementById('studentPassword').value;
    try {
        const data = await backendRequest('/api/auth/login', {
            method: 'POST', body: JSON.stringify({ email, password })
        });
        if (data.user.role !== 'student') throw new Error('Use Teacher Login for a teacher account.');
        setBackendSession(data);
        document.getElementById('studentPassword').value = '';
        showToast('success', 'Student login successful.');
    } catch (error) {
        showToast('error', 'Login failed: ' + error.message);
    }
}

function setBackendSession(data) {
    AppState.backendToken = data.token;
    AppState.backendRole = data.user.role;
    AppState.currentUser = data.user;
    sessionStorage.setItem('qigBackendToken', data.token);
    sessionStorage.setItem('qigBackendRole', data.user.role);
    showDashboard(data.user);
}

function clearBackendSession() {
    if (AppState.backendSocket) {
        AppState.backendSocket.disconnect();
        AppState.backendSocket = null;
    }
    sessionStorage.removeItem('qigBackendToken');
    sessionStorage.removeItem('qigBackendRole');
    AppState.backendToken = null;
    AppState.backendRole = null;
    AppState.currentUser = null;
}

async function handleTeacherLogin(e) {
    e.preventDefault();
    const email = document.getElementById('teacherEmail').value.trim();
    const password = document.getElementById('teacherPassword').value;
    try {
        const data = await backendRequest('/api/auth/login', {
            method: 'POST', body: JSON.stringify({ email, password })
        });
        if (data.user.role !== 'teacher') throw new Error('This account is not a teacher account.');
        setBackendSession(data);
        document.getElementById('teacherPassword').value = '';
        showToast('success', 'Teacher login successful.');
    } catch (error) {
        clearBackendSession();
        showToast('error', 'Teacher login failed: ' + error.message);
    }
}

async function handleSignup(e) {
    e.preventDefault();
    const name = document.getElementById('signupName').value.trim();
    const email = document.getElementById('signupEmail').value.trim();
    const password = document.getElementById('signupPassword').value;
    try {
        const data = await backendRequest('/api/auth/register', {
            method: 'POST', body: JSON.stringify({ name, email, password })
        });
        setBackendSession(data);
        document.getElementById('signupPassword').value = '';
        showToast('success', 'Student account created.');
    } catch (error) {
        showToast('error', 'Sign-up failed: ' + error.message);
    }
}

function showDashboard(user) {
    const role = user.role || AppState.backendRole;
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
    const name = user.name || user.email;
    document.getElementById('studentName').textContent = name;
    document.getElementById('studentEmailDisplay').textContent = user.email;
    document.getElementById('studentAvatar').textContent = name.charAt(0).toUpperCase();
    const pendingInviteCode = sessionStorage.getItem('qigPendingBatchInviteCode');
    if (pendingInviteCode) document.getElementById('studentBatchInviteCode').value = pendingInviteCode;
    loadAvailableQuizzes();
    loadStudentAttempts();
    loadStudentBatchJoinRequests();
}

async function loadTeacherDashboard() {
    const user = AppState.currentUser;
    const name = user.name || user.email;
    document.getElementById('teacherName').textContent = name;
    document.getElementById('teacherEmailDisplay').textContent = user.email;
    document.getElementById('teacherAvatar').textContent = name.charAt(0).toUpperCase();
    await loadTeacherBatches();
    await loadTeacherQuizzes();
    startTeacherMonitoring();
}

async function loadTeacherBatches() {
    const list = document.getElementById('batchList');
    list.innerHTML = '<p>Loading batches…</p>';
    try {
        const { batches } = await backendRequest('/api/batches');
        AppState.teacherBatches = batches;
        if (!batches.length) {
            list.innerHTML = '<p class="empty-state">No batches yet. Create one to organize students.</p>';
            AppState.selectedBatchId = null;
            document.getElementById('batchDetailPanel').classList.add('hidden');
            return;
        }
        if (AppState.selectedBatchId && !batches.some(batch => String(batch.id) === String(AppState.selectedBatchId))) {
            AppState.selectedBatchId = null;
            document.getElementById('batchDetailPanel').classList.add('hidden');
        }
        list.innerHTML = batches.map(batch => `
            <article class="batch-card">
                <div><h3>${escapeHtml(batch.name)}</h3><p>${Number(batch.membership_count)} ${Number(batch.membership_count) === 1 ? 'student' : 'students'} · ${Number(batch.pending_count || 0)} pending requests</p></div>
                <button type="button" class="btn btn-outline btn-small" data-view-batch="${Number(batch.id)}">View students</button>
            </article>
        `).join('');
    } catch (error) {
        list.innerHTML = `<p class="error-text">Could not load batches: ${escapeHtml(error.message)}</p>`;
    }
}

async function handleCreateBatch(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('[type="submit"]');
    const originalText = button.textContent;
    button.disabled = true;
    button.textContent = 'Creating…';
    try {
        await backendRequest('/api/batches', {
            method: 'POST',
            body: JSON.stringify({ name: document.getElementById('newBatchName').value.trim() })
        });
        form.reset();
        await loadTeacherBatches();
        showToast('success', 'Batch created. Add registered students from the batch list.');
    } catch (error) {
        showToast('error', 'Could not create batch: ' + error.message);
    } finally {
        button.disabled = false;
        button.textContent = originalText;
    }
}

async function openBatchDetails(batchId) {
    AppState.selectedBatchId = String(batchId);
    AppState.batchInviteUrl = null;
    document.getElementById('batchInviteOutput').innerHTML = '';
    const panel = document.getElementById('batchDetailPanel');
    const list = document.getElementById('batchStudentList');
    panel.classList.remove('hidden');
    list.innerHTML = '<p>Loading students…</p>';
    panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    try {
        await refreshBatchDetails();
    } catch (error) {
        list.innerHTML = `<p class="error-text">Could not load students: ${escapeHtml(error.message)}</p>`;
    }
}

async function refreshBatchDetails() {
    if (!AppState.selectedBatchId) return;
    const [data, requestData] = await Promise.all([
        backendRequest(`/api/batches/${encodeURIComponent(AppState.selectedBatchId)}/students`),
        backendRequest(`/api/batches/${encodeURIComponent(AppState.selectedBatchId)}/join-requests`)
    ]);
    document.getElementById('batchDetailTitle').textContent = `${data.batch.name} · ${Number(data.batch.membership_count)} students`;
    const list = document.getElementById('batchStudentList');
    list.innerHTML = data.students.length ? data.students.map(student => `
        <div class="batch-student-row">
            <div><strong>${escapeHtml(student.name)}</strong><span>${escapeHtml(student.email)} · Student ID ${Number(student.id)}</span></div>
            <button type="button" class="btn btn-outline btn-small" data-remove-batch-student="${Number(student.id)}">Remove</button>
        </div>
    `).join('') : '<p class="empty-state">This batch has no students yet.</p>';
    const requestList = document.getElementById('batchJoinRequests');
    requestList.innerHTML = requestData.requests.length ? requestData.requests.map(request => `
        <article class="batch-request-row">
            <div><strong>${escapeHtml(request.student_name)}</strong><span>${escapeHtml(request.student_email)} · Requested ${escapeHtml(new Date(request.requested_at).toLocaleString())}</span></div>
            <div class="batch-request-actions"><button type="button" class="btn btn-primary btn-small" data-request-id="${Number(request.id)}" data-batch-request-decision="approved">Approve</button><button type="button" class="btn btn-outline btn-small" data-request-id="${Number(request.id)}" data-batch-request-decision="rejected">Reject</button></div>
        </article>
    `).join('') : '<p class="empty-state">No students are waiting for approval.</p>';
}

async function createBatchInviteLink() {
    if (!AppState.selectedBatchId) return showToast('error', 'Choose a batch first.');
    const button = document.getElementById('createBatchInvite');
    button.disabled = true;
    try {
        const { invite } = await backendRequest(`/api/batches/${encodeURIComponent(AppState.selectedBatchId)}/invite`, { method: 'POST' });
        const inviteUrl = new URL(window.location.href);
        inviteUrl.hash = '';
        inviteUrl.searchParams.delete('qigReload');
        inviteUrl.searchParams.set('join', invite.code);
        AppState.batchInviteUrl = inviteUrl.toString();
        document.getElementById('batchInviteOutput').innerHTML = `
            <label for="batchInviteLink">Share this link (expires ${escapeHtml(new Date(invite.expires_at).toLocaleString())})</label>
            <div class="batch-invite-link-row"><input id="batchInviteLink" type="text" readonly value="${escapeHtml(AppState.batchInviteUrl)}"><button type="button" class="btn btn-outline" data-copy-batch-invite>Copy link</button></div>
        `;
        showToast('success', 'Invite link created. Anyone with this link can request entry until it expires or you revoke it.');
        await loadTeacherBatches();
    } catch (error) {
        showToast('error', 'Could not create invite link: ' + error.message);
    } finally {
        button.disabled = false;
    }
}

async function copyBatchInviteLink() {
    const input = document.getElementById('batchInviteLink');
    if (!input || !AppState.batchInviteUrl) return;
    try {
        await navigator.clipboard.writeText(AppState.batchInviteUrl);
    } catch (_) {
        input.focus();
        input.select();
        document.execCommand('copy');
    }
    showToast('success', 'Invite link copied.');
}

async function revokeBatchInviteLink() {
    if (!AppState.selectedBatchId || !confirm('Revoke the current invite link? Students will no longer be able to use it.')) return;
    try {
        await backendRequest(`/api/batches/${encodeURIComponent(AppState.selectedBatchId)}/invite`, { method: 'DELETE' });
        AppState.batchInviteUrl = null;
        document.getElementById('batchInviteOutput').innerHTML = '<p class="empty-state">Invite link revoked.</p>';
        await loadTeacherBatches();
        showToast('success', 'Invite link revoked. Pending requests remain available for review.');
    } catch (error) {
        showToast('error', 'Could not revoke invite link: ' + error.message);
    }
}

async function reviewBatchJoinRequest(requestId, decision) {
    if (!AppState.selectedBatchId || !['approved', 'rejected'].includes(decision)) return;
    try {
        const result = await backendRequest(`/api/batches/${encodeURIComponent(AppState.selectedBatchId)}/join-requests/${encodeURIComponent(requestId)}/decision`, {
            method: 'POST', body: JSON.stringify({ decision })
        });
        await Promise.all([refreshBatchDetails(), loadTeacherBatches()]);
        showToast('success', decision === 'approved'
            ? (result.membership_added ? 'Student approved and added to the batch.' : 'Request approved; student was already a batch member.')
            : 'Join request rejected.');
    } catch (error) {
        showToast('error', `Could not ${decision === 'approved' ? 'approve' : 'reject'} request: ` + error.message);
    }
}

function inviteCodeFromInput(value) {
    const input = String(value || '').trim();
    try {
        const url = new URL(input);
        return url.searchParams.get('join') || url.searchParams.get('code') || input;
    } catch (_) {
        return input;
    }
}

async function handleStudentBatchJoinRequest(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('[type="submit"]');
    const code = inviteCodeFromInput(document.getElementById('studentBatchInviteCode').value);
    button.disabled = true;
    try {
        const { request } = await backendRequest('/api/batches/join-requests', {
            method: 'POST', body: JSON.stringify({ code })
        });
        form.reset();
        sessionStorage.removeItem('qigPendingBatchInviteCode');
        const currentUrl = new URL(window.location.href);
        currentUrl.searchParams.delete('join');
        window.history.replaceState({}, '', currentUrl.toString());
        await loadStudentBatchJoinRequests();
        showToast('success', `Join request sent for ${request.batch_name}. A teacher must approve it.`);
    } catch (error) {
        showToast('error', 'Could not request to join: ' + error.message);
    } finally {
        button.disabled = false;
    }
}

async function loadStudentBatchJoinRequests() {
    const list = document.getElementById('studentBatchRequests');
    list.innerHTML = '<p>Loading your batch requests…</p>';
    try {
        const { requests } = await backendRequest('/api/batches/my-join-requests');
        list.innerHTML = requests.length ? requests.map(request => `
            <article class="student-batch-request-row"><div><strong>${escapeHtml(request.batch_name)}</strong><span>Requested ${escapeHtml(new Date(request.requested_at).toLocaleString())}</span></div><span class="batch-request-status batch-request-status--${escapeHtml(request.status)}">${escapeHtml(request.status)}</span></article>
        `).join('') : '<p class="empty-state">You have not requested to join any batches yet.</p>';
    } catch (error) {
        list.innerHTML = `<p class="error-text">Could not load your batch requests: ${escapeHtml(error.message)}</p>`;
    }
}

async function handleAddBatchStudent(event) {
    event.preventDefault();
    if (!AppState.selectedBatchId) return showToast('error', 'Choose a batch first.');
    const form = event.currentTarget;
    const button = form.querySelector('[type="submit"]');
    const identifier = document.getElementById('batchStudentIdentifier').value.trim();
    const body = /^[1-9]\d*$/.test(identifier) ? { student_id: Number(identifier) } : { email: identifier };
    button.disabled = true;
    try {
        await backendRequest(`/api/batches/${encodeURIComponent(AppState.selectedBatchId)}/students`, {
            method: 'POST', body: JSON.stringify(body)
        });
        form.reset();
        await Promise.all([refreshBatchDetails(), loadTeacherBatches()]);
        showToast('success', 'Student added to the batch.');
    } catch (error) {
        showToast('error', 'Could not add student: ' + error.message);
    } finally {
        button.disabled = false;
    }
}

async function removeBatchStudent(studentId) {
    if (!AppState.selectedBatchId || !confirm('Remove this student from the batch?')) return;
    try {
        await backendRequest(`/api/batches/${encodeURIComponent(AppState.selectedBatchId)}/students/${encodeURIComponent(studentId)}`, { method: 'DELETE' });
        await Promise.all([refreshBatchDetails(), loadTeacherBatches()]);
        showToast('success', 'Student removed from the batch.');
    } catch (error) {
        showToast('error', 'Could not remove student: ' + error.message);
    }
}

async function loadAvailableQuizzes() {
    const list = document.getElementById('studentQuizGrid');
    list.innerHTML = '<p>Loading available quizzes…</p>';
    try {
        const { quizzes } = await backendRequest('/api/quizzes');
        if (!quizzes.length) {
            list.innerHTML = '<p>No active quizzes are available right now.</p>';
            return;
        }
        list.innerHTML = quizzes.map(quiz => `
            <div class="quiz-card">
                <div class="quiz-icon">${escapeHtml((quiz.title || 'Q').charAt(0).toUpperCase())}</div>
                <h3>${escapeHtml(quiz.title)}</h3>
                <p>${escapeHtml(quiz.description || '')}</p>
                <div class="quiz-meta">
                    <span class="quiz-duration">${Number(quiz.duration_minutes)} minutes</span>
                    <span class="quiz-questions">${Number(quiz.question_count)} questions</span>
                </div>
                <button class="btn btn-primary" onclick="startQuiz(${Number(quiz.id)})" ${Number(quiz.question_count) < 1 ? 'disabled' : ''}>Start Quiz</button>
            </div>
        `).join('');
    } catch (error) {
        list.innerHTML = `<p>${escapeHtml(error.message)}</p>`;
    }
}

async function loadStudentAttempts() {
    const list = document.getElementById('studentAttemptsList');
    list.innerHTML = '<p>Loading attempts…</p>';
    try {
        const { attempts } = await backendRequest('/api/attempts?limit=50');
        if (!attempts.length) {
            list.innerHTML = '<p>No attempts yet. Start an active quiz to see it here.</p>';
            return;
        }
        list.innerHTML = attempts.map(attempt => `
            <div class="attempt-item">
                <div class="attempt-info">
                    <h4>${escapeHtml(attempt.quiz_title)} — Attempt ${Number(attempt.attempt_number)}</h4>
                    <p>${new Date(attempt.start_time).toLocaleString()} · ${escapeHtml(attempt.status)}</p>
                    <p>Violations: ${Number(attempt.violation_count || 0)}</p>
                    ${attempt.status === 'in_progress' ? `<button class="btn btn-secondary" onclick="resumeAttempt(${Number(attempt.id)})">Resume attempt</button>` : ''}
                </div>
                <div class="attempt-stats">
                    <div class="attempt-stat"><div class="attempt-stat-value">${attempt.score == null ? '—' : `${Number(attempt.score)}`}</div><div class="attempt-stat-label">Score</div></div>
                    <div class="attempt-stat"><div class="attempt-stat-value">${attempt.percentage == null ? '—' : `${Number(attempt.percentage)}%`}</div><div class="attempt-stat-label">Result</div></div>
                </div>
            </div>
        `).join('');
    } catch (error) {
        list.innerHTML = `<p>${escapeHtml(error.message)}</p>`;
    }
}

async function resumeAttempt(attemptId) {
    if (QuizState.quizInProgress) {
        showToast('warning', 'Finish or exit the current attempt first.');
        return;
    }
    if (!isPortalFullscreen()) {
        QuizState.pendingResumeId = Number(attemptId);
        try {
            // Call the browser fullscreen API directly from the user's click. Chrome rejects delayed calls.
            await enterPortalFullscreen();
            QuizState.pendingResumeId = null;
            closeFullscreenWarning();
        } catch (error) {
            showFullscreenWarning();
            return;
        }
    }
    try {
        const data = await backendRequest(`/api/attempts/${Number(attemptId)}`);
        QuizState.quizId = data.attempt.quiz_id;
        QuizState.attemptId = data.attempt.id;
        QuizState.attemptNumber = data.attempt.attempt_number;
        QuizState.quizTitle = data.attempt.quiz_title;
        QuizState.questions = data.questions;
        QuizState.answers = data.questions.map(question => question.selected_option ?? null);
        QuizState.startTime = new Date(data.attempt.start_time);
        QuizState.endTime = null;
        QuizState.userId = AppState.currentUser.id;
        QuizState.violationCount = Number(data.attempt.violation_count || 0);
        QuizState.violations = [];
        QuizState.currentQuestion = 0;
        QuizState.isSubmitted = false;
        QuizState.isAutoSubmitted = false;
        QuizState.quizInProgress = true;
        const durationSeconds = Number(data.attempt.duration_minutes) * 60;
        const elapsedSeconds = Math.floor((Date.now() - QuizState.startTime.getTime()) / 1000);
        QuizState.timeRemaining = Math.max(0, durationSeconds - elapsedSeconds);
        document.getElementById('activeQuizTitle').textContent = QuizState.quizTitle;
        document.getElementById('violationCount').textContent = String(QuizState.violationCount);
        document.getElementById('attemptNumber').textContent = QuizState.attemptNumber;
        document.getElementById('attemptTime').textContent = formatTime(QuizState.startTime);
        showPage('quiz');
        loadQuestion(0);
        initializeQuestionPalette();
        startTimer();
        startAttemptStatusPolling();
        startMonitoring();
    } catch (error) {
        showToast('error', 'Could not resume attempt: ' + error.message);
    }
}

async function loadTeacherQuizzes() {
    try {
        const { quizzes } = await backendRequest('/api/quizzes/manage');
        const select = document.getElementById('teacherQuizSelect');
        const previous = select.value;

        select.innerHTML = '<option value="">Select a quiz</option>' + quizzes.map(quiz =>
            `<option value="${Number(quiz.id)}">${escapeHtml(quiz.title)}${quiz.is_active ? '' : ' (inactive)'}</option>`
        ).join('');

        if (quizzes.some(quiz => String(quiz.id) === previous)) select.value = previous;

        const batchOptions = AppState.teacherBatches.map(batch =>
            `<option value="${Number(batch.id)}">${escapeHtml(batch.name)}</option>`
        ).join('');

        document.getElementById('teacherQuizList').innerHTML = quizzes.length
            ? quizzes.map(quiz => {
                const quizId = Number(quiz.id);
                const assignedBatches = quiz.assigned_batches || [];

                return `
                    <article class="attempt-item" data-quiz-card="${quizId}">
                        <div class="attempt-info">
                            <h4>${escapeHtml(quiz.title)}</h4>
                            <p>${Number(quiz.duration_minutes)} min · ${Number(quiz.question_count)} questions · ${quiz.is_active ? 'Active' : 'Inactive'}</p>
                        </div>

                        ${quiz.audience_mode === 'batch' ? `
                            <div class="quiz-audience-controls">
                                <h4>Assigned batches</h4>
                                <p>${assignedBatches.length
                                    ? assignedBatches.map(batch => escapeHtml(batch.name)).join(', ')
                                    : 'No batches assigned yet.'}</p>

                                <label for="quiz-batches-${quizId}">Add batches</label>
                                <select id="quiz-batches-${quizId}" multiple data-quiz-batch-select>
                                    ${batchOptions}
                                </select>

                                <button type="button" class="btn btn-outline btn-small"
                                    data-quiz-action="assign-batches" data-quiz-id="${quizId}">
                                    Add selected batches
                                </button>

                                <div class="quiz-invitation-actions">
                                    <button type="button" class="btn btn-outline btn-small"
                                        data-quiz-action="refresh-invitations" data-quiz-id="${quizId}">
                                        Refresh invitations
                                    </button>
                                    <button type="button" class="btn btn-outline btn-small"
                                        data-quiz-action="view-invitations" data-quiz-id="${quizId}">
                                        View invitations
                                    </button>
                                </div>

                                <div data-quiz-invitations aria-live="polite"></div>
                            </div>
                        ` : ''}
                    </article>
                `;
            }).join('')
            : '<p>No quizzes yet. Create one above.</p>';

    } catch (error) {
        document.getElementById('teacherQuizList').textContent = error.message;
    }
}
async function handleTeacherQuizAction(event) {
    const button = event.target.closest('[data-quiz-action]');
    if (!button) return;

    const quizId = Number(button.dataset.quizId);
    const action = button.dataset.quizAction;

    if (!Number.isSafeInteger(quizId) || quizId <= 0) return;

    button.disabled = true;

    try {
        if (action === 'assign-batches') {
            const card = button.closest('[data-quiz-card]');
            const select = card.querySelector('[data-quiz-batch-select]');
            const batchIds = Array.from(select.selectedOptions).map(option => Number(option.value));

            if (!batchIds.length) {
                showToast('error', 'Select at least one batch.');
                return;
            }

            const result = await backendRequest(`/api/quizzes/${quizId}/batches`, {
                method: 'PUT',
                body: JSON.stringify({ batch_ids: batchIds })
            });

            showToast('success', result.message || 'Batches assigned successfully.');
            await loadTeacherQuizzes();

        } else if (action === 'refresh-invitations') {
            const result = await backendRequest(`/api/quizzes/${quizId}/invitations/refresh`, {
                method: 'POST'
            });

            showToast('success', result.message || 'Invitations refreshed.');
            await loadQuizInvitations(quizId);

        } else if (action === 'view-invitations') {
            await loadQuizInvitations(quizId);

        } else if (action === 'revoke-invitation') {
            const invitationId = Number(button.dataset.invitationId);
            if (!Number.isSafeInteger(invitationId) || invitationId <= 0) return;

            if (!confirm('Revoke this invitation? Existing attempts will not be interrupted.')) return;

            await backendRequest(`/api/quizzes/${quizId}/invitations/${invitationId}`, {
                method: 'DELETE'
            });

            showToast('success', 'Invitation revoked.');
            await loadQuizInvitations(quizId);
        }
    } catch (error) {
        showToast('error', error.message);
    } finally {
        button.disabled = false;
    }
}
async function loadQuizInvitations(quizId) {
    const card = document.querySelector(`[data-quiz-card="${quizId}"]`);
    const panel = card?.querySelector('[data-quiz-invitations]');

    if (!panel) return;

    panel.innerHTML = '<p>Loading invitations…</p>';

    try {
        const { invitations } = await backendRequest(
            `/api/quizzes/${quizId}/invitations`
        );

        if (!invitations.length) {
            panel.innerHTML = '<p class="empty-state">No invitations found for this quiz.</p>';
            return;
        }

        panel.innerHTML = invitations.map(invitation => {
            const batches = (invitation.source_batches || [])
                .map(batch => escapeHtml(batch.name))
                .join(', ') || '—';

            const canRevoke = invitation.state === 'invited';

            return `
                <article class="attempt-item">
                    <div class="attempt-info">
                        <h4>${escapeHtml(invitation.student_name || 'Student')}</h4>
                        <p>${escapeHtml(invitation.student_email || '')}</p>
                        <p>Status: ${escapeHtml(invitation.state)}</p>
                        <p>Batches: ${batches}</p>
                        <p>
                            Attempts: ${Number(invitation.attempt_count || 0)}
                            · Completed: ${Number(invitation.completed_count || 0)}
                            · In progress: ${Number(invitation.in_progress_count || 0)}
                            · Auto-submitted: ${Number(invitation.auto_submitted_count || 0)}
                        </p>
                    </div>
                    ${canRevoke ? `
                        <button type="button"
                            class="btn btn-outline btn-small"
                            data-quiz-action="revoke-invitation"
                            data-quiz-id="${quizId}"
                            data-invitation-id="${Number(invitation.invitation_id)}">
                            Revoke
                        </button>
                    ` : ''}
                </article>
            `;
        }).join('');
    } catch (error) {
        panel.innerHTML = `<p class="error-text">${escapeHtml(error.message)}</p>`;
    }
}
async function handleCreateQuiz(e) {
    e.preventDefault();
    const form = e.currentTarget;
    const submitButton = form.querySelector('[type="submit"]');
    const originalButtonText = submitButton.textContent;
    submitButton.disabled = true;
    submitButton.textContent = 'Creating quiz…';
    form.setAttribute('aria-busy', 'true');
    try {
        const { quiz } = await backendRequest('/api/quizzes', {
            method: 'POST',
            body: JSON.stringify({
                audience_mode: document.getElementById('newQuizAudience').value,
                title: document.getElementById('newQuizTitle').value.trim(),
                description: document.getElementById('newQuizDescription').value.trim() || null,
                duration_minutes: Number(document.getElementById('newQuizDuration').value),
                is_active: document.getElementById('newQuizActive').checked
            })
        });
        form.reset();
        document.getElementById('newQuizDuration').value = '15';
        document.getElementById('newQuizAudience').value = 'global';
        document.getElementById('newQuizActive').checked = true;
        await loadTeacherQuizzes();
        document.getElementById('teacherQuizSelect').value = String(quiz.id);
        showToast('success', 'Quiz created. Add its questions below.');
    } catch (error) {
        showToast('error', error.message);
    } finally {
        submitButton.disabled = false;
        submitButton.textContent = originalButtonText;
        form.removeAttribute('aria-busy');
    }
}

function initializeQuestionOptions() {
    if (!document.getElementById('questionOptionRows').children.length) {
        addQuestionOptionRow('Option 1');
        addQuestionOptionRow('Option 2');
    }
}

function addQuestionOptionRow(value = '') {
    const rows = document.getElementById('questionOptionRows');
    if (rows.children.length >= 10) return;
    const index = questionOptionFieldSequence++;
    const row = document.createElement('div');
    row.className = 'option-row';
    row.innerHTML = `<span class="option-bullet" aria-hidden="true">•</span><label class="sr-only" for="questionOption${index}">Option ${index + 1}</label><input id="questionOption${index}" class="question-option-input" maxlength="1000" required placeholder="Option ${index + 1}"><button type="button" class="option-remove" aria-label="Remove option ${index + 1}">×</button>`;
    row.querySelector('input').value = value.startsWith('Option ') ? '' : value;
    row.querySelector('.option-remove').addEventListener('click', () => {
        if (rows.children.length <= 2) return showToast('error', 'A question needs at least two options.');
        row.remove();
        refreshCorrectAnswerOptions();
    });
    row.querySelector('input').addEventListener('input', refreshCorrectAnswerOptions);
    rows.appendChild(row);
    refreshCorrectAnswerOptions();
    document.getElementById('addQuestionOption').disabled = rows.children.length >= 10;
}

function refreshCorrectAnswerOptions() {
    const select = document.getElementById('newCorrectAnswer');
    const previous = select.value;
    const inputs = [...document.querySelectorAll('.question-option-input')];
    select.innerHTML = '<option value="">Choose the correct option</option>' + inputs.map((input, index) => {
        const text = input.value.trim();
        return text ? `<option value="${index}">${escapeHtml(text)}</option>` : '';
    }).join('');
    if ([...select.options].some(option => option.value === previous)) select.value = previous;
}

function readQuestionOptions() {
    const inputs = [...document.querySelectorAll('.question-option-input')];
    const options = inputs.map(input => input.value.trim());
    if (options.length < 2 || options.length > 10 || options.some(option => !option)) throw new Error('Enter between 2 and 10 non-empty options.');
    const correctAnswer = document.getElementById('newCorrectAnswer').value;
    if (!correctAnswer || Number(correctAnswer) < 0 || Number(correctAnswer) >= options.length) throw new Error('Choose the correct answer from the options above.');
    return { options, correct_answer: Number(correctAnswer) };
}

async function handleAddQuestion(e) {
    e.preventDefault();
    const form = e.currentTarget;
    const submitButton = form.querySelector('[type="submit"]');
    const originalButtonText = submitButton.textContent;
    const quizId = Number(document.getElementById('teacherQuizSelect').value);
    submitButton.disabled = true;
    submitButton.textContent = 'Adding question…';
    form.setAttribute('aria-busy', 'true');
    try {
        const questionOptions = readQuestionOptions();
        await backendRequest(`/api/quizzes/${quizId}/questions`, {
            method: 'POST',
            body: JSON.stringify({ question_text: document.getElementById('newQuestionText').value.trim(), ...questionOptions })
        });
        document.getElementById('newQuestionText').value = '';
        document.getElementById('questionOptionRows').innerHTML = '';
        addQuestionOptionRow();
        addQuestionOptionRow();
        await loadTeacherQuizzes();
        showToast('success', 'Question added.');
    } catch (error) {
        showToast('error', error.message);
    } finally {
        submitButton.disabled = false;
        submitButton.textContent = originalButtonText;
        form.removeAttribute('aria-busy');
    }
}

function startTeacherMonitoring() {
    startBackendMonitoring();
    loadTeacherMonitoringSnapshot();
}

async function loadTeacherMonitoringSnapshot() {
    try {
        const data = await backendRequest('/api/attempts/monitoring');
        AppState.monitoringAttempts = data.attempts;
        const summary = data.summary || {};
        [['totalStudentsCount','total_students'],['activeQuizzesCount','active_quizzes'],['liveAttemptsCount','live_attempts'],['completedAttemptsCount','completed_attempts'],['totalViolationsCount','total_violations'],['autoSubmittedCount','auto_submitted_attempts']].forEach(([id,key]) => {
            document.getElementById(id).textContent = String(summary[key] ?? 0);
        });
        renderMonitoringTable();
        renderAnalytics('attemptStatusChart', data.analytics?.attempts_by_status || [], row => row.status, row => row.total);
        renderAnalytics('violationTypeChart', data.analytics?.violations_by_type || [], row => row.type.replaceAll('_',' '), row => row.total);
        renderAnalytics('scoreDistributionChart', data.analytics?.score_distribution || [], row => row.bucket, row => row.total);
        renderAnalytics('completionStatisticsChart', data.analytics?.completion_statistics || [], row => row.label, row => row.total);
        AppState.backendActivities = data.violations;
        renderActivityFeed();
    } catch (error) {
        document.getElementById('monitoringTableBody').innerHTML = `<tr><td colspan="10">${escapeHtml(error.message)}</td></tr>`;
    }
}

function renderMonitoringTable() {
    const search = (document.getElementById('attemptSearch')?.value || '').trim().toLowerCase();
    const status = document.getElementById('attemptStatusFilter')?.value || 'all';
    const attempts = AppState.monitoringAttempts.filter(attempt =>
        (status === 'all' || attempt.status === status) &&
        `${attempt.student_name} ${attempt.student_email} ${attempt.quiz_title} ${attempt.id}`.toLowerCase().includes(search)
    );
    const body = document.getElementById('monitoringTableBody');
    if (!attempts.length) {
        body.innerHTML = '<tr><td colspan="10" class="empty-state">No examination attempts match this view.</td></tr>';
        return;
    }
    body.innerHTML = attempts.map(attempt => `<tr>
        <td><strong>${escapeHtml(attempt.student_name)}</strong><small>${escapeHtml(attempt.student_email)}</small></td>
        <td>${escapeHtml(attempt.quiz_title)}</td><td>#${Number(attempt.id)}</td>
        <td>${formatDashboardDate(attempt.start_time)}</td>
        <td>${formatElapsedDuration(attempt.start_time, attempt.end_time || (attempt.status === 'in_progress' ? new Date() : null))}</td>
        <td>${attempt.score == null ? '—' : `${Number(attempt.score)} / ${Number(attempt.question_count)}`}</td>
        <td><span class="status-pill status-${escapeHtml(attempt.status)}">${escapeHtml(attempt.status.replaceAll('_',' '))}</span></td>
        <td>${Number(attempt.violation_count)}</td><td>${formatDashboardDate(attempt.last_activity)}</td>
        <td><button type="button" class="btn btn-outline btn-small" data-attempt-detail="${Number(attempt.id)}">Details</button></td></tr>`).join('');
}

function formatDashboardDate(value) {
    if (!value) return '—';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString();
}

function formatElapsedDuration(start, end) {
    if (!start) return '—';
    const startMs = new Date(start).getTime();
    const endMs = end ? new Date(end).getTime() : Date.now();
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return '—';
    const totalSeconds = Math.max(0, Math.floor((endMs - startMs) / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return hours ? `${hours}h ${minutes}m ${seconds}s` : `${minutes}m ${seconds}s`;
}

function renderAnalytics(targetId, rows, labelFor, valueFor) {
    const target = document.getElementById(targetId);
    if (!rows.length) { target.innerHTML = '<p class="empty-state">No data yet.</p>'; return; }
    const max = Math.max(1, ...rows.map(row => Number(valueFor(row))));
    target.innerHTML = rows.map(row => `<div class="chart-row"><span>${escapeHtml(labelFor(row))}</span><div class="chart-track"><i style="width:${Math.min(100, Number(valueFor(row)) / max * 100)}%"></i></div><strong>${Number(valueFor(row))}</strong></div>`).join('');
}

async function loadTeacherAttemptDetail(attemptId) {
    const panel = document.getElementById('attemptDetailPanel');
    const content = document.getElementById('attemptDetailContent');
    panel.classList.remove('hidden');
    content.innerHTML = '<p>Loading attempt details…</p>';
    panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    try {
        const data = await backendRequest(`/api/attempts/monitoring/${encodeURIComponent(attemptId)}`);
        const { attempt, answers, violations } = data;
        const attemptedCount = answers.filter(answer => answer.selected_option != null).length;
        const unansweredCount = answers.length - attemptedCount;
        const canScoreAnswers = attempt.status !== 'in_progress' && answers.every(answer => answer.correct_answer != null);
        const incorrectCount = canScoreAnswers
            ? answers.filter(answer => answer.selected_option != null && answer.selected_option !== answer.correct_answer).length
            : null;
        const answerRows = answers.map(answer => {
            const selected = answer.selected_option == null ? 'No answer' : answer.options[answer.selected_option];
            const correct = answer.correct_answer == null ? '' : `<small>Correct answer: ${escapeHtml(answer.options[answer.correct_answer])}</small>`;
            return `<li><strong>${escapeHtml(answer.question_text)}</strong><span>Your response: ${escapeHtml(selected)}</span>${correct}</li>`;
        }).join('') || '<li>No questions found.</li>';
        const violationRows = violations.map(item => `<li><strong>${escapeHtml(item.type.replaceAll('_',' '))}</strong> · ${formatDashboardDate(item.created_at)}<span>${escapeHtml(item.message || '')}</span></li>`).join('') || '<li>No violations recorded.</li>';
        const marks = attempt.score == null ? 'Pending' : `${Number(attempt.score)} / ${answers.length} (${Number(attempt.percentage)}%)`;
        const duration = formatElapsedDuration(attempt.start_time, attempt.end_time || (attempt.status === 'in_progress' ? new Date() : null));
        content.innerHTML = `<div class="detail-summary"><p><strong>${escapeHtml(attempt.student_name)}</strong> · ${escapeHtml(attempt.student_email)}</p><p>${escapeHtml(attempt.quiz_title)} · Attempt #${Number(attempt.attempt_number)}</p><p>Status: ${escapeHtml(attempt.status.replaceAll('_',' '))} · Started ${formatDashboardDate(attempt.start_time)} · Submitted ${formatDashboardDate(attempt.end_time)}</p><p>Time taken: ${duration} · Marks: ${marks} · Violations: ${Number(attempt.violation_count)}</p><p>Attempted: ${attemptedCount} · Not attempted: ${unansweredCount} · Incorrect: ${incorrectCount == null ? 'Available after submission' : incorrectCount}</p></div><h3>Answers</h3><ol class="detail-list">${answerRows}</ol><h3>Violation history</h3><ul class="detail-list">${violationRows}</ul>`;
        panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (error) { content.innerHTML = `<p class="error-text">${escapeHtml(error.message)}</p>`; }
}

async function startBackendMonitoring() {
    const status = document.getElementById('backendRealtimeStatus');
    if (!AppState.backendToken || AppState.backendRole !== 'teacher') {
        if (status) status.textContent = 'Live backend alerts require a teacher account.';
        return;
    }

    try {
        if (typeof window.io !== 'function') {
            await new Promise((resolve, reject) => {
                const script = document.createElement('script');
                script.src = `${window.QIG_BACKEND_URL}/socket.io/socket.io.js`;
                script.async = true;
                script.onload = resolve;
                script.onerror = () => reject(new Error('Socket.IO client did not load from the backend.'));
                document.head.appendChild(script);
            });
        }
        if (typeof window.io !== 'function') throw new Error('Socket.IO client is unavailable.');
        if (AppState.backendSocket) AppState.backendSocket.disconnect();
        const socket = window.io(window.QIG_BACKEND_URL, { auth: { token: AppState.backendToken } });
        AppState.backendSocket = socket;
        let connectionErrorShown = false;
        socket.on('connect', () => {
            connectionErrorShown = false;
            if (status) status.textContent = 'Live backend alerts: connected';
            loadTeacherMonitoringSnapshot();
        });
        socket.on('disconnect', () => { if (status) status.textContent = 'Live alerts reconnecting…'; });
        socket.on('connect_error', error => {
            if (status) status.textContent = 'Live backend alerts: connection failed. Check the backend and CORS settings.';
            if (!connectionErrorShown) {
                showToast('error', 'Live alerts could not connect: ' + error.message);
                connectionErrorShown = true;
            }
        });
        const recordEvent = (eventType, payload) => {
            const at = payload.start_time || payload.end_time || payload.violation?.created_at || new Date().toISOString();
            const key = `${eventType}:${payload.id || payload.attempt?.id}:${at}`;
            // Violations are persisted and returned by the snapshot; keeping a second socket copy would duplicate the feed row.
            if (eventType !== 'violation' && !AppState.socketActivities.some(item => item.key === key)) AppState.socketActivities.unshift({ key, eventType, payload, created_at: at });
            AppState.socketActivities = AppState.socketActivities.slice(0, 30);
            renderActivityFeed();
            loadTeacherMonitoringSnapshot();
        };
        socket.on('attempt:started', payload => recordEvent('started', payload));
        socket.on('attempt:completed', payload => recordEvent('completed', payload));
        socket.on('violation:created', payload => recordEvent('violation', payload));
        socket.on('attempt:auto_submitted', payload => recordEvent('auto_submitted', payload));
    } catch (error) {
        if (status) status.textContent = error.message;
    }
}

function renderActivityFeed() {
    const activityFeed = document.getElementById('teacherActivityFeed');
    if (!activityFeed) return;
    const stored = AppState.backendActivities.map(item => ({ ...item, activity_kind: 'violation', created_at: item.created_at }));
    const live = AppState.socketActivities.map(item => ({ ...item.payload, activity_kind: item.eventType, created_at: item.created_at }));
    const activities = [...live, ...stored]
        .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))
        .slice(0, 20);

    if (activities.length === 0) {
        activityFeed.innerHTML = '<p>No recent activity.</p>';
        return;
    }
    activityFeed.innerHTML = activities.map(activity => {
        const date = activity.created_at;
        const violation = activity.violation || activity;
        const questionNum = violation.question_number;
        const suffix = questionNum ? ` at Q${questionNum}` : '';
        const relatedAttempt = AppState.monitoringAttempts.find(attempt => String(attempt.id) === String(activity.attempt?.id || activity.id));
        const student = activity.student?.name || activity.student_name || relatedAttempt?.student_name || activity.student?.email || '';
        const message = activity.activity_kind === 'started' ? 'started an examination' : activity.activity_kind === 'completed' ? 'submitted an examination' : activity.activity_kind === 'auto_submitted' ? 'had an attempt auto-submitted' : getViolationMessage(violation) + suffix;
        return `
            <div class="activity-item">
                <div class="activity-icon">${activity.activity_kind === 'violation' ? '!' : '↗'}</div>
                <div class="activity-content">
                    <div class="activity-text"><strong>${escapeHtml(student)}</strong> ${escapeHtml(message)}</div>
                    <div class="activity-time">${getTimeAgo(date)}</div>
                </div>
            </div>
        `;
    }).join('');
}

function getViolationMessage(violation) {
    if (violation.type === 'attempt_auto_submitted') {
        return violation.reason === 'violation_threshold'
            ? 'Attempt auto-submitted after three violations'
            : 'Attempt auto-submitted after the time limit';
    }
    const messages = {
        'tab_switch': 'Student switched tab',
        'window_blur': 'Student lost focus',
        'fullscreen_exit': 'Student exited fullscreen',
        'copy_attempt': 'Copy attempt detected',
        'paste_attempt': 'Paste attempt detected',
        'cut_attempt': 'Cut attempt detected',
        'right_click': 'Right-click blocked',
        'keyboard_shortcut': 'Keyboard shortcut blocked',
        'inactivity': 'Inactivity detected',
        'fast_submission': 'Fast submission detected',
        'devtools_opened': 'Developer tools opened',
        'screenshot_attempt': 'Screenshot attempt detected'
    };

    return messages[violation.type] || 'Violation detected';
}

function getTimeAgo(date) {
    const parsedDate = date && typeof date.toDate === 'function' ? date.toDate() : new Date(date);
    const seconds = Math.floor((new Date() - parsedDate) / 1000);

    if (seconds < 60) return 'Just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)} hours ago`;
    return `${Math.floor(seconds / 86400)} days ago`;
}

// Quiz Functions
async function startQuiz(quizId) {
    if (QuizState.quizInProgress) {
        showToast('warning', 'Quiz already in progress. Submit or exit it first.');
        return;
    }
    if (!isPortalFullscreen()) {
        QuizState.pendingQuizId = Number(quizId);
        try {
            // Request fullscreen in the original Start Quiz click, then start only after Chrome confirms it.
            await enterPortalFullscreen();
            QuizState.pendingQuizId = null;
            closeFullscreenWarning();
        } catch (error) {
            showFullscreenWarning();
            return;
        }
    }
    try {
        const data = await backendRequest('/api/attempts', {
            method: 'POST', body: JSON.stringify({ quiz_id: Number(quizId) })
        });
        QuizState.quizId = data.attempt.quiz_id;
        QuizState.attemptId = data.attempt.id;
        QuizState.attemptNumber = data.attempt.attempt_number;
        QuizState.quizTitle = data.attempt.quiz_title;
        QuizState.questions = data.questions;
        QuizState.answers = new Array(data.questions.length).fill(null);
        QuizState.startTime = new Date(data.attempt.start_time);
        QuizState.endTime = null;
        QuizState.userId = AppState.currentUser.id;
        QuizState.violations = [];
        QuizState.violationCount = 0;
        QuizState.currentQuestion = 0;
        QuizState.isSubmitted = false;
        QuizState.isAutoSubmitted = false;
        QuizState.quizInProgress = true;
        QuizState.timeRemaining = Number(data.attempt.duration_minutes) * 60;
        document.getElementById('activeQuizTitle').textContent = QuizState.quizTitle;
        showPage('quiz');
        loadQuestion(0);
        initializeQuestionPalette();
        startTimer();
        startAttemptStatusPolling();
        startMonitoring();
        document.getElementById('attemptNumber').textContent = QuizState.attemptNumber;
        document.getElementById('attemptTime').textContent = formatTime(QuizState.startTime);
        document.getElementById('violationCount').textContent = '0';
        showToast('info', 'Quiz started. Answers are saved to the backend.');
    } catch (error) {
        showToast('error', 'Could not start quiz: ' + error.message);
    }
}

function loadQuestion(index) {
    if (index < 0 || index >= QuizState.questions.length) return;

    QuizState.currentQuestion = index;
    const question = QuizState.questions[index];

    // Update question content
    const questionContent = document.getElementById('questionContent');
    questionContent.innerHTML = `
        <div class="question-text">${escapeHtml(question.question_text)}</div>
        <div class="options-list">
            ${question.options.map((option, i) => `
                <div class="option-item ${QuizState.answers[index] === i ? 'selected' : ''}"
                     onclick="selectOption(${i})" data-option="${i}">
                    <div class="option-indicator">${String.fromCharCode(65 + i)}</div>
                    <div class="option-text">${escapeHtml(option)}</div>
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
    document.getElementById('totalQuestions').textContent = QuizState.questions.length;

}

async function selectOption(optionIndex) {
    if (QuizState.isSubmitted || !QuizState.questions[QuizState.currentQuestion]) return;
    const questionIndex = QuizState.currentQuestion;
    const question = QuizState.questions[questionIndex];
    try {
        await backendRequest(`/api/attempts/${QuizState.attemptId}/answers/${question.id}`, {
            method: 'PUT', body: JSON.stringify({ selected_option: optionIndex })
        });
        QuizState.answers[questionIndex] = optionIndex;
        if (QuizState.currentQuestion === questionIndex) {
            document.querySelectorAll('.option-item').forEach(item => item.classList.remove('selected'));
            document.querySelector(`[data-option="${optionIndex}"]`)?.classList.add('selected');
        }
        updateQuestionPalette();
    } catch (error) {
        showToast('error', 'Answer was not saved: ' + error.message);
    }
}

function nextQuestion() {
    if (QuizState.currentQuestion < QuizState.questions.length - 1) {
        loadQuestion(QuizState.currentQuestion + 1);
    }
}

function previousQuestion() {
    if (QuizState.currentQuestion > 0) {
        loadQuestion(QuizState.currentQuestion - 1);
    }
}

function updateProgress() {
    const progress = ((QuizState.currentQuestion + 1) / QuizState.questions.length) * 100;
    document.getElementById('progressFill').style.width = progress + '%';
}

function updateQuestionPalette() {
    const paletteItems = document.querySelectorAll('.palette-item');
    paletteItems.forEach((item, index) => {
        item.classList.remove('current', 'answered');
        if (index === QuizState.currentQuestion) {
            item.classList.add('current');
            item.setAttribute('aria-current', 'step');
        } else if (QuizState.answers[index] !== null) {
            item.classList.add('answered');
        }
        if (index !== QuizState.currentQuestion) item.setAttribute('aria-current', 'false');
    });
}

function initializeQuestionPalette() {
    const paletteGrid = document.getElementById('questionPalette');
    paletteGrid.innerHTML = QuizState.questions.map((_, index) => `
        <button type="button" class="palette-item" aria-label="Go to question ${index + 1}" aria-current="${index === 0 ? 'step' : 'false'}" onclick="loadQuestion(${index})">${index + 1}</button>
    `).join('');
}

function updateNavigationButtons() {
    const prevBtn = document.getElementById('prevBtn');
    const nextBtn = document.getElementById('nextBtn');
    const submitBtn = document.getElementById('submitBtn');

    prevBtn.style.display = 'flex';
    nextBtn.style.display = 'flex';
    prevBtn.disabled = QuizState.currentQuestion === 0;
    nextBtn.disabled = QuizState.currentQuestion === QuizState.questions.length - 1;
    submitBtn.style.display = QuizState.currentQuestion === QuizState.questions.length - 1 ? 'flex' : 'none';
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

function startAttemptStatusPolling() {
    clearInterval(QuizState.statusPollTimer);
    QuizState.statusPollTimer = setInterval(async () => {
        if (!QuizState.quizInProgress || QuizState.isSubmitted || QuizState.statusCheckPending) return;
        QuizState.statusCheckPending = true;
        try {
            const detail = await backendRequest(`/api/attempts/${QuizState.attemptId}`);
            if (detail.attempt.status !== 'in_progress') {
                finishQuizFromServer({ attempt: detail.attempt, total_questions: detail.questions.length });
                showToast('warning', 'This attempt was submitted by the backend.');
            }
        } catch (error) {
            if (error.status === 401) {
                clearBackendSession();
                QuizState.quizInProgress = false;
                clearInterval(QuizState.timer);
                clearInterval(QuizState.statusPollTimer);
                stopMonitoring();
                showPage('login');
                showToast('error', 'Your session expired. Sign in again.');
            }
        } finally {
            QuizState.statusCheckPending = false;
        }
    }, 5000);
}

async function submitQuiz() {
    if (QuizState.isSubmitted || QuizState.submitting) return;
    QuizState.submitting = true;
    try {
        const data = await backendRequest(`/api/attempts/${QuizState.attemptId}/submit`, {
            method: 'POST', body: JSON.stringify({})
        });
        finishQuizFromServer(data.result);
    } catch (error) {
        showToast('error', 'Could not submit quiz: ' + error.message);
    } finally {
        QuizState.submitting = false;
    }
}

async function autoSubmitQuiz(reason) {
    if (QuizState.isSubmitted || QuizState.submitting) return;
    QuizState.submitting = true;
    try {
        const data = await backendRequest(`/api/attempts/${QuizState.attemptId}/submit`, {
            method: 'POST', body: JSON.stringify({})
        });
        finishQuizFromServer(data.result);
        showToast('warning', `Quiz submitted: ${reason}`);
    } catch (error) {
        if (error.status === 409) {
            try {
                const detail = await backendRequest(`/api/attempts/${QuizState.attemptId}`);
                finishQuizFromServer({ attempt: detail.attempt, total_questions: detail.questions.length });
                return;
            } catch (_) { /* Show the original submit error below. */ }
        }
        showToast('error', 'Could not submit quiz: ' + error.message);
    } finally {
        QuizState.submitting = false;
    }
}

function finishQuizFromServer(result) {
    const attempt = result.attempt;
    QuizState.isSubmitted = true;
    QuizState.isAutoSubmitted = attempt.status === 'auto_submitted' || attempt.is_auto_submitted;
    QuizState.endTime = attempt.end_time ? new Date(attempt.end_time) : new Date();
    QuizState.violationCount = Number(attempt.violation_count || 0);
    clearInterval(QuizState.timer);
    clearInterval(QuizState.statusPollTimer);
    stopMonitoring();
    QuizState.quizInProgress = false;
    showResults(Number(attempt.score || 0), Number(attempt.percentage || 0));
    loadStudentAttempts();
}

function showResults(score, percentage) {
    // Hide quiz, show results
    showPage('result');

    // Update result display
    document.getElementById('finalScore').textContent = `${score}/${QuizState.questions.length}`;
    document.getElementById('scorePercentage').textContent = `${percentage}%`;
    document.getElementById('correctAnswers').textContent = score;
    const attemptedCount = QuizState.answers.filter(answer => answer !== null && answer !== undefined).length;
    const unansweredCount = QuizState.questions.length - attemptedCount;
    const incorrectCount = Math.max(0, attemptedCount - score);
    document.getElementById('incorrectAnswers').textContent = incorrectCount;
    document.getElementById('unattemptedQuestions').textContent = unansweredCount;
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
    QuizState.timeRemaining = 0;

    // Restart the same backend quiz.
    startQuiz(QuizState.quizId);
}

function goToDashboard() {
    showDashboard(AppState.currentUser);
}

function exitQuiz() {
    if (QuizState.quizInProgress && !QuizState.isSubmitted) {
        const confirmed = confirm('Exit this quiz? Your saved answers will remain in your account.');
        if (confirmed) {
            stopMonitoring();
            clearInterval(QuizState.timer);
            clearInterval(QuizState.statusPollTimer);
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
    window.addEventListener('keydown', handleKeyboardShortcuts, true);

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
    window.removeEventListener('keydown', handleKeyboardShortcuts, true);
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

    if (isScreenshotShortcut(e)) {
        const now = Date.now();
        if (e.repeat || now - lastScreenshotShortcutAt < 2000) return;
        lastScreenshotShortcutAt = now;
        recordViolation('screenshot_attempt', 'A screenshot keyboard shortcut was detected. Operating-system captures may not be visible to the browser.');
        return;
    }

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

function isScreenshotShortcut(event) {
    const key = String(event.key || '').toLowerCase();
    const code = String(event.code || '').toLowerCase();
    const macCapture = event.metaKey && event.shiftKey &&
        (['digit3', 'digit4', 'digit5'].includes(code) || ['3', '4', '5', '#', '$', '%'].includes(key));
    const printScreen = ['printscreen', 'print', 'snapshot'].includes(key) ||
        ['printscreen', 'snapshot'].includes(code);
    return macCapture || printScreen;
}

function handleFullscreenChange() {
    const isFullscreen = isPortalFullscreen();

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

    // The backend persists the event and enforces the three-strike limit.
    reportViolationToBackend(violation);

    // Check for auto-submit (3 strikes)
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

function isPortalFullscreen() {
    return !!(document.fullscreenElement || document.webkitFullscreenElement ||
        document.mozFullScreenElement || document.msFullscreenElement);
}

async function enterPortalFullscreen() {
    if (isPortalFullscreen()) return true;
    const elem = document.documentElement;
    const request = elem.requestFullscreen || elem.webkitRequestFullscreen || elem.msRequestFullscreen;
    if (!request) throw new Error('Fullscreen mode is not supported by this browser.');
    await Promise.resolve(request.call(elem));
    if (!isPortalFullscreen()) throw new Error('Chrome did not enter fullscreen mode.');
    return true;
}

async function requestFullscreen() {
    try {
        await enterPortalFullscreen();
        closeFullscreenWarning();
        if (QuizState.pendingResumeId) {
            const attemptId = QuizState.pendingResumeId;
            QuizState.pendingResumeId = null;
            await resumeAttempt(attemptId);
        } else if (QuizState.pendingQuizId) {
            const quizId = QuizState.pendingQuizId;
            QuizState.pendingQuizId = null;
            await startQuiz(quizId);
        }
    } catch (error) {
        showFullscreenWarning();
        showToast('error', error.message || 'Allow fullscreen in your browser to start the quiz.');
    }
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

async function reportViolationToBackend(violation) {
    if (!QuizState.attemptId) return;
    try {
        const data = await backendRequest(`/api/attempts/${QuizState.attemptId}/violations`, {
            method: 'POST', body: JSON.stringify({
                type: violation.type,
                message: violation.message,
                question_number: violation.questionNumber
            })
        });
        QuizState.violationCount = Number(data.attempt.violation_count);
        document.getElementById('violationCount').textContent = String(QuizState.violationCount);
        if (data.auto_submitted) {
            finishQuizFromServer({ attempt: data.attempt, total_questions: data.result.total_questions });
        }
    } catch (error) {
        if (error.status === 409 && error.payload?.result?.attempt) {
            finishQuizFromServer(error.payload.result);
            return;
        }
        console.error('Violation report failed:', error);
        showToast('error', 'Could not report this violation to the backend: ' + error.message);
    }
}

// ========================================
// UTILITY FUNCTIONS
// ========================================

function logout() {
    clearBackendSession();
    QuizState.quizInProgress = false;
    clearInterval(QuizState.timer);
    clearInterval(QuizState.statusPollTimer);
    stopMonitoring();
    showPage('login');
    showToast('info', 'Logged out.');
}

function showToast(type, message) {
    const toastContainer = document.getElementById('toastContainer');

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    const icon = document.createElement('div');
    icon.className = 'toast-icon';
    icon.textContent = type.charAt(0).toUpperCase();
    const messageElement = document.createElement('div');
    messageElement.className = 'toast-message';
    messageElement.textContent = message;
    toast.append(icon, messageElement);

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
window.resumeAttempt = resumeAttempt;
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
