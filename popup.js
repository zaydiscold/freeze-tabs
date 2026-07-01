// Thin popup. The service worker owns freezing (so it finishes even if this
// popup closes) and counting (net change in discarded tabs, immune to Chrome
// swapping a tab's id when it discards it). v1.3.0 adds the settings panel.

const headline = document.getElementById("headline");
const sub = document.getElementById("sub");
const status = document.getElementById("status");
const buttons = [...document.querySelectorAll("button[data-action]")];

function send(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (res) => {
      if (chrome.runtime.lastError) resolve({ error: chrome.runtime.lastError.message });
      else resolve(res || {});
    });
  });
}

function renderPanel(s) {
  if (s.error) {
    headline.textContent = "—";
    sub.textContent = "Error: " + s.error;
    return;
  }
  const loaded = s.total - s.frozen;
  headline.innerHTML = `<b>${s.frozen}</b> / ${s.total} tabs frozen`;
  const bits = [`${loaded} still loaded`];
  if (typeof s.visible === "number") bits.push(`${s.visible} must stay visible (1 per window)`);
  if (typeof s.winFrozen === "number" && typeof s.winTotal === "number") bits.push(`this window: ${s.winFrozen}/${s.winTotal}`);
  sub.textContent = bits.join(" · ");
}

const setBusy = (busy) => buttons.forEach((b) => (b.disabled = busy));

async function refresh() {
  renderPanel(await send({ type: "STATUS" }));
}

async function freeze(action) {
  setBusy(true);
  status.className = "";
  status.textContent = "Freezing…";
  const res = await send({ type: action });
  setBusy(false);

  if (res.error) { status.className = ""; status.textContent = "Error: " + res.error; return; }
  renderPanel(res);

  if (res.frozenNow > 0) {
    status.className = "ok";
    status.textContent = `❄️ Froze ${res.frozenNow} more tab${res.frozenNow === 1 ? "" : "s"}.`;
  } else if (res.note) {
    status.className = ""; status.textContent = res.note + ".";
  } else if (res.attempted === 0) {
    status.className = ""; status.textContent = "Everything freezable is already frozen.";
  } else {
    status.className = ""; status.textContent = "No change — those tabs were already frozen.";
  }
}

buttons.forEach((b) => b.addEventListener("click", () => freeze(b.dataset.action)));

// ---- settings panel --------------------------------------------------------
const ctrl = {
  auto: document.getElementById("auto"),
  idle: document.getElementById("idle"),
  skipPinned: document.getElementById("skipPinned"),
  skipAudible: document.getElementById("skipAudible"),
  protectForms: document.getElementById("protectForms"),
};

async function loadSettings() {
  const s = await send({ type: "GET_SETTINGS" });
  ctrl.auto.checked = !!s.auto;
  ctrl.idle.value = s.idleMinutes ?? 30;
  ctrl.skipPinned.checked = s.skipPinned !== false;
  ctrl.skipAudible.checked = s.skipAudible !== false;
  ctrl.protectForms.checked = !!s.protectForms;
}

async function saveSettings(patch) {
  await send({ type: "SET_SETTINGS", settings: patch });
}

ctrl.auto.addEventListener("change", () => saveSettings({ auto: ctrl.auto.checked }));
ctrl.idle.addEventListener("change", () => {
  const v = Math.min(1440, Math.max(1, parseInt(ctrl.idle.value, 10) || 30));
  ctrl.idle.value = v;
  saveSettings({ idleMinutes: v });
});
ctrl.skipPinned.addEventListener("change", () => saveSettings({ skipPinned: ctrl.skipPinned.checked }));
ctrl.skipAudible.addEventListener("change", () => saveSettings({ skipAudible: ctrl.skipAudible.checked }));

// Turning on form protection needs scripting + host access — request it from
// this user gesture; revert the checkbox if the user declines.
ctrl.protectForms.addEventListener("change", async () => {
  if (ctrl.protectForms.checked) {
    let granted = false;
    try { granted = await chrome.permissions.request({ permissions: ["scripting"], origins: ["<all_urls>"] }); }
    catch { granted = false; }
    if (!granted) { ctrl.protectForms.checked = false; status.textContent = "Permission needed for unsaved-text protection."; return; }
  }
  saveSettings({ protectForms: ctrl.protectForms.checked });
});

document.getElementById("shortcuts").addEventListener("click", (e) => {
  e.preventDefault();
  chrome.tabs.create({ url: "chrome://extensions/shortcuts" });
});

loadSettings();
refresh();
