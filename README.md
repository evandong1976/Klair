# Claire

Background AI assistant that brings contextual help to your current screen. Product brief: [MEGA_PROMPT.md](MEGA_PROMPT.md).

## Stack

| Layer | Technology | Where |
| --- | --- | --- |
| Desktop app | Electron + electron-vite | `src/main`, `src/preload` |
| Interface | React + TypeScript + Tailwind v4 | `src/renderer` |
| AI | Vercel AI SDK + Claude via OpenRouter | `src/main/ai.ts` |
| Database | TigerData (Postgres), canonical session records | `src/main/db.ts` |
| Cache | SQLite (`node:sqlite`, built into Electron) | `src/main/cache.ts` |
| Context retrieval | Graphify CLI | `src/main/graphify.ts` |

## Setup

```bash
pnpm install
cp .env.example .env   # then fill in the values below
pnpm dev
```

- `OPENROUTER_API_KEY`: used by the AI SDK and by `graphify extract`.
- `DATABASE_URL`: create a TigerData service and copy its connection string:
  ```bash
  tiger service create --name klair --cpu shared
  tiger db connection-string --with-password
  ```
  Tables are created on app start. Without `DATABASE_URL` the app runs with persistence disabled.
- Graphify: `uv tool install graphifyy`. Set `GRAPHIFY_BIN` to the output of `which graphify` if the app cannot find it.

## Scripts

- `pnpm dev`: run with hot reload
- `pnpm typecheck`: typecheck main and renderer
- `pnpm build:mac`: package the macOS app
