# Klair build progress

## Handoff (updated 2026-10-10 18:55 ET, by Mac session · claude-opus-5-5)
- **Milestone:** 8 (prove it) in progress on the Mac.
- **Just finished:** SQLite-first sessions. A running session writes only to SQLite on the Mac (`src/main/local.ts`, `userData/klair.db`, FTS5 search). When it ends, `src/main/upload.ts` copies it to TigerData in one transaction and the local session records its TigerData id (`remote_id`). Failed uploads retry on start, hourly and on Check again; abandoned sessions are ended and uploaded on start. TigerData is no longer needed to start a session. Unit tests cover the store; the upload was tested against a throwaway local Postgres 17 (rows, id remapping, replace-on-retry, search, delete, offline failure and queued deletes).
- **In progress:** nothing half-done
- **Next step:** run a real session with TigerData reachable, end it, and check the Sessions window says "also in TigerData" and the console prints `tigerdata: uploaded session …`. Then "resume a session" (pull back from TigerData by `remote_id`), which the user deferred.
- **Broken / failing:** TigerData's port 31846 is blocked from some networks (see 2026-10-10 notes); sessions now just wait locally and upload later.
- **Decisions made this session:** see the Decisions log
- **Blocked on / questions for the user:** none
- **How to verify current state:** `pnpm install && pnpm typecheck && pnpm lint && pnpm test && pnpm build`

---

## Milestones
- [x] 1. Connections: health, schema, IPC, windows, shortcuts, rename and packaging
- [x] 2. Panel + keys (renderer; visual check on the Mac pending)
- [x] 3. Capture → persist → notes (main process; verify on the Mac)
- [x] 4. Controller (core unit-tested)
- [x] 5. Retrieval: Graphify + TigerData search (verify on the Mac)
- [x] 6. AI: suggestions + execution (verify on the Mac)
- [x] 7. The rest: Tray / Sessions + insights / Start / States, rename/packaging, fn addon source (unbuilt)
- [ ] 8. Prove it: demo run, acceptance criteria, token measurements (needs the Mac)

## Verify on the Mac (can't be tested from the Linux build workspace)
- ~~`pnpm build:native` compiles `native/fn-key`~~ (compiles cleanly, 2026-10-10); still to check: fn tap opens Klair, fn+P / fn+Q work
- `pnpm dev` launches; flower window top-right; ⌃⌥K opens the panel
- Health: OpenRouter slugs `anthropic/claude-haiku-5.5` / `anthropic/claude-sonnet-5.5` accept images; TigerData migrate output (`tigerdata: … unavailable` lines in the console show which optional features failed)
- Screen Recording prompt and capture; `setContentProtection` hides Klair windows from captures
- `graphify extract` against OpenRouter; `graphify query` returns text
- Panel focus and return-focus-on-close (`app.hide()` + `flower.showInactive()`); vibrancy look

## Health checks
- 2026-10-10, packaged app: screen=ok, openrouter=ok, graphify=ok, cache=ok, fnkey=warn (Input Monitoring not yet granted), tigerdata=fail (port 31846 blocked by the network)

## Stubs and simulations
- fn key: `native/fn-key/src/fn_key.c` compiles and loads; the event tap itself is unverified until Input Monitoring is granted. ⌃⌥K / ⌃⌥P / ⌃⌥Q work as fallbacks.
- The headless preview in the build workspace used mock data. No real model, database or capture has run yet.

## Decisions log
- 2026-10-10: TigerData replaces SQLite for canonical records; screenshots stay local.
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
