# Klair

**Resuming a build? Read `docs/PROGRESS.md` first and continue from its Handoff section.** Keep it updated and committed after every step (see `BUILD_PROMPT.md` §0), because a session can stop without warning.

Klair is a background macOS assistant built with Electron, React and TypeScript. It watches the screen during a session and offers help in place.

- **What to build:** `MEGA_PROMPT.md` covers the product brief, architecture, failure handling and acceptance criteria. The brief calls the product "Claire"; it is now **Klair**.
- **How it should look:** `design/DESIGN.md` covers the UI spec: the pixel flower indicator, thick-glass panels, colors, fonts and the full keyboard map. Read it before building any UI.
- **Mockups:** `design/canvas/*.dc.html` holds the exact markup and values for every screen (see `design/canvas/README.md`).
- **Flower code:** `design/reference/flower.ts` is a drop-in pixel-flower generator.
- **Building it:** `BUILD_PROMPT.md` has the build instructions, milestones and definition of done. Progress is tracked in `docs/PROGRESS.md`.
- **Stack as built:** `README.md` and `src/` cover Electron + electron-vite, pnpm, Tailwind v4, AI SDK via OpenRouter (Gemini 3.5 Flash-Lite for notes and ideas, GPT-5.4 mini for answers), SQLite (`node:sqlite`) as the local store, TigerData Postgres (a copy of each project, uploaded after each session), and the Graphify CLI (one graph per project). These replace the stack table in `MEGA_PROMPT.md`.
- **Projects vs sessions (since 2026-10-10):** a _project_ holds all context (captures, notes, ideas, answers, pages, files, activity) and has its own Graphify graph; a _session_ is only time (`sessions` + `project_spans`) and holds no data. The brief's "session" maps to a project. See README "Projects and sessions".
- **Added since the brief:** project slots 1–9 (fn/⌃⌥ 1–9 switch the active project, the session keeps running; context never crosses projects), a change and relevance judge that goes by each project's brief (`src/main/judge.ts`, `src/main/brief.ts`), project types (work, study, research) each with a fixed menu of options the model only picks from (`src/shared/options.ts`, ⌘1–9, ⌘O for all, ⌘T to change type), screen changes held while the panel is open, select an area (⌘S, `controller.ts` + `views/Select.tsx`), the Chrome extension that sends whole pages (`extension/`, `src/main/bridge.ts`), adding downloaded files (`src/main/downloads.ts`, `files.ts`), and the Knowledge graph pane (`src/main/graphs.ts`, `views/Graph.tsx`). `README.md` describes each; `docs/PROGRESS.md` logs the decisions behind them.
- **Checks before committing:** `pnpm typecheck && pnpm lint && pnpm test`. Test on the Mac with `pnpm dev` (hot reload) or `pnpm app` (the signed `Klair.app`, needed for real permission prompts); only one Klair can run at a time.

When they disagree: look, layout, copy and shortcuts follow `design/DESIGN.md`; behaviour follows `MEGA_PROMPT.md`; technology and services follow the scaffold.
