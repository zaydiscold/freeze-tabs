// Freeze Tabs — service worker (Manifest V3) — v1.3.0
//
// "Freeze" = chrome.tabs.discard(): Chrome unloads the page from memory but
// keeps the tab in the strip; it reloads automatically when next focused.
//
// v1.3.0 adds, without giving up the privacy stance:
//   - Auto-freeze idle tabs (alarms + a per-tab last-active clock).
//   - Guards: never freeze the active tab, pinned tabs, or audio-playing tabs.
//     Pinned acts as the "never freeze" list, so we NEVER read your URLs/titles
//     (that would need the "tabs" permission). pinned/audible/active/discarded
//     are non-sensitive Tab fields available with zero permissions.
//   - Keyboard shortcuts (chrome.commands).
//   - OPTIONAL unsaved-text guard: only if you opt in does it request
//     "scripting" + host access to peek for dirty form fields before freezing.
//
// Default permissions stay tiny: "alarms" + "storage". No host access.
//
// Two Chrome behaviors still shape everything:
//   1. discard() REPLACES the tab — the returned Tab has a *different id*. So we
//      measure success by the NET change in how many tabs are discarded.
//   2. Every window must keep exactly one visible (active) tab loaded.

const CHUNK = 40;
const SCAN_ALARM = "auto-scan";
const ACT_KEY = "activity"; // storage.session: { [tabId]: lastActiveMs }
const SET_KEY = "settings"; // storage.local

const DEFAULTS = {
  auto: false,
  idleMinutes: 30,
  skipPinned: true,
  skipAudible: true,
  protectForms: false,
};

// ---- settings + activity clock --------------------------------------------
async function getSettings() {
  const s = (await chrome.storage.local.get(SET_KEY))[SET_KEY] || {};
  return { ...DEFAULTS, ...s };
}
async function getActivity() {
  return (await chrome.storage.session.get(ACT_KEY))[ACT_KEY] || {};
}
async function setActivity(a) {
  await chrome.storage.session.set({ [ACT_KEY]: a });
}
async function touch(tabId) {
  const a = await getActivity();
  a[tabId] = Date.now();
  await setActivity(a);
}

// ---- core discard ----------------------------------------------------------
async function discardInChunks(ids) {
  let accepted = 0, refused = 0;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const batch = ids.slice(i, i + CHUNK);
    const results = await Promise.allSettled(batch.map((id) => chrome.tabs.discard(id)));
    for (const r of results) {
      if (r.status === "fulfilled" && r.value && r.value.discarded) accepted++;
      else refused++;
    }
  }
  return { accepted, refused };
}

async function freezeActiveBySwitching() {
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!active) return { attempted: 0, note: "no active tab" };
  if (active.discarded) return { attempted: 0, note: "this tab is already frozen" };
  const winTabs = await chrome.tabs.query({ currentWindow: true });
  const neighbor = winTabs.find((t) => t.id !== active.id);
  if (!neighbor) return { attempted: 0, note: "only tab in this window — nothing to switch to" };
  await chrome.tabs.update(neighbor.id, { active: true });
  try { await chrome.tabs.discard(active.id); }
  catch (_) { return { attempted: 1, note: "Chrome refused to freeze this tab" }; }
  return { attempted: 1, note: null };
}

const countDiscarded = (tabs) => tabs.filter((t) => t.discarded).length;

// Eligibility for bulk + auto freezing. NOT applied to FREEZE_THIS (explicit).
function eligible(t, s) {
  if (t.discarded || t.active) return false;
  if (s.skipPinned && t.pinned) return false;
  if (s.skipAudible && t.audible) return false;
  return true;
}

async function runFreeze(type) {
  const s = await getSettings();
  const before = await chrome.tabs.query({});
  const frozenBefore = countDiscarded(before);
  let attempted = 0, note = null;

  if (type === "FREEZE_THIS") {
    const r = await freezeActiveBySwitching();
    attempted = r.attempted; note = r.note;
  } else {
    const scope = type === "FREEZE_WINDOW" ? await chrome.tabs.query({ currentWindow: true }) : before;
    const ids = scope.filter((t) => eligible(t, s)).map((t) => t.id);
    attempted = ids.length;
    await discardInChunks(ids);
    if (type === "FREEZE_ALL") {
      const r = await freezeActiveBySwitching();
      attempted += r.attempted;
      if (r.note && r.attempted === 0) note = r.note;
    }
  }

  const after = await chrome.tabs.query({});
  return buildStatus(after, {
    frozenNow: Math.max(0, countDiscarded(after) - frozenBefore),
    attempted, note,
  });
}

function buildStatus(allTabs, extra = {}) {
  return {
    total: allTabs.length,
    frozen: countDiscarded(allTabs),
    visible: allTabs.filter((t) => t.active).length,
    ...extra,
  };
}

async function status() {
  const all = await chrome.tabs.query({});
  const win = await chrome.tabs.query({ currentWindow: true });
  return { ...buildStatus(all), winTotal: win.length, winFrozen: countDiscarded(win) };
}

function flashBadge(total, frozen) {
  chrome.action.setBadgeBackgroundColor({ color: "#3b82f6" });
  const loaded = total - frozen;
  chrome.action.setBadgeText({ text: loaded > 0 ? String(loaded) : "0" });
}

// ---- auto-freeze -----------------------------------------------------------
async function applyAutoAlarm() {
  const s = await getSettings();
  if (s.auto) chrome.alarms.create(SCAN_ALARM, { periodInMinutes: 1 });
  else chrome.alarms.clear(SCAN_ALARM);
}

async function hasUnsavedForms(tabId) {
  try {
    const [r] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const textish = new Set(["text", "search", "email", "url", "tel", "password", "number"]);
        for (const el of document.querySelectorAll("input, textarea")) {
          if ((el.tagName === "TEXTAREA" || textish.has(el.type)) && el.value && el.value.length) return true;
        }
        for (const el of document.querySelectorAll('[contenteditable="true"], [contenteditable=""]')) {
          if ((el.textContent || "").trim()) return true;
        }
        return false;
      },
    });
    return !!r?.result;
  } catch { return false; } // can't inject (chrome:// etc.) → treat as not dirty
}

async function autoScan() {
  const s = await getSettings();
  if (!s.auto) return;
  const cutoff = Date.now() - s.idleMinutes * 60000;
  const tabs = await chrome.tabs.query({});

  // Seed unseen tabs to "now" so freshly-opened tabs get a full idle window.
  const act = await getActivity();
  let changed = false;
  for (const t of tabs) if (act[t.id] == null) { act[t.id] = Date.now(); changed = true; }
  if (changed) await setActivity(act);

  let candidates = tabs.filter((t) => eligible(t, s) && (act[t.id] || 0) <= cutoff);
  if (!candidates.length) return;

  if (s.protectForms) {
    const ok = await chrome.permissions.contains({ permissions: ["scripting"], origins: ["<all_urls>"] });
    if (ok) {
      const safe = [];
      for (const t of candidates) if (!(await hasUnsavedForms(t.id))) safe.push(t);
      candidates = safe;
    }
  }
  await discardInChunks(candidates.map((t) => t.id));
}

// ---- listeners -------------------------------------------------------------
chrome.tabs.onActivated.addListener(({ tabId }) => touch(tabId));
chrome.tabs.onCreated.addListener((t) => touch(t.id));
chrome.tabs.onUpdated.addListener((tabId, info) => { if (info.status === "complete") touch(tabId); });
chrome.tabs.onRemoved.addListener(async (tabId) => {
  const a = await getActivity();
  if (a[tabId] != null) { delete a[tabId]; await setActivity(a); }
});
chrome.tabs.onReplaced.addListener(async (addedId, removedId) => {
  const a = await getActivity();
  a[addedId] = Date.now();
  delete a[removedId];
  await setActivity(a);
});

chrome.alarms.onAlarm.addListener((al) => { if (al.name === SCAN_ALARM) autoScan(); });
chrome.runtime.onStartup.addListener(applyAutoAlarm);
chrome.runtime.onInstalled.addListener(applyAutoAlarm);

const CMD_MAP = {
  "freeze-this": "FREEZE_THIS",
  "freeze-others": "FREEZE_OTHERS",
  "freeze-window": "FREEZE_WINDOW",
  "freeze-all": "FREEZE_ALL",
};
chrome.commands.onCommand.addListener(async (cmd) => {
  const type = CMD_MAP[cmd];
  if (!type) return;
  const res = await runFreeze(type);
  flashBadge(res.total, res.frozen);
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const type = message && message.type;

  let work = null;
  if (type === "STATUS") work = status();
  else if (type === "GET_SETTINGS") work = getSettings();
  else if (type === "SET_SETTINGS") {
    work = (async () => {
      const next = { ...(await getSettings()), ...(message.settings || {}) };
      await chrome.storage.local.set({ [SET_KEY]: next });
      await applyAutoAlarm();
      return next;
    })();
  } else if (["FREEZE_THIS", "FREEZE_OTHERS", "FREEZE_WINDOW", "FREEZE_ALL"].includes(type)) {
    work = runFreeze(type);
  }

  if (!work) return false;

  work
    .then((res) => {
      if (res && typeof res.total === "number") flashBadge(res.total, res.frozen);
      sendResponse(res);
    })
    .catch((err) => sendResponse({ error: String(err) }));
  return true; // async sendResponse
});
