// Thin popup. It asks the service worker for live counts on open and after
// every action, so you can SEE the numbers move. The worker owns the actual
// freezing (so it finishes even if this popup closes) and the counting (it
// measures the net change in discarded tabs, which is immune to Chrome
// swapping a tab's id when it discards it).

const headline = document.getElementById("headline");
const sub = document.getElementById("sub");
const status = document.getElementById("status");
const buttons = [...document.querySelectorAll("button[data-action]")];

function send(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (res) => {
      if (chrome.runtime.lastError) {
        resolve({ error: chrome.runtime.lastError.message });
      } else {
        resolve(res || {});
      }
    });
  });
}

// Render the persistent status panel from a status/result payload.
function renderPanel(s) {
  if (s.error) {
    headline.textContent = "—";
    sub.textContent = "Error: " + s.error;
    return;
  }
  const loaded = s.total - s.frozen;
  headline.innerHTML = `<b>${s.frozen}</b> / ${s.total} tabs frozen`;
  const bits = [`${loaded} still loaded`];
  if (typeof s.visible === "number") {
    bits.push(`${s.visible} must stay visible (1 per window)`);
  }
  if (typeof s.winFrozen === "number" && typeof s.winTotal === "number") {
    bits.push(`this window: ${s.winFrozen}/${s.winTotal}`);
  }
  sub.textContent = bits.join(" · ");
}

function setBusy(busy) {
  buttons.forEach((b) => (b.disabled = busy));
}

async function refresh() {
  renderPanel(await send({ type: "STATUS" }));
}

async function freeze(action) {
  setBusy(true);
  status.className = "";
  status.textContent = "Freezing…";

  const res = await send({ type: action });
  setBusy(false);

  if (res.error) {
    status.className = "";
    status.textContent = "Error: " + res.error;
    return;
  }

  renderPanel(res);

  // Result line: prefer the true net change; fall back to explanatory notes.
  if (res.frozenNow > 0) {
    status.className = "ok";
    status.textContent = `❄️ Froze ${res.frozenNow} more tab${res.frozenNow === 1 ? "" : "s"}.`;
  } else if (res.note) {
    status.className = "";
    status.textContent = res.note + ".";
  } else if (res.attempted === 0) {
    status.className = "";
    status.textContent = "Everything freezable is already frozen.";
  } else {
    status.className = "";
    status.textContent = "No change — those tabs were already frozen.";
  }
}

buttons.forEach((b) => b.addEventListener("click", () => freeze(b.dataset.action)));

// Load the live picture as soon as the popup opens.
refresh();
