const DEFAULT_BACKEND = 'http://localhost:5050';
const byId = id => document.getElementById(id);
let attempts = [];
let token = null;

function backendUrl() {
  return byId('backendUrl').value.trim().replace(/\/$/, '') || DEFAULT_BACKEND;
}

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${backendUrl()}${path}`, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Backend request failed (${response.status}).`);
  return data;
}

function setStatus(message, isError = false) {
  byId('status').textContent = message;
  byId('status').style.color = isError ? '#b42318' : '#45516a';
}

async function loadAttempts() {
  try {
    const { attempts: rows } = await api('/api/attempts?limit=100');
    attempts = rows.filter(row => row.status === 'in_progress');
    const select = byId('attempt');
    select.replaceChildren();
    for (const attempt of attempts) {
      const option = document.createElement('option');
      option.value = String(attempt.id);
      option.textContent = `${attempt.quiz_title} — Attempt ${attempt.attempt_number}`;
      select.append(option);
    }
    const saved = await chrome.storage.local.get('activeAttemptId');
    if (attempts.some(attempt => String(attempt.id) === String(saved.activeAttemptId))) {
      select.value = String(saved.activeAttemptId);
    }
    byId('setAttempt').disabled = attempts.length === 0;
    setStatus(attempts.length ? 'Choose the attempt currently open in the portal.' : 'No in-progress attempts. Start a quiz in the portal, then refresh.');
  } catch (error) {
    setStatus(error.message, true);
    if (/401|token/i.test(error.message)) showLogin('Session expired. Connect again.');
  }
}

function showLogin(message = '') {
  byId('login').style.display = 'block';
  byId('session').style.display = 'none';
  byId('account').textContent = '';
  setStatus(message);
}

async function showSession(user) {
  byId('login').style.display = 'none';
  byId('session').style.display = 'block';
  byId('account').textContent = `Connected as ${user.name || user.email}`;
  await loadAttempts();
}

byId('backendUrl').addEventListener('change', async () => {
  await chrome.storage.local.set({ backendUrl: backendUrl() });
});

byId('loginForm').addEventListener('submit', async event => {
  event.preventDefault();
  try {
    const result = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: byId('email').value.trim(), password: byId('password').value })
    });
    if (result.user.role !== 'student') throw new Error('Connect with a student account.');
    token = result.token;
    await chrome.storage.local.set({ backendToken: token, backendUrl: backendUrl(), accountEmail: result.user.email });
    byId('password').value = '';
    await showSession(result.user);
  } catch (error) {
    setStatus(error.message, true);
  }
});

byId('setAttempt').addEventListener('click', async () => {
  const attempt = attempts.find(item => String(item.id) === byId('attempt').value);
  if (!attempt) return setStatus('Select an in-progress attempt first.', true);
  try {
    const detail = await api(`/api/attempts/${attempt.id}`);
    await chrome.storage.local.set({
      activeAttemptId: attempt.id,
      activeAttemptTitle: attempt.quiz_title,
      activeQuestionCount: detail.questions.length
    });
    setStatus(`Monitoring ${attempt.quiz_title}. Keep this selection active during the attempt.`);
  } catch (error) { setStatus(error.message, true); }
});

byId('refresh').addEventListener('click', loadAttempts);
byId('logout').addEventListener('click', async () => {
  token = null;
  attempts = [];
  await chrome.storage.local.remove(['backendToken', 'accountEmail', 'activeAttemptId', 'activeAttemptTitle', 'activeQuestionCount']);
  showLogin('Disconnected from the backend.');
});

(async function initialize() {
  const saved = await chrome.storage.local.get(['backendToken', 'backendUrl', 'accountEmail']);
  byId('backendUrl').value = saved.backendUrl || DEFAULT_BACKEND;
  token = saved.backendToken || null;
  if (!token) return showLogin();
  try {
    const { user } = await api('/api/auth/me');
    if (user.role !== 'student') throw new Error('Connect with a student account.');
    await showSession(user);
  } catch (error) {
    token = null;
    await chrome.storage.local.remove(['backendToken', 'activeAttemptId', 'activeAttemptTitle', 'activeQuestionCount']);
    showLogin(error.message);
  }
})();
