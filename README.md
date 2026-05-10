# Tetris 2 – Competitive Multiplayer Tetris

A real-time, two-player competitive Tetris game built entirely with Node.js and vanilla browser technologies (no front-end framework, no bundler).

---

## Table of Contents

- [Tetris 2 – Competitive Multiplayer Tetris](#tetris-2--competitive-multiplayer-tetris)
  - [Table of Contents](#table-of-contents)
  - [Features](#features)
    - [Known missing / partial implementations](#known-missing--partial-implementations)
  - [Tech Stack](#tech-stack)
  - [Project Structure](#project-structure)
    - [Key modules explained](#key-modules-explained)
  - [Getting Started](#getting-started)
    - [Prerequisites](#prerequisites)
    - [Install \& run](#install--run)
    - [Configuration](#configuration)
  - [Running Tests](#running-tests)
  - [Game Modes](#game-modes)
  - [How to Play](#how-to-play)
  - [Cheat Codes](#cheat-codes)
    - [Usage rules](#usage-rules)
    - [Effects](#effects)
  - [WebSocket Message Reference](#websocket-message-reference)
    - [Client → Server](#client--server)
    - [Server → Client](#server--client)
  - [Known Limitations](#known-limitations)

---

## Features

- 🎮 **1v1 multiplayer** via WebSockets with lobby codes
- 🃏 **Two game modes**: Score Attack, Time Attack (3 min)
- 👻 **Ghost piece**, **hold piece**, **next piece preview**
- 📊 **Per-session stats**: games played, high score, lines cleared, win/loss record, recent score history
- 🔑 **Escalating cheat codes** (digit-only sequences) granting score boost + slow drop
- ⚙️ **Persistent settings** (cheat on/off, sound on/off, default game mode) stored per WebSocket session
- 🛡️ Path-traversal protection on the static file server
- ✅ Unit-tested server with Node.js built-in test runner (no extra test framework)
- 👀 **Real-time opponent board** — see your opponent's active piece and board state live as they play
- ⏸️ **Pause-safe Time Attack** — the countdown freezes while paused and resumes with the exact remaining time
- 🏆 **Clear match outcomes** — the game-over screen shows Win / Loss / Time's Up based on how the game ended

### Known missing / partial implementations

- **Sound Effects** — the `soundEnabled` setting is saved/restored in `public/index.html`, `public/js/home.js`, and `server.js`, but there are no audio assets, `Audio`/`AudioContext` calls, or gameplay hooks that actually play sounds.
- **Paused Time Attack clock** — `public/js/game.js` pauses the Tetris loop, but the `time_attack` countdown interval keeps running while the game is paused.
- **Full game-over outcome flow** — `server.js` tracks wins/losses and `public/js/gameover.js` shows score/history, but the results page does not render an explicit win/loss outcome, and “Play Again” always returns to `/` instead of restarting the current lobby.

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
- Implements all game logic: lobby management, game start (shared seed for deterministic RNG), cheat-code validation, and stats tracking

**`public/js/tetris.js`** — self-contained Tetris engine:
- `TetrisGame` class instantiated on a `<canvas>` element
- 7-bag random piece generator using a seeded Mulberry32 PRNG (so both players draw identical piece sequences)
- Full SRS (Super Rotation System) wall-kick tables for all pieces
- Ghost piece, hold, scoring (with level multiplier and optional 2× score boost)
- Line-clear base scores: 1 line = 100, 2 = 300, 3 = 500, 4 = 1200 (before level and score boost)
- `activateScoreBoost()` for cheat effect

**`public/js/network.js`** — thin WebSocket wrapper loaded on every page:
- Connects to the server over `ws://` or `wss://` depending on the page protocol
- Provides `Network.on(type, fn)` / `Network.send(obj)` event-bus API
- Restores the player's last-used name from `localStorage`

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

Test coverage includes: HTTP static file serving, path-traversal blocking, WebSocket connection lifecycle, player name setting, lobby create/join/leave/full, game start, cheat-code activation and rejection, game-over stat recording, and settings save/restore.

---

## Game Modes

| Mode | Description |
|---|---|
| **Score Attack** | Classic — highest score when the game ends wins |
| **Time Attack** | 3-minute timer — most points when time runs out wins |

---

## How to Play

**Goal**: Clear lines to score points and outlast your opponent. Every 10 lines raises your level and increases the drop speed.

**Controls**

| Key | Action |
|---|---|
| Left / Right | Move piece |
| Up | Rotate |
| Down | Soft drop |
| Space | Hard drop |
| C | Hold piece |
| P | Pause / resume |

**Win conditions**

- **Score Attack**: Highest score wins when a player tops out.
- **Time Attack**: Highest score wins when the 3-minute timer ends.

---

## Cheat Codes

Cheat codes are optional (toggled in Settings). When enabled, the server sends each player a unique key sequence at game start.

### Usage rules

- **Max 5 activations per player per game**
- Sequences are **randomised per game** (but deterministic from the game seed)
- Activations **1–3** use a **4-digit** code
- Activations **4–5** use a **6-digit** code
- Digits are **0–9** (top-row or numpad)

### Effects

On each successful activation, the player receives both advantages:

1) `score_boost` — doubles scoring for 30 seconds
2) `slow_drop` — slows the player's block auto-drop for 30 seconds

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
| `cheat_activate` | `{ sequence, manual }` | Submit a cheat-code key sequence or manual activation |
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
| `game_start` | `seed`, `gameMode`, `players`, `cheatCode`, `cheatUsesMax`, `cheatUsesRemaining` | Game begins; `seed` drives the shared RNG |
| `opponent_update` | `board`, `score`, `level`, `lines` | Opponent's board state |
| `opponent_game_over` | `score`, `playerName` | Opponent's game ended |
| `cheat_activated` | `effects`, `duration`, `nextCheatCode`, `cheatUsesMax`, `cheatUsesRemaining` | Cheat accepted; grants all effects |
| `cheat_invalid` | `reason`, `cheatUsesMax`, `cheatUsesRemaining` | Cheat rejected |
| `cheat_effect` | `effect`, `duration` | Effect applied to this player (e.g. obfuscate) |
| `game_over_confirmed` | `stats` | Server confirms game-over and returns updated stats |
| `stats` | `stats` | Response to `get_stats` |
| `settings_saved` | `settings` | Settings persisted |
| `settings` | `settings` | Response to `get_settings` |
| `error` | `message` | Error message (e.g. lobby not found) |

---

## Known Limitations

| Area | Status | Notes |
|---|---|---|
| **Sound effects** | ✅ Implemented | BGM, line-clear, lock, game-start, and game-over sounds play via `<Audio>` elements with `.mp3` files served as `audio/mpeg`. Playback is gated by the `soundEnabled` setting and a session flag. Browser autoplay policy may suppress audio until the first user gesture. |
| **Time Attack winner** | ⚠️ Partial | Both clients count down independently. The server awards a win/loss to whoever submits `game_over` last (the other player still playing at that moment). In practice times are nearly identical, but a future improvement would be a server-side adjudication message comparing both scores after both clocks expire. |
| **Play Again (multiplayer)** | ⚠️ Redirect only | After a game ends the lobby is closed. "Play Again" returns to the home page where a fresh lobby must be created. Full in-place lobby restart would require additional server logic. |
| **Mobile / touch controls** | ❌ Not implemented | Gameplay is keyboard-only. Touch/swipe support would need on-screen buttons or gesture detection. |
