chrome.runtime.onInstalled.addListener(() => {
  console.log("Exam Monitor installed");
});

const supportedViolationTypes = new Set([
  "tab_switch", "window_blur", "copy_attempt", "paste_attempt", "cut_attempt",
  "right_click", "keyboard_shortcut", "fullscreen_exit", "inactivity",
  "fast_submission", "devtools_opened", "screenshot_attempt"
]);

function isAllowedExamPage(rawUrl) {
  try {
    const url = new URL(rawUrl);
    const googleForm = url.origin === "https://docs.google.com" && url.pathname.startsWith("/forms/");
    const localPortal = ["http://localhost:5005", "http://127.0.0.1:5005"].includes(url.origin);
    return googleForm || localPortal;
  } catch (_) {
    return false;
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "TAKE_SCREENSHOT") {
    chrome.tabs.captureVisibleTab(null, { format: "png" }, () => {
      if (chrome.runtime.lastError) console.error("Capture failed:", chrome.runtime.lastError.message);
    });
    return;
  }

  if (msg.type !== "REPORT_VIOLATION") return;
  if (!sender.url || !isAllowedExamPage(sender.url)) {
    sendResponse({ ok: false, error: "Violation reports are accepted only from supported exam pages." });
    return;
  }

  (async () => {
    const saved = await chrome.storage.local.get([
      "backendToken", "backendUrl", "activeAttemptId", "activeQuestionCount"
    ]);
    if (!saved.backendToken || !saved.activeAttemptId) {
      return { ok: false, error: "Connect the extension and select an active attempt in its popup." };
    }
    if (!supportedViolationTypes.has(msg.violation?.type)) {
      return { ok: false, error: "This event type is not supported by the backend." };
    }

    const apiBase = (saved.backendUrl || "http://localhost:5050").replace(/\/$/, "");
    const response = await fetch(`${apiBase}/api/attempts/${saved.activeAttemptId}/violations`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${saved.backendToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        type: msg.violation.type,
        message: String(msg.violation.message || "Extension detected an exam event").slice(0, 500),
        question_number: null
      })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return { ok: false, error: data.error || `Backend request failed (${response.status}).` };
    if (data.auto_submitted) {
      await chrome.storage.local.remove(["activeAttemptId", "activeAttemptTitle", "activeQuestionCount"]);
    }
    return { ok: true, violationCount: data.attempt.violation_count, autoSubmitted: data.auto_submitted };
  })().then(sendResponse).catch(error => sendResponse({ ok: false, error: error.message }));

  return true;
});
