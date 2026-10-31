console.log("🟣 Exam Monitor Content Script Loaded:", window.location.href);

if (!window.__examMonitorLoaded) {
  window.__examMonitorLoaded = true;
  const isLocalPortal = ["localhost", "127.0.0.1"].includes(window.location.hostname) && window.location.port === "5005";
  const portalManagedTypes = new Set([
    "tab_switch", "window_blur", "copy_attempt", "paste_attempt", "cut_attempt",
    "right_click", "keyboard_shortcut", "fullscreen_exit", "screenshot_attempt"
  ]);
  let examTerminated = false;
  let serverAutoSubmitted = false;

  let violations = 0;
  const MAX = 3;

  let lastViolationTime = 0;
  const COOLDOWN = 2000;

  // ---------------- STUDENT DASHBOARD ----------------
  let dashboard = document.createElement("div");

  dashboard.style.position = "fixed";
  dashboard.style.bottom = "20px";
  dashboard.style.right = "20px";
  dashboard.style.background = "linear-gradient(135deg, #667eea, #764ba2)";
  dashboard.style.color = "white";
  dashboard.style.padding = "15px";
  dashboard.style.borderRadius = "12px";
  dashboard.style.zIndex = "9999";
  dashboard.style.fontSize = "14px";
  dashboard.style.boxShadow = "0 8px 20px rgba(0,0,0,0.3)";
  dashboard.style.width = "200px";
  dashboard.style.fontFamily = "Arial";

  document.body.appendChild(dashboard);

function isPortalExamActive() {
  if (!isLocalPortal) return true;
  const quizPage = document.getElementById("quizPage");
  return Boolean(quizPage?.classList.contains("active") && quizPage.style.display !== "none");
}

function updateDashboard() {
  let status = "Safe ✅";
  let color = "#00ff88";
  dashboard.hidden = isLocalPortal && !isPortalExamActive();

  if (serverAutoSubmitted) {
    status = "Submitted by backend";
    color = "#ff4d4d";
  } else if (violations >= 2) {
    status = "Warning ⚠️";
    color = "#ffd93d";
  }

  dashboard.innerHTML = `
    <div style="font-weight:bold; font-size:16px;">Exam Monitor</div>
    <hr style="border:0.5px solid rgba(255,255,255,0.3)">
    <div>Violations: <b>${violations}/${MAX}</b></div>
    <div>Status: <span style="color:${color}"><b>${status}</b></span></div>
  `;
}
  updateDashboard(); // 👈 INITIAL CALL
  if (isLocalPortal) {
    const quizPage = document.getElementById("quizPage");
    if (quizPage) new MutationObserver(updateDashboard).observe(quizPage, { attributes: true, attributeFilter: ["class", "style"] });
  }

  // ---------------- Warning Popup ----------------
  function showWarning(message) {
    let popup = document.createElement("div");
    popup.innerText = message;

    popup.style.position = "fixed";
    popup.style.top = "20px";
    popup.style.right = "20px";
    popup.style.background = "#ff4d4d";
    popup.style.color = "white";
    popup.style.padding = "10px 15px";
    popup.style.borderRadius = "8px";
    popup.style.zIndex = "9999";
    popup.style.fontSize = "14px";

    document.body.appendChild(popup);
    setTimeout(() => popup.remove(), 3000);
  }

  // ---------------- Violation Handler ----------------
function backendViolationType(reason) {
  const value = reason.toUpperCase();
  if (value.includes("TAB SWITCH")) return "tab_switch";
  if (value.includes("WINDOW BLUR")) return "window_blur";
  if (value.includes("FULLSCREEN")) return "fullscreen_exit";
  if (value === "COPY") return "copy_attempt";
  if (value === "PASTE") return "paste_attempt";
  if (value === "CUT") return "cut_attempt";
  if (value.includes("RIGHT CLICK")) return "right_click";
  if (value.includes("KEYBOARD SHORTCUT")) return "keyboard_shortcut";
  if (value.includes("SCREENSHOT ATTEMPT")) return "screenshot_attempt";
  if (value.includes("INACTIVITY")) return "inactivity";
  if (value.includes("FAST SUBMISSION")) return "fast_submission";
  if (value.includes("DEVTOOLS")) return "devtools_opened";
  return null;
}

function reportToBackend(reason) {
  const type = backendViolationType(reason);
  if (!type) return;
  chrome.runtime.sendMessage({
    type: "REPORT_VIOLATION",
    violation: { type, message: `${reason} detected by Exam Monitor extension` }
  }).then(result => {
    if (!result?.ok) {
      console.warn("Exam Monitor could not sync this event:", result?.error || "Unknown error");
      return;
    }
    violations = Math.max(violations, Number(result.violationCount) || 0);
    updateDashboard();
    if (result.autoSubmitted) {
      examTerminated = true;
      serverAutoSubmitted = true;
      updateDashboard();
      showWarning("Attempt was auto-submitted by the backend.");
    }
  }).catch(error => console.warn("Exam Monitor backend connection failed:", error.message));
}

function flag(reason) {
  if (examTerminated || !isPortalExamActive()) return;
  const type = backendViolationType(reason);
  if (isLocalPortal && portalManagedTypes.has(type)) return;

  const now = Date.now();
  if (now - lastViolationTime < COOLDOWN) return;

  lastViolationTime = now;
  violations++;

  if (violations > MAX) violations = MAX;

  console.log(`🚨 VIOLATION ${violations}: ${reason}`);
  showWarning(`⚠️ ${reason} detected!`);

  updateDashboard();
  reportToBackend(reason);

  if (violations >= MAX) showWarning("Three extension signals reported. The backend applies the attempt policy.");
}
  // ---------------- Fullscreen ----------------
let fullscreenActivated = false;
let lastFullscreenExit = 0;

// First click → enter fullscreen
document.addEventListener("click", () => {
  if (!isPortalExamActive()) return;
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch(() => {});
  }

  fullscreenActivated = true;
});

// Detect exit (ESC)
document.addEventListener("fullscreenchange", () => {
  if (fullscreenActivated && !document.fullscreenElement) {
    const now = Date.now();

    if (now - lastFullscreenExit > 2000) {
      lastFullscreenExit = now;
      flag("EXITED FULLSCREEN");

      if (!isLocalPortal) showWarning("⚠️ Click anywhere to resume fullscreen");
    }
  }
});
  // ---------------- Tab Switch ----------------
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      flag("TAB SWITCH");
    }
  });

  // ---------------- Window Blur ----------------
  window.addEventListener("blur", () => {
    if (!document.hidden) {
      flag("WINDOW BLUR");
    }
  });

  // ---------------- Copy / Paste ----------------
  ["copy", "paste", "cut"].forEach(evt => {
    document.addEventListener(evt, e => {
      const type = backendViolationType(evt.toUpperCase());
      if (isLocalPortal && (!isPortalExamActive() || portalManagedTypes.has(type))) return;
      e.preventDefault();
      flag(evt.toUpperCase());
    });
  });

  // ---------------- Right Click ----------------
  document.addEventListener("contextmenu", (e) => {
    if (!e.metaKey) {
      if (isLocalPortal && (!isPortalExamActive() || portalManagedTypes.has("right_click"))) return;
      e.preventDefault();
      flag("RIGHT CLICK");
    }
  });

  // ---------------- Activity Timer ----------------
  let lastActivityTime = Date.now();

  ["mousemove", "keydown", "click", "scroll"].forEach(evt => {
    document.addEventListener(evt, () => {
      lastActivityTime = Date.now();
    });
  });

  setInterval(() => {
    const inactiveTime = (Date.now() - lastActivityTime) / 1000;
    if (inactiveTime > 20) {
      flag("INACTIVITY DETECTED");
    }
  }, 5000);

  // ---------------- Fast Submission ----------------
  let formStartTime = Date.now();

  document.addEventListener("submit", () => {
    const totalTime = (Date.now() - formStartTime) / 1000;

    if (totalTime < 30) {
      flag("SUSPICIOUSLY FAST SUBMISSION");
    }
  });

  // The browser can only observe screenshot shortcuts that reach the page.
  // OS capture tools may intercept their own key combinations before this code.
  function isScreenshotShortcut(event) {
    const key = String(event.key || "").toLowerCase();
    const code = String(event.code || "").toLowerCase();
    const macCapture = event.metaKey && event.shiftKey &&
      (["digit3", "digit4", "digit5"].includes(code) || ["3", "4", "5", "#", "$", "%"].includes(key));
    const printScreen = ["printscreen", "print", "snapshot"].includes(key) ||
      ["printscreen", "snapshot"].includes(code);
    return macCapture || printScreen;
  }

  // ---------------- Best-effort Screenshot Shortcut Detection ----------------
  window.addEventListener("keydown", (event) => {
    if (isScreenshotShortcut(event)) flag("SCREENSHOT ATTEMPT (keyboard shortcut)");
  }, true);

  // ---------------- DevTools Detection ----------------
  let devtoolsOpen = false;

  setInterval(() => {
    const widthThreshold = window.outerWidth - window.innerWidth > 150;
    const heightThreshold = window.outerHeight - window.innerHeight > 150;

    if (widthThreshold || heightThreshold) {
      if (!devtoolsOpen) {
        devtoolsOpen = true;
        flag("DEVTOOLS OPENED");
      }
    } else {
      devtoolsOpen = false;
    }
  }, 1000);

  console.log("✅ Exam Monitor Active");
}
