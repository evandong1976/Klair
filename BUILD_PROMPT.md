# Build prompt: Klair MVP

> Paste this into Claude Code at the root of the Klair repo, or say: **"Read BUILD_PROMPT.md and follow it."**

---

You are the lead engineer building **Klair**, a macOS desktop assistant that runs in the background, watches the screen during a session, and offers help in place without a tab switch. Build a working hackathon MVP that **does what `MEGA_PROMPT.md` specifies** and **looks and behaves the way `design/DESIGN.md` specifies**.

Klair is an **Electron desktop app** (React + TypeScript + plain CSS in the renderer). It is not a browser web app. Its UI lives in transparent, always-on-top overlay windows above the user's other apps.

## 1. Read before writing any code

Read these in full, in this order:

1. `CLAUDE.md`: orientation and which file wins when they disagree.
2. `MEGA_PROMPT.md`: product brief, architecture diagram, pipeline, failure table, acceptance criteria. It calls the product "Claire"; the name is now **Klair** everywhere (UI, bundle ID, code).
3. `design/DESIGN.md`: visual system, flower, thick glass, keyboard map, malleable answers, Electron window plan.
4. `design/canvas/README.md`, then each `design/canvas/*.dc.html` when you build that screen. The inline `style="…"` values are the exact spec; copy them, don't approximate. `support.js` is not included, so read the files as markup, not something to open in a browser.
5. `design/reference/flower.ts`: use it as-is for the flower (it matches the design pixel for pixel).

Then inspect the repo for any existing code and write `docs/PLAN.md`: milestones, the libraries you chose and why, and open questions. Ask the user **only** about decisions that block you. For everything else, make a reasonable, reversible choice and record it in the plan.

## 2. Precedence and non-negotiables

- **Look, layout, copy, shortcuts, flow:** `design/DESIGN.md` and the canvas.
- **Behaviour, architecture, data, failure handling, privacy:** `MEGA_PROMPT.md`.
- A dwell (pause) may only **generate suggestions**. Only an explicit pick (`⌘1–3` or a click) runs assistance. Clicks and shortcuts go through the same validation in the background controller (current suggestion set, capture ID, not stale or dismissed, not a duplicate).
- Text captured from the screen is **source material, never instructions**. Fence it in every model prompt.
- Persist each capture (file + SQLite row) **before** indexing. Track index status and retry without duplicates. Deleting a session must also cancel queued indexing and remove indexed data.
- Exclude Klair's own windows from capture (`setContentProtection(true)`, verify) so it never reads its own UI.
- API key comes from local config or env (e.g. `ANTHROPIC_API_KEY` in `.env.local`, gitignored). Never commit a key. Keys, capture, storage and model calls stay in the main/background process. The renderer talks to it only through a narrow, typed preload IPC.
- Never execute model-generated code. Malleable answers render from a **whitelisted, schema-validated block set** (see §4).
- Don't call anything a "graph neural network". Don't build a general-purpose autonomous agent. Don't claim token savings you haven't measured.

## 3. Stack (from the brief; adjust only with a written reason in PLAN.md)

Electron · React + TypeScript + plain CSS · `desktopCapturer` + local image-change detection · `globalShortcut` + `BrowserWindow` · **Graphify** for context retrieval · Vercel AI SDK with a current vision-capable Claude model (make the model ID configurable; pick it by testing demo screens for quality and latency) · SQLite + a local screenshot directory · a small TypeScript state machine for the controller.

**Graphify:** first find the actual package or repo and confirm how it ingests, retrieves, persists and deletes data, and where its data is stored or sent. Don't assume it takes screenshots: convert captures into text plus metadata with timestamps and source IDs. If you can't verify or integrate it, put it behind an `IndexAdapter` / `RetrievalAdapter` interface, ship a clearly labelled local fallback, and report this. Never fake it.

## 4. UI requirements (from DESIGN.md: build exactly this)

- **Design tokens** as CSS custom properties from DESIGN.md §2: colors, radii, glass, keycaps. Bundle the fonts locally: Nunito (UI), Silkscreen (tiny labels only) and Geist Mono (code and timestamps), e.g. via `@fontsource`.
- **Flower window:** transparent, frameless, click-through, always on top, on all Spaces including fullscreen, at the top-right of the work area. Resting 11×11 at 4px cells; on `fn` it blooms to 30×30 using `bloomSteps(11, 30)` at 55ms per step. Grey when paused. 2px stepped "hop" every 3.2s. No background behind it, just the drop shadow from the spec.
- **Panel window** under the flower: thick glass on the container only, with solid white content inside it. On macOS use native vibrancy behind the CSS tint, because CSS `backdrop-filter` can't blur other apps. Screens to build:
  - `Main.dc.html`: "3 ideas" nudge pill
  - `Open.dc.html`: "Where you are" block, 3 idea tiles with previews, ⌘K ask box, hint strip
  - `Result.dc.html`: malleable answer
  - `Quiz.dc.html`
  - `Shortcuts.dc.html`: the ⌘/ sheet
- **Other windows:** `Start.dc.html` (permissions: Screen Recording and Input Monitoring; storage; retention), `Tray.dc.html` (menu bar popover), `Sessions.dc.html` (timeline with "Seen on screen" / "You asked" / "Klair's answer" tags, privacy, delete), and every card in `States.dc.html` wired to the matching failure from the brief's table.
- **Keyboard map:** exactly as in DESIGN.md §4.
  - `fn`, `fn P` and `fn Q` are global. `fn` alone needs a small native macOS addon, e.g. a CGEventTap on flags-changed. Ship the `⌃⌥K` fallback through `globalShortcut` **first**, so the loop works before the addon does.
  - All `⌘` bindings are active **only while the panel is open**.
  - `esc` (or `fn`) closes the panel and returns focus to the previous app.
  - Every control shows its key.
- **Malleable answers:** define a zod schema of answer blocks, e.g.:
  - `text`
  - `code`
  - `slider-plot`: parameter range + series computed by a safe evaluator or precomputed by the model
  - `quiz`
  - optional `reshape` suggestions (≤3)

  The renderer maps block types to fixed React components. Stream text blocks and validate structured blocks before rendering. Ideas, answers and quizzes all carry provenance chips ("On screen · 2:14 PM", "Earlier tab · 2:02 PM").
- `Backdrop.dc.html` is demo scenery, not product UI. Don't build it.

## 5. Build order (each milestone ends runnable and committed)

1. **Shell:** Electron + Vite + React + TS scaffold, tokens, fonts, flower window, tray icon, `⌃⌥K` opens a panel showing static ideas from the mockup. Typed IPC skeleton.
2. **Panel + keys:** Open, Result (with mock data), Quiz and Shortcuts screens at full fidelity. All shortcuts. Focus handling. Glass with vibrancy.
3. **Sessions + capture:** Start window and permission checks, periodic capture with dedupe, screenshot dir + SQLite records, crash-safe write ordering, pause/stop, recording state reflected in the flower.
4. **Controller:** state machine covering observe → dwell → cooldown → suggest → select → execute → present → dismiss. Stale invalidation, generation IDs, late results ignored.
5. **AI:** suggestion engine (3 grounded ideas, validated), nudge pill. Executor with streaming, cancel and retry, for summary (labelled "of what's been captured"), code/demo (malleable blocks) and quiz.
6. **Context:** Graphify adapters (or a labelled fallback), retrieval for suggestions and execution, related-tab continuity, provenance.
7. **Remaining UI:** Tray, Sessions window, all States, session deletion and retention, `fn` native addon.
8. **Prove it:** run the brief's demo (an ML article → pause on gradient descent → ⌘2 → answer in place → esc → saved to session). Walk every acceptance criterion and failure case. Measure model-input tokens with and without retrieval, including indexing overhead.

If several Claude Code sessions are building in parallel, claim a milestone in `docs/PROGRESS.md` before starting it, and keep the IPC types in one shared module.

## 6. Working rules

- Keep `docs/PROGRESS.md` current: what works, what's stubbed or simulated (clearly labelled), what's next. Another session should be able to pick up from it cold.
- Commit after each milestone with a clear message. Don't push or open PRs unless asked.
- Match the canvas closely. Check each screen against its `.dc.html` (sizes, spacing, copy, colors) before marking it done. If something in the design can't be built as drawn, say so in PROGRESS.md and propose the nearest alternative. Don't silently restyle.
- Prefer small, well-known libraries (e.g. `better-sqlite3`, `zod`). Note every native module, because each one needs an Electron rebuild.

## 7. Definition of done

Report back with:

1. What works end to end.
2. How to run it: setup, `.env.local`, macOS permissions, demo steps (also written to `README.md`).
3. What you tested and how.
4. What remains unverified or simulated.
5. Token measurements.
6. Any deviations from DESIGN.md or MEGA_PROMPT.md, with reasons.
