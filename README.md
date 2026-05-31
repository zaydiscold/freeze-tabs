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
skipped automatically. The toolbar badge shows how many tabs were frozen.

> **Chrome rule:** every window must keep exactly one visible, loaded tab — the
> active tab can't be discarded while it's on screen. "Freeze this tab" works
> around this by hopping focus to a neighbor first.

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
