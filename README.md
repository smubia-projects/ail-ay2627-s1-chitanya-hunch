# Hunch

A multiplayer price-guessing game. The host creates a room, friends join by name and room code, and everyone submits one private guess per product. The host reveals the stored retail price and the nearest guesses win. Equal distances share a rank; both overestimates and underestimates count.

## SMU BIA AI Lodge showcase version

This fork is deployed by the club as a public demo:

- **Site** (repo root, Vercel): the React game and the Insights page. It calls the API at `VITE_API_BASE`.
- **API** (`server/`, Cloud Run): rooms, guesses, scoring, research reports and the AI analyst. Plain Node `http`,
  no framework. State lives in **Neon Postgres** (`DATABASE_URL`), keyed by room codes and random player tokens:
  there are no accounts. Without `DATABASE_URL` it falls back to PGlite in `.game-data/` (local development only).
- **Insights** (`/insights`): a public page over the published studies. `HUNCH_SEED_DEMO=on` loads a synthetic demo
  study (about 300 respondents) once on a fresh database. Ask the **AI analyst** about it: an agent that picks which
  analyses to run (OpenAI-format tool calls through the club gateway: `API_BASE_URL`, `API_KEY`, `MODEL_NAME`, default `deepseek-v4-flash`) and only
  quotes numbers its tools returned. Each visitor gets a few questions (shared limiter, bucket `ask`); past the limit
  a card links to AI Lodge.
- Rooms poll the API every 2 s during rounds (3 s in the lobby, 20 s after the game, paused in hidden tabs).

Not in this version: the company research portal and its magic-link / prototype sign-in, and the Vercel function
(`api/handler.js`). Research opt-in still works, but reports are shown on the public Insights page as a demo and are
not sold or shared with companies. See `docs/commercial-plan.md` for the student's business idea.

```sh
cp .env.example .env          # DATABASE_URL empty = local PGlite; add API_KEY for the analyst
npm install && npm run dev    # game server on 3001 + Vite on 5173 (Vite proxies /api)
npm test                      # 53 tests, no network or key needed
```
The API image builds from `server/` (`server/Dockerfile`), and `.github/workflows/deploy.yml` deploys it.

## Run locally

```sh
npm install
npm run dev
```

On Windows PowerShell, use `npm.cmd` if execution policy blocks `npm.ps1`.

This starts the Node game server on port 3001 and Vite on port 5173. Open the Network URL printed by Vite on all phones connected to the same Wi-Fi. The host computer must remain running. If a phone cannot connect, check the host's firewall and whether the Wi-Fi isolates devices.

1. Enter your name and choose **Host a game**.
2. Use **Copy invite link** or share the six-character room code with friends.
3. Friends open the same network address and choose **Join a game**.
4. Each player locks in one guess. The host reveals the price after guesses arrive; an early reveal requires confirmation and closes guessing for the round.
5. See the closest guesses, then advance to the next item. After ten rounds, view the final scores.

## Scoring and state

New games draw ten unique items from a 48-item catalog: six items each in Tech, Fashion, Home, Beauty, Food & Drink, Sports, Hobbies and Everyday. Every game covers all eight categories with a shuffled order. Existing saved rooms retain their original rounds. Draws are independent, so an item can recur in a later game.

Catalog benchmarks are illustrative SGD values; product pictures are labelled illustrations. Commercial studies must replace demo benchmarks with dated, verified prices and licensed exact-product imagery. Run `node scripts/export-catalog.js` to export the complete server-only dataset to `server/catalog.json`. Prices stay outside the frontend bundle. See `docs/commercial-plan.md` for the proposed business offering.

Round ranking is by absolute price difference. Points are rounded accuracy: `max(0, 100 * (1 - absoluteDifference / actualPrice))`, rounded to a whole number. Overall ranking uses accumulated points. Missed rounds earn zero points. Tied nearest guesses each receive a round win.

Prices are predefined demo values in `server/products.js`, not live retailer prices. The server excludes actual prices and other players' guesses from round responses until reveal. Browser sessions are remembered in localStorage. Room state persists in `.game-data/rooms.json` across server restarts. Names and submitted guesses are visible to room participants after reveal. Names must be unique within each room.

This is a local-network app, not an internet deployment. Publishing the static `dist` folder alone will not run multiplayer: a Node server and `/api` routing are required. This development setup is intended for a friendly game, not a tamper-proof competition. The host should keep their browser session until the game ends; host transfer is not implemented.

## Commercial research preview

Players can optionally opt in to anonymous, aggregate price-perception reports (shown on the public Insights page in this showcase). Playing is available without research consent. Existing data is excluded; opting in affects future guesses only. Opted-in players can also answer an optional, separate maximum-pay question before price reveal. Zero means they would not buy the item.

The host's **Insights** tab reports only revealed rounds from their own room. Each product or metric needs at least five opted-in responses before publication. It shows median perceived price, interquartile range, median bias against the demo benchmark, and a stated maximum-pay median if enough optional responses exist. CSV exports include aggregate rows only. The threshold is a disclosure precaution, not guaranteed anonymity or sufficient evidence for pricing decisions. These are self-selected responses; maximum-pay answers are hypothetical and must not be presented as observed sales or estimated demand curves.

### Company research portal (not in the showcase)

The original version had a company portal with per-company sign-in. The showcase replaces it with the public Insights page described at the top.

Research preferences can be changed in Profile, even after a game finishes. Withdrawal removes the player's research records from future reports in that room, but does not delete their game guesses or recall previously exported reports. Research events store submission time and consent version. Room state is local, single-server JSON storage. Before a paid launch, implement operator/customer accounts, scoped access to pooled studies, deduplicated recruitment, production storage, and a documented retention policy. Public internet deployment is separate from the local Wi-Fi setup.

## Verification

```sh
npm test
npm run build
npm run lint
```

The tests cover independent HTTP sessions, hidden guesses, nearest-price ties, duplicate names, input validation, round transitions, host authorization, scoring and restored room state. Existing unused demo components may generate lint warnings.
