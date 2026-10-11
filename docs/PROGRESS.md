# Klair build progress

## Handoff (updated 2026-10-10 21:40 ET, by Mac session · claude-opus-5-5)
- **Milestone:** 8 (prove it) in progress on the Mac. Features beyond the brief were added at the user's request: SQLite-first sessions with upload to TigerData, the Chrome extension, select an area (⌘S) and adding downloads.
- **Just finished:** adding downloads (`feature/download-pdf`, not merged to `main` yet) and a docs refresh (`fix/md-update`, built on it): README rewritten to match the code, CLAUDE.md, TIGERDATA.md, extension README and `.env.example` updated, PLAN.md marked historical.
- **Branches:** `main` (pushed) has everything through select an area. `feature/download-pdf` adds downloads; `fix/md-update` adds the docs on top of it.
- **In progress:** nothing half-done
- **Next step:** merge `feature/download-pdf` (and these docs) into `main`; then walk "Verify on the Mac" below. After that, the deferred "resume a session" (pull it back from TigerData by `remote_id`).
- **Broken / failing:** nothing known. TigerData's port 31846 is blocked on some networks; sessions then wait on the Mac and upload later.
- **Decisions made this session:** see the Decisions log
- **Blocked on / questions for the user:** none
- **How to verify current state:** `pnpm install && pnpm typecheck && pnpm lint && pnpm test && pnpm build`, then `pnpm dev`

---

## Milestones
- [x] 1. Connections: health, schema, IPC, windows, shortcuts, rename and packaging
- [x] 2. Panel + keys
- [x] 3. Capture → persist → notes (seen working in real sessions)
- [x] 4. Controller (core unit-tested)
- [x] 5. Retrieval: Graphify + local and TigerData search
- [x] 6. AI: suggestions + execution
- [x] 7. The rest: Tray / Sessions + insights / Start / States, rename/packaging, fn addon
- [ ] 8. Prove it: demo run, acceptance criteria, token measurements

## Seen working on the Mac (2026-10-10)
- `pnpm dev` and the packaged `Klair.app` launch; Screen Recording allowed; real sessions captured screenshots and wrote notes (Gemini via OpenRouter).
- fn addon compiles and loads (health `fnkey=ok` once Input Monitoring was granted).
- Ideas follow the screen while the panel is open (user confirmed).
- Chrome extension connected to a session; a page was stored and linked to a screenshot.
- TigerData connection works on a network that allows port 31846.

## Verify on the Mac (not confirmed yet)
- fn tap opens Klair; fn P / fn Q
- A session ending and uploading to TigerData (console `tigerdata: uploaded session …`; Sessions window "also in TigerData")
- Select an area: the saved crop matches the dragged rectangle (multi-display and Retina)
- Adding a real browser download end to end, and the Downloads folder permission prompt
- `graphify extract` / `graphify query` on a real session
- The demo script in README.md, and token measurements (`KLAIR_BASELINE=full`)

## Health checks
- 2026-10-10, packaged app: screen=ok, fnkey=ok, local=ok, openrouter=ok, graphify=ok, cache=ok, browser=ok once the extension checked in; tigerdata=ok on an open network (fail on networks that block port 31846).

## Stubs and simulations
- Answers are text only; the code, slider-plot and quiz blocks in `src/shared/blocks.ts` are parked (see `execute.ts`).
- "Resume a session" (pull it back from TigerData) is not built; local sessions record `remote_id` for it.

## Decisions log
- 2026-10-10: (superseded by SQLite-first sessions, below) TigerData replaces SQLite for canonical records; screenshots stay local.
- 2026-10-10: `.env.local` is loaded before `.env` (the team's keys are in `.env.local`).
- 2026-10-10: the panel handles ⌘ keys itself while focused; there are no global ⌘ registrations.
- 2026-10-10: privacy copy deviates from BUILD_PROMPT §2: each new screen is sent to Claude for a vision note, so the copy says so instead of "only the relevant ones".
- 2026-10-10: Vite inlines small fonts as data: URLs, so the CSP allows `font-src 'self' data:`.
- 2026-10-10: reopening the panel shows ideas unless an answer is still streaming.
- 2026-10-10: Graphify is installed with Homebrew + pipx (`brew install pipx && pipx install graphifyy`), not uv. Klair finds `graphify` in ~/.local/bin, /opt/homebrew/bin, /usr/local/bin or the login shell's PATH; GRAPHIFY_BIN is optional.
- 2026-10-10: `KLAIR_BASELINE=full` swaps retrieval for all session notes, for token comparisons (`userData/metrics.jsonl`).
- 2026-10-10: `pnpm app` copies `.env.local` / `.env` into `~/Library/Application Support/Klair` (`scripts/copy-env.sh`). A symlink into ~/Downloads made macOS block Klair's startup on a folder-access prompt.
- 2026-10-10: the fn health check retries the event tap, and the Allow button sends the Input Monitoring request; only that request makes Klair appear in System Settings.
- 2026-10-10: a second launch exits with `app.exit(0)` and focuses the Start window of the running Klair.
- 2026-10-10: the Screen recording row says which app macOS files the grant under (in `pnpm dev`, the terminal's host app, e.g. Visual Studio Code) and that it must be quit and reopened; macOS ignores a new grant until then.
- 2026-10-10: SQLite-first sessions (user request). Live writes go to `local.ts`; TigerData receives each session when it ends (`upload.ts`) and serves earlier-session search, insights for uploaded sessions and retention. Local copies are kept until retention (user's choice); "resume" (pull a session back) is deferred. This replaces "TigerData replaces SQLite for canonical records" above.
- 2026-10-10: session folders are `sessions/local-<id>` (local SQLite ids), so they can't collide with older folders named after TigerData ids.
- 2026-10-10: TigerData schema additions for uploads: `sessions.local_key` (unique; a retried upload replaces the earlier copy) and `local_id` on captures, suggestion_sets, actions and notes (id remapping in one round trip per table).
- 2026-10-10: a screen change now always invalidates shown ideas (MEGA_PROMPT failure table), also while the panel is open; with the panel open, ideas for the new screen are requested at once. Previously open-panel ideas were kept, so picks ran against an older page (seen in a real session: Google-tab ideas picked on the ML article).
- 2026-10-10: capture checks the screen every interval but stores a frame only when ≥5% of 64×40 grey cells moved by >24 levels versus the last *stored* frame (or the window title/URL changed). Measured on Wikipedia pages: page switches and scrolls 17–45%, pointer/clock under 0.5%.
- 2026-10-10: Chrome extension (`extension/`, MV3) sends each page's full rendered text to `bridge.ts` (127.0.0.1:47821, only `Origin: chrome-extension://jndibkpbjoldneahpgmofeoekkpeaepo`, pinned by the manifest key; Host checked against DNS rebinding). Pages are stored per session (`pages`, note, Graphify file), offered to the note model with each screenshot (15k chars), linked to captures when the model says the screenshot shows the page (`captures.page_id`), and sent with answers (60k chars). Uploaded to TigerData with the session. Verified: bridge unit tests, page upload on a throwaway Postgres, content script on real pages via Chrome DevTools, bridge inside the built app. Not verified: loading the unpacked extension in Chrome (Chrome 154 ignores --load-extension), so the pinned id is computed, not observed.
- 2026-10-10: Select an area (panel button / ⌘S): overlay window per display (`#/select`, content-protected), full-resolution crop via `captureArea`, stored as `captures.source = 'selection'` (SQLite + TigerData), note prompted to focus on it, then pinned as the context (`ControllerCore.pin/unpin`) until "Use whole screen" or a new selection; its image goes with answers. Verified: core pin/unpin and store tests; overlay and panel rendered with mock data in the browser pane (drag → rect sent). Not verified on the Mac: the real capture/crop (needs Screen Recording in a running session).
- 2026-10-10: Downloads → session (user request; opt-in per file). `downloads.ts` watches the Downloads folder while observing (temp names skipped, size must settle, files from before the session ignored; async fs so a TCC prompt can't block). Offers show beside the flower and in the panel; on Add, `files.ts` extracts text with macOS tools only (PDFKit via osascript JXA, textutil, unzip for pptx/xlsx, UTF-8 for text; images described by the vision model), stored as `files` + note (`notes.file_id`) + Graphify file, uploaded to TigerData. Newest file (20 min) goes with answers. Verified: watcher/extraction tests (incl. a cupsfilter-printed PDF), store test, file upload on a throwaway Postgres, pill and cards rendered with mock data. Not verified on the Mac: a real browser download end to end and the Downloads permission prompt.
