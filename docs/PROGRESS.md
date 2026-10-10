# Klair build progress

## Handoff (updated 2026-10-10 16:40 ET, by build session · claude-opus-5-5)
- **Milestone:** 2 (Panel + keys) — renderer screens built; next: visual check with mock data, then rename/packaging + fn addon (Milestone 7)
- **Just finished:** every renderer window: flower (bloom, nudge/notice pills), panel (ideas / answer / quiz / ⌘/ sheet / error cards, full ⌘ keymap), Start (permissions + connection health), Tray popover, Sessions (timeline, holding, privacy, **Session insights** from the TigerData aggregate). Also Tailwind v4 tokens, bundled fonts, answer-block renderers. `pnpm build` passes.
- **In progress:** nothing half-done
- **Next step:** render each route in headless Chromium with a mocked `window.klair` to catch runtime errors (script: `scripts/preview.mjs`, to be written), then the rename/packaging changes from BUILD_PROMPT §4.5 and the `native/fn-key` addon.
- **Broken / failing:** nothing known; typecheck, lint, test and build all pass
- **Decisions made this session:** privacy copy says Claude sees *each new screen* (vision notes), not only the screens tied to ideas, because that's how the pipeline works; see the Decisions log
- **Blocked on / questions for the user:** none
- **How to verify current state:** `pnpm install && pnpm typecheck && pnpm lint && pnpm test && pnpm build`, then on the Mac `pnpm dev`

---

## Milestones
- [x] 1. Connections: main process (health, schema, IPC, windows, shortcuts). Rename and packaging still pending.
- [x] 2. Panel + keys (renderer; visual check on the Mac pending)
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
- 2026-10-10: privacy copy deviates from BUILD_PROMPT §2: each new screen is sent to Claude for a vision note, so the copy says so instead of "only the relevant ones".
- 2026-10-10: `KLAIR_BASELINE=full` swaps retrieval for all session notes, for token comparisons (`userData/metrics.jsonl`).
