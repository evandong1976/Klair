# Klair build progress

## Handoff (updated 2026-10-10, by design session)
- **Milestone:** 0 / not started (scaffold exists; see `BUILD_PROMPT.md` §6)
- **Just finished:** design spec (`design/`), build prompt, TigerData-based brief
- **In progress:** nothing
- **Next step:** follow `BUILD_PROMPT.md` §1: read the docs and scaffold, then write `docs/PLAN.md`
- **Broken / failing:** none known
- **Decisions made this session:** TigerData is the canonical database (prize track); product name is Klair
- **Blocked on / questions for the user:** none
- **How to verify current state:** `pnpm install && pnpm typecheck && pnpm dev` should open the scaffold's placeholder window

---

## Milestones
- [ ] 1. Connections + rename
- [ ] 2. Panel + keys
- [ ] 3. Capture → persist → notes
- [ ] 4. Controller
- [ ] 5. Retrieval (Graphify + TigerData search)
- [ ] 6. AI (suggestions + execution)
- [ ] 7. The rest (Tray, Sessions + insights, States, deletion, fn addon)
- [ ] 8. Prove it (demo, acceptance criteria, token measurements)

## Health checks
_Not run yet._

## Stubs and simulations
_None yet._

## Decisions log
- 2026-10-10: TigerData replaces SQLite for canonical records; screenshots stay local.
