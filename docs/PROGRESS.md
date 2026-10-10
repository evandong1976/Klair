# Klair build progress

## Handoff (updated 2026-10-10 16:10 ET, by build session · claude-opus-5-5)
- **Milestone:** 1 (Connections) — main process done; renderer windows next (Milestone 2)
- **Just finished:** the whole main process. It covers env (`.env.local`), config, TigerData schema + hypertable/aggregate/retention/BM25 (each optional), health checks, capture → persist → notes, the Graphify indexer, retrieval, suggestions, assistance streaming, the controller and its pure core (7 unit tests), windows, tray, shortcuts and typed IPC/preload.
- **In progress:** nothing half-done
- **Next step:** build the renderer. `src/renderer/src/main.tsx` should route on `location.hash` (`#/flower`, `#/panel`, `#/start`, `#/sessions`, `#/tray`). Put DESIGN.md tokens in `assets/main.css` (`@theme`), add `@fontsource` fonts, then build the screens from `design/canvas/*.dc.html` against the `window.klair` API in `src/shared/types.ts`.
- **Broken / failing:** nothing; `pnpm typecheck`, `pnpm lint` and `pnpm test` pass. The renderer is still the scaffold placeholder, so windows show "Claire" until Milestone 2.
- **Decisions made this session:** see `docs/PLAN.md`
- **Blocked on / questions for the user:** none
- **How to verify current state:** `pnpm install && pnpm typecheck && pnpm lint && pnpm test`

---

## Milestones
- [x] 1. Connections: main process (health, schema, IPC, windows, shortcuts). Rename and packaging still pending.
- [ ] 2. Panel + keys (renderer)
- [x] 3. Capture → persist → notes (main process; verify on the Mac)
- [x] 4. Controller (core unit-tested)
- [x] 5. Retrieval: Graphify + TigerData search (verify on the Mac)
- [x] 6. AI: suggestions + execution (verify on the Mac)
- [ ] 7. The rest: Tray / Sessions / Start / States screens, fn native addon, rename/packaging
- [ ] 8. Prove it

## Verify on the Mac (can't be tested from the Linux build workspace)
- `pnpm dev` launches; flower window top-right; ⌃⌥K opens the panel
- Health: OpenRouter slugs `anthropic/claude-haiku-5.5` / `anthropic/claude-sonnet-5.5` accept images; TigerData migrate output (`tigerdata: … unavailable` lines in the console show which optional features failed)
- Screen Recording prompt and capture; `setContentProtection` hides Klair windows from captures
- `graphify extract` against OpenRouter; `graphify query` returns text
- Panel focus and return-focus-on-close (`app.hide()` + `flower.showInactive()`); vibrancy look

## Health checks
_Not run on a Mac yet._

## Stubs and simulations
- fn key: `src/main/fnkey.ts` loads `native/fn-key` if built; the addon itself isn't written yet. ⌃⌥K / ⌃⌥P / ⌃⌥Q work as fallbacks.

## Decisions log
- 2026-10-10: TigerData replaces SQLite for canonical records; screenshots stay local.
- 2026-10-10: `.env.local` is loaded before `.env` (the team's keys are in `.env.local`).
- 2026-10-10: the panel handles ⌘ keys itself while focused; there are no global ⌘ registrations.
- 2026-10-10: `KLAIR_BASELINE=full` swaps retrieval for all session notes, for token comparisons (`userData/metrics.jsonl`).
