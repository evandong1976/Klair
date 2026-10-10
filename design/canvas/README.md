# Design canvas snapshot

These files are a snapshot of the Klair design canvas (12 artboards). Read [`../DESIGN.md`](../DESIGN.md) first. It explains what each screen is for and lists the tokens, shortcuts and Electron notes.

## How to read a `.dc.html` file

Each artboard is HTML with inline styles. **The inline `style="…"` values are the exact design values** (sizes, colors, radii, copy), so copy them directly. The files use a small templating layer from the design tool:

| Syntax | Meaning |
|---|---|
| `<x-dc> … </x-dc>` | The artboard's markup |
| `<helmet>` | Head content: font links, a few CSS rules, keyframes |
| `{{name}}` | Value computed in `renderVals()` in the `<script type="text/x-dc">` block at the bottom |
| `<sc-for list="{{items}}" as="item">` | Repeat for each item |
| `<sc-if value="{{cond}}">` | Render only when true |
| `<dc-import name="Flower" res="11" cell="4">` | Embed `Flower.dc.html` with those props |
| `onClick="{{handler}}"` | Event handler from `renderVals()` |
| `<a href="Result.dc.html">` | Prototype link to another screen |

`./support.js` (the design tool's runtime) is **not** included, so the files won't render if you open them directly in a browser. Use them as markup/CSS reference, or ask the canvas owner to export PNGs.

`canvas.json` records where each artboard sits on the canvas. It isn't needed for building.

## Files

- `Main.dc.html`: resting flower + "3 ideas" pill
- `Open.dc.html`: fn pressed; bloomed flower + glass ideas panel
- `Result.dc.html`: malleable answer (slider, plot, code, reshape); the logic is in its script block
- `Quiz.dc.html`: quiz with answer states
- `Shortcuts.dc.html`: ⌘/ sheet (the shortcut list is in its script block)
- `Indicator.dc.html`: flower states + bloom animation demo
- `Flower.dc.html`: the flower component (see also `../reference/flower.ts`)
- `Start.dc.html`, `Tray.dc.html`, `Sessions.dc.html`, `States.dc.html`: session UI and recovery states
- `Backdrop.dc.html`: fake encyclopedia page used behind the overlays (demo content, not product UI)
