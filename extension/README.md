# Klair for Chrome

Sends the full text of the pages you open in Chrome to the Klair app on this Mac while a Klair session is observing, so ideas and answers can use the whole page instead of only what a screenshot shows.

**Install:** `chrome://extensions` › Developer mode › Load unpacked › this folder. The `key` in `manifest.json` fixes the extension id at `jndibkpbjoldneahpgmofeoekkpeaepo`, which is the only id Klair accepts.

- `content.js` reads `document.body.innerText` (the whole rendered page, up to 200k characters) on load, again after late content arrives, on in-app URL changes, and when you switch back to the tab.
- `background.js` posts it to `http://127.0.0.1:47821/v1/page` and checks in at `/v1/status` every minute.
- `popup.html` shows whether Klair is observing, what happened to the last page, and an on/off switch.

Nothing is sent from incognito windows. Klair drops pages unless a session is observing. See the main README's "Chrome extension" section.
