# Klair for Chrome

Sends the full text of the pages you open in Chrome to the Klair app on this Mac while a Klair session is observing, so ideas and answers can use the whole page instead of only what a screenshot shows, and marks the passages Klair's answers are about.

**Install:** `chrome://extensions` › Developer mode › Load unpacked › this folder. The `key` in `manifest.json` fixes the extension id at `jndibkpbjoldneahpgmofeoekkpeaepo`. Klair accepts requests carrying that origin, or no Origin header at all (Chrome may leave it off extension requests), and refuses any other origin. After pulling new extension code, click reload ↻ on the extension's card.

- `content.js` reads `document.body.innerText` (the whole rendered page, up to 200k characters) on load, again after late content arrives, on in-app URL changes, and when you switch back to the tab.
- `background.js` posts it to `http://127.0.0.1:47821/v1/page` and checks in at `/v1/status` every minute.
- After an answer about the page on screen, `content.js` asks Klair for the passages it marked (`GET /v1/highlights`, through `background.js`) and highlights them in place with the CSS Custom Highlight API (styles in `highlight.css`), with a numbered badge beside each that shows Klair's note on hover. The page's own markup isn't changed; **Clear highlights** in a note hides them.
- `popup.html` shows whether Klair is observing (or refused the extension), what happened to the last page, and an on/off switch.
- `condense.js` is "hold fn, click a paragraph": a click on a paragraph (or list item, quote, table cell) with at least 80 characters asks Klair, through `background.js`, whether fn is held (`POST /v1/fn`; a web page can't see the fn key itself). If it is, the paragraph is swapped for a loading shimmer and a one-to-three sentence version streams in from `POST /v1/condense`, written with the active project's notes in mind. A small **original** switch after it shows the page's own text again. It works whenever Klair is running, session or not; only the paragraph and the page title are sent. Links, buttons and text you are typing are left alone.
- PDFs opened in Chrome's built-in viewer can't be read by extensions; download them and add them in Klair instead.

Nothing is sent from incognito windows. Klair drops pages unless a session is observing. See the main README's "Chrome extension" section.
