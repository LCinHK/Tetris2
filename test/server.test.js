'use strict';

/**
 * server.test.js – Unit tests for the Tetris 2 server
 *
 * Run with:  npm test
 *
 * Uses Node.js built-in test runner (node:test) – no extra framework needed.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http   = require('http');
const WebSocket = require('ws');

// Import server internals
const { server, lobbies, players, playerStats, getCheatSequence } = require('../server.js');

/* ─────────────────────────────────────────
   Helpers
───────────────────────────────────────── */
let BASE_URL;
let WS_URL;
const TIMEOUT_MS = 4000;

/**
 * Connect and return a ws instance with built-in message buffering.
 * Messages are queued until consumed, preventing race conditions where the
 * server sends a message before the test registers a listener.
 */
function wsConnect() {
  return new Promise((resolve, reject) => {
    const ws     = new WebSocket(WS_URL);
    const queue  = [];   // buffered messages
    const waiters = []; // pending nextMessage / waitForType resolvers

    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch (_) { return; }

      // Deliver to the first waiter whose predicate matches, or buffer
      const idx = waiters.findIndex(w => w.pred(msg));
      if (idx !== -1) {
        const w = waiters.splice(idx, 1)[0];
        clearTimeout(w.timer);
        w.resolve(msg);
      } else {
        queue.push(msg);
      }
    });

    /** Return the next message matching predicate (default: any) */
    ws.nextMsg = (pred = () => true) => new Promise((res, rej) => {
      // Check buffered messages first
      const buffIdx = queue.findIndex(pred);
      if (buffIdx !== -1) {
        res(queue.splice(buffIdx, 1)[0]);
        return;
      }
      const timer = setTimeout(() => {
        const i = waiters.findIndex(w => w.resolve === res);
        if (i !== -1) waiters.splice(i, 1);
        rej(new Error(`Timeout waiting for message (pred=${pred.toString().slice(0,60)})`));
      }, TIMEOUT_MS);
      waiters.push({ pred, resolve: res, timer });
    });

    ws.once('open',  () => resolve(ws));
    ws.once('error', reject);
  });
}

function send(ws, obj) { ws.send(JSON.stringify(obj)); }

/** Wait for the first buffered/arriving message */
function nextMessage(ws) { return ws.nextMsg(); }

/** Wait for a message of a specific type */
function waitForType(ws, type) { return ws.nextMsg(m => m.type === type); }

/* ─────────────────────────────────────────
   Suite
───────────────────────────────────────── */
describe('Tetris2 Server', () => {
  before((_, done) => {
    // Start on a random port so tests don't clash with a running dev server
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      BASE_URL = `http://127.0.0.1:${port}`;
      WS_URL   = `ws://127.0.0.1:${port}`;
      done();
    });
  });

  after((_, done) => server.close(done));

  /* ── HTTP static files ────────────────────────────────────────── */
  describe('HTTP static server', () => {
    it('serves index.html on GET /', (_, done) => {
      http.get(`${BASE_URL}/`, (res) => {
        assert.equal(res.statusCode, 200);
        assert.ok(res.headers['content-type'].includes('text/html'));
        res.resume();
        done();
      });
    });

    it('serves CSS files', (_, done) => {
      http.get(`${BASE_URL}/css/style.css`, (res) => {
        assert.equal(res.statusCode, 200);
        assert.ok(res.headers['content-type'].includes('text/css'));
        res.resume();
        done();
      });
    });

    it('returns 404 for unknown routes', (_, done) => {
      http.get(`${BASE_URL}/nonexistent.html`, (res) => {
        assert.equal(res.statusCode, 404);
        res.resume();
        done();
      });
    });

    it('serves /api/stats as JSON', (_, done) => {
      http.get(`${BASE_URL}/api/stats`, (res) => {
        assert.equal(res.statusCode, 200);
        assert.ok(res.headers['content-type'].includes('application/json'));
        let body = '';
        res.on('data', d => (body += d));
        res.on('end', () => {
          const data = JSON.parse(body);
          assert.ok(Array.isArray(data));
          done();
        });
      });
    });
  });

  /* ── WebSocket – connection ────────────────────────────────────── */
  describe('WebSocket connection', () => {
    it('sends "connected" message on connect', async () => {
      const ws  = await wsConnect();
      const msg = await nextMessage(ws);
      assert.equal(msg.type, 'connected');
      assert.ok(msg.clientId, 'clientId should be present');
      assert.ok(msg.playerName, 'playerName should be present');
      ws.close();
    });

    it('registers the player in players map', async () => {
      const ws  = await wsConnect();
      const msg = await nextMessage(ws);
      assert.ok(players.has(msg.clientId));
      ws.close();
    });

    it('removes player from map on disconnect', async () => {
      const ws  = await wsConnect();
      const msg = await nextMessage(ws);
      const id  = msg.clientId;
      assert.ok(players.has(id));
      ws.close();
      await new Promise(r => setTimeout(r, 100));
      assert.ok(!players.has(id));
    });
  });

  /* ── set_name ─────────────────────────────────────────────────── */
  describe('set_name', () => {
    it('updates player name', async () => {
      const ws  = await wsConnect();
      await nextMessage(ws); // connected
      send(ws, { type: 'set_name', name: 'Alice' });
      const resp = await waitForType(ws, 'name_set');
      assert.equal(resp.name, 'Alice');
      ws.close();
    });

    it('trims whitespace from name', async () => {
      const ws  = await wsConnect();
      await nextMessage(ws);
      send(ws, { type: 'set_name', name: '  Bob  ' });
      const resp = await waitForType(ws, 'name_set');
      assert.equal(resp.name, 'Bob');
      ws.close();
    });
  });

  /* ── Lobby create / join / leave ──────────────────────────────── */
  describe('Lobby management', () => {
    it('creates a lobby and returns a code', async () => {
      const ws  = await wsConnect();
      await nextMessage(ws);
      send(ws, { type: 'create_lobby', gameMode: 'score_attack' });
      const resp = await waitForType(ws, 'lobby_created');
      assert.ok(resp.code, 'should return lobby code');
      assert.equal(resp.gameMode, 'score_attack');
      assert.ok(lobbies.has(resp.code));
      ws.close();
    });

    it('allows a second player to join', async () => {
      const ws1 = await wsConnect();
      await nextMessage(ws1);
      send(ws1, { type: 'create_lobby', gameMode: 'score_attack' });
      const created = await waitForType(ws1, 'lobby_created');

      const ws2 = await wsConnect();
      await nextMessage(ws2);
      send(ws2, { type: 'join_lobby', code: created.code });
      const joined = await waitForType(ws2, 'lobby_joined');
      assert.equal(joined.code, created.code);
      assert.equal(joined.players.length, 2);
      ws1.close(); ws2.close();
    });

    it('rejects join for non-existent lobby', async () => {
      const ws = await wsConnect();
      await nextMessage(ws);
      send(ws, { type: 'join_lobby', code: 'XXXXXX' });
      const resp = await waitForType(ws, 'error');
      assert.ok(resp.message.includes('not found'), `unexpected message: ${resp.message}`);
      ws.close();
    });

    it('rejects joining a full lobby', async () => {
      const ws1 = await wsConnect();
      await nextMessage(ws1);
      send(ws1, { type: 'create_lobby' });
      const created = await waitForType(ws1, 'lobby_created');

      const ws2 = await wsConnect();
      await nextMessage(ws2);
      send(ws2, { type: 'join_lobby', code: created.code });
      await waitForType(ws2, 'lobby_joined');

      const ws3 = await wsConnect();
      await nextMessage(ws3);
      send(ws3, { type: 'join_lobby', code: created.code });
      const resp = await waitForType(ws3, 'error');
      assert.ok(resp.message.toLowerCase().includes('full'));
      ws1.close(); ws2.close(); ws3.close();
    });

    it('removes lobby when last player leaves', async () => {
      const ws = await wsConnect();
      await nextMessage(ws);
      send(ws, { type: 'create_lobby' });
      const { code } = await waitForType(ws, 'lobby_created');
      assert.ok(lobbies.has(code));
      send(ws, { type: 'leave_lobby' });
      await new Promise(r => setTimeout(r, 100));
      assert.ok(!lobbies.has(code), 'lobby should be deleted');
      ws.close();
    });
  });

  /* ── Game start ───────────────────────────────────────────────── */
  describe('Game start', () => {
    it('starts game when solo player is ready', async () => {
      const ws = await wsConnect();
      await nextMessage(ws);
      send(ws, { type: 'create_lobby', gameMode: 'score_attack' });
      await waitForType(ws, 'lobby_created');
      send(ws, { type: 'player_ready' });
      const start = await waitForType(ws, 'game_start');
      assert.ok(typeof start.seed === 'number');
      assert.equal(start.gameMode, 'score_attack');
      assert.ok(Array.isArray(start.cheatCode));
      ws.close();
    });

    it('includes cheat code in game_start', async () => {
      const ws = await wsConnect();
      await nextMessage(ws);
      send(ws, { type: 'create_lobby' });
      await waitForType(ws, 'lobby_created');
      send(ws, { type: 'player_ready' });
      const start = await waitForType(ws, 'game_start');
      assert.ok(start.cheatCode.length > 0);
      ws.close();
    });
  });

  /* ── Cheat codes ──────────────────────────────────────────────── */
  describe('Cheat codes', () => {
    it('getCheatSequence returns escalating sequences', () => {
      const seq0 = getCheatSequence(0);
      const seq1 = getCheatSequence(1);
      assert.ok(seq1.length >= seq0.length, 'later sequences should be longer or equal');
    });

    it('activates cheat with correct sequence', async () => {
      const ws = await wsConnect();
      await nextMessage(ws);
      send(ws, { type: 'create_lobby' });
      await waitForType(ws, 'lobby_created');
      send(ws, { type: 'player_ready' });
      const start = await waitForType(ws, 'game_start');

      send(ws, { type: 'cheat_activate', sequence: start.cheatCode });
      const resp = await waitForType(ws, 'cheat_activated');
      assert.ok(['score_boost', 'opponent_obfuscate'].includes(resp.cheatType));
      assert.ok(resp.nextCheatCode, 'should provide next cheat code');
      ws.close();
    });

    it('rejects cheat with incorrect sequence', async () => {
      const ws = await wsConnect();
      await nextMessage(ws);
      send(ws, { type: 'create_lobby' });
      await waitForType(ws, 'lobby_created');
      send(ws, { type: 'player_ready' });
      await waitForType(ws, 'game_start');

      send(ws, { type: 'cheat_activate', sequence: ['ArrowDown', 'ArrowDown'] });
      const resp = await waitForType(ws, 'cheat_invalid');
      assert.ok(resp, 'should receive cheat_invalid');
      ws.close();
    });
  });

  /* ── Game over / stats ────────────────────────────────────────── */
  describe('Game over and stats', () => {
    it('records stats on game_over', async () => {
      const ws  = await wsConnect();
      const con = await nextMessage(ws);
      const id  = con.clientId;

      send(ws, { type: 'game_over', score: 5000, linesCleared: 20, gameMode: 'score_attack' });
      const confirmed = await waitForType(ws, 'game_over_confirmed');
      assert.ok(confirmed.stats, 'should return stats');
      assert.equal(confirmed.stats.gamesPlayed, 1);
      assert.equal(confirmed.stats.highScore, 5000);
      ws.close();
    });

    it('updates high score if new score is higher', async () => {
      const ws  = await wsConnect();
      const con = await nextMessage(ws);
      send(ws, { type: 'game_over', score: 1000, linesCleared: 5 });
      await waitForType(ws, 'game_over_confirmed');
      send(ws, { type: 'game_over', score: 9999, linesCleared: 50 });
      const confirmed = await waitForType(ws, 'game_over_confirmed');
      assert.equal(confirmed.stats.highScore, 9999);
      ws.close();
    });

    it('does not lower high score', async () => {
      const ws = await wsConnect();
      await nextMessage(ws);
      send(ws, { type: 'game_over', score: 9999, linesCleared: 50 });
      await waitForType(ws, 'game_over_confirmed');
      send(ws, { type: 'game_over', score: 100, linesCleared: 1 });
      const confirmed = await waitForType(ws, 'game_over_confirmed');
      assert.equal(confirmed.stats.highScore, 9999);
      ws.close();
    });

    it('keeps at most 10 scores in history', async () => {
      const ws = await wsConnect();
      await nextMessage(ws);
      for (let i = 0; i < 12; i++) {
        send(ws, { type: 'game_over', score: i * 100, linesCleared: i });
        await waitForType(ws, 'game_over_confirmed');
      }
      send(ws, { type: 'get_stats' });
      const stats = await waitForType(ws, 'stats');
      assert.ok(stats.stats.scores.length <= 10);
      ws.close();
    });
  });

  /* ── Settings ─────────────────────────────────────────────────── */
  describe('Settings', () => {
    it('saves and retrieves settings', async () => {
      const ws = await wsConnect();
      await nextMessage(ws);
      send(ws, { type: 'save_settings', settings: { cheatEnabled: false, soundEnabled: true } });
      const saved = await waitForType(ws, 'settings_saved');
      assert.equal(saved.settings.cheatEnabled, false);
      assert.equal(saved.settings.soundEnabled, true);
      ws.close();
    });

    it('disabling cheats prevents activation', async () => {
      const ws = await wsConnect();
      await nextMessage(ws);
      // Disable cheats first
      send(ws, { type: 'save_settings', settings: { cheatEnabled: false } });
      await waitForType(ws, 'settings_saved');

      send(ws, { type: 'create_lobby' });
      await waitForType(ws, 'lobby_created');
      send(ws, { type: 'player_ready' });
      const start = await waitForType(ws, 'game_start');

      send(ws, { type: 'cheat_activate', sequence: start.cheatCode });
      const resp = await waitForType(ws, 'cheat_invalid');
      assert.ok(resp.reason && resp.reason.toLowerCase().includes('disabled'));
      ws.close();
    });
  });

  /* ── Obstacle mode garbage lines ──────────────────────────────── */
  describe('Obstacle mode garbage lines', () => {
    it('sends garbage lines to opponent when lines cleared in obstacle mode', async () => {
      const ws1 = await wsConnect();
      const ws2 = await wsConnect();
      await nextMessage(ws1);
      await nextMessage(ws2);

      send(ws1, { type: 'create_lobby', gameMode: 'obstacle' });
      const { code } = await waitForType(ws1, 'lobby_created');
      send(ws2, { type: 'join_lobby', code });
      await waitForType(ws2, 'lobby_joined');

      send(ws1, { type: 'player_ready' });
      send(ws2, { type: 'player_ready' });
      await waitForType(ws1, 'game_start');
      await waitForType(ws2, 'game_start');

      // ws1 clears 3 lines → 2 garbage to ws2
      send(ws1, { type: 'lines_cleared', count: 3, score: 500 });
      const garbage = await waitForType(ws2, 'add_garbage');
      assert.equal(garbage.lines, 2);
      ws1.close(); ws2.close();
    });
  });
});
