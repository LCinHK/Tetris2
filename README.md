# Tetris 2 – Competitive Multiplayer Tetris

A real-time, two-player competitive Tetris game built entirely with Node.js and vanilla browser technologies (no front-end framework, no bundler).

---

## Table of Contents

- [Features](#features)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Getting Started](#getting-started)
- [Running Tests](#running-tests)
- [Game Modes](#game-modes)
- [Cheat Codes](#cheat-codes)
- [WebSocket Message Reference](#websocket-message-reference)

---

## Features

- 🎮 **1v1 multiplayer** via WebSockets with lobby codes
- 🃏 **Three game modes**: Score Attack, Time Attack (3 min), Obstacle (garbage lines)
- 👻 **Ghost piece**, **hold piece**, **next piece preview**
- 📊 **Per-session stats**: games played, high score, lines cleared, win/loss record, recent score history
- 🔑 **Escalating cheat codes** (Konami-style arrow-key sequences) for score boosts or opponent board obfuscation
- ⚙️ **Persistent settings** (cheat on/off, sound on/off, default game mode) stored per WebSocket session
- 🛡️ Path-traversal protection on the static file server
- ✅ Unit-tested server with Node.js built-in test runner (no extra test framework)

---

## Tech Stack

| Layer | Technology |
|---|---|
| Server runtime | Node.js (≥ 18) |
| HTTP server | `node:http` (no framework) |
| Real-time comms | `ws` v8 (WebSocket server) |
| Front-end | Vanilla HTML5, CSS3, JavaScript (ES6+) |
| Rendering | HTML5 Canvas API |
| Testing | `node:test` + `node:assert` (built-in) |
| Package manager | npm |

No build step, no transpiler, no front-end framework — the browser receives the source files directly.

---

## Project Structure

```
Tetris2/
├── server.js              # HTTP + WebSocket server (all back-end logic)
├── package.json
├── package-lock.json
├── public/                # Static files served to the browser
│   ├── index.html         # Home / lobby page
│   ├── game.html          # Active gameplay page
│   ├── gameover.html      # Game-over results page
│   ├── css/
│   │   └── style.css      # All styling (dark theme, responsive)
│   └── js/
│       ├── network.js     # WebSocket client wrapper (shared message bus)
│       ├── tetris.js      # Core Tetris engine: TetrisGame class, SRS rotation, 7-bag RNG
│       ├── game.js        # Game-page controller (keyboard input, countdown, opponent sync)
│       ├── home.js        # Home-page controller (lobby create/join, stats display, settings)
│       ├── cheat.js       # Client-side cheat-sequence detector
│       └── gameover.js    # Game-over page controller
└── test/
    └── server.test.js     # Server unit tests (HTTP, WebSocket, lobby, stats, cheats)
```

### Key modules explained

**`server.js`** — single-file back end that:
- Serves static files from `public/` with MIME detection and path-traversal protection
- Exposes `GET /api/stats` (JSON array of all connected players' stats)
- Manages in-memory state: `players` map, `lobbies` map, `playerStats` map
- Handles the full WebSocket lifecycle (connect → lobby → game → game-over → disconnect)
- Implements all game logic: lobby management, game start (shared seed for deterministic RNG), garbage-line dispatch, cheat-code validation, and stats tracking

**`public/index.html`** — home / lobby page:
- Entry point of the application; rendered when a player first visits the site
- Contains the player-name input, game-mode selector, and lobby create/join controls
- Houses the lobby panel (lobby code display, player list, Ready button) and the settings panel
- Loads `network.js` then `home.js`

**`public/game.html`** — active gameplay page:
- Rendered when a match is in progress; navigated to programmatically after `game_start`
- Contains the player's main canvas, the opponent's mirror canvas, the next-piece and hold-piece preview canvases, score/level/lines HUD, and cheat-code panel
- Loads `network.js`, `tetris.js`, `cheat.js`, then `game.js`

**`public/gameover.html`** — post-match results page:
- Rendered after the game ends; navigated to by `game.js` with results in `localStorage`
- Displays the final score, lines cleared, level, game mode, and cumulative session statistics
- Loads `network.js` then `gameover.js`

**`public/css/style.css`** — global stylesheet:
- Single stylesheet used by all three HTML pages
- Implements a dark-theme design with CSS custom properties (variables) for colours and spacing
- Covers layout (flex/grid), canvas sizing, HUD elements, buttons, panels, and responsive adjustments

**`public/js/tetris.js`** — self-contained Tetris engine:
- `TetrisGame` class instantiated on a `<canvas>` element
- 7-bag random piece generator using a seeded Mulberry32 PRNG (so both players draw identical piece sequences)
- Full SRS (Super Rotation System) wall-kick tables for all pieces
- Ghost piece, hold, scoring (with level multiplier and optional 2× score boost)
- `addGarbageLines()` for Obstacle mode; `activateScoreBoost()` for cheat effect

**`public/js/network.js`** — thin WebSocket wrapper loaded on every page:
- Connects to the server over `ws://` or `wss://` depending on the page protocol
- Provides `Network.on(type, fn)` / `Network.send(obj)` event-bus API
- Restores the player's last-used name from `localStorage`

**`public/js/game.js`** — active gameplay controller:
- Reads the shared game seed, game mode, and player list from `localStorage`
- Runs the pre-game countdown (3-2-1-GO) then starts the `TetrisGame` engine
- Maps keyboard input (arrow keys, Z/X/C/P) to game actions and forwards arrow keys to `CheatManager`
- Syncs the local board state to the server and renders the opponent's board from incoming `opponent_update` messages
- Manages the Time Attack timer; handles `add_garbage`, cheat effects, and opponent game-over events
- Saves results to `localStorage` and navigates to `gameover.html` when the match ends

**`public/js/home.js`** — home / lobby page controller:
- Wires all interactive controls on `index.html`: name input, game-mode selector, create/join buttons, Ready button, and settings panel
- Communicates with the server to create and join lobbies, receive live player-list updates, and wait for `game_start`
- Fetches and renders per-session statistics (games, wins, high score, recent scores)
- Persists user settings (cheats, sound, default mode) via the server and `localStorage`

**`public/js/cheat.js`** — cheat-code detection system:
- `CheatManager` class that tracks the player's arrow-key input against the current required sequence
- Fires `onActivate` when the full sequence is entered, then waits for the server to confirm with `cheat_activated`
- Reports progress (how many keys matched so far) via `onProgress` so the UI can highlight the sequence
- Auto-deactivates after the server-specified duration; supports escalating sequences

**`test/server.test.js`** — server unit-test suite:
- Uses Node.js's built-in `node:test` runner — no extra test framework required
- Spins up a real HTTP + WebSocket server on a random port, runs all tests, then tears down cleanly
- Coverage includes: static file serving, path-traversal blocking, WebSocket lifecycle, lobby create/join/leave/full, game start, cheat-code validation, game-over stat recording, settings save/restore, and Obstacle-mode garbage lines

---

## Getting Started

### Prerequisites

- **Node.js ≥ 18** (uses the built-in `node:test` runner and `node:assert`)
- **npm** (bundled with Node.js)

### Install & run

```bash
# 1. Install the single runtime dependency (ws)
npm install

# 2. Start the server
npm start
# → Tetris2 server running on http://localhost:3000
```

Open **http://localhost:3000** in your browser. To play multiplayer, open the same URL in two separate browser tabs (or share the URL with someone on the same network).

### Configuration

The only configurable option is the port number, set via the `PORT` environment variable (default: `3000`):

```bash
PORT=8080 npm start
```

No other configuration files or environment variables are required.

---

## Running Tests

```bash
npm test
```

The test suite uses **Node.js's built-in test runner** (`node:test`) — no additional packages needed. It spins up a real HTTP + WebSocket server on a random port, runs all assertions, and tears down cleanly.

Test coverage includes: HTTP static file serving, path-traversal blocking, WebSocket connection lifecycle, player name setting, lobby create/join/leave/full, game start, cheat-code activation and rejection, game-over stat recording, settings save/restore, and Obstacle mode garbage lines.

---

## Game Modes

| Mode | Description |
|---|---|
| **Score Attack** | Classic — highest score when the game ends wins |
| **Time Attack** | 3-minute timer — most points when time runs out wins |
| **Obstacle** | Clearing lines sends garbage rows to your opponent (clearing N lines sends N−1 garbage rows) |

---

## Cheat Codes

Cheat codes are optional (toggled in Settings). When enabled, the server sends an arrow-key sequence at game start. Enter it using the arrow keys during gameplay:

- **Even activations** → `score_boost`: doubles scoring for 30 seconds
- **Odd activations** → `opponent_obfuscate`: obfuscates the opponent's board for 10 seconds

Each successful activation unlocks a longer, harder sequence for the next cheat. Up to 5 escalating sequences are defined.

---

## WebSocket Message Reference

All messages are JSON objects with a `type` field.

### Client → Server

| `type` | Payload | Description |
|---|---|---|
| `set_name` | `{ name }` | Set display name |
| `create_lobby` | `{ gameMode }` | Create a new lobby |
| `join_lobby` | `{ code }` | Join an existing lobby by code |
| `leave_lobby` | — | Leave current lobby |
| `player_ready` | — | Signal ready; game starts when all players ready |
| `game_update` | `{ board, score, level, lines }` | Broadcast board state to opponent |
| `lines_cleared` | `{ count, score }` | Notify server of cleared lines (triggers garbage in Obstacle mode) |
| `cheat_activate` | `{ sequence }` | Submit a cheat-code key sequence |
| `game_over` | `{ score, linesCleared, gameMode }` | Report game over |
| `get_stats` | — | Request current session stats |
| `save_settings` | `{ settings }` | Persist settings on the server |
| `get_settings` | — | Retrieve current settings |

### Server → Client

| `type` | Key Payload Fields | Description |
|---|---|---|
| `connected` | `clientId`, `playerName` | Sent immediately on connection |
| `name_set` | `name` | Confirms name update |
| `lobby_created` | `code`, `gameMode`, `players` | Lobby successfully created |
| `lobby_joined` | `code`, `gameMode`, `players` | Joined an existing lobby |
| `lobby_updated` | `players` | Player list changed |
| `player_ready` | `playerId`, `players` | A player marked themselves ready |
| `game_start` | `seed`, `gameMode`, `players`, `cheatCode` | Game begins; `seed` drives the shared RNG |
| `opponent_update` | `board`, `score`, `level`, `lines` | Opponent's board state |
| `add_garbage` | `lines` | Add N garbage rows (Obstacle mode) |
| `opponent_game_over` | `score`, `playerName` | Opponent's game ended |
| `cheat_activated` | `cheatType`, `duration`, `nextCheatCode` | Cheat accepted |
| `cheat_invalid` | `reason` | Cheat rejected |
| `cheat_effect` | `effect`, `duration` | Effect applied to this player (e.g. obfuscate) |
| `game_over_confirmed` | `stats` | Server confirms game-over and returns updated stats |
| `stats` | `stats` | Response to `get_stats` |
| `settings_saved` | `settings` | Settings persisted |
| `settings` | `settings` | Response to `get_settings` |
| `error` | `message` | Error message (e.g. lobby not found) |
