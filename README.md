# Klair

A background macOS assistant that keeps you on your current screen. While a session runs, a see-through pixel flower sits in the top-right corner and Klair takes notes on what you're looking at. Pause on something and it offers three ideas. Tap **fn** (or **⌃⌥K**) and the flower blooms into a glass panel; press **⌘1–3** to pick one, or ask your own question. The answer streams into the panel as a short, grounded explanation, and nothing runs until you ask.

Beyond the screen itself, you can hand Klair more context: **select an area** of the screen (⌘S), send it **whole web pages** with the Chrome extension, and **add files you download** to the session.

- Product brief: [MEGA_PROMPT.md](MEGA_PROMPT.md) (it calls the product "Claire")
- UI spec and keyboard map: [design/DESIGN.md](design/DESIGN.md)
- Build plan: [BUILD_PROMPT.md](BUILD_PROMPT.md)
- Progress, handoff and decisions: [docs/PROGRESS.md](docs/PROGRESS.md)
- TigerData usage: [docs/TIGERDATA.md](docs/TIGERDATA.md)
- Chrome extension: [extension/README.md](extension/README.md)

## What it does

- **Observes a session.** Klair checks the screen every 4 s and stores a screenshot only when it changed substantially (at least 5% of the screen) since the last stored one, so pointer moves and clock ticks never count but page switches and scrolls do. Each stored screenshot gets a short note from a vision model, written as observed facts.
- **Offers ideas.** The same note proposes three ideas for that screen (the first is always a summary). They appear beside the flower after you've stayed on a screen for the pause time (1 min by default). With the panel open, ideas follow the screen: change pages and the old ideas are dropped and new ones requested at once.
- **Answers in place.** Pick an idea (**⌘1–3**), type your own question (**⌘K**), then refine the answer with the reshape chips (**⌘⇧1–3**: Shorter, Simpler, More detail). Answers are short markdown, grounded in the screen note plus related notes from this and earlier sessions.
- **Selects an area.** **⌘S** in the panel lets you drag out part of the screen; it's captured at full resolution and pinned as the context until you clear it. See [Selecting an area](#selecting-an-area).
- **Reads whole web pages.** With the Chrome extension, the full text of each page you open joins the session, so ideas and answers can use the whole page, not just what's visible. See [Chrome extension](#chrome-extension).
- **Adds downloads.** When a file finishes downloading, Klair asks whether to add it; PDFs, documents, slides, spreadsheets, text and images are read into the session. See [Adding downloads](#adding-downloads).
- **Keeps sessions.** Everything is saved on the Mac in SQLite while the session runs and uploaded to TigerData when it ends. The Sessions window shows each session's timeline, time on topic, stuck spots and upload status.

## How it works

```
screen (every 4 s) ──► substantial change? ──► PNG + captures row (SQLite) ──► vision note + 3 ideas
Chrome extension ────► bridge (127.0.0.1:47821) ──► pages row + note ─────────┘ (note sees the page text)
~/Downloads ─────────► "Add file?" ──► Add ──► files row + extracted text + note
⌘S ──────────────────► selection overlay ──► full-resolution crop ──► capture pinned as context

pick / ask ──► retrieval: Graphify graph + SQLite FTS5 (this session) + TigerData BM25 (earlier sessions)
           ──► answer model (screen note, image for selections, full page, recent file, earlier notes)
           ──► streamed into the panel, saved as an action + note

session ends ──► upload.ts copies every row to TigerData in one transaction
```

The decisions about _when_ things may happen (dwell, cooldown, stale ideas, the pinned selection) live in a pure state machine, `src/main/controller-core.ts`, which is unit-tested. `src/main/controller.ts` carries out its effects. All Klair windows are excluded from screen capture.

## Stack

| Layer              | Technology                                                                                                           | Where                                                    |
| ------------------ | -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Desktop app        | Electron + electron-vite, pnpm                                                                                       | `src/main`, `src/preload`                                |
| Interface          | React + TypeScript + Tailwind v4, Reforma 1918 font, native macOS vibrancy                                           | `src/renderer`                                           |
| AI                 | Vercel AI SDK via OpenRouter: Gemini 3.5 Flash-Lite for screen notes and ideas, GPT-5.4 mini for answers             | `src/main/ai.ts`, `notes.ts`, `suggest.ts`, `execute.ts` |
| Live session store | SQLite (`node:sqlite`, FTS5 search): everything while a session runs, kept until retention                           | `src/main/local.ts`                                      |
| Database           | TigerData (Postgres + TimescaleDB): ended sessions, activity time-series, insights aggregate, BM25 search, retention | `src/main/db.ts`, `upload.ts`                            |
| Context retrieval  | Graphify CLI + local search (this session) + TigerData search (earlier sessions), merged                             | `src/main/graphify.ts`, `indexer.ts`, `retrieve.ts`      |
| Chrome pages       | Manifest V3 extension + a local HTTP bridge                                                                          | `extension/`, `src/main/bridge.ts`                       |
| Downloads          | Folder watcher + text extraction with macOS tools (PDFKit, textutil)                                                 | `src/main/downloads.ts`, `files.ts`                      |
| Note cache         | SQLite: screenshot hash → note, safe to delete                                                                       | `src/main/cache.ts`                                      |
| fn key             | Optional native addon (CGEventTap)                                                                                   | `native/fn-key`, `src/main/fnkey.ts`                     |

## Setup

```bash
pnpm install
cp .env.example .env.local      # fill in OPENROUTER_API_KEY and DATABASE_URL
pnpm dev
```

1. **OpenRouter:** create a key at https://openrouter.ai/keys and set `OPENROUTER_API_KEY`. The models (`KLAIR_FAST_MODEL`, `KLAIR_ANSWER_MODEL`) must accept images; the defaults were picked for speed. The Start window checks the key and model.
2. **TigerData:** use your own fork of the team database so test sessions don't mix:
   ```bash
   tiger auth login
   tiger service fork <team-service-id> --now --name klair-<you>
   tiger db uri <fork-id> --with-password      # → DATABASE_URL (append &uselibpqcompat=true)
   ```
   Tables, the hypertable, the continuous aggregate, retention and the BM25 index are created on start; the console prints any optional feature the service lacks. TigerData isn't needed to start a session: sessions are saved on the Mac and upload when TigerData is reachable (on start, hourly, and on **Check again**).
3. **Graphify** (a Python tool; use pipx from Homebrew):
   ```bash
   brew install pipx
   pipx ensurepath          # adds ~/.local/bin to your PATH (open a new Terminal after)
   pipx install graphifyy   # note the double y
   ```
   Klair finds `graphify` in `~/.local/bin`, `/opt/homebrew/bin` or your shell's PATH by itself. Set `GRAPHIFY_BIN` only if it's somewhere else. Without Graphify, answers still use search and the current screen.
4. **fn key (optional):** `pnpm build:native` builds `native/fn-key` against Electron; then allow Input Monitoring. Until then, use ⌃⌥K / ⌃⌥P / ⌃⌥Q.
5. **Chrome extension (optional):** `chrome://extensions` › **Developer mode** › **Load unpacked** › the repo's `extension/` folder. See [Chrome extension](#chrome-extension).
6. **Tiger MCP for builders (optional):** `tiger mcp install claude-code` lets Claude Code inspect the schema and test queries.

## Running: `pnpm dev` or `pnpm app`

- **`pnpm dev`** runs with hot reload. macOS files privacy grants under the app that launched it (Visual Studio Code, Terminal, iTerm…), so "Klair" never appears in System Settings; the Start window names the app to allow.
- **`pnpm app`** builds `dist/mac-arm64/Klair.app`, signs it with a local self-signed certificate (`scripts/sign-dev.sh`, kept in its own `klair-dev` keychain, so grants survive rebuilds), copies `.env.local` / `.env` into `~/Library/Application Support/Klair` (`scripts/copy-env.sh`; the app starts outside the repo), and opens it. Run it again after changing code or env files. Build the fn addon first (`pnpm build:native`) so it's bundled.

**Only one Klair runs at a time.** A second launch exits at once (printing "Klair is already running") and shows the running Klair's Start window. Quit one from the menu bar before starting the other.

### macOS permissions

| Permission       | Why                                             | How                                                                                                      |
| ---------------- | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Screen Recording | Capture during a session                        | Start window › **Allow**, switch it on, then **quit and reopen** (macOS applies it only after a restart) |
| Input Monitoring | The fn key (optional)                           | Start window › **Allow** on the fn row, switch it on, then **Check again**                               |
| Downloads folder | Offering new downloads (optional)               | macOS asks the first time a session starts                                                               |
| Automation       | Front app, window title, browser URL (optional) | `KLAIR_ACTIVE_WINDOW=applescript`; asked on first use                                                    |

If System Settings shows Klair as allowed but the app says it isn't, the entry is stale: run `tccutil reset ScreenCapture com.klair.app` and allow it again.

## Keys

Only the fn family is global; ⌘ keys work only while the panel is open. The full map is in [design/DESIGN.md](design/DESIGN.md) §4, and **⌘/** shows it in the panel.

| Where            | Keys                                        | Action                                                                                    |
| ---------------- | ------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Anywhere         | `fn` / `⌃⌥K` (changeable in the popover)    | Open or close Klair                                                                       |
| Anywhere         | `fn P` / `⌃⌥P` · `fn Q` / `⌃⌥Q`             | Pause or resume · quiet ideas for 30 min                                                  |
| Panel            | `⌘1–3` · `⌘↑↓` · `⌘K` · `⌘S` · `⌘/` · `esc` | Pick · move · ask · select an area · all keys · close                                     |
| Answer           | `⌘[` · `⌘⇧1–3` · `⌘R`                       | Back to ideas · reshape · retry                                                           |
| Menu bar popover | `⌘P` `⌘E` `⌘1–3` `⌘L` `⌘O` `⌘,`             | Pause · end session · pause time 30 s/1 min/2 min · last answer · all sessions · settings |
| Sessions window  | `⌘N` `⌘1–3` `⌘P` `⌘⌫`                       | New · switch session · pause · delete session                                             |
| Start window     | `⌘↵` / `esc`                                | Start observing / not now                                                                 |

## Selecting an area

In the open panel, click **Select area** (or press **⌘S**). The panel steps aside and the screen under the pointer dims; drag out a rectangle (its size shows as you drag) and let go. **esc** or a plain click cancels.

Klair captures that area at full Retina resolution, saves it like any capture (a PNG in the session's `shots/` folder and a `captures` row with `source = 'selection'`), writes a note focused on it, and reopens the panel with ideas for it. The selection is **pinned as the context**: ideas, "Ask about your selection…" and picked ideas use it, and its image goes with every answer, until you press **Use whole screen** on the panel's selection card or select another area. Automatic captures keep being stored meanwhile; clearing the selection hands over to the latest one.

## Chrome extension

`extension/` is a Manifest V3 extension ("Klair for Chrome"). On each new page, including in-app navigation on single-page sites and when you switch back to a tab, it reads the page's rendered text (up to 200k characters), title and URL and posts it to Klair at `http://127.0.0.1:47821` (`src/main/bridge.ts`).

- **What Klair does with a page:** stores it with the session (a `pages` row, a searchable note, and a markdown file Graphify indexes). Each new screenshot's note gets the latest page's text and says whether the screenshot shows it; if so, the screenshot is linked to the page and its ideas and answers use the whole page ("Full page · …" in sources).
- **When:** only while a session is observing (otherwise Klair answers 409 and drops the page), never in incognito, and not while the switch in the extension's popup is off. Revisiting a page makes it the live page again without storing it twice.
- **Who can send:** the bridge listens on 127.0.0.1 only and checks the Host header (against DNS rebinding). A request must carry the extension's origin, `chrome-extension://jndibkpbjoldneahpgmofeoekkpeaepo` (pinned by the `key` in `extension/manifest.json`), or no Origin at all (Chrome may omit it for extension requests); any other origin is refused. Web pages can't hide their origin, so they can't push content into a session.
- **Check it:** the Start window's **Chrome extension** row turns green within a minute (the extension checks in every minute); the popup shows whether Klair is observing and what happened to the last page. [Checking what's stored](#checking-whats-stored) shows the pages in SQLite.
- **PDFs opened in Chrome** aren't read by the extension (Chrome's PDF viewer is off-limits to extensions); download them instead and add them as a file.

## Adding downloads

While a session is observing, Klair watches your Downloads folder. When a file finishes downloading (browsers' temporary `.crdownload` / `.part` / `.download` names are ignored until renamed, and the size must stop changing), the flower shows **Add "file"?** with **Add** and **Not now**; the panel shows the same card. Nothing is read until you pick **Add**, and files that were already in Downloads when the session started are never offered.

On **Add**, Klair copies the file into the session folder (`sessions/local-<id>/files/`; files over 200 MB are kept by reference), extracts its text and stores it as a `files` row, a searchable note and a markdown file Graphify indexes.

| Type                                  | How it's read                    |
| ------------------------------------- | -------------------------------- |
| PDF                                   | macOS PDFKit                     |
| doc, docx, rtf, odt, html, webarchive | macOS `textutil`                 |
| pptx, xlsx                            | the text in their slides / cells |
| txt, md, csv, json, code…             | read directly                    |
| png, jpg, gif, webp, heic             | described by the vision model    |
| anything else                         | kept by name only                |

The newest added file goes with answers for 20 minutes ("Your file · …" in sources), so you can ask about it right away; after that it's found by search like any note.

## Configuration

Set these in `.env.local` (read first) or `.env`. For `pnpm app`, run `pnpm app` again after editing so the copies in Application Support are updated. `CLAIRE_*` names still work as a fallback for `KLAIR_*`.

| Variable                                        | Default                                 | What it does                                                                |
| ----------------------------------------------- | --------------------------------------- | --------------------------------------------------------------------------- |
| `OPENROUTER_API_KEY`                            | (required)                              | AI calls                                                                    |
| `DATABASE_URL`                                  | (none)                                  | TigerData; without it, sessions stay on the Mac                             |
| `KLAIR_FAST_MODEL`                              | `google/gemini-3.5-flash-lite`          | Screen notes, ideas, image descriptions                                     |
| `KLAIR_ANSWER_MODEL`                            | `openai/gpt-5.4-mini`                   | Answers                                                                     |
| `GRAPHIFY_MODEL` / `GRAPHIFY_OPENROUTER_KEY`    | `anthropic/claude-haiku-5.5` / main key | Graphify extraction (a separate key shows its cost on its own)              |
| `GRAPHIFY_BIN`                                  | found automatically                     | Path to `graphify`                                                          |
| `KLAIR_CAPTURE_MS`                              | `4000`                                  | How often the screen is checked                                             |
| `KLAIR_DWELL_MS`                                | `60000`                                 | Pause time before ideas appear on their own (also in the popover)           |
| `KLAIR_COOLDOWN_MS`                             | `120000`                                | Minimum gap between automatic idea pop-ups                                  |
| `KLAIR_DISMISS_QUIET_MS`                        | `600000`                                | Quiet time after you dismiss ideas                                          |
| `KLAIR_RETENTION_DAYS`                          | `14`                                    | How long sessions are kept (here and in TigerData)                          |
| `KLAIR_RETRIEVAL_BUDGET`                        | `1500`                                  | Tokens of earlier context per answer                                        |
| `KLAIR_INDEX_DEBOUNCE_MS` / `KLAIR_INDEX_BATCH` | `20000` / `5`                           | When Graphify re-indexes                                                    |
| `KLAIR_TOGGLE_KEY`                              | `Control+Alt+K`                         | Fallback open/close key (also changeable in the popover)                    |
| `KLAIR_ACTIVE_WINDOW`                           | off                                     | `applescript` reads front app, window title and browser URL                 |
| `KLAIR_WATCH_DOWNLOADS`                         | on                                      | `off` stops offering downloads                                              |
| `KLAIR_DOWNLOADS_DIR`                           | `~/Downloads`                           | Folder to watch                                                             |
| `KLAIR_BRIDGE_PORT`                             | `47821`                                 | Chrome bridge port (also change `extension/background.js` and the manifest) |
| `KLAIR_EXTENSION_ID`                            | the pinned id                           | Only if you load a differently keyed copy of the extension                  |
| `KLAIR_BASELINE`                                | off                                     | `full` sends all session notes instead of retrieval (token comparisons)     |

What counts as a "substantial" screen change is set in code: `CHANGE_SHARE` (5% of the screen) and `CELL_DELTA` (24 brightness levels) in [src/main/capture.ts](src/main/capture.ts). Page and file text limits are `PAGE_CHARS_FOR_NOTE` (15k, `notes.ts`), `PAGE_CHARS_FOR_ANSWER` (60k) and `FILE_CHARS_FOR_ANSWER` (40k, `execute.ts`).

## Where data lives

- **Screenshots and added files:** this Mac only, in `~/Library/Application Support/Klair/sessions/local-<id>/` (`shots/`, `files/`, `notes/`, `graphify-out/`).
- **The session record** (captures, selections, notes, ideas, answers, activity, Chrome pages, added files' text): SQLite at `~/Library/Application Support/Klair/klair.db`, while the session runs and until retention.
- **Ended sessions:** uploaded in full to your TigerData database in one transaction (text and metadata; image and file contents stay on the Mac). Each local session records its TigerData id, ready for resuming a session later. The Sessions window shows whether a session has been uploaded.
- **Sent to AI models (OpenRouter):** each new screen (for its note), with up to 15k characters of the latest Chrome page; selected areas' images; images you add from Downloads (to describe them); and for an answer, the screen note, up to 60k characters of the page on screen, up to 40k of a recently added file and the relevant earlier notes. Graphify extraction also uses OpenRouter.
- **Deleting a session** removes its local rows and TigerData copy (queued if TigerData is unreachable), its folder, Graphify index and cache entries. Sessions older than `KLAIR_RETENTION_DAYS` are removed automatically.

## Checking what's stored

```bash
DB=~/Library/Application\ Support/Klair/klair.db
sqlite3 -header -column "$DB" "select id, name, status, upload_status from sessions order by id desc limit 5;"
sqlite3 -header -column "$DB" "select id, captured_at, source, page_id, substr(note,1,60) as note from captures order by id desc limit 10;"
sqlite3 -header -column "$DB" "select id, captured_at, substr(title,1,40) as title, length(body) as chars from pages order by id desc limit 10;"
sqlite3 -header -column "$DB" "select id, added_at, name, kind, extract_status, length(body) as chars from files order by id desc limit 10;"
```

## Demo script (from the brief)

1. Run `pnpm dev` (or `pnpm app`). On the Start window, check the connection rows, name the session "ML study" and press **⌘↵**.
2. Open an encyclopedia article on machine learning, then switch to its _Gradient descent_ page and stay on the _Learning rate_ section.
3. After the pause time (1 min by default; change it in the menu bar popover), "3 ideas for this section" appears beside the flower.
4. Tap **fn** / **⌃⌥K**: the flower blooms and the panel shows _Where you are_ + three ideas (with the extension, sources include "Full page · …").
5. Press **⌘2**. The answer streams in; try a reshape chip (**⌘⇧1** Shorter).
6. Press **⌘S** and drag over the article's learning-rate figure: the panel comes back with ideas for just that figure. **Use whole screen** returns to normal.
7. Download a PDF on the topic and click **Add** on the flower's prompt, then ask "summarize the paper I just downloaded".
8. Press **esc**: the panel closes and focus returns to the article.
9. Open the menu bar popover › **All sessions** (⌘O). The timeline shows captures, the selection, the Chrome pages, the added file, _You asked_ and the answers. **Session insights** shows time on topic and the stuck spot: read on the Mac while the session runs, and from the TigerData continuous aggregate once it has ended and uploaded.
10. Switch back to the _Machine learning_ tab and open Klair. Answers cite "Earlier tab · …" from local search and Graphify, and "Earlier session · …" from TigerData.

**Token measurement:** run the demo twice, once normally and once with `KLAIR_BASELINE=full`, then compare `inputTokens` in `~/Library/Application Support/Klair/metrics.jsonl`. For Graphify's indexing cost, set `GRAPHIFY_OPENROUTER_KEY` so it shows separately in OpenRouter, or run `graphify benchmark <session>/graphify-out/graph.json`.

## Development

- `pnpm dev`: run with hot reload · `pnpm start`: run the last build
- `pnpm app`: build, sign and open `Klair.app` (see above)
- `pnpm typecheck` / `pnpm lint` / `pnpm test` / `pnpm build`
- `pnpm build:native`: build the fn-key addon
- `pnpm build:mac`: package the macOS app

Unit tests (`src/**/*.test.ts`, run with `tsx --test`) cover the controller state machine, change detection, the SQLite store, the Chrome bridge, the Downloads watcher and text extraction, and key parsing. The TigerData upload was also tested against a throwaway local Postgres.

**Layout:** `src/main` is the main process. `controller.ts` and `controller-core.ts` drive everything; `capture.ts`, `notes.ts`, `suggest.ts`, `execute.ts` and `retrieve.ts` are the pipeline; `local.ts`, `db.ts` and `upload.ts` are storage; `bridge.ts`, `downloads.ts` and `files.ts` bring in outside context; `windows.ts`, `shortcuts.ts`, `fnkey.ts`, `tray.ts` and `health.ts` are the shell. `src/renderer/src/views` holds one view per window route (`#/flower`, `#/panel`, `#/select`, `#/start`, `#/tray`, `#/sessions`). `src/shared` has the types and the IPC contract shared by both.

## Troubleshooting

- **The ⌘ keys do nothing:** they only work while the panel is open and focused. Click the panel once if another app grabbed focus.
- **No ideas appear:** check the Start window. You need "Where your data lives" and the AI models green, and the screen must stay put for the pause time. Opening the panel asks for ideas at once.
- **Screen recording says "not allowed" after you allowed it:** macOS applies the grant only after the app it belongs to restarts. In `pnpm dev` that's the app you ran it from (the Start window names it, e.g. Visual Studio Code): allow that app, quit it with ⌘Q and run `pnpm dev` again. Or use `pnpm app`.
- **`pnpm dev` exits right after "starting electron app…":** another Klair (often `Klair.app`) is running. Quit it from the menu bar first.
- **TigerData: "Connection terminated due to connection timeout":** usually the network (some campus and office Wi-Fi block port 31846). Sessions keep saving on the Mac and upload later; try a hotspot or VPN, then **Check again**.
- **Klair.app shows the AI models or TigerData red but `pnpm dev` works:** the app reads env files from `~/Library/Application Support/Klair`; run `pnpm app` again to copy them.
- **The extension's popup says "Klair isn't running" or "Klair refused the extension":** check that Klair is open and a session is observing; the Start window's Chrome extension row says what was refused. Reload the extension (↻ in `chrome://extensions`) after pulling new extension code, and reload tabs that were open before installing it.
- **No "Add file?" prompt after a download:** a session must be observing, `KLAIR_WATCH_DOWNLOADS` must not be `off`, and macOS must have been allowed to show Klair the Downloads folder.
- **"macOS is using the fn key":** System Settings › Keyboard › "Press 🌐 key to" › Do Nothing, or keep using ⌃⌥K.
