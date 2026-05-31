// Freeze Tabs — service worker (Manifest V3)
//
// "Freeze" = chrome.tabs.discard(): Chrome unloads the page from memory but
// keeps the tab in the strip; it reloads automatically when next focused.
// Only tab *ids* are read (never url/title), so this needs ZERO permissions.
//
// Two Chrome behaviors shape everything below:
//   1. discard() REPLACES the tab — the returned Tab has a *different id* than
//      the one you passed. So we never trust an old id after discarding; we
//      measure success by the NET change in how many tabs are discarded.
//   2. Every window must keep exactly one visible (active) tab loaded. The
//      active tab can't be discarded while on screen. So the floor of loaded
//      tabs equals the number of windows.

const CHUNK = 40; // discard in batches so we don't hammer Chrome at scale

// Discard a list of tab ids in chunks. Returns how many calls Chrome accepted
// (resolved with a discarded Tab) vs. refused (chrome:// pages, media, etc.).
// Chunking + awaiting each batch keeps the MV3 worker alive via continuous
// extension-API activity, so big freezes (hundreds of tabs) complete reliably.
async function discardInChunks(ids) {
  let accepted = 0;
  let refused = 0;
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

// Freeze the tab you're currently looking at. Chrome won't discard the visible
// tab, so we hop focus to a neighbor first, then discard the one we left.
async function freezeActiveBySwitching() {
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!active) return { attempted: 0, note: "no active tab" };
  if (active.discarded) return { attempted: 0, note: "this tab is already frozen" };

  const winTabs = await chrome.tabs.query({ currentWindow: true });
  const neighbor = winTabs.find((t) => t.id !== active.id);
  if (!neighbor) return { attempted: 0, note: "only tab in this window — nothing to switch to" };

  await chrome.tabs.update(neighbor.id, { active: true });
  try {
    await chrome.tabs.discard(active.id);
  } catch (_) {
    return { attempted: 1, note: "Chrome refused to freeze this tab" };
  }
  return { attempted: 1, note: null };
}

function countDiscarded(tabs) {
  return tabs.filter((t) => t.discarded).length;
}

// Run one of the four freeze actions. We snapshot the discarded-count before
// and after so the reported "frozen N more" is the true net change — immune to
// the id-swap and to a neighbor reloading when we switch off the active tab.
async function runFreeze(type) {
  const before = await chrome.tabs.query({});
  const frozenBefore = countDiscarded(before);

  let attempted = 0;
  let note = null;

  if (type === "FREEZE_THIS") {
    const r = await freezeActiveBySwitching();
    attempted = r.attempted;
    note = r.note;
  } else {
    // OTHERS + ALL operate on every window; WINDOW only on the current one.
    const scope =
      type === "FREEZE_WINDOW"
        ? await chrome.tabs.query({ currentWindow: true })
        : before;
    const ids = scope.filter((t) => !t.discarded && !t.active).map((t) => t.id);
    attempted = ids.length;
    await discardInChunks(ids);

    // "Freeze all tabs" also grabs the current tab (switching you off it);
    // "everything but this tab" deliberately leaves your current tab visible.
    if (type === "FREEZE_ALL") {
      const r = await freezeActiveBySwitching();
      attempted += r.attempted;
      if (r.note && r.attempted === 0) note = r.note;
    }
  }

  const after = await chrome.tabs.query({});
  return buildStatus(after, {
    frozenNow: Math.max(0, countDiscarded(after) - frozenBefore),
    attempted,
    note,
  });
}

// Live picture of the tab landscape — used both for the popup's on-open panel
// and folded into every action result.
function buildStatus(allTabs, extra = {}) {
  return {
    total: allTabs.length,
    frozen: countDiscarded(allTabs),
    visible: allTabs.filter((t) => t.active).length, // == window count (floor)
    ...extra,
  };
}

async function status() {
  const all = await chrome.tabs.query({});
  const win = await chrome.tabs.query({ currentWindow: true });
  return {
    ...buildStatus(all),
    winTotal: win.length,
    winFrozen: countDiscarded(win),
  };
}

function flashBadge(total, frozen) {
  chrome.action.setBadgeBackgroundColor({ color: "#3b82f6" });
  // show how many are still loaded (total - frozen); 0 = everything frozen
  const loaded = total - frozen;
  chrome.action.setBadgeText({ text: loaded > 0 ? String(loaded) : "0" });
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const type = message && message.type;

  const work =
    type === "STATUS"
      ? status()
      : ["FREEZE_THIS", "FREEZE_OTHERS", "FREEZE_WINDOW", "FREEZE_ALL"].includes(type)
      ? runFreeze(type)
      : null;

  if (!work) return false; // not ours

  work
    .then((res) => {
      flashBadge(res.total, res.frozen);
      sendResponse(res);
    })
    .catch((err) => sendResponse({ error: String(err) }));

  return true; // async sendResponse
});
