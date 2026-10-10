# Klair

A background macOS assistant that keeps you on your current screen. A see-through pixel flower sits in the top-right corner while a session runs. Pause on something and it offers three ideas. Tap **fn** (or **⌃⌥K**) and the flower blooms into a glass panel; press **⌘1–3** to pick. The answer appears right there, often as a small working demo, and nothing runs until you pick.

- Product brief: [MEGA_PROMPT.md](MEGA_PROMPT.md)
- UI spec: [design/DESIGN.md](design/DESIGN.md)
- Build plan: [BUILD_PROMPT.md](BUILD_PROMPT.md)
- Progress and handoff: [docs/PROGRESS.md](docs/PROGRESS.md)
- TigerData usage: [docs/TIGERDATA.md](docs/TIGERDATA.md)

## Stack

| Layer | Technology | Where |
| --- | --- | --- |
| Desktop app | Electron + electron-vite, pnpm | `src/main`, `src/preload` |
| Interface | React + TypeScript + Tailwind v4 | `src/renderer` |
| AI | Vercel AI SDK + Claude via OpenRouter | `src/main/ai.ts`, `suggest.ts`, `execute.ts`, `notes.ts` |
| Database | TigerData (Postgres + TimescaleDB): canonical records, activity time-series, BM25 note search | `src/main/db.ts` |
| Cache | SQLite (`node:sqlite`): screenshot hash → note, safe to delete | `src/main/cache.ts` |
| Context retrieval | Graphify CLI + TigerData search, merged | `src/main/graphify.ts`, `retrieve.ts` |
| fn key | Optional native addon (CGEventTap) | `native/fn-key` |

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
   Tables, the hypertable, the continuous aggregate, retention and the BM25 index are created on start. The console prints any optional feature the service lacks. Without `DATABASE_URL`, Klair won't start a session: it shows "This session isn't being saved".
3. **Graphify:** `uv tool install graphifyy`. Apps launched from the Dock don't inherit your shell PATH, so set `GRAPHIFY_BIN` to the output of `which graphify`. Without Graphify, answers still work using TigerData search and the current screen.
4. **fn key (optional):** `pnpm build:native` builds `native/fn-key` against Electron, then grant Input Monitoring. Until then, use ⌃⌥K / ⌃⌥P / ⌃⌥Q.
5. **Tiger MCP for builders (optional):** `tiger mcp install claude-code` lets Claude Code inspect the schema and test queries.

### macOS permissions

| Permission | Why | Where |
| --- | --- | --- |
| Screen Recording | Capture during a session | System Settings › Privacy & Security › Screen Recording |
| Input Monitoring | The fn key (optional) | System Settings › Privacy & Security › Input Monitoring |
| Automation | Front app, window title, browser URL (`KLAIR_ACTIVE_WINDOW=applescript`, optional) | Prompted on first use |

In `pnpm dev`, these permissions are granted to **Electron** itself. A packaged build (`com.klair.app`) needs its own grants. Restart the app after granting Screen Recording.

## Demo script (from the brief)

1. Run `pnpm dev`. On the Start window, check that every connection row is green, name the session "ML study" and press **⌘↵**.
2. Open an encyclopedia article on machine learning, then switch to its *Gradient descent* page and stay on the *Learning rate* section.
3. After the pause time (1 min by default; change it in the menu bar popover), "3 ideas for this section" appears beside the flower.
4. Tap **fn** / **⌃⌥K**: the flower blooms and the panel shows *Where you are* + three ideas.
5. Press **⌘2** (the hands-on idea). The answer streams in as a slider demo plus code. Drag the slider, try **⌥3** (overshoot), **⌘C** copies the code.
6. Press **esc**: the panel closes and focus returns to the article.
7. Open the menu bar popover › **All sessions** (⌘O). The timeline shows the capture, *You asked* and *Klair's answer*. **Session insights** shows time on topic and the stuck spot from the TigerData continuous aggregate.
8. Switch back to the *Machine learning* tab and open Klair. Ideas and answers cite "Earlier tab · …" from TigerData search and Graphify.

**Token measurement:** run the demo twice, once normally and once with `KLAIR_BASELINE=full`, then compare `inputTokens` in `~/Library/Application Support/klair/metrics.jsonl`. For Graphify's indexing cost, set `GRAPHIFY_OPENROUTER_KEY` so it shows separately in OpenRouter, or run `graphify benchmark <session>/graphify-out/graph.json`.

## Where data lives

- **Screenshots:** this Mac only, at `~/Library/Application Support/klair/sessions/<id>/shots/`.
- **Notes, prompts, answers:** your TigerData database.
- **Sent to Claude (OpenRouter):** each new screen (for a short note), plus the relevant notes for ideas and answers. Graphify extraction also uses OpenRouter.
- **Deleting a session** removes its TigerData rows, screenshots, notes, Graphify index and cache entries. Sessions older than `KLAIR_RETENTION_DAYS` are removed automatically.

## Scripts

- `pnpm dev`: run with hot reload
- `pnpm typecheck` / `pnpm lint` / `pnpm test`
- `pnpm build:native`: build the fn-key addon (macOS)
- `pnpm build:mac`: package the macOS app

## Troubleshooting

- **The ⌘ keys do nothing:** they only work while the panel is open and focused. Click the panel once if another app grabbed focus.
- **No ideas appear:** check the Start window. You need TigerData green and Claude green, and the screen must stay unchanged for the pause time.
- **"macOS is using the fn key":** System Settings › Keyboard › "Press 🌐 key to" › Do Nothing, or keep using ⌃⌥K.
