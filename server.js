'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const crypto = require('crypto');

const PORT = process.env.PORT || 8000;

/* ─────────────────────────────────────────
   In-memory state
───────────────────────────────────────── */
const players = new Map();     // clientId → player object (includes ws)
const lobbies = new Map();     // lobbyCode → lobby object
const playerStats = new Map(); // clientId → stats object

let clientIdCounter = 0;

/* ─────────────────────────────────────────
   Cheat codes

   Requirements:
   - Randomised sequences (deterministic per game to keep tests stable)
   - Pattern: each key is pressed twice (pairs)
   - Escalating difficulty after each activation
   - Limited to 5 activations per player per game
    - Each activation grants all advantages:
      1) score boost (2× scoring for 30s)
      2) slow drop speed for player for 30s
───────────────────────────────────────── */

const MAX_CHEAT_USES_PER_GAME = 5;

const CHEAT_KEYS_ARROWS = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
const CHEAT_KEYS_DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];
const VALID_GAME_MODES = new Set(['score_attack', 'time_attack']);

function fnv1a32(input) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function mulberry32(seed) {
  let s = seed >>> 0;
  return function () {
    s += 0x6d2b79f5;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function _cheatKeyPool(activationCount) {
  // Gradually add digit keys as sequences get harder.
  if (activationCount >= 2) return [...CHEAT_KEYS_ARROWS, ...CHEAT_KEYS_DIGITS];
  return [...CHEAT_KEYS_ARROWS];
}

function getCheatSequence(activationCount, gameSeed = 0, clientId = '') {
  const safeCount = Math.max(0, Math.floor(Number(activationCount) || 0));
  const pairs = 3 + Math.min(safeCount, MAX_CHEAT_USES_PER_GAME + 1); // 3..9 pairs (beyond limit, still defined)
  const pool = _cheatKeyPool(safeCount);

  const seed = fnv1a32(`${gameSeed}:${clientId}:${safeCount}`);
  const rng = mulberry32(seed);
  const seq = [];

  let last = null;
  for (let i = 0; i < pairs; i++) {
    let key;
    do {
      key = pool[Math.floor(rng() * pool.length)];
    } while (pool.length > 1 && key === last);
    last = key;
    seq.push(key, key);
  }

  return seq;
}

function _pickAllEffects() {
  const effects = [
    { type: 'score_boost', duration: 30000 },
    { type: 'slow_drop', duration: 30000, multiplier: 1.7 },
  ];

  return effects;
}

function normalizeGameMode(mode) {
  return VALID_GAME_MODES.has(mode) ? mode : 'score_attack';
}

/* ─────────────────────────────────────────
   Helpers
───────────────────────────────────────── */
function generateLobbyCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

function sendTo(clientId, msg) {
  const p = players.get(clientId);
  if (p && p.ws.readyState === 1) {
    p.ws.send(JSON.stringify(msg));
  }
}

function broadcastToLobby(code, msg, excludeId = null) {
  const lobby = lobbies.get(code);
  if (!lobby) return;
  lobby.players.forEach(cid => {
    if (cid !== excludeId) sendTo(cid, msg);
  });
}

function getLobbyPlayerList(code) {
  const lobby = lobbies.get(code);
  if (!lobby) return [];
  return lobby.players.map(cid => {
    const p = players.get(cid);
    return {
      id: cid,
      name: p ? p.name : 'Unknown',
      isHost: lobby.host === cid,
      isReady: lobby.readyPlayers.has(cid),
    };
  });
}

function normalizePlayerName(name) {
  return String(name || '').trim().toLowerCase();
}

function isNameTakenInLobby(lobby, name, excludeId = null) {
  if (!lobby) return false;
  const target = normalizePlayerName(name);
  if (!target) return false;
  return lobby.players.some(cid => {
    if (cid === excludeId) return false;
    const p = players.get(cid);
    return p && normalizePlayerName(p.name) === target;
  });
}

/* ─────────────────────────────────────────
   Static file server
───────────────────────────────────────── */
const MIME = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
};

const server = http.createServer((req, res) => {
  // API routes
  if (req.url.startsWith('/api/')) {
    return handleAPI(req, res);
  }

  let urlPath = req.url.split('?')[0];
  if (urlPath === '/') urlPath = '/index.html';

  const publicDir = path.join(__dirname, 'public');
  const filePath  = path.join(publicDir, urlPath);

  // Prevent path traversal: resolved path must stay inside public/
  if (!filePath.startsWith(publicDir + path.sep) && filePath !== publicDir) {
    res.writeHead(403, { 'Content-Type': 'text/html' });
    res.end('<h1>403 – Forbidden</h1>');
    return;
  }

  const ext  = path.extname(filePath);
  const mime = MIME[ext] || 'text/plain';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/html' });
      res.end('<h1>404 – Not Found</h1>');
      return;
    }
    res.writeHead(200, { 'Content-Type': mime });
    res.end(data);
  });
});

/* ─────────────────────────────────────────
   REST API
───────────────────────────────────────── */
function handleAPI(req, res) {
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'GET' && req.url === '/api/stats') {
    const stats = [];
    playerStats.forEach((s, id) => stats.push({ id, ...s }));
    res.writeHead(200);
    res.end(JSON.stringify(stats));
    return;
  }

  res.writeHead(404);
  res.end(JSON.stringify({ error: 'Not found' }));
}

/* ─────────────────────────────────────────
   WebSocket server
───────────────────────────────────────── */
const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  const clientId = `player_${++clientIdCounter}`;
  ws.clientId = clientId;

  players.set(clientId, {
    id: clientId,
    name: `Player${clientIdCounter}`,
    hasCustomName: false,
    ws,
    lobbyCode: null,
    settings: { cheatEnabled: true, soundEnabled: true },
    cheatActivations: 0,
    cheatCode: null,
    gameOver: false,
  });

  playerStats.set(clientId, {
    name: `Player${clientIdCounter}`,
    gamesPlayed: 0,
    highScore: 0,
    totalLinesCleared: 0,
    wins: 0,
    losses: 0,
    scores: [],
  });

  ws.send(JSON.stringify({
    type: 'connected',
    clientId,
    playerName: `Player${clientIdCounter}`,
  }));

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw);
      if (msg && msg.type === 'game_update') {
        const p = players.get(clientId);
        console.log('[net] recv game_update', {
          clientId,
          lobbyCode: p ? p.lobbyCode : null,
          boardRows: Array.isArray(msg.board) ? msg.board.length : 0,
          ts: Date.now(),
        });
      }
      handleMessage(ws, msg);
    } catch (e) {
      // ignore malformed messages
    }
  });

  ws.on('close', () => {
    const player = players.get(clientId);
    if (player && player.lobbyCode) {
      leaveLobby(clientId, player.lobbyCode);
    }
    players.delete(clientId);
  });
});

/* ─────────────────────────────────────────
   Message router
───────────────────────────────────────── */
function handleMessage(ws, msg) {
  const clientId = ws.clientId;
  const player = players.get(clientId);
  if (!player) return;

  if (msg.type === 'game_update' && !player.lobbyCode && !msg.lobbyCode) {
    console.log('[net] drop game_update (no lobby)', { clientId, ts: Date.now() });
  }

  switch (msg.type) {
    case 'set_name':         return handleSetName(clientId, msg);
    case 'create_lobby':     return handleCreateLobby(clientId, msg);
    case 'join_lobby':       return handleJoinLobby(clientId, msg);
    case 'leave_lobby':      return handleLeaveLobby(clientId);
    case 'player_ready':     return handlePlayerReady(clientId);
    case 'game_update':      return handleGameUpdate(clientId, msg);
    case 'cheat_activate':   return handleCheatActivate(clientId, msg);
    case 'game_over':        return handleGameOver(clientId, msg);
    case 'get_stats':        return sendTo(clientId, { type: 'stats', stats: playerStats.get(clientId) });
    case 'save_settings':    return handleSaveSettings(clientId, msg);
    case 'get_settings':     return sendTo(clientId, { type: 'settings', settings: player.settings });
  }
}

function tryAttachLobbyFromMessage(player, clientId, msg) {
  if (!player || player.lobbyCode || !msg || !msg.lobbyCode) return;
  const code = String(msg.lobbyCode || '').toUpperCase().trim();
  const lobby = lobbies.get(code);
  if (lobby) pruneLobbyPlayers(lobby);
  if (lobby && lobby.status === 'playing') {
    player.lobbyCode = code;
    if (!lobby.players.includes(clientId)) lobby.players.push(clientId);
  }
}

/* ─────────────────────────────────────────
   Handlers
───────────────────────────────────────── */
function handleSetName(clientId, msg) {
  const player = players.get(clientId);
  const name = (msg.name || '').trim().slice(0, 20);

  if (!name) {
    sendTo(clientId, { type: 'error', message: 'Please set your name first.' });
    return;
  }

  if (player && player.lobbyCode) {
    const lobby = lobbies.get(player.lobbyCode);
    if (isNameTakenInLobby(lobby, name, clientId)) {
      sendTo(clientId, { type: 'error', message: 'Name already taken in this lobby.' });
      return;
    }
  }

  player.name = name;
  player.hasCustomName = true;
  const stats = playerStats.get(clientId);
  if (stats) stats.name = name;
  sendTo(clientId, { type: 'name_set', name });

  if (player && player.lobbyCode) {
    const lobby = lobbies.get(player.lobbyCode);
    if (lobby) {
      broadcastToLobby(player.lobbyCode, {
        type: 'lobby_updated',
        code: player.lobbyCode,
        gameMode: lobby.gameMode,
        players: getLobbyPlayerList(player.lobbyCode),
      });
    }
  }
}

function handleCreateLobby(clientId, msg) {
  const player = players.get(clientId);
  if (!player.hasCustomName) {
    sendTo(clientId, { type: 'error', message: 'Please set your name first.' });
    return;
  }
  if (player.lobbyCode) leaveLobby(clientId, player.lobbyCode);

  let code;
  do { code = generateLobbyCode(); } while (lobbies.has(code));

  const gameMode = normalizeGameMode(msg.gameMode);
  lobbies.set(code, {
    code,
    host: clientId,
    players: [clientId],
    gameMode,
    status: 'waiting',
    readyPlayers: new Set(),
    seed: 0,
  });

  player.lobbyCode = code;
  sendTo(clientId, {
    type: 'lobby_created',
    code,
    gameMode,
    players: getLobbyPlayerList(code),
  });
}

function handleJoinLobby(clientId, msg) {
  const player = players.get(clientId);
  if (!player.hasCustomName) return sendTo(clientId, { type: 'error', message: 'Please set your name first.' });
  const code = (msg.code || '').toUpperCase().trim();
  const lobby = lobbies.get(code);

  if (!lobby) return sendTo(clientId, { type: 'error', message: 'Lobby not found.' });
  if (lobby.status !== 'waiting') return sendTo(clientId, { type: 'error', message: 'Game already in progress.' });
  if (lobby.players.length >= 2) return sendTo(clientId, { type: 'error', message: 'Lobby is full.' });
  if (isNameTakenInLobby(lobby, player.name, clientId)) {
    return sendTo(clientId, { type: 'error', message: 'Name already taken in this lobby.' });
  }

  if (player.lobbyCode) leaveLobby(clientId, player.lobbyCode);

  lobby.players.push(clientId);
  player.lobbyCode = code;

  const playerList = getLobbyPlayerList(code);
  broadcastToLobby(code, { type: 'lobby_updated', code, gameMode: lobby.gameMode, players: playerList }, clientId);
  sendTo(clientId, { type: 'lobby_joined', code, gameMode: lobby.gameMode, players: playerList });
}

function handleLeaveLobby(clientId) {
  const player = players.get(clientId);
  if (player && player.lobbyCode) leaveLobby(clientId, player.lobbyCode);
}

function pruneLobbyPlayers(lobby) {
  if (!lobby) return;
  lobby.players = lobby.players.filter(id => players.has(id));
  if (lobby.readyPlayers) {
    lobby.readyPlayers = new Set([...lobby.readyPlayers].filter(id => players.has(id)));
  }
}

function leaveLobby(clientId, code) {
  const lobby = lobbies.get(code);
  if (!lobby) return;

  lobby.players = lobby.players.filter(id => id !== clientId);
  lobby.readyPlayers.delete(clientId);

  const player = players.get(clientId);
  if (player) player.lobbyCode = null;

  pruneLobbyPlayers(lobby);

  if (lobby.players.length === 0) {
    if (lobby.status !== 'playing') {
      lobbies.delete(code);
    }
  } else {
    if (lobby.host === clientId) lobby.host = lobby.players[0];
    broadcastToLobby(code, {
      type: 'lobby_updated',
      code,
      gameMode: lobby.gameMode,
      players: getLobbyPlayerList(code),
    });
  }
}

function handlePlayerReady(clientId) {
  const player = players.get(clientId);
  if (!player || !player.lobbyCode) return;

  const lobby = lobbies.get(player.lobbyCode);
  if (!lobby || lobby.status !== 'waiting') return;

  lobby.readyPlayers.add(clientId);
  broadcastToLobby(player.lobbyCode, {
    type: 'player_ready',
    playerId: clientId,
    players: getLobbyPlayerList(player.lobbyCode),
  });

  // Start when all players ready (min 1)
  if (lobby.readyPlayers.size >= lobby.players.length && lobby.players.length >= 1) {
    startGame(player.lobbyCode);
  }
}

function startGame(code) {
  const lobby = lobbies.get(code);
  if (!lobby) return;

  lobby.status = 'playing';
  lobby.startTime = Date.now();
  lobby.startPlayersCount = lobby.players.length;

  // Reset game state
  lobby.players.forEach(cid => {
    const p = players.get(cid);
    if (p) {
      p.gameOver = false;
      p.cheatActivations = 0;
      p.cheatCode = null;
    }
  });

  const seed = crypto.randomInt(0, 1000000);
  lobby.seed = seed;

  // Each player gets their own cheat sequence (deterministic from seed + clientId).
  lobby.players.forEach(cid => {
    const p = players.get(cid);
    if (p) p.cheatCode = getCheatSequence(0, seed, cid);
    sendTo(cid, {
      type: 'game_start',
      seed,
      gameMode: lobby.gameMode,
      players: getLobbyPlayerList(code),
      cheatCode: p ? p.cheatCode : getCheatSequence(0, seed, cid),
      cheatUsesMax: MAX_CHEAT_USES_PER_GAME,
      cheatUsesRemaining: MAX_CHEAT_USES_PER_GAME - (p ? p.cheatActivations : 0),
    });
  });
}

function handleGameUpdate(clientId, msg) {
  const player = players.get(clientId);
  if (!player) return;
  if (!player.lobbyCode) {
    tryAttachLobbyFromMessage(player, clientId, msg);
  }
  if (!player.lobbyCode) return;

  console.log('[net] relay game_update', {
    clientId,
    lobbyCode: player.lobbyCode,
    score: msg.score,
    level: msg.level,
    lines: msg.lines,
    boardRows: Array.isArray(msg.board) ? msg.board.length : 0,
    ts: Date.now(),
  });

  broadcastToLobby(player.lobbyCode, {
    type: 'opponent_update',
    board: msg.board,
    score: msg.score,
    level: msg.level,
    lines: msg.lines,
    playerName: player.name,
  }, clientId);
}


function handleCheatActivate(clientId, msg) {
  const player = players.get(clientId);
  if (!player) return;

  if (!player.lobbyCode && msg.lobbyCode) {
    const code = String(msg.lobbyCode || '').toUpperCase().trim();
    const lobby = lobbies.get(code);
    if (lobby) pruneLobbyPlayers(lobby);
    if (lobby && lobby.status === 'playing') {
      player.lobbyCode = code;
      if (!lobby.players.includes(clientId)) lobby.players.push(clientId);
    }
  }

  if (!player.lobbyCode) {
    return;
  }

  if (!player.settings.cheatEnabled) {
    return sendTo(clientId, {
      type: 'cheat_invalid',
      reason: 'Cheats are disabled in settings.',
      cheatUsesMax: MAX_CHEAT_USES_PER_GAME,
      cheatUsesRemaining: Math.max(0, MAX_CHEAT_USES_PER_GAME - player.cheatActivations),
    });
  }

  const lobby = lobbies.get(player.lobbyCode);
  if (!lobby) return;

  if (player.cheatActivations >= MAX_CHEAT_USES_PER_GAME) {
    return sendTo(clientId, {
      type: 'cheat_invalid',
      reason: `Cheat limit reached (${MAX_CHEAT_USES_PER_GAME} per game).`,
      cheatUsesMax: MAX_CHEAT_USES_PER_GAME,
      cheatUsesRemaining: 0,
    });
  }

  const expected = player.cheatCode || getCheatSequence(player.cheatActivations, lobby.seed, clientId);
  const isManual = !!msg.manual;
  if (!isManual && JSON.stringify(msg.sequence) !== JSON.stringify(expected)) {
    return sendTo(clientId, {
      type: 'cheat_invalid',
      reason: 'Incorrect sequence.',
      cheatUsesMax: MAX_CHEAT_USES_PER_GAME,
      cheatUsesRemaining: Math.max(0, MAX_CHEAT_USES_PER_GAME - player.cheatActivations),
    });
  }

  const activationIndex = player.cheatActivations;
  const effects = _pickAllEffects();

  player.cheatActivations++;
  const nextCode = getCheatSequence(player.cheatActivations, lobby.seed, clientId);
  player.cheatCode = nextCode;

  const duration = effects.reduce((max, e) => Math.max(max, Number(e.duration) || 0), 0);
  const remaining = Math.max(0, MAX_CHEAT_USES_PER_GAME - player.cheatActivations);

  sendTo(clientId, {
    type: 'cheat_activated',
    effects,
    duration,
    nextCheatCode: nextCode,
    cheatUsesMax: MAX_CHEAT_USES_PER_GAME,
    cheatUsesRemaining: remaining,
  });
}

function handleGameOver(clientId, msg) {
  const player = players.get(clientId);
  if (!player) return;
  if (!player.lobbyCode) {
    tryAttachLobbyFromMessage(player, clientId, msg);
  }

  player.gameOver = true;

  const stats = playerStats.get(clientId);
  if (stats) {
    stats.gamesPlayed++;
    stats.totalLinesCleared += msg.linesCleared || 0;
    stats.scores.push({
      score: msg.score || 0,
      linesCleared: msg.linesCleared || 0,
      gameMode: msg.gameMode || 'score_attack',
      date: new Date().toISOString(),
    });
    if ((msg.score || 0) > stats.highScore) stats.highScore = msg.score || 0;
    if (stats.scores.length > 10) stats.scores = stats.scores.slice(-10);
  }

  // Notify opponent (they win)
  if (player.lobbyCode) {
    const lobby = lobbies.get(player.lobbyCode);
    if (lobby) {
      lobby.players.forEach(cid => {
        if (cid !== clientId) {
          const opp = players.get(cid);
          const oppStats = playerStats.get(cid);
          if (opp && !opp.gameOver) {
            if (oppStats) oppStats.wins++;
            if (stats) stats.losses++;
          }
          sendTo(cid, { type: 'opponent_game_over', score: msg.score || 0, playerName: player.name });
        }
      });

      // Check if all players done
      const allDone = lobby.players.every(cid => {
        const p = players.get(cid);
        return !p || p.gameOver;
      });
      if (allDone) lobby.status = 'finished';
    }
  }

  // Send confirmed stats back to player
  sendTo(clientId, {
    type: 'game_over_confirmed',
    stats: playerStats.get(clientId),
  });
}

function handleSaveSettings(clientId, msg) {
  const player = players.get(clientId);
  if (!player) return;
  const incoming = Object.assign({}, msg.settings || {});
  if (Object.prototype.hasOwnProperty.call(incoming, 'gameMode')) {
    incoming.gameMode = normalizeGameMode(incoming.gameMode);
  }
  player.settings = Object.assign(player.settings, incoming);
  sendTo(clientId, { type: 'settings_saved', settings: player.settings });
}

/* ─────────────────────────────────────────
   Start (only when run directly)
───────────────────────────────────────── */
if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`Tetris2 server running on http://localhost:${PORT}`);
  });
}

module.exports = { server, wss, lobbies, players, playerStats, getCheatSequence };
