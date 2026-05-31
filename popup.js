// Popup UI: each button fires a message to the service worker, which does the
// freezing and replies with how many tabs it froze. We keep the popup logic
// thin on purpose — the worker owns the work so it survives the popup closing.

const status = document.getElementById("status");

function freeze(action) {
  status.textContent = "Freezing…";
  chrome.runtime.sendMessage({ type: action }, (res) => {
    // lastError fires if the worker didn't respond (e.g. it was asleep and the
    // message raced). Surface it instead of failing silently.
    if (chrome.runtime.lastError) {
      status.textContent = "Error: " + chrome.runtime.lastError.message;
      return;
    }
    const n = res && typeof res.frozen === "number" ? res.frozen : 0;
    if (res && res.error) {
      status.textContent = "Error: " + res.error;
    } else if (n === 0) {
      status.textContent = "Nothing to freeze.";
    } else {
      status.textContent = `Froze ${n} tab${n === 1 ? "" : "s"}.`;
    }
  });
}

document.querySelectorAll("button[data-action]").forEach((btn) => {
  btn.addEventListener("click", () => freeze(btn.dataset.action));
});
