# Klair — UI design spec

This is the source of truth for **how Klair looks and feels**. `MEGA_PROMPT.md` is the source of truth for **what Klair does** (pipeline, architecture, failure handling, acceptance criteria). If they disagree about look, layout, copy or shortcuts, follow this file. If they disagree about behaviour or architecture, follow the brief.

- **Name:** the product is **Klair** (the brief calls it "Claire"; that name is retired).
- **Mockups:** every screen is in [`design/canvas/`](canvas/) as a `.dc.html` file with exact sizes, colors and copy. See [`canvas/README.md`](canvas/README.md) for how to read them.
- **Live canvas** (owner-only, editable): https://claude.ai/code/artifact/6ffedbde-94bc-42c6-a764-f48be765b6cb — the files in this repo are a snapshot of it taken 2026-10-10.
- **Flower code:** [`design/reference/flower.ts`](reference/flower.ts) is a framework-neutral port of the pixel flower. Use it directly.

---

## 1. The experience in one paragraph

A small, see-through **pixel flower** lives in the top-right corner of the screen whenever a session is running — that is the "Klair is on" signal. When the user lingers on one screen, a quiet glass pill appears beside it ("3 ideas for this section · fn"). Tapping **fn** makes the flower **resolve from ~11×11 to 30×30 pixels** (it literally becomes more defined) and a thick-glass panel unfolds beneath it with a one-line "where you are" read and three ideas. The user presses **⌘1 / ⌘2 / ⌘3** to pick one. The answer replaces the ideas in the same panel and is **malleable**: often a small working tool (a slider + chart + code) rather than a wall of text, with chips and a ⌘K box to reshape it. **esc** (or fn again) closes it and the flower shrinks back. Nothing runs until the user picks.

### Flow and screens

| # | Screen | File | Size |
|---|---|---|---|
| 1 | Resting + ideas ready (flower + nudge pill) | `Main.dc.html` | 1440×900 screen |
| 2 | fn pressed — flower blooms, ideas panel | `Open.dc.html` | 1440×900 screen |
| 3 | Answer you can play with (⌘2 picked) | `Result.dc.html` | 1440×900 screen |
| 4 | Quiz in place (⌘3 picked) | `Quiz.dc.html` | 1440×900 screen |
| — | ⌘/ shortcut sheet | `Shortcuts.dc.html` | 1440×900 screen |
| — | Flower states + bloom demo | `Indicator.dc.html` | 960×600 |
| — | Flower component | `Flower.dc.html` | 240×240 |
| 5 | Start a session (permissions, storage) | `Start.dc.html` | 560×720 window |
| 6 | Menu bar popover | `Tray.dc.html` | 380×620 popover |
| 7 | Sessions window (timeline, privacy, delete) | `Sessions.dc.html` | fluid, drawn at 1280×860 |
| 8 | States & recovery (all failure cases from the brief) | `States.dc.html` | 1440×1000 sheet |
| — | Fake article behind the overlays (demo content only) | `Backdrop.dc.html` | 1440×900 |

Not yet designed: the result for idea 1 ("Summarize this section"); settings; first-run onboarding beyond `Start`.

---

## 2. Visual system

Mood: soft pixel-art botanical — blush pink and sage on warm off-white, under thick frosted glass. Calm, low-noise, cute but legible.

### Colors

| Role | Hex | Use |
|---|---|---|
| Ink | `#2D3128` | Primary text, dark buttons |
| Ink 2 | `#3F4538` | Body text on glass |
| Ink 3 | `#4B5044` | Secondary text on glass, shortcut hints |
| Muted | `#686D60` | Secondary text on white |
| Sage deep | `#46522F` / `#56623F` | Pixel-font labels, "correct", "You asked" tag fill |
| Sage | `#9CAA77` | Flower stems, chart curve |
| Sage tint | `#EEF1E6`, `#F4F6EE`, `#C9D1B6` | Info boxes, correct-answer fill |
| Rose | `#EE8378` | Flower centre, chart points, progress, slider accent |
| Rose text | `#A8463D` (hover `#7E2F28`) | Links, "Your pick" |
| Blush | `#FCE4E2`, `#FFF5F4`, `#FFF7F6` | Highlighted tile, chip hover, "Klair's answer" tag |
| Blush lines | `#F3E6E3`, `#F0E4E1`, `#EADCD9`, `#E2D3D0` | Card borders, input borders, keycap border |
| Danger | `#A3271A`, border `#E8B9B3`, outline `#E8A39B` | Delete session, "not saving" |
| App ground | `#FBF7F5` | Windows without glass |
| Wallpaper (mock) | `#D8DECF` | Desktop behind overlays in mockups |
| Code | bg `#F7F5EF`, border `#ECE8DE`, comment `#6E7365`, keyword `#A8463D`, number `#46522F` | Code blocks |
| On-dark keycap | bg `#4A4F43`, border `#5C6254`, text `#FFFCFB` | Keycaps inside dark buttons |

Text contrast was chosen for ≥4.5:1 on white/glass; don't lighten the greys.

### Type

- **Reforma 1918** (PampaType, CC BY-ND 4.0, bundled in `src/renderer/src/assets/fonts/reforma/`) — the only typeface, used for all UI text, section labels and code (replaced Nunito, Silkscreen and Geist Mono on 2026-10-10). Three weights: Blanca for regular text, Gris for medium and semibold, Negra for bold and headings.
- Section labels ("Where you are", "Observing · 42:10") are 11–12px Gris, uppercase with wide letter-spacing.
- Keycaps use Reforma 1918 Negra with `-apple-system` fallback so ⌘ ⇧ ⌥ ⌃ ↵ glyphs render.
- Electron runs offline: bundle the fonts (e.g. `@fontsource/*` packages) instead of loading Google Fonts.

### Shape and spacing

- Radii: overlay panels 26px · windows 22–28px · cards 16–18px · inputs 14px · buttons 12px · keycaps 5–6px · chips/pills 999px.
- Panel padding 18–20px; stack gaps 6/8/10/12/16px. Hit targets ≥ 36px (primary ≥ 44px).

### Thick glass (panel backgrounds only)

> **Updated (2026-10-10):** frosted glass is back, as native macOS vibrancy on the panel, tray, Start and Sessions windows (`glass()` in `src/main/windows.ts`). The earlier attempt looked muddy because a Mac in Dark mode supplied the dark material; the app now forces light appearance. macOS rounds a vibrancy window at 16px, so the panel and tray shells use a **16px** radius (not 26px) to sit exactly on it. Shells are the Magic UI Magic Card in `src/renderer/src/components/magicui/` with a light translucent tint instead of a solid fill; the CSS recipe below is superseded by that component. Colors, type and shortcuts below still apply.

Glass is for the **background of containers** (panels, pills, popovers, windows, state cards). Everything **inside** them — idea tiles, inputs, code, demos, buttons — is solid white so it stays crisp.

```css
.klair-glass {
  background: linear-gradient(180deg, rgba(255,255,255,0.64), rgba(255,244,242,0.46));
  backdrop-filter: blur(36px) saturate(170%);
  -webkit-backdrop-filter: blur(36px) saturate(170%);
  border: 1px solid rgba(255,255,255,0.75);
  box-shadow:
    inset 0 1px 0 rgba(255,255,255,0.95),   /* top highlight */
    inset 0 0 0 6px rgba(255,255,255,0.14),  /* "thick" edge band */
    0 30px 70px rgba(90,60,55,0.22),
    0 2px 6px rgba(90,60,55,0.08);
  border-radius: 26px;
}
```

**Electron caveat:** CSS `backdrop-filter` only blurs content inside the same window — it cannot blur other apps behind a transparent window. Use native macOS vibrancy on the panel window (`vibrancy`, `visualEffectState: 'active'`) and keep the CSS gradient/border/shadow as the tint layer on top. Verify early; fallback is the same tint at higher opacity without blur.

### Keycaps

```css
.klair-key {
  font: 700 11.5px 'Reforma 1918', -apple-system, serif; line-height: 1;
  padding: 5px 8px; border-radius: 6px;
  background: #FFFFFF; border: 1px solid #E2D3D0; box-shadow: 0 2px 0 #E2D3D0;
  color: #2D3128; white-space: nowrap;
}
/* small inline variant inside buttons/chips: 10–10.5px, padding 3–4px 5–6px, bg #FBF7F5, no shadow */
/* selected idea: bg #FCE4E2, border + shadow #EBB8B2 */
```

### Other details

- Idea tile: white, 1px `#F3E6E3`, radius 16, min-height 64, keycap left, title 15/700 + subtitle 13/`#686D60`, a 56×40 pixel-ish preview of the output on the right. Hover `#FFF7F6` / `#EFCFCB`.
- Provenance chips: white pill, `#46522F` 12/600 — "On screen · 2:14 PM", "Earlier tab · 2:02 PM". Every answer says what it was built from.
- Timeline tags: "Seen on screen" (outline `#D4D9C6`), "You asked" (fill `#56623F`, white), "Klair's answer" (fill `#FCE4E2`, `#8E3A32`). Never present a generated answer as observed fact.
- Pixel progress: 8px-tall segmented bar (8px blocks, 2px gaps), rose fill animated with `steps(12)`.
- Motion: the resting flower hops 2px every 3.2s with `steps(1)` (pixel-honest, no smooth rotation that would blur pixels). Bloom/shrink = resolution steps (below). No other decorative motion.
- Icons: thin inline stroke SVGs; no emoji.

---

## 3. The flower

> **Open state (2026-10-10):** the panel no longer unfolds *beneath* the flower. It opens over the flower's corner and the flower becomes its backdrop. The corner flower steps aside as the panel appears, and the panel draws the flower from exactly the same size and position (44px, 2px in from the top-right), then in one 0.9s movement resolves it from 11×11 to 30×30, grows it to 210px and lets it settle at 22% opacity behind the content (`BackdropFlower` in `Panel.tsx`). The flower takes no space of its own above the panel.

The flower is the product's identity and its status light.

- **Always visible** while a session runs: top-right of the display, ~10–12px from the top and right edges of the work area (below the macOS menu bar). Fully **transparent background** — no chip behind it — with `filter: drop-shadow(0 1px 1px rgba(90,60,55,0.28))` so pale petals survive on white pages.
- It is drawn from a vector description sampled onto an N×N pixel grid, so detail = resolution:

| State | Resolution × cell | Rendered size |
|---|---|---|
| Observing (resting) | 11 × 4px | 44px |
| Ideas ready | 11 × 4px + "3 ideas · fn" glass pill to its left | 44px |
| Open (fn) | 30 × 4px | 120px |
| Open, answer/quiz showing | 30 × 3px | 90px (gives the panel room) |
| Paused / no permission | 11 × 4px, greyscale | 44px |

- **Bloom animation:** step the resolution 11 → 14 → 17 → … → 30 by +3 every 55ms (shrink back the same way). The cell size stays fixed, so the flower grows *and* gains detail.
- Palette: petals `#FFEEEC` `#FCDDDA` `#F9C9C4` (crease `#F8BDB7`) → inner `#F4A39B` → centre `#EE8378`; bud `#FDE0DE`/`#F9C3BE`; stems `#9CAA77`; leaves `#8A9868` (shade side) / `#A9B583` (light side).
- Render crisply: CSS grid of squares, or a `<canvas>` with `imageSmoothingEnabled = false` / `image-rendering: pixelated`. Implementation: `design/reference/flower.ts`.
- The flower is an original drawing inspired by a pastel pixel-art reference the owner supplied; the reference image itself is not in the repo.

---

### Project types (added 2026-10-11)

Each project is Work, Study or Research. The type has a pixel icon in the flower's style and a flower palette, both in `src/shared/options.ts`:

| Type | Icon (11 × 11 sprite) | Palette |
|---|---|---|
| Work | briefcase | Bluebell blues |
| Study | open book | Buttercup yellows |
| Research | magnifying glass | Violet |

- Sprites use four shades of the palette (centre, inner, crease, outer petal). They are drawn as crisp SVG squares (`components/TypeIcon.tsx`), 14px in the panel chip, 16px in the picker chips, 20px on Start rows.
- **Type chip** (panel, beside the project chip): 28px pill, palette's palest tint as fill and its crease shade as border, icon + label + `⌘T` keycap. Click or ⌘T steps to the next type.
- **Dynamic:** while Klair is checking which options fit the screen, the icon's two lighter shades twinkle (opacity steps, staggered across the pixels). Still when `prefers-reduced-motion` is set.
- **Picker** (Start window, under the new-project name): three pills; the selected one is filled with its palette, the others are white. Preselected from the name as it is typed.
- The rest of the panel keeps the blush and sage scheme whatever the type.

### Option tiles as they load (added 2026-10-11)

- The type's three standing options are drawn the moment the panel opens. Before the first screen of a session has been read they are dimmed (55%) and don't respond; once a screen is captured they are live while its note is still being written.
- When the checked list arrives, tiles are matched by option, not by position: one that is still offered stays where it is, new ones fade in from 6px below (220ms), dropped ones fade out. The header above them changes from "Reading your screen…" to the topic.
- **All options** is a small text button under the tiles, right-aligned, with a `⌘O` keycap; in the full list it reads "Only what fits this screen". A dimmed tile (55%, no hover) says why it can't run as its second line.
- "Do it for me" has its own preview (an arrow leaving a window) and, after it runs, the flower shows an "Opened …" pill for 2.5s.

## 4. Keyboard map

Keyboard-first: every action shows its shortcut on the control itself, and the open panel has a hint strip (`⌘1–9 pick · ⌘↑↓ move · ⌘/ all keys · esc close`).

**Rule:** only the **fn** family is global. All **⌘** shortcuts work **only while Klair's panel is open** (so ⌘1 never steals the browser's tab switching the rest of the time).

| Context | Keys | Action |
|---|---|---|
| Anywhere | `fn` | Open / close Klair (flower blooms / shrinks) |
| Anywhere | `fn P` | Pause / resume observing |
| Anywhere | `fn Q` | Quiet ideas for 30 min |
| Anywhere | `fn 1`–`fn 9` (or `⌃⌥1`–`⌃⌥9`) | Switch to the session in that slot; the running one is ended and saved first |
| Start window | `1`–`9` · `⌘N` | Continue that session · new session |
| Anywhere (fallback) | `⌃⌥K` | Replaces fn if macOS is using fn for input switching/dictation |
| Klair open | `⌘1`–`⌘9` | Pick an idea (from the fixed menu of the project's type; the three standing ones are always first) |
| Klair open | `⌘O` | All options: the type's whole menu, with what can't run here dimmed; again for only what fits |
| Klair open | `⌘T` | Change the project's type: Work → Study → Research |
| Klair open | `⌘↑` `⌘↓` | Move between ideas |
| Klair open | `⌘K` | Focus "Ask for something else" |
| Klair open | `⌘S` | Select an area: drag out a rectangle (esc cancels); it's captured and pinned as the context until "Use whole screen" |
| Klair open | `⌘/` | Shortcut sheet |
| Klair open | `esc` | Close |
| Answer | `⌘[` | Back to ideas |
| Answer | `⌘⇧1–3` | Reshape chips ("Simpler", "Show the math", …) |
| Answer | `⌘C` | Copy code |
| Answer | `⌘←` `⌘→` | Nudge the focused slider |
| Answer | `⌥1–3` | Slider presets |
| Answer | `⌘K` | Reshape box |
| Quiz | `⌘1–4` | Answer |
| Quiz | `⌘↵` / `⌘R` | Next question / start over |
| Menu bar popover | `⌘P` `⌘E` `⌘1–3` `⌘L` `⌘O` `⌘,` | Pause · End session · dwell 30s/1m/2m · last answer · all sessions · settings |
| Sessions window | `⌘N` `⌘1–3` `⌘P` `⌘⌫` | New · switch session · pause · delete session |
| Start window | `⌘↵` / `esc` | Start observing / not now |
| Error cards | `⌘R` `esc` `⌘E` `⌘,` `⌘↵` | Retry · dismiss/cancel · end session · settings · primary action |

**Implementation notes (verify):**
- Electron's `globalShortcut` cannot bind fn alone. Capture it with a small native macOS addon (e.g. a `CGEventTap` on flags-changed events watching the secondary-fn flag). Needs the **Input Monitoring** (or Accessibility) permission — `Start.dc.html` asks for it; `States.dc.html` covers "macOS is using the fn key".
- Opening the panel is an explicit user action, so it may take keyboard focus (needed for ⌘K typing) — restore focus to the previous app on close. Register the ⌘ bindings only while open.

---

## 5. Malleable answers

Answers are **composed UI**, not just text: the panel morphs to fit the task. The ⌘2 mock shows a "Step size η" slider driving a live plot of gradient-descent steps, the code updating with the slider, preset buttons, reshape chips (`⌘⇧1–3`), and a "Reshape this…" box (`⌘K`).

Proposed (not settled) build approach: the assistance request returns structured blocks validated against a schema — e.g. `text`, `code`, `slider-plot`, `quiz`, `steps` — plus up to three reshape suggestions. The renderer maps each block type to a fixed React component. Never execute model-generated JS; interactive blocks use an audited, whitelisted set.

### Quiz (built 2026-10-11)

"Test me" (study projects) opens a quiz in the panel (`Quiz.dc.html`; `Quiz` in `components/blocks.tsx`; panel 490px wide):

- **One question at a time:** a progress strip (one segment per question), "Question 2 of 5", the question, and four options with `⌘1–4` keycaps.
- **A pick is final.** It shows at once which option was right (sage border, "Correct answer") and which was picked if wrong (blush, "Your pick"), with a white card saying "Right." or "Not quite." and why. The other options fade to 60%. `⌘↵` goes on ("Next question", then "See your score"); it is disabled until an option is picked.
- **Score page:** "Your score", "3 of 5" at 28px, one line on how many to look at again, and **Try again** (`⌘R`) beside it. Below, every question with a ✓ or ✕ dot, what was picked (rose, only if wrong), the answer (sage) and why. The strip turns sage or rose per question.
- **Who decides what:** the model writes each question with one right answer, three wrong ones and a reason (`src/main/quiz.ts`), in plain labelled lines. Klair shuffles the options and keeps track of the right one, so the marked answer can never be the wrong index. Maths in questions and options is drawn as in answers.
- No reshape chips or box under a quiz.

### Interactive explainers (built 2026-10-11)

The first malleable answer that is built end to end. When a screen has a concept that is better understood by playing with it, the ideas gain one more tile ("Play with the learning rate"), and picking it opens an explainer in the panel.

- **Who decides:** the note call that already reads each new screen and writes the ideas also says whether there is a concept worth an explainer and which template fits (`explore` in `src/main/notes.ts`). Because it is the same call, the tile arrives with the other ideas, not seconds later. It is deliberately generous: any page whose subject has quantities that depend on each other gets one, worded to fit what an explainer can draw. No tile appears for chat, terminals, settings, search pages or prose with no quantities. (A separate Jev call made this decision at first; it ran after the note, so the tile popped in about three seconds late, and it offered a tile on one of six concept pages.)
- **What the model writes:** a small specification, never code (`landscapeSpec`, `curveSpec` in `src/shared/blocks.ts`): a title, one to three sliders, short math expressions, live readouts, and captions with conditions. Klair parses the expressions itself (`src/shared/expr.ts`, no `eval`) and draws everything with its own components (`src/renderer/src/components/Explorable.tsx`).
- **Templates:** *landscape*, a surface z = f(x, y) drawn in 3D (drag to turn, or a top-down contour map) with a path stepping across it; *curve*, one to three lines y = f(x); and *fit*, data points with a model fitted to them. Slopes for the landscape path are measured by Klair, so the model never writes a derivative.
- **Fit is computed by Klair, not described by the model.** The model names the relationship the data follows and writes the captions. Klair scatters the points once from a seed (so they never move), fits by least squares, measures the error on those points and on fresh ones, and provides the sliders: a degree (and optional penalty), or a slope and height for fitting a line by hand. Asked to show a regression with the curve template, a model drew its "data points" on the fitted line, so they moved with it, and invented the fitted curve. The rule this set: where correctness matters, Klair does the computing and the model only chooses parameters.
- **Checked before it is shown** (`checkSpec` in `src/shared/explorable.ts`): every expression parses, the surface is defined and the path moves. A spec that can't be drawn is sent back once with the reason. A slider that stops short of a regime its captions describe is widened automatically, a caption that can never show is dropped, and an explainer whose caption never changes gets one more try and is then shown anyway.
- **Why a spec and not a generated web page:** measured on the gradient descent example, a spec takes about 2 s and a fifth of a cent; a whole HTML and JavaScript app took 7 to 11 s and about a cent, looked different every run, and would mean running code written from screen content.
- **Layout:** plot on the left, sliders and readouts on the right, the caption underneath in a sage card that turns blush when the thing shown has gone wrong (a path that flew off the map). Height is coloured sage (low) to rose (high) in bands, so the top view reads as level sets.

---

## 6. Copy and states

- Plain language; no architecture words in the UI (no "Graphify", "index", "tokens").
- Be honest about scope: "Summary of what's been captured", "Earlier tabs couldn't be loaded, so this answer uses only what's on screen now."
- Ideas come from a fixed menu per project type (`src/shared/options.ts`): a short verb title ("Explain this", "Summarize this", "Do it for me") and one second line. The second line is the menu's own, or the name of the thing on screen when the model gave one ("Gradient descent", "Commit message"). No option text is written per screen by a model; that read as filler (changed 2026-10-11).
- Transmission is stated where it matters: "To make ideas and answers, Klair sends the relevant screenshots and notes to Claude."
- `States.dc.html` has the approved copy for: working (with cancel), no earlier context, request failed, fn busy, screen access needed, not saving, partial page, paused, stale ideas.
- Placeholders still open: `[RETENTION]` (how long sessions are kept).

---

## 7. Window plan for Electron (suggested, verify each)

| Window | Key options |
|---|---|
| Flower | `transparent`, `frame: false`, `hasShadow: false`, `focusable: false`, always on top at a high level, `setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })`, click-through via `setIgnoreMouseEvents(true, { forward: true })` except when the nudge pill is shown |
| Panel | Anchored under the flower, right-aligned; native vibrancy for the glass; resizes per content (ideas ≈ 460px wide, answer ≈ 572px, quiz ≈ 490px) |
| Popover | Menu bar tray popover, 380×620 |
| Sessions / Start | Normal windows; glass over the vibrancy material |

Exclude all Klair windows from screen capture (`setContentProtection(true)`) so Klair never "sees" its own UI.
