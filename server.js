'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;

/* ─────────────────────────────────────────
   In-memory state
───────────────────────────────────────── */
const players = new Map();     // clientId → player object (includes ws)
const lobbies = new Map();     // lobbyCode → lobby object
const playerStats = new Map(); // clientId → stats object

let clientIdCounter = 0;

/* ─────────────────────────────────────────
   Cheat code sequences (escalating difficulty)
───────────────────────────────────────── */
const CHEAT_SEQUENCES = [
  ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight'],
  ['ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'ArrowUp'],
  ['ArrowRight', 'ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft', 'ArrowDown'],
  ['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'],
  ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'],
];

function getCheatSequence(activationCount) {
  const idx = Math.min(activationCount, CHEAT_SEQUENCES.length - 1);
  return CHEAT_SEQUENCES[idx];
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
};

const server = http.createServer((req, res) => {
  // API routes
  if (req.url.startsWith('/api/')) {
    return handleAPI(req, res);
  }

  let urlPath = req.url.split('?')[0];
  if (urlPath === '/') urlPath = '/index.html';

  const filePath = path.join(__dirname, 'public', urlPath);
  const ext = path.extname(filePath);
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
    ws,
    lobbyCode: null,
    settings: { cheatEnabled: true, soundEnabled: true },
    cheatActivations: 0,
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
      handleMessage(ws, JSON.parse(raw));
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

  switch (msg.type) {
    case 'set_name':         return handleSetName(clientId, msg);
    case 'create_lobby':     return handleCreateLobby(clientId, msg);
    case 'join_lobby':       return handleJoinLobby(clientId, msg);
    case 'leave_lobby':      return handleLeaveLobby(clientId);
    case 'player_ready':     return handlePlayerReady(clientId);
    case 'game_update':      return handleGameUpdate(clientId, msg);
    case 'lines_cleared':    return handleLinesCleared(clientId, msg);
    case 'cheat_activate':   return handleCheatActivate(clientId, msg);
    case 'game_over':        return handleGameOver(clientId, msg);
    case 'get_stats':        return sendTo(clientId, { type: 'stats', stats: playerStats.get(clientId) });
    case 'save_settings':    return handleSaveSettings(clientId, msg);
    case 'get_settings':     return sendTo(clientId, { type: 'settings', settings: player.settings });
  }
}

/* ─────────────────────────────────────────
   Handlers
───────────────────────────────────────── */
function handleSetName(clientId, msg) {
  const player = players.get(clientId);
  const name = (msg.name || '').trim().slice(0, 20) || player.name;
  player.name = name;
  const stats = playerStats.get(clientId);
  if (stats) stats.name = name;
  sendTo(clientId, { type: 'name_set', name });
}

function handleCreateLobby(clientId, msg) {
  const player = players.get(clientId);
  if (player.lobbyCode) leaveLobby(clientId, player.lobbyCode);

  let code;
  do { code = generateLobbyCode(); } while (lobbies.has(code));

  const gameMode = msg.gameMode || 'score_attack';
  lobbies.set(code, {
    code,
    host: clientId,
    players: [clientId],
    gameMode,
    status: 'waiting',
    readyPlayers: new Set(),
    cheatActivationCount: 0,
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
  const code = (msg.code || '').toUpperCase().trim();
  const lobby = lobbies.get(code);

  if (!lobby) return sendTo(clientId, { type: 'error', message: 'Lobby not found.' });
  if (lobby.status !== 'waiting') return sendTo(clientId, { type: 'error', message: 'Game already in progress.' });
  if (lobby.players.length >= 2) return sendTo(clientId, { type: 'error', message: 'Lobby is full.' });

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

function leaveLobby(clientId, code) {
  const lobby = lobbies.get(code);
  if (!lobby) return;

  lobby.players = lobby.players.filter(id => id !== clientId);
  lobby.readyPlayers.delete(clientId);

  const player = players.get(clientId);
  if (player) player.lobbyCode = null;

  if (lobby.players.length === 0) {
    lobbies.delete(code);
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

  // Reset game-over flags
  lobby.players.forEach(cid => {
    const p = players.get(cid);
    if (p) { p.gameOver = false; p.cheatActivations = 0; }
  });

  const seed = Math.floor(Math.random() * 1000000);
  const cheatCode = getCheatSequence(0);

  broadcastToLobby(code, {
    type: 'game_start',
    seed,
    gameMode: lobby.gameMode,
    players: getLobbyPlayerList(code),
    cheatCode,
  });
}

function handleGameUpdate(clientId, msg) {
  const player = players.get(clientId);
  if (!player || !player.lobbyCode) return;

  broadcastToLobby(player.lobbyCode, {
    type: 'opponent_update',
    board: msg.board,
    score: msg.score,
    level: msg.level,
    lines: msg.lines,
    playerName: player.name,
  }, clientId);
}

function handleLinesCleared(clientId, msg) {
  const player = players.get(clientId);
  if (!player || !player.lobbyCode) return;

  const lobby = lobbies.get(player.lobbyCode);
  if (!lobby) return;

  // Obstacle mode: send garbage lines to opponent
  if (lobby.gameMode === 'obstacle') {
    const garbage = Math.max(0, (msg.count || 0) - 1);
    if (garbage > 0) {
      broadcastToLobby(player.lobbyCode, { type: 'add_garbage', lines: garbage }, clientId);
    }
  }
}

function handleCheatActivate(clientId, msg) {
  const player = players.get(clientId);
  if (!player || !player.lobbyCode) return;

  if (!player.settings.cheatEnabled) {
    return sendTo(clientId, { type: 'cheat_invalid', reason: 'Cheats are disabled in settings.' });
  }

  const lobby = lobbies.get(player.lobbyCode);
  if (!lobby) return;

  const expected = getCheatSequence(lobby.cheatActivationCount);
  if (JSON.stringify(msg.sequence) !== JSON.stringify(expected)) {
    return sendTo(clientId, { type: 'cheat_invalid', reason: 'Incorrect sequence.' });
  }

  // Alternate between effects
  const cheatType = lobby.cheatActivationCount % 2 === 0 ? 'score_boost' : 'opponent_obfuscate';
  lobby.cheatActivationCount++;
  const nextCode = getCheatSequence(lobby.cheatActivationCount);

  sendTo(clientId, {
    type: 'cheat_activated',
    cheatType,
    duration: 30000,
    nextCheatCode: nextCode,
  });

  if (cheatType === 'opponent_obfuscate') {
    broadcastToLobby(player.lobbyCode, {
      type: 'cheat_effect',
      effect: 'obfuscate',
      duration: 10000,
    }, clientId);
  }
}

function handleGameOver(clientId, msg) {
  const player = players.get(clientId);
  if (!player) return;

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
  player.settings = Object.assign(player.settings, msg.settings || {});
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
