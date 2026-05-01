/**
 * game.js – Game page logic
 * Depends on: network.js, tetris.js, cheat.js
 */
(function () {
  'use strict';

  /* ── Read game config from localStorage ─────────────────────── */
  let gameConfig = {};
  try { gameConfig = JSON.parse(localStorage.getItem('currentGame') || '{}'); } catch (_) {}

  let settings = {};
  try { settings = JSON.parse(localStorage.getItem('settings') || '{}'); } catch (_) {}

  const gameMode = gameConfig.gameMode || 'score_attack';
  const seed     = gameConfig.seed     || Math.floor(Math.random() * 1e6);
  const isSolo   = !gameConfig.players || gameConfig.players.length < 2;

  /* ── DOM refs ─────────────────────────────────────────────────── */
  const gameCanvas     = document.getElementById('gameCanvas');
  const opponentCanvas = document.getElementById('opponentCanvas');
  const opponentArea   = document.getElementById('opponentArea');
  const opponentLabel  = document.getElementById('opponentLabel');
  const opponentScore  = document.getElementById('opponentScore');
  const nextCanvas     = document.getElementById('nextCanvas');
  const holdCanvas     = document.getElementById('holdCanvas');
  const modeBadge      = document.getElementById('modeBadge');
  const timerDisplay   = document.getElementById('timerDisplay');
  const homeBtn        = document.getElementById('homeBtn');
  const pauseOverlay   = document.getElementById('pauseOverlay');
  const countdownOverlay = document.getElementById('countdownOverlay');
  const countdownText  = document.getElementById('countdownText');
  const myBoardLabel   = document.getElementById('myBoardLabel');

  /* ── Mode badge ──────────────────────────────────────────────── */
  const modeLabels = { score_attack: 'Score Attack', time_attack: 'Time Attack', obstacle: 'Obstacle' };
  if (modeBadge) modeBadge.textContent = modeLabels[gameMode] || gameMode;

  /* ── Show opponent area if multiplayer ───────────────────────── */
  if (!isSolo && opponentArea) {
    opponentArea.classList.remove('hidden');
    opponentArea.style.display = 'flex';
    if (gameConfig.players) {
      const myId = Network.clientId || '';
      const opp  = gameConfig.players.find(p => p.id !== myId);
      if (opp && opponentLabel) opponentLabel.textContent = opp.name || 'OPPONENT';
    }
  }
  if (myBoardLabel && Network.playerName) {
    myBoardLabel.textContent = Network.playerName.toUpperCase();
  }

  /* ── Timer (Time Attack) ─────────────────────────────────────── */
  const TIME_ATTACK_DURATION = 3 * 60 * 1000; // 3 minutes
  let timerEnd = 0;
  let timerInterval = null;
  let timerRemaining = 0; // ms remaining when paused

  function _runTimerInterval() {
    timerInterval = setInterval(() => {
      const left = Math.max(0, timerEnd - Date.now());
      const m = Math.floor(left / 60000);
      const s = Math.floor((left % 60000) / 1000);
      timerDisplay.textContent = `${m}:${s.toString().padStart(2, '0')}`;
      if (left <= 0) {
        clearInterval(timerInterval);
        timerInterval = null;
        endGame();
      }
    }, 250);
  }

  function startTimer() {
    timerEnd = Date.now() + TIME_ATTACK_DURATION;
    timerDisplay.classList.remove('hidden');
    _runTimerInterval();
  }

  /* ── Create game instance ────────────────────────────────────── */
  let _lastPieceMoveSend = 0;
  let _opponentGameOver  = false;
  let _gameEnded         = false;

  const game = new TetrisGame(gameCanvas, {
    cellSize: 30,
    nextCanvas,
    holdCanvas,
    onScoreUpdate({ score, lines, level }) {
      _setText('scoreDisplay', score.toLocaleString());
      _setText('levelDisplay', level);
      _setText('linesDisplay', lines);
    },
    onLinesCleared({ count, score }) {
      Network.send({ type: 'lines_cleared', count, score });
    },
    onBoardUpdate(board) {
      // Always send after a piece locks (board state finalised)
      Network.send({
        type: 'game_update',
        board,
        score: game.score,
        level: game.level,
        lines: game.lines,
      });
    },
    onPieceMoved(board) {
      // Throttle to ~20 fps to avoid flooding the network
      const now = Date.now();
      if (now - _lastPieceMoveSend < 50) return;
      _lastPieceMoveSend = now;
      Network.send({
        type: 'game_update',
        board,
        score: game.score,
        level: game.level,
        lines: game.lines,
      });
    },
    onGameOver({ score, lines, level }) {
      endGame(score, lines, level);
    },
  });

  /* ── Cheat manager ───────────────────────────────────────────── */
  const cheat = new CheatManager({
    enabled: settings.cheatEnabled !== false,
    onActivate(seq) {
      Network.send({ type: 'cheat_activate', sequence: seq });
    },
    onProgress(done, total) { /* handled by CheatManager internally */ },
    onDeactivate() {
      game.scoreBoost = false;
      gameCanvas.classList.remove('obfuscated');
    },
  });

  if (gameConfig.cheatCode) cheat.setSequence(gameConfig.cheatCode);
  cheat.attach();

  /* ── Keyboard controls ───────────────────────────────────────── */
  let hardDropLocked = false;

  document.addEventListener('keydown', (e) => {
    if (game.isGameOver) return;
    switch (e.key) {
      case 'ArrowLeft':  e.preventDefault(); game.moveLeft();  break;
      case 'ArrowRight': e.preventDefault(); game.moveRight(); break;
      case 'ArrowDown':  e.preventDefault(); game.softDrop();  break;
      case 'ArrowUp':    e.preventDefault(); game.rotate();    break;
      case ' ':
        e.preventDefault();
        if (!hardDropLocked) { hardDropLocked = true; game.hardDrop(); }
        break;
      case 'c': case 'C': game.hold(); break;
      case 'p': case 'P': togglePause(); break;
    }
  });

  document.addEventListener('keyup', (e) => {
    if (e.key === ' ') hardDropLocked = false;
  });

  function togglePause() {
    if (game.isGameOver) return;
    const paused = game.togglePause();
    if (pauseOverlay) {
      paused ? pauseOverlay.classList.remove('hidden') : pauseOverlay.classList.add('hidden');
    }
    // Pause / resume the Time Attack countdown so time doesn't drain while paused
    if (gameMode === 'time_attack') {
      if (paused) {
        clearInterval(timerInterval);
        timerInterval = null;
        timerRemaining = Math.max(0, timerEnd - Date.now());
      } else if (timerRemaining > 0) {
        timerEnd = Date.now() + timerRemaining;
        _runTimerInterval();
      }
    }
  }

  /* ── Countdown then start ────────────────────────────────────── */
  function startWithCountdown() {
    countdownOverlay.classList.remove('hidden');
    let count = 3;
    countdownText.textContent = count;

    const tick = setInterval(() => {
      count--;
      if (count > 0) {
        countdownText.textContent = count;
      } else if (count === 0) {
        countdownText.textContent = 'GO!';
      } else {
        clearInterval(tick);
        countdownOverlay.classList.add('hidden');
        game.start(seed);
        if (gameMode === 'time_attack') startTimer();
      }
    }, 900);
  }

  /* ── End game ────────────────────────────────────────────────── */
  function endGame(score, lines, level) {
    if (_gameEnded) return;
    _gameEnded = true;

    clearInterval(timerInterval);
    timerInterval = null;
    cheat.detach();

    const finalScore = score  !== undefined ? score  : game.score;
    const finalLines = lines  !== undefined ? lines  : game.lines;
    const finalLevel = level  !== undefined ? level  : game.level;

    // Determine match outcome for the game-over page
    let result;
    if (isSolo) {
      result = gameMode === 'time_attack' ? 'time_up' : 'solo';
    } else if (_opponentGameOver) {
      result = 'win';
    } else if (gameMode === 'time_attack') {
      result = 'time_up';
    } else {
      result = 'loss';
    }

    Network.send({
      type: 'game_over',
      score: finalScore,
      linesCleared: finalLines,
      level: finalLevel,
      gameMode,
    });

    localStorage.setItem('lastGame', JSON.stringify({
      score: finalScore,
      linesCleared: finalLines,
      level: finalLevel,
      gameMode,
      result,
    }));

    // Wait for server to confirm with full stats, then navigate
    const nav = () => { window.location.href = '/gameover.html'; };
    Network.on('game_over_confirmed', (msg) => {
      if (msg.stats) localStorage.setItem('stats', JSON.stringify(msg.stats));
      nav();
    });
    // Fallback timeout in case of network issue
    setTimeout(nav, 3000);
  }

  /* ── Network events ──────────────────────────────────────────── */
  Network.on('opponent_update', (msg) => {
    if (opponentArea && !opponentArea.classList.contains('hidden')) {
      if (msg.board) drawOpponentBoard(opponentCanvas, msg.board);
      if (opponentScore) opponentScore.textContent = (msg.score || 0).toLocaleString();
      _setText('opponentLevel', msg.level || 1);
      _setText('opponentLines', msg.lines || 0);
    }
  });

  Network.on('opponent_game_over', (msg) => {
    _opponentGameOver = true;
    const overlay = document.getElementById('opponentOverlay');
    if (overlay) overlay.classList.remove('hidden');
    notify(`Opponent finished with ${(msg.score || 0).toLocaleString()} pts! You win!`, 'success');
  });

  Network.on('add_garbage', (msg) => {
    if (msg.lines > 0) {
      game.addGarbageLines(msg.lines);
      notify(`+${msg.lines} garbage line${msg.lines > 1 ? 's' : ''}!`, 'error');
    }
  });

  Network.on('cheat_activated', (msg) => {
    cheat.markActive(msg.duration || 30000);
    if (msg.cheatType === 'score_boost') {
      game.activateScoreBoost(msg.duration || 30000);
      notify('🚀 Score Boost activated! (2× for 30s)', 'success');
    } else if (msg.cheatType === 'opponent_obfuscate') {
      notify('👁 Opponent obfuscated for 10s!', 'success');
    }
    if (msg.nextCheatCode) cheat.setSequence(msg.nextCheatCode);
  });

  Network.on('cheat_effect', (msg) => {
    if (msg.effect === 'obfuscate') {
      gameCanvas.classList.add('obfuscated');
      notify('⚠ Screen obfuscated by opponent!', 'error');
      setTimeout(() => gameCanvas.classList.remove('obfuscated'), msg.duration || 10000);
    }
  });

  Network.on('cheat_invalid', (msg) => {
    notify(msg.reason || 'Invalid cheat sequence.', 'error');
  });

  Network.on('game_start', (msg) => {
    // In case we receive this while on game page (reconnect scenario)
    if (msg.cheatCode) cheat.setSequence(msg.cheatCode);
  });

  /* ── Home button ─────────────────────────────────────────────── */
  homeBtn.addEventListener('click', () => {
    Network.send({ type: 'leave_lobby' });
    window.location.href = '/';
  });

  /* ── Notification ────────────────────────────────────────────── */
  function notify(msg, type = '') {
    const el = document.getElementById('notification');
    if (!el) return;
    el.textContent = msg;
    el.className   = type;
    el.classList.remove('hidden');
    clearTimeout(el._timer);
    el._timer = setTimeout(() => el.classList.add('hidden'), 3500);
  }

  function _setText(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  }

  /* ── Boot ─────────────────────────────────────────────────────── */
  // If network already open, start immediately; otherwise wait
  function boot() {
    startWithCountdown();
  }

  if (Network.ws && Network.ws.readyState === WebSocket.OPEN) {
    boot();
  } else {
    Network.on('open', boot);
    // Fallback: if WS takes too long, still start the game
    setTimeout(() => {
      if (!game._raf && !game.isGameOver) boot();
    }, 2000);
  }
})();
