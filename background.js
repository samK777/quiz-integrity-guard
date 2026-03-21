chrome.runtime.onInstalled.addListener(() => {
  console.log("📦 Exam Monitor Installed");
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "TAKE_SCREENSHOT") {
    chrome.tabs.captureVisibleTab(null, { format: "png" }, (img) => {
      if (chrome.runtime.lastError) {
        console.error("Capture Error:", chrome.runtime.lastError);
        return;
      }
      console.log("📸 Screenshot captured!");
    });
  }
});
