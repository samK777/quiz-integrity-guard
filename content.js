console.log("🟣 Exam Monitor Content Script Loaded:", window.location.href);

if (!window.__examMonitorLoaded) {
  window.__examMonitorLoaded = true;
  let examTerminated = false;

  let violations = 0;
  const MAX = 5;

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

function updateDashboard() {
  let status = "Safe ✅";
  let color = "#00ff88";

  if (violations >= 3 && violations < MAX) {
    status = "Warning ⚠️";
    color = "#ffd93d";
  } else if (violations >= MAX) {
    status = "Terminated ❌";
    color = "#ff4d4d";
  }

  dashboard.innerHTML = `
    <div style="font-weight:bold; font-size:16px;">Exam Monitor</div>
    <hr style="border:0.5px solid rgba(255,255,255,0.3)">
    <div>Violations: <b>${violations}/${MAX}</b></div>
    <div>Status: <span style="color:${color}"><b>${status}</b></span></div>
  `;
}
  updateDashboard(); // 👈 INITIAL CALL

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
function flag(reason) {
  if (examTerminated) return; // 🚫 stop everything

  const now = Date.now();
  if (now - lastViolationTime < COOLDOWN) return;

  lastViolationTime = now;
  violations++;

  if (violations > MAX) violations = MAX; // 🚫 cap at 5

  console.log(`🚨 VIOLATION ${violations}: ${reason}`);
  showWarning(`⚠️ ${reason} detected!`);

  updateDashboard();

  if (violations >= MAX) {
    examTerminated = true; // 🔒 LOCK

    showWarning("❌ Too many violations. Submitting...");

    setTimeout(() => {
      document.querySelector("form")?.submit();
    }, 2000);
  }
}
  // ---------------- Fullscreen ----------------
let fullscreenActivated = false;
let lastFullscreenExit = 0;

// First click → enter fullscreen
document.addEventListener("click", () => {
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

      showWarning("⚠️ Click anywhere to resume fullscreen");
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
      e.preventDefault();
      flag(evt.toUpperCase());
    });
  });

  // ---------------- Right Click ----------------
  document.addEventListener("contextmenu", (e) => {
    if (!e.metaKey) {
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

  // ---------------- Screenshot Detection ----------------
  document.addEventListener("keydown", (e) => {
    if (e.metaKey && e.shiftKey && (e.key === "3" || e.key === "4")) {
      flag("SCREENSHOT ATTEMPT (Mac)");
    }

    if (e.key === "PrintScreen") {
      flag("SCREENSHOT ATTEMPT (Windows)");
    }
  });

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