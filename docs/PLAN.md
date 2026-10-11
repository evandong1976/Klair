# Klair build plan

> **Historical.** This is the first build session's plan. Several decisions changed since (sessions are SQLite-first and uploaded to TigerData when they end, change detection uses a 64×40 share-of-screen check, answers are text only, and the extension, area selection and downloads were added). See `README.md` for how Klair works now and the decisions log in `docs/PROGRESS.md`.

Written by the build session on 2026-10-10. Sources: `BUILD_PROMPT.md`, `MEGA_PROMPT.md`, `design/DESIGN.md`, and the scaffold.

## Where the build runs

The code is written and checked in a Linux workspace: `pnpm install`, `pnpm typecheck`, `pnpm lint` and unit tests for pure logic. That workspace **can't** run the macOS app, grant permissions, or reach OpenRouter or TigerData. Everything that needs them is listed under "Verify on the Mac" in `docs/PROGRESS.md`.

## Scaffold gaps found

- `src/main/env.ts` loads `.env` only, but the team's keys are in `.env.local`. **Decision:** load `.env.local` first, then `.env`.
- `index.ts` warns and keeps running without `DATABASE_URL`. The brief requires "Not saving" plus capture stopping. **Decision:** the health check gates capture.
- There's one placeholder window, an empty preload API and no shared types.
- The schema is missing capture metadata, statuses, suggestion sets, notes and activity.
- `appId: com.electron.app`, camera/mic boilerplate, and "Claire" naming throughout.
- `optimizer.watchWindowShortcuts` reserves ⌘R in dev. **Decision:** don't attach it to the panel window; the panel handles its own keys.

## Graphify findings (`graphifyy`, checked with `graphify --help`)

- `graphify extract <dir> --backend openai --out <dir>` writes `<dir>/graphify-out/graph.json`. It's **incremental by default** (manifest gate + semantic cache); `--force` re-runs everything. It makes LLM calls; `OPENAI_BASE_URL`/`OPENAI_MODEL` point it at OpenRouter.
- `graphify query "<q>" --budget N --graph <path>` is a local BFS over the graph with no LLM call.
- `graphify benchmark <graph.json>` measures token reduction against a full-corpus baseline. It's used for the token-savings report.
- Deleting a session's index means deleting its `graphify-out/` folder.

## Architecture decisions

| Area | Decision |
|---|---|
| Windows | Separate **flower** window (transparent, click-through, non-focusable) and **panel** window (focusable, glass, native vibrancy behind `KLAIR_VIBRANCY`, default on). Start, Sessions and Tray popover are normal or frameless windows. One renderer bundle, routed by `#/flower`, `#/panel`, `#/start`, `#/sessions`, `#/tray`. |
| Keys | Global: fn via an optional native addon. Always-available fallbacks via `globalShortcut`: `⌃⌥K` open/close, `⌃⌥P` pause, `⌃⌥Q` quiet. The panel takes focus while open, so `⌘` keys are handled by the panel itself (no global ⌘ registrations) and focus returns on close. |
| Capture | `desktopCapturer` on the primary screen every `KLAIR_CAPTURE_MS` (default 4000), with a 32×20 grey thumbnail diff for change detection. Front app, window title and browser URL come from AppleScript (`KLAIR_ACTIVE_WINDOW=applescript`, off by default; it needs Automation permission). |
| Persistence | PNG to `userData/sessions/<id>/shots/`, then a `captures` row (pending → committed). Notes go to `userData/sessions/<id>/notes/*.md` and the `notes` table. Writes are queued; a DB failure flips the "not saving" state. |
| TigerData | Additive migration. The `screen_activity` hypertable, `activity_by_minute` continuous aggregate, retention policy and `pg_textsearch` BM25 index are each tried separately; capability flags are reported by the health check, with Postgres full-text search as the fallback. |
| AI | AI SDK 7 `generateText` / `streamText` with `Output.object` (zod 4 schemas in `src/shared/blocks.ts`). `fastModel` handles vision notes and ideas; `answerModel` handles answers. Model slugs come from env (`KLAIR_*`, then `CLAIRE_*`). |
| Controller | Pure state machine (`src/main/controller-core.ts`) with injected clock and effects, plus unit tests. `controller.ts` wires it to Electron. |
| Retrieval | `retrieve.ts` merges `graphify query` output with BM25/FTS hits over `notes`, trimmed to a token budget with provenance. Graphify failure → notes search only. |

## Milestones

Same as `BUILD_PROMPT.md` §6; progress is in `docs/PROGRESS.md`.

## Open questions (not blocking)

- **OpenRouter model slugs:** `anthropic/claude-haiku-5.5` and `anthropic/claude-sonnet-5.5` are unverified, so check them on the Mac with the health check.
- **Retention default:** 14 days for now (`KLAIR_RETENTION_DAYS`).
- **Vibrancy and rounded corners on transparent windows:** check visually on the Mac.
