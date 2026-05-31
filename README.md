remake your own extensions #ownit

# Freeze Tabs

A tiny, zero-permission Chrome extension (Manifest V3) that **freezes tabs** to
free up memory. Hand-rolled replacement for third-party tab suspenders.

Click the toolbar icon for a four-button popup:

| Button | What it freezes |
| --- | --- |
| **Freeze this tab** | The current tab (switches you to a neighbor first, since Chrome can't unload the visible tab). |
| **Freeze everything but this tab** | Every tab in every window except the one you're looking at. |
| **Freeze all tabs in this window** | Every tab in the current window except the one that must stay visible. |
| **Freeze all tabs** | Everything everywhere, including the current tab. |

## What "freeze" means

It calls `chrome.tabs.discard()`. Chrome unloads the page from memory but keeps
the tab in the strip; the page reloads automatically the next time you focus it.
Tabs that refuse to discard (`chrome://` pages, tabs holding a media stream) are
skipped automatically.

The popup shows a **live count** — `frozen / total`, how many are still loaded,
and how many must stay visible — and updates after every click, so you can
actually see it working. The toolbar badge shows how many tabs are still loaded
(`0` = everything that can be frozen is frozen).

## How it's verified (and two Chrome gotchas it handles)

- **`discard()` changes the tab's id.** Chrome swaps in a fresh tab object, so
  the resolved tab has a *different* id than the one you passed. Looking a tab
  up by its old id after discarding throws "No tab with id". This extension
  never relies on the old id — it reports freezes as the **net change in how
  many tabs are discarded** (snapshot before vs. after), which is accurate even
  with the id swap and even when switching off the active tab reloads a neighbor.
- **Every window keeps one visible, loaded tab.** The active tab can't be
  discarded while it's on screen, so the floor of loaded tabs equals your number
  of windows. "Freeze this tab" (and "Freeze all tabs") work around it for the
  current window by hopping focus to a neighbor first. If most of your tabs are
  already frozen, clicking freeze again correctly reports "already frozen" rather
  than pretending to do something.
- **Scale.** Freezing is done in chunks (40 at a time) so it stays reliable even
  across hundreds of tabs and dozens of windows.

## Why zero permissions

The manifest requests **no permissions and no host access**. We only read tab
*ids*, and `tabs.discard` needs no permission, so there's nothing to grant —
nothing to leak. Check `manifest.json` yourself.

## Install (load unpacked)

1. Open `chrome://extensions`
2. Toggle **Developer mode** on (top-right)
3. Click **Load unpacked**
4. Select this folder

Pin the icon from the puzzle-piece menu, then click it any time.

## Files

- `manifest.json` — MV3 manifest, popup, no permissions
- `popup.html` / `popup.js` — the four-button UI; sends a message per action
- `background.js` — service worker; does the discarding so it survives the popup closing
- `generate_icons.py` — regenerates `icons/*.png` with stdlib only (no Pillow)
