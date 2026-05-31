// Freeze Tabs — service worker (Manifest V3)
//
// The popup sends one of four message types; this worker does the actual
// discarding so the work completes even if the popup closes mid-batch.
//
// "Freeze" = chrome.tabs.discard(): Chrome unloads the page from memory but
// keeps the tab in the strip; it reloads automatically when next focused.
// Only tab *ids* are used (never url/title), so this needs zero permissions.

// Discard a list of tabs in parallel. discard() resolves with the discarded
// Tab on success, or a falsy value if Chrome declined (chrome:// pages, tabs
// holding a media stream, etc.). allSettled means one stubborn tab never
// aborts the batch. Returns how many actually froze.
async function discardList(tabs) {
  const results = await Promise.allSettled(
    tabs.map((t) => chrome.tabs.discard(t.id))
  );
  return results.filter((r) => r.status === "fulfilled" && r.value).length;
}

// Chrome refuses to discard the tab that's currently visible in a window. To
// freeze it anyway we hop focus to a neighbor in the same window first, then
// discard the tab we left. Returns 1 if we froze it, 0 if there was no other
// tab to land on (it's the only tab in the window).
async function freezeActiveBySwitching() {
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!active || active.discarded) return 0;

  const winTabs = await chrome.tabs.query({ currentWindow: true });
  const neighbor = winTabs.find((t) => t.id !== active.id);
  if (!neighbor) return 0;

  await chrome.tabs.update(neighbor.id, { active: true });
  const discarded = await chrome.tabs.discard(active.id);
  return discarded ? 1 : 0;
}

const HANDLERS = {
  // Freeze the current tab (switching you to a neighbor so it can unload).
  FREEZE_THIS: () => freezeActiveBySwitching(),

  // Freeze every tab in every window except the one you're looking at.
  FREEZE_OTHERS: async () => {
    const tabs = await chrome.tabs.query({});
    return discardList(tabs.filter((t) => !t.active && !t.discarded));
  },

  // Freeze every tab in the current window except the one that must stay
  // visible. (Chrome always keeps one loaded tab per window.)
  FREEZE_WINDOW: async () => {
    const tabs = await chrome.tabs.query({ currentWindow: true });
    return discardList(tabs.filter((t) => !t.active && !t.discarded));
  },

  // Freeze everything everywhere, including the current tab (via the
  // switch-to-neighbor trick). Each other window still keeps its visible tab.
  FREEZE_ALL: async () => {
    const tabs = await chrome.tabs.query({});
    const others = await discardList(tabs.filter((t) => !t.active && !t.discarded));
    const self = await freezeActiveBySwitching();
    return others + self;
  },
};

function flashBadge(count) {
  chrome.action.setBadgeBackgroundColor({ color: "#3b82f6" });
  chrome.action.setBadgeText({ text: count > 0 ? String(count) : "" });
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const handler = HANDLERS[message?.type];
  if (!handler) return false; // not ours — let other listeners handle it

  handler()
    .then((frozen) => {
      flashBadge(frozen);
      sendResponse({ frozen });
    })
    .catch((err) => sendResponse({ frozen: 0, error: String(err) }));

  return true; // keep the message channel open for the async sendResponse
});
