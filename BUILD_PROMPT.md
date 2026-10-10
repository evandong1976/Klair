# Build prompt: Klair MVP

> Paste this into Claude Code at the root of the Klair repo, or say: **"Read BUILD_PROMPT.md and follow it."**
>
> **Resuming after another session stopped?** Say: **"Read BUILD_PROMPT.md and docs/PROGRESS.md, then continue from the Handoff section."**

---

## 0. Handoff protocol: follow it the whole time

This build may stop at any moment (token limits, a crash, the user closing the session), with no warning and no chance to write a final report. So **never hold progress only in your head or your context**. Keep the repo in a state another AI can pick up cold.

**Starting:**
- Read `docs/PROGRESS.md` before anything else.
- If it has a Handoff section, continue from **Next step** instead of starting over.
- Run `git log --oneline -15` and `git status` to check the code matches what PROGRESS.md claims. If they disagree, trust the code and fix PROGRESS.md.

**After every completed step:** a "step" is a few files or about 15–20 minutes of work.
1. Update `docs/PROGRESS.md`, especially the **Handoff** section (template below).
2. Commit code and PROGRESS.md together with a clear message.
3. Leave work-in-progress commits typechecking where possible. If they don't, prefix the message with `WIP:` and say what's broken in the Handoff.

**Before anything risky or long** (a big refactor, a long install or build, a native addon), commit and update the Handoff first.

**If you get any signal you're running low** (a context or usage warning, the conversation being compacted, or the user saying so): stop feature work, write the Handoff in full, commit, and only then continue.

**Handoff section template** (keep it at the top of `docs/PROGRESS.md`; overwrite it each time and keep it short):

```markdown
## Handoff (updated <date time>, by <session/model>)
- **Milestone:** <n / name> — <% done>
- **Just finished:** <1–3 bullets>
- **In progress:** <file(s) + what's half-done, or "nothing">
- **Next step:** <the single exact next action, specific enough to start immediately>
- **Broken / failing:** <typecheck, lint, runtime errors, or "none">
- **Decisions made this session:** <anything not yet in PLAN.md>
- **Blocked on / questions for the user:** <or "none">
- **How to verify current state:** <commands to run and what you should see>
```

Below the Handoff, keep the longer record: milestone checklist, health-check status, stubs and simulations, and a decisions log.

---

You are the lead engineer building **Klair**, a macOS desktop assistant that runs in the background, watches the screen during a session, and offers help in place without a tab switch. Build a working hackathon MVP that:

- **does** what `MEGA_PROMPT.md` specifies,
- **looks and behaves** the way `design/DESIGN.md` specifies,
- is **built on the team's existing scaffold** (stack and services described in §3),
- and makes **TigerData** a load-bearing, visible part of the product. The team is competing in TigerData's prize track (§4.6).

Klair is an **Electron desktop app**, not a browser web app. Its UI lives in transparent, always-on-top overlay windows above the user's other apps.

## 1. Read before writing any code

1. `CLAUDE.md`: orientation and precedence.
2. `MEGA_PROMPT.md`: product behaviour, pipeline, failure table, acceptance criteria. It says "Claire"; the product is now **Klair**. **Its stack table is superseded by the scaffold** (§3).
3. `design/DESIGN.md`: visual system, flower, thick glass, keyboard map, malleable answers, Electron window plan.
4. `design/canvas/README.md`, then each `design/canvas/*.dc.html` when you build that screen. Inline `style="…"` values are the exact spec. `support.js` is not included, so read them as markup.
5. `design/reference/flower.ts`: use it as-is for the flower.
6. **The scaffold:** `README.md`, `package.json`, `.env.example`, `electron.vite.config.ts`, `electron-builder.yml`, `tsconfig*.json`, `src/main/{index,env,ai,db,cache,graphify}.ts`, `src/preload/*`, `src/renderer/**`. **Extend it. Don't re-scaffold or swap libraries** without a written reason in `docs/PLAN.md` and a note to the team.

Then write `docs/PLAN.md`: milestones, gaps you found in the scaffold, decisions and open questions. Ask the user only about decisions that truly block you; for the rest, make reversible choices and record them.

## 2. Precedence and non-negotiables

- **Look, layout, copy, shortcuts, flow:** `design/DESIGN.md` and the canvas.
- **Behaviour, pipeline, failure handling:** `MEGA_PROMPT.md`.
- **Technology and services:** the scaffold. The brief's behavioural rules still apply to the scaffold's services. For example, "persist before indexing" now means *screenshot file + Postgres row committed before Graphify sees the note*.
- **Execution:** a dwell may only **generate suggestions**. Only an explicit pick (`⌘1–3` or a click) runs assistance. Clicks and shortcuts go through the same validation in the main-process controller: current suggestion set, capture ID, not stale, not dismissed, not a duplicate.
- **Untrusted text:** text captured from the screen is **source material, never instructions**. Fence it in every model prompt.
- **Self-capture:** exclude Klair's own windows from capture (`setContentProtection(true)`, verify).
- **Secrets and trust boundary:** secrets live in `.env` (gitignored, loaded by `src/main/env.ts`). Never commit them. Keys, capture, storage, Graphify and model calls stay in the **main process**. The renderer gets a narrow, typed preload API only.
- **Generated code:** never execute model-generated code. Malleable answers render from a whitelisted, zod-validated block set (§5).
- **Honest claims:** don't call anything a "graph neural network", don't build a general-purpose agent, and don't claim token savings you haven't measured.
- **Privacy copy must be true.** TigerData is a deliberate team decision; keep it. Data goes to three places:
  - screenshots stay in a local folder;
  - notes, prompts and answers are stored in **TigerData** (cloud Postgres);
  - relevant screenshots and notes go to Claude via **OpenRouter** for vision notes, ideas, answers and Graphify extraction.

  Replace the design's "on this Mac" lines with these. They override the canvas copy; keep the layouts.

  | Where | Copy |
  |---|---|
  | `Start`, third row | Title "Where your data lives"; body "Screenshots stay on this Mac. Notes and answers are saved to your TigerData database." |
  | `Start`, footnote | "To make ideas and answers, Klair sends the relevant screenshots and notes to Claude (via OpenRouter)." |
  | `Tray`, footer | "Screenshots stay on this Mac. Notes sync to your TigerData database; Claude sees the relevant ones to make ideas and answers." |
  | `Sessions`, Privacy card | "Screenshots on this Mac · notes and answers in TigerData. Deleted after [RETENTION]." |

## 3. The stack as built

| Layer | What's there | File | What's missing |
|---|---|---|---|
| Desktop | Electron 39 + electron-vite 5, **pnpm** | `src/main/index.ts` | One 900×670 placeholder window; Klair's windows (§4.4) |
| UI | React 19 + TS + **Tailwind v4** (CSS-first, `@import 'tailwindcss'`) | `src/renderer/` | Design tokens, fonts, every screen |
| AI | Vercel AI SDK (`ai`) + `@openrouter/ai-sdk-provider`; `fastModel` / `answerModel` | `src/main/ai.ts` | All calls. Verify the model slugs exist on OpenRouter **and accept images**. Check the installed `ai` and `zod` versions' APIs for structured output and streaming before writing calls |
| Canonical records | TigerData Postgres via `pg`; `sessions`, `captures`, `actions`; `migrate()` on start | `src/main/db.ts` | Columns and tables (§4.3); the TigerData features in §4.6 (hypertable, continuous aggregate, retention, BM25 search); write path; failure handling |
| Cache | `node:sqlite` key/value (`screenshot hash → vision note`) | `src/main/cache.ts` | Use it; confirm `node:sqlite` loads in Electron's main process |
| Retrieval | Graphify CLI (`brew install pipx && pipx install graphifyy`): `indexSession(dir)` runs `graphify extract` (LLM calls via OpenRouter); `queryContext(dir, q, budget)` runs `graphify query` (local) | `src/main/graphify.ts` | Note files to index, queue, debounce, cancel, delete, provenance |
| Config | `OPENROUTER_API_KEY`, `DATABASE_URL`, `GRAPHIFY_BIN`; model overrides `CLAIRE_FAST_MODEL`, `CLAIRE_ANSWER_MODEL`, `GRAPHIFY_MODEL` | `.env.example` | Rename to `KLAIR_*` (still read `CLAIRE_*` as a fallback) and list every variable in `.env.example` |

Run `graphify --help` and `graphify extract --help` before integrating. Confirm whether `extract` is incremental, what it writes to `graphify-out/`, and how to delete an index. Record findings in `docs/PLAN.md`.

## 4. Make the connections work

### 4.1 Health check first (`src/main/health.ts`)

Before any feature, check every connection at startup and on demand. Return a typed status over IPC and show it on the **Start** window, using the same row style as the design's permission rows. Mid-session failures surface through the matching **States** cards.

| Check | Pass means | On failure |
|---|---|---|
| OpenRouter | Key set; a tiny image request to `fastModel` succeeds; log latency | "Request failed" card; no suggestions |
| TigerData | `DATABASE_URL` set; connect; `migrate()` ok; TimescaleDB ≥ 2.16 present; whether `pg_textsearch` / `vectorscale` are available is reported | **"Not saving" card and capture stops.** The scaffold currently only warns and continues; change that, per the brief |
| Graphify | Binary resolves (`GRAPHIFY_BIN` or PATH; GUI apps don't inherit the shell PATH); `--help` runs | Answers continue with on-screen context only; show "No earlier context" |
| Cache | `node:sqlite` opens | Continue uncached |
| Screen Recording | `systemPreferences.getMediaAccessStatus('screen')` is granted | "Screen access needed" card; observation stays off |
| fn key | Native addon loaded; Input Monitoring granted | "fn is busy" card; `⌃⌥K` fallback |

**Don't share one database while building:** each developer or Claude Code session works on its own TigerData **fork** of the team service (§4.6), so test sessions never mix.

### 4.2 Data flow: which module owns each step

Add these modules under `src/main/`. Names are suggestions; the ownership is the point.

1. **`capture.ts`:** during an active session, run `desktopCapturer` every N seconds, excluding Klair's windows. Downscale, hash, and skip unchanged frames, but log **every** tick (changed or not) to the `screen_activity` hypertable (§4.6), asynchronously.
2. **Persist first:** write the PNG to `userData/sessions/<sessionId>/shots/<captureId>.png`, then insert the `captures` row (`status: pending → committed`). On startup, reconcile orphans: files without rows and rows without files.
3. **`notes.ts`:**
   - Make a vision note with `fastModel`, cached by image hash.
   - Write `userData/sessions/<id>/notes/<captureId>.md` with front matter: `capture_id`, `captured_at`, `app`, `window_title`, `url` if known, `provenance: observed`.
   - Store the note on the row and in the `notes` table (BM25-searchable, §4.6). Only committed captures get notes.
4. **`indexer.ts` → `graphify.ts`:**
   - Run one `extract` per session at a time, debounced (after K new notes or on idle).
   - Track `captures.index_status` (`pending → indexed | failed`) and retry without duplicates.
   - Kill the child process if the session is deleted.
   - Log tokens used by `extract` as **indexing overhead**.
5. **`controller.ts`:** a state machine covering observe → dwell → cooldown → suggest → select → execute → present → dismiss.
   - Change events reset the dwell timer.
   - Every suggestion request carries a `generationId` + `captureId`; drop late or stale results.
6. **`retrieve.ts`:** one entry point that merges **Graphify** graph context (`queryContext`) with **TigerData BM25** hits over `notes` (including other sessions). It dedupes, keeps provenance, and trims to a token budget. If Graphify fails or hasn't indexed yet, TigerData search alone still supplies earlier context.
7. **`suggest.ts`:** current note + `retrieve(topic)` → `fastModel` structured output (exactly 3 ideas, zod-validated) → controller publishes → nudge pill.
8. **`execute.ts`:**
   - Starts on a validated pick: `retrieve(selectedPrompt)` + the **bound** capture's image and note → `answerModel` stream → answer blocks → panel.
   - Cancel uses an `AbortController` and suppresses late events.
9. **Retain:** write an `actions` row with kind, status, sources and token usage. Write the answer as a note (file + `notes` row) with `provenance: assistant` so Graphify and TigerData search can retrieve it; never treat it as observed.
10. **Delete session:** Postgres cascade (including `notes` and `screen_activity`) + remove the session folder (shots, notes, `graphify-out`) + cache entries + cancel queued and running index jobs.

### 4.3 Schema additions (additive only; teammates may already have these tables)

Use `create table if not exists` and `alter table … add column if not exists`. Keep the existing `bigint identity` IDs.

- **`sessions`:** add `name text`, `status text` (active | paused | ended).
- **`captures`:** add `app_name`, `window_title`, `url`, `image_hash`, `status` (pending | committed | failed), `index_status` (pending | indexed | failed), `note_path`.
- **New `suggestion_sets`:** `id`, `session_id` (cascade), `capture_id`, `generation_id`, `created_at`, `status` (shown | dismissed | stale | selected), `suggestions jsonb`.
- **`actions`:** add `kind` (summary | code | quiz | ask | reshape), `status` (pending | streaming | complete | failed | cancelled), `suggestion_set_id`, `blocks jsonb`, `sources jsonb` (capture IDs + retrieval refs), `tokens_in`, `tokens_out`.
- **New `notes`, `screen_activity` (hypertable) and `activity_by_minute` (continuous aggregate):** see §4.6.

### 4.4 Windows, IPC, renderer

- **Windows:** replace `createWindow()` with `windows.ts`, which creates the **flower**, **panel**, **tray popover**, **start** and **sessions** windows per DESIGN.md §7. Use one renderer bundle; each window loads `index.html#/flower`, `#/panel`, … and the renderer routes on the hash.
- **Shared types:** add `src/shared/` with `ipc.ts` (channel names + payload types) and `blocks.ts` (zod answer schema). Add `src/shared/**/*` to the `include` of **both** `tsconfig.node.json` and `tsconfig.web.json`.
- **Preload:** replace the empty `api = {}` with the typed API and update `src/preload/index.d.ts` (no more `api: unknown`).
- **CSP:** keep `index.html`'s CSP strict. Load fonts from `'self'`. Show screenshot thumbnails through a custom protocol or data URLs, never `file://`.
- **Shortcut conflicts:** `optimizer.watchWindowShortcuts` from `@electron-toolkit/utils` claims ⌘R (reload in dev) and F12. Make sure the panel's own ⌘R, ⌘[, ⌘K bindings win (e.g. `before-input-event`), or configure the helper.

### 4.5 Rename and packaging

- Rename "Claire" → **Klair** in `README.md`, `index.html` `<title>`, `App.tsx`, the `package.json` description and env var names.
- In `electron-builder.yml`, change `appId: com.electron.app` to e.g. `com.klair.app` and set `productName: Klair`. Replace the boilerplate camera, microphone, Documents and Downloads usage strings with only what Klair needs.
- In `index.ts`, change `setAppUserModelId('com.electron')` to match the new appId.
- **Change the appId before anyone grants macOS permissions**, because Screen Recording and Input Monitoring grants are tied to the app's identity. In `pnpm dev` the grant applies to Electron itself; document that in the README.
- The fn native addon must build against Electron. `postinstall` already runs `electron-builder install-app-deps`; add the addon to `pnpm.onlyBuiltDependencies` if needed.

### 4.6 TigerData: load-bearing and visible (prize track)

Judges should see TigerData doing work Klair couldn't do as well without it; plain create/read/update/delete storage isn't enough. Build these in priority order. Check each against the current TigerData docs and `tiger --help` first.

1. **Activity time-series.** Add an append-only `screen_activity` **hypertable** on `time`:
   - Columns: `time`, `session_id` (FK → sessions, cascade), `capture_id` (nullable), `app_name`, `window_title`, `url`, `topic`, `changed boolean`, `dwell_ms`.
   - One row per capture tick, including unchanged frames.
   - Keep `captures` a regular table: it's the FK target for `actions`, and a hypertable needs the time column in every unique key. (FKs *into* hypertables need TimescaleDB 2.16+; you don't need them here.)
2. **Continuous aggregate.** Create `activity_by_minute`:
   - Buckets `time_bucket('1 minute', time)` × session × topic × app, recording seconds observed, change count and max dwell.
   - It powers a **Session insights** view in the Sessions window: where the time went by topic, plus "stuck spots" (long dwells and what Klair offered then).
   - It also gives suggestions a history signal ("you paused here last session too").
3. **Retention.** Implement the `[RETENTION]` setting with `add_retention_policy` on `screen_activity`, plus an app-side sweep that deletes expired sessions' rows, screenshots, notes and Graphify output **together**. A DB policy alone never touches local files.
4. **Search over notes.**
   - Create a `notes` table: `id`, `session_id` (cascade), `capture_id`, `provenance` (observed | assistant), `body`, `created_at`.
   - Add a **BM25 index with `pg_textsearch`** if the service has it, otherwise Postgres full-text search, and report which one you used.
   - It drives `retrieve.ts`'s cross-session hits and the Graphify fallback.
   - Add vector search (`pgvectorscale`) only if you've verified an embedding source; don't block on it.
5. **Forks for building and the demo.**
   - Every developer or Claude Code session uses its own fork of the team service: `tiger service fork <service-id> --now --name klair-<who>`, then `tiger db uri <fork-id> --with-password` gives the `DATABASE_URL`.
   - Rehearse the demo on a fork seeded with a realistic session so the main service stays clean.
   - When creating the team service, enable the time-series (and, if useful, AI) add-on via `tiger service create --addons …`.
6. **Tiger MCP for builders.** Run `tiger mcp install claude-code` so build sessions can inspect the schema and test queries. Document it in the README.
7. **Show it.**
   - In the demo, after the ⌘2 answer, open **Sessions → Session insights** to show live time-on-topic and the stuck spot from the continuous aggregate.
   - Note "you saw this before" hits that came from TigerData search.
   - Put this in the README's demo script, and list every TigerData feature used, with the SQL that powers it, in `docs/TIGERDATA.md`. Judges will look for it.

Keep TigerData **off the hot path**: dwell detection and the overlay never wait on a network round-trip. Writes are asynchronous and queued, and if the DB is down Klair degrades per the health check.

*Session insights* isn't on the design canvas yet. Build it inside the Sessions window using DESIGN.md's vocabulary:
- a white card on glass
- a Silkscreen section label
- pixel-block bars in sage and rose
- Geist Mono numbers

Flag it in PROGRESS.md for a design pass.

## 5. UI requirements (build exactly what DESIGN.md shows)

- **Tailwind v4 tokens:** put DESIGN.md §2 tokens in `src/renderer/src/assets/main.css` using `@theme` (colors, radii, fonts). Define the glass panel and keycap as `@utility` / `@layer components` classes copied from DESIGN.md's CSS. There is no `tailwind.config.js` in v4. Bundle Nunito, Silkscreen and Geist Mono via `@fontsource/*`. Replace the scaffold's dark `bg-neutral-950` page: windows are transparent or glass.
- **Flower window:** transparent, frameless, click-through, always on top, on all Spaces including fullscreen, at the top-right of the work area.
  - Resting: 11×11 at 4px cells. On `fn` it blooms to 30×30 via `bloomSteps(11, 30)`, one step every 55ms.
  - Grey when paused; 2px stepped hop every 3.2s.
  - No background behind it, only the spec's drop shadow.
- **Panel window:** thick glass on the container only (native macOS vibrancy behind the CSS tint, because CSS `backdrop-filter` can't blur other apps), with solid white content inside. Screens:
  - `Main` (nudge pill)
  - `Open` (where-you-are, 3 idea tiles, ⌘K box, hint strip)
  - `Result` (malleable answer)
  - `Quiz`
  - `Shortcuts` (⌘/)
- **Other windows:** `Start` (permissions + connection health + storage, with accurate privacy copy), `Tray`, `Sessions` (timeline tags "Seen on screen" / "You asked" / "Klair's answer", delete), and every `States` card wired to its failure.
- **Keys:** exactly DESIGN.md §4.
  - Global: `fn`, `fn P`, `fn Q`. Ship the `⌃⌥K` fallback via `globalShortcut` first, then the native fn addon.
  - `⌘` bindings are active only while the panel is open.
  - `esc` / `fn` closes the panel and restores focus to the previous app.
- **Malleable answers:** `src/shared/blocks.ts` defines the zod schema for the answer blocks:
  - `text`, `code` and `quiz`
  - `slider-plot`: parameter range + series, precomputed by the model or a safe evaluator
  - an optional `reshape` list (≤3)

  React maps each block type to a fixed component. Every idea and answer shows provenance chips ("On screen · 2:14 PM", "Earlier tab · 2:02 PM").
- `Backdrop.dc.html` is demo scenery. Don't build it.

## 6. Build order (the scaffold exists; start at the connections)

1. **Connections + rename:** health checks, env renames, schema additions, `src/shared` types, typed preload, `windows.ts` with the flower window (flower.ts) and a panel showing static ideas on `⌃⌥K`.
2. **Panel + keys:** Open, Result (mock blocks), Quiz and Shortcuts at full fidelity. All shortcuts, focus handling, glass with vibrancy.
3. **Capture → persist → notes:** Start window and permissions, capture loop with dedupe, file + Postgres ordering, orphan reconciliation, vision notes with cache, `screen_activity` hypertable writes, pause and stop, flower reflects state.
4. **Controller:** the full state machine with stale invalidation and generation IDs.
5. **Retrieval:** Graphify indexing queue + TigerData `notes` search merged in `retrieve.ts`, related-tab continuity, provenance, Graphify fallback.
6. **AI:** suggestions + nudge pill; executor with streaming, cancel and retry for summary ("of what's been captured"), code/demo blocks and quiz.
7. **The rest:** Tray, Sessions window with **Session insights** (continuous aggregate), retention policy + sweep, all States, session deletion across Postgres, files, Graphify and cache, the fn native addon.
8. **Prove it:** run the brief's demo (ML article → pause on gradient descent → ⌘2 → answer in place → esc → saved → Session insights) on a seeded TigerData fork. Walk every acceptance criterion and failure case. Measure model-input tokens with and without retrieval, and indexing overhead separately.

If several Claude Code sessions build in parallel, claim a milestone in `docs/PROGRESS.md` first and keep all IPC and block types in `src/shared/`.

## 7. Working rules

- Use **pnpm**. Run `pnpm typecheck` and `pnpm lint` before every commit. Commit after every step (§0), not just every milestone. Don't push or open PRs unless asked.
- Follow the handoff protocol in §0 at all times. `docs/PROGRESS.md` is how the next session continues if this one stops.
- Before marking a screen done, check it against its `.dc.html`. If something can't be built as drawn, note it and propose the nearest alternative; don't silently restyle.
- Note every native module (it needs an Electron rebuild) and every new env var (add it to `.env.example`).

## 8. Definition of done

Report back with:

1. What works end to end.
2. How to run it: `pnpm install`, `.env`, TigerData and Graphify setup, macOS permissions, demo steps. Write this to `README.md` too.
3. Health-check results.
4. What was tested and how.
5. What remains unverified or simulated.
6. Token measurements.
7. TigerData features in use, with links to `docs/TIGERDATA.md`.
8. Every deviation from DESIGN.md, MEGA_PROMPT.md or the scaffold, with reasons, including the privacy-copy change.
