# Klair build progress

## Handoff (updated 2026-10-10 17:20 ET, by build session · claude-opus-5-5)
- **Milestone:** 7 done in code; 8 (prove it) needs the Mac. Everything that can be built and checked in Linux is done.
- **Just finished:** a headless-Chromium preview of all 13 screens with mock data (found and fixed a font CSP bug), the rename and packaging changes (`com.klair.app`, LSUIElement, usage strings), `.env.example`, the `native/fn-key` addon source (unbuilt), README with setup and demo script, `docs/TIGERDATA.md`, and five bug fixes from code review (health-check race, activity row after flush, TimescaleDB-less start, clickable corner, reopen during streaming).
- **In progress:** nothing half-done
- **Next step (on the Mac):** `pnpm install && pnpm dev`, then walk the "Verify on the Mac" list below in order. First fix anything the Start window's Connections rows show red (OpenRouter model slugs are the most likely failure).
- **Broken / failing:** nothing known; typecheck, lint, 7 unit tests, build and the 13-screen preview pass
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
- `pnpm build:native` compiles `native/fn-key` (unverified C, CGEventTap); fn tap opens Klair, fn+P / fn+Q work
- `pnpm dev` launches; flower window top-right; ⌃⌥K opens the panel
- Health: OpenRouter slugs `anthropic/claude-haiku-5.5` / `anthropic/claude-sonnet-5.5` accept images; TigerData migrate output (`tigerdata: … unavailable` lines in the console show which optional features failed)
- Screen Recording prompt and capture; `setContentProtection` hides Klair windows from captures
- `graphify extract` against OpenRouter; `graphify query` returns text
- Panel focus and return-focus-on-close (`app.hide()` + `flower.showInactive()`); vibrancy look

## Health checks
_Not run on a Mac yet._

## Stubs and simulations
- fn key: `native/fn-key/src/fn_key.c` is written but has never been compiled. ⌃⌥K / ⌃⌥P / ⌃⌥Q work as fallbacks.
- The headless preview in the build workspace used mock data. No real model, database or capture has run yet.

## Decisions log
- 2026-10-10: TigerData replaces SQLite for canonical records; screenshots stay local.
- 2026-10-10: `.env.local` is loaded before `.env` (the team's keys are in `.env.local`).
- 2026-10-10: the panel handles ⌘ keys itself while focused; there are no global ⌘ registrations.
- 2026-10-10: privacy copy deviates from BUILD_PROMPT §2: each new screen is sent to Claude for a vision note, so the copy says so instead of "only the relevant ones".
- 2026-10-10: Vite inlines small fonts as data: URLs, so the CSP allows `font-src 'self' data:`.
- 2026-10-10: reopening the panel shows ideas unless an answer is still streaming.
- 2026-10-10: `KLAIR_BASELINE=full` swaps retrieval for all session notes, for token comparisons (`userData/metrics.jsonl`).
