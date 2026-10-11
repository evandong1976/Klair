# Klair build progress

## Handoff (updated 2026-10-11 08:10 ET, by Mac session · claude-opus-5-5)
- **Milestone:** 8 (prove it) in progress on the Mac.
- **Just finished (on `main` as `d6008be`; the maths rendering is on branch `latex-answers`):** project types (work, study, research) with a fixed menu of options each; the note call picks menu entries instead of writing ideas; three standing options shown at once, then the checked list; All options (⌘O); change type (⌘T, chip in the panel, chips in Start); "Do it for me" (opens one checked web page or app); pixel type icons. Also: fn-click on a bulleted item shortens its whole list (`extension/condense.js`, `src/main/condense.ts`). And: answers draw LaTeX maths with KaTeX, keep numbered steps, sub-bullets and line breaks, and show fenced code with a Copy button (`src/shared/markdown.ts`, `components/blocks.tsx`).
- **Already merged to `main` today:** project brief + relevance judge, the ideas pill that hides itself, fn-click paragraph condense.
- **In progress:** nothing half-done
- **Next step:** on the Mac with `pnpm dev`: open the panel right after a screen change and watch the three standing tiles become the checked list; press ⌘O and ⌘T; in a work project, put a missing-API-key error on screen and pick "Do it for me". Then merge `latex-answers`.
- **Broken / failing:** nothing known. TigerData's port 31846 is blocked on some networks (projects then upload later).
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
- 2026-10-10: merged the teammate's session-flow commit with downloads and the docs. Kept from the teammate: screen changes are held while the panel is open (this supersedes "ideas follow the screen while the panel is open" above) and retrieval stays within the current session (TigerData search no longer feeds answers). Downloads' file labels and per-session offer reset were fitted into that (`enterSession`, session-only search).
- 2026-10-10: Graphify had never produced a graph: Klair uses its OpenAI backend (to reach OpenRouter), which needs the optional `openai` package, and `pipx install graphifyy` leaves it out. Fixed on this Mac with `pipx inject graphifyy openai`; README installs `graphifyy[openai]`; the health check now tests `import openai` with Graphify's own Python (via the pipx symlink or pip's sh launcher) and failed builds show Graphify's error with the fix. After each build `graphify export html` writes graph.html.
- 2026-10-10: projects own the context; sessions are only time (user decision). SQLite: `sessions` renamed to `projects`, `session_id` → `project_id` everywhere, new `sessions` (time) and `project_spans`; one-time migration (each old session becomes a project with the same id/name/slot/data, its time becomes a session + span, its folder moves sessions/local-<id> → projects/local-<id>, stored paths rewritten). TigerData: the same rename in `migrate()` (activity_by_minute dropped and rebuilt on project_id), `project_spans` table, upload per project (replace by local_key) after each session. The user picks the active project (Start window, fn/⌃⌥1–9, panel chip); switching keeps the session running and resets the screen context (`ControllerCore.resetContext`). Retrieval, ideas' "so far" context, the context judge, indexing and the KLAIR_BASELINE comparison are per project. Retention prunes old context from projects (projects stay) and old session records. Deleting a session removes only its time record; Delete project is in the Knowledge graph pane.
- 2026-10-10: Knowledge graph pane (`#/graph/<id>`, `views/Graph.tsx`, `graphs.ts`): project picker, counts, Rebuild (graphify extract --force), Delete project; Graphify's own graph.html in a sandboxed WebContentsView over the graph area (no preload, navigation blocked, links open externally; needs internet for vis-network). Opened from the Sessions window (Knowledge graph button on the longest-worked project, project chips), the panel chip and the popover (⌘G). Measured on a real 29-note project: graph queries return 1.7–3.9k chars vs 19k for all notes.
- 2026-10-10: the running `pnpm dev` restarted on the code change and migrated the real klair.db during the build (one project, "Session", 27 captures); checked: folder moved, paths rewritten, span created.
- 2026-10-10: fix: databases migrated by the first projects build had `sessions`/`project_spans` without defaults (and status default 'ended'), so starting a session failed (NOT NULL started_at). Inserts now set started_at and status explicitly, the migration creates the tables with the same defaults as a new database, the migration test starts a session afterwards, and a new project whose session fails to start is removed instead of piling up (the user got three empty "SWE" projects).
- 2026-10-10: sessions hold the projects pulled into them (user's pipeline): `session_projects` (session, project, position = fn N, backfilled from spans for older sessions). The Start window ticks projects for a new session (first ticked is active) or, while one runs, lists the session's projects and adds saved/new ones. fn/⌃⌥ N switches to the session's Nth project (projects' permanent slots are no longer used). Opening a span adds the project to the session. Deleting a session removes the session, its project list and spans; projects keep all their context (tested with the user's SWE+ML → SWE+OS example).
- 2026-10-11: options are a fixed menu per project type, not text written per screen (user decision: model-written options "look and sound like slop"). Three types: work, study, research; `projects.type` (local only, null = guessed from name and brief by keywords). Menus in `src/shared/options.ts`; the first three of each are shown instantly and keep their ⌘ numbers.
- 2026-10-11: the menu pick is made inside the note call (closed enum of ids per type, plus a short name of the thing on screen for some entries), not by a second model call: no added latency, and on 17 real screenshots the picks were sensible (note median 2.0 s, max 2.8 s). If picks turn out poor, move them to their own call on the answer model; `suggestionsFromNote` is the only consumer.
- 2026-10-11: code checks after the pick: an explainer needs a drawable template, "Connect to earlier"/"Compare" need a named earlier topic that is in the project context and is not the topic on screen, "Do it for me" needs an https address or app name that the screen text names (`src/shared/open.ts`). Something to draw or to open counts as the pick itself.
- 2026-10-11: with nothing picked (or a failed note) the three standing options are offered. A key pressed against a list that has just been replaced is dropped (`pickKey(key, setId)`).
- 2026-10-11: changing the type mid-session resets the screen context and re-captures (`loop.refresh()`), so the current screen is noted again against the new menu; it also clears a pinned selection.
- 2026-10-11: "Do it for me" is recorded nowhere (no action row): it opens the target, closes the panel and shows an "Opened …" pill. A computer-use agent is not built.
- 2026-10-11: "transfer of knowledge between text" (research) is read as "Carry it over": while writing, what from earlier sources belongs here; while reading, what to take into the notes. To confirm with the user.
- 2026-10-11: answers render maths. The answer prompt asks for LaTeX as `\( … \)` and `\[ … \]` (never `$`); `src/shared/markdown.ts` parses the answer markdown into data (maths, mixed lists with their numbers, one level of sub-bullets, kept line breaks, fenced code) and `blocks.tsx` draws it. Maths is drawn by KaTeX (new dependency, `katex` 0.19.0, fonts bundled), `trust` off. Chromium's built-in MathML was tried and rejected: it drops bold vectors and blackboard letters. A single `$` is never maths, so prices stay prices.
- 2026-10-11: `pnpm add katex` was run once with `--config.minimumReleaseAge=0` (user approved): pnpm 12's one-day release-age check was failing on rollup 4.64.5 builds already in the committed lockfile, not on KaTeX. The lockfile diff is KaTeX, commander 15.0.0, and pnpm re-keying existing entries with a peer suffix; no other version changed.
