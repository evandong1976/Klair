# Klair

A background macOS assistant that keeps you on your current screen. A see-through pixel flower sits in the top-right corner while a session runs. Pause on something and it offers three ideas. Tap **fn** (or **⌃⌥K**) and the flower blooms into a glass panel; press **⌘1–3** to pick. The answer appears right there, often as a small working demo, and nothing runs until you pick.

- Product brief: [MEGA_PROMPT.md](MEGA_PROMPT.md)
- UI spec: [design/DESIGN.md](design/DESIGN.md)
- Build plan: [BUILD_PROMPT.md](BUILD_PROMPT.md)
- Progress and handoff: [docs/PROGRESS.md](docs/PROGRESS.md)
- TigerData usage: [docs/TIGERDATA.md](docs/TIGERDATA.md)

## Stack

| Layer              | Technology                                                                                                                      | Where                                                    |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Desktop app        | Electron + electron-vite, pnpm                                                                                                  | `src/main`, `src/preload`                                |
| Interface          | React + TypeScript + Tailwind v4                                                                                                | `src/renderer`                                           |
| AI                 | Vercel AI SDK via OpenRouter (Gemini 3.5 Flash-Lite for screen notes, GPT-5.4 mini for answers)                                 | `src/main/ai.ts`, `suggest.ts`, `execute.ts`, `notes.ts` |
| Live session store | SQLite (`node:sqlite`, FTS5): the running session, uploaded when it ends                                                        | `src/main/local.ts`                                      |
| Database           | TigerData (Postgres + TimescaleDB): ended sessions, activity time-series, insights aggregate, BM25 search over earlier sessions | `src/main/db.ts`, `upload.ts`                            |
| Cache              | SQLite (`node:sqlite`): screenshot hash → note, safe to delete                                                                  | `src/main/cache.ts`                                      |
| Context retrieval  | Graphify CLI + local search (this session) + TigerData search (earlier sessions), merged                                        | `src/main/graphify.ts`, `retrieve.ts`                    |
| fn key             | Optional native addon (CGEventTap)                                                                                              | `native/fn-key`                                          |

## Setup

```bash
pnpm install
cp .env.example .env.local      # fill in OPENROUTER_API_KEY and DATABASE_URL
pnpm dev
```

1. **OpenRouter:** create a key at https://openrouter.ai/keys and set `OPENROUTER_API_KEY`. Both models (`KLAIR_FAST_MODEL`, `KLAIR_ANSWER_MODEL`) must accept images. The Start window checks this for you.
2. **TigerData:** use your own fork of the team database so test sessions don't mix:
   ```bash
   tiger auth login
   tiger service fork <team-service-id> --now --name klair-<you>
   tiger db uri <fork-id> --with-password      # → DATABASE_URL
   ```
   Tables, the hypertable, the continuous aggregate, retention and the BM25 index are created on start. The console prints any optional feature the service lacks. A running session is saved on the Mac (SQLite) and uploaded to TigerData when it ends, so Klair still starts without `DATABASE_URL` or when TigerData is unreachable; those sessions upload once it's back (on start, hourly, and on **Check again**).
3. **Graphify** (a Python tool, so there's no Homebrew formula; use pipx from Homebrew):
   ```bash
   brew install pipx
   pipx ensurepath          # adds ~/.local/bin to your PATH (open a new Terminal after)
   pipx install graphifyy   # note the double y
   ```
   Klair finds `graphify` in `~/.local/bin`, `/opt/homebrew/bin` or your shell's PATH by itself. Set `GRAPHIFY_BIN` only if it's somewhere else. Without Graphify, answers still work using TigerData search and the current screen.
4. **fn key (optional):** `pnpm build:native` builds `native/fn-key` against Electron, then grant Input Monitoring. Until then, use ⌃⌥K / ⌃⌥P / ⌃⌥Q.
5. **Tiger MCP for builders (optional):** `tiger mcp install claude-code` lets Claude Code inspect the schema and test queries.
6. **Chrome extension (optional):** in Chrome open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked** and pick the repo's `extension/` folder. While a session is observing, every page you open in Chrome is sent to Klair in full (its whole rendered text, not just the part in view) and becomes part of the session. See [Chrome extension](#chrome-extension).

### macOS permissions

| Permission       | Why                                                                                | Where                                                   |
| ---------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Screen Recording | Capture during a session                                                           | System Settings › Privacy & Security › Screen Recording |
| Input Monitoring | The fn key (optional)                                                              | System Settings › Privacy & Security › Input Monitoring |
| Automation       | Front app, window title, browser URL (`KLAIR_ACTIVE_WINDOW=applescript`, optional) | Prompted on first use                                   |

In `pnpm dev`, macOS attributes these permissions to **Electron** or to the terminal that launched it, so "Klair" never appears in System Settings. To get a real **Klair** entry, run the app as its own bundle:

```bash
pnpm build:native   # once: the fn key addon, bundled into the app
pnpm app            # builds, signs, copies your env files and opens dist/mac-arm64/Klair.app
```

Quit `pnpm dev` first (only one Klair runs at a time). The app starts outside the repo, so `pnpm app` copies `.env.local` / `.env` into `~/Library/Application Support/Klair` (`scripts/copy-env.sh`; rerun `pnpm app` after editing them). Click **Allow** on a permission row in the Start window to make macOS list Klair, then switch it on. For the fn key, **Check again** picks up the grant; Screen Recording needs Klair quit and reopened. `pnpm app` signs the build with a local self-signed certificate (`scripts/sign-dev.sh`, kept in its own `klair-dev` keychain), so the grant survives rebuilds. If System Settings shows Klair as allowed but the app says it isn't, the entry is stale: run `tccutil reset ScreenCapture com.klair.app`, then allow it again.

## Selecting an area

In the open panel, click **Select area** (or press **⌘S**). The panel steps aside and the screen dims; drag out a rectangle (its size shows as you drag) and let go. **esc** or a plain click cancels. Klair captures that area at full Retina resolution, saves it like any capture (a PNG in the session's `shots/` folder and a `captures` row with `source = 'selection'` in SQLite, uploaded to TigerData when the session ends), writes a note about it, and reopens the panel with ideas for it.

The selection is **pinned as the context**: ideas, "Ask about your selection…" and picked ideas use it, and its image goes with every answer, until you press **Use whole screen** on the panel's selection card or select another area. Automatic captures are still stored meanwhile; clearing the selection hands over to the latest one.

## Chrome extension

`extension/` is a Manifest V3 extension ("Klair for Chrome"). On each new page, including in-app navigation on single-page sites, it reads the page's rendered text, title and URL and posts it to Klair at `http://127.0.0.1:47821` (`src/main/bridge.ts`).

- **What Klair does with a page:** stores it with the session (a `pages` row, a searchable note, and a markdown file Graphify indexes). Each new screenshot's note gets the latest page's text and says whether the screenshot shows it; if so, that screenshot's ideas and answers use the whole page ("Full page · …" in sources). Pages upload to TigerData with the rest of the session.
- **When:** only while a session is observing (otherwise Klair answers 409 and drops the page), never in incognito, and not while the switch in the extension's popup is off. Switching back to a tab makes it the live page again without storing it twice.
- **Who can send:** the bridge listens on 127.0.0.1 only and accepts requests only with `Origin: chrome-extension://jndibkpbjoldneahpgmofeoekkpeaepo`. That id is pinned by the `key` in `extension/manifest.json` (no private key is kept; it would only be needed to publish), so web pages can't push content into a session.
- **Settings:** `KLAIR_BRIDGE_PORT` (default 47821; also change `KLAIR` in `extension/background.js` and `host_permissions` in the manifest) and `KLAIR_EXTENSION_ID` (if you load a differently keyed copy).
- **Check it:** the Start window's **Chrome extension** row turns green within a minute of loading the extension; the extension's popup shows whether Klair is observing and what happened to the last page.

## Demo script (from the brief)

1. Run `pnpm dev`. On the Start window, check that every connection row is green, name the session "ML study" and press **⌘↵**.
2. Open an encyclopedia article on machine learning, then switch to its _Gradient descent_ page and stay on the _Learning rate_ section.
3. After the pause time (1 min by default; change it in the menu bar popover), "3 ideas for this section" appears beside the flower.
4. Tap **fn** / **⌃⌥K**: the flower blooms and the panel shows _Where you are_ + three ideas.
5. Press **⌘2** (the hands-on idea). The answer streams in as a slider demo plus code. Drag the slider, try **⌥3** (overshoot), **⌘C** copies the code.
6. Press **esc**: the panel closes and focus returns to the article.
7. Open the menu bar popover › **All sessions** (⌘O). The timeline shows the capture, _You asked_ and _Klair's answer_. **Session insights** shows time on topic and the stuck spot: read on the Mac while the session runs, and from the TigerData continuous aggregate once it has ended and uploaded.
8. Switch back to the _Machine learning_ tab and open Klair. Ideas and answers cite "Earlier tab · …" from local search and Graphify, and "Earlier session · …" from TigerData.

**Token measurement:** run the demo twice, once normally and once with `KLAIR_BASELINE=full`, then compare `inputTokens` in `~/Library/Application Support/klair/metrics.jsonl`. For Graphify's indexing cost, set `GRAPHIFY_OPENROUTER_KEY` so it shows separately in OpenRouter, or run `graphify benchmark <session>/graphify-out/graph.json`.

## Where data lives

- **Screenshots:** this Mac only, at `~/Library/Application Support/Klair/sessions/local-<id>/shots/`.
- **The running session** (captures, notes, ideas, answers, activity): SQLite on this Mac, `~/Library/Application Support/Klair/klair.db`.
- **Ended sessions:** uploaded in full to your TigerData database, in one transaction. The local copy stays until retention, and each local session records its TigerData id (for resuming a session later). The Sessions window shows whether a session has been uploaded.
- **Chrome pages (with the extension):** the full text of pages you open while a session is observing, stored like the rest of the session (on this Mac, then TigerData).
- **Sent to AI models (Google and OpenAI by default, via OpenRouter):** each new screen (for a short note) with up to 15k characters of the latest Chrome page, plus the relevant notes for ideas and answers, and up to 60k characters of the page on screen for an answer. Graphify extraction also uses OpenRouter.
- **Deleting a session** removes its local rows and TigerData copy (queued if TigerData is unreachable), screenshots, notes, Graphify index and cache entries. Sessions older than `KLAIR_RETENTION_DAYS` are removed automatically.

## Scripts

- `pnpm dev`: run with hot reload
- `pnpm typecheck` / `pnpm lint` / `pnpm test`
- `pnpm build:native`: build the fn-key addon (macOS)
- `pnpm build:mac`: package the macOS app

## Troubleshooting

- **The ⌘ keys do nothing:** they only work while the panel is open and focused. Click the panel once if another app grabbed focus.
- **No ideas appear:** check the Start window. You need "This Mac" and Claude green (TigerData only matters once a session ends), and the screen must stay unchanged for the pause time.
- **"macOS is using the fn key":** System Settings › Keyboard › "Press 🌐 key to" › Do Nothing, or keep using ⌃⌥K.
