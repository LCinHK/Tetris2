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
  const isSolo   = !gameConfig.players || gameConfig.players.length < 2;
  
  function _randomSeed() {
    // Prefer cryptographically-strong randomness when available.
    try {
      if (window.crypto && window.crypto.getRandomValues) {
        const buf = new Uint32Array(1);
        window.crypto.getRandomValues(buf);
        return buf[0] >>> 0;
      }
    } catch (_) {}
    return Math.floor(Math.random() * 0xFFFFFFFF) >>> 0;
  }

  // Multiplayer should be deterministic (server-provided seed for fairness).
  // Solo should feel fresh: generate a new seed each load so the initial piece varies.
  const seed = isSolo
    ? _randomSeed()
    : (gameConfig.seed || _randomSeed());

  const soundEnabled = settings.soundEnabled !== false;

  /* ── Load audio ───────────────────────────────────────────────── */
  const bgm = soundEnabled ? new Audio('/audio/bgm.mp3') : null; 
  if (bgm) { bgm.loop = true; }
  
  const clearSound = soundEnabled ? new Audio('/audio/clear.mp3') : null;
  const lockSound = soundEnabled ? new Audio('/audio/lock.mp3') : null;
  const countdownSound = soundEnabled ? new Audio('/audio/countdown.mp3') : null;
  const gamestartSound = soundEnabled ? new Audio('/audio/gamestart.mp3') : null;
  //const gameoverSound = soundEnabled ? new Audio('/audio/gameover.mp3') : null;

  function playBgm() {
    if (!bgm) return;
    try {
      bgm.currentTime = 0;
      void bgm.play().catch(() => {});
    } catch (_) { /* ignore playback errors */ }
  }

  function stopBgm() {
    if (!bgm) return;
    bgm.pause();
    try { bgm.currentTime = 0; } catch (_) {}
  }

  function pauseBgm() {
    if (!bgm) return;
    bgm.pause();
  }

  function resumeBgm() {
    if (!bgm) return;
    void bgm.play().catch(() => {});
  }

  function playClearSound() {
    if (!clearSound) return;
    try {
      clearSound.currentTime = 0;
      void clearSound.play().catch(() => {});
    } catch (_) { /* ignore playback errors */ }
  }

  function playLockSound() {
    if (!lockSound) return;
    try {
      lockSound.currentTime = 0;
      void lockSound.play().catch(() => {});
    } catch (_) { /* ignore playback errors */ }
  }

  function playCountdownSound() {
    if (!countdownSound) return;
    try {
      countdownSound.currentTime = 0;
      void countdownSound.play().catch(() => {});
    } catch (_) { /* ignore playback errors */ }
  }

  function playGamestartSound() {
    if (!gamestartSound) return;
    try {
      gamestartSound.currentTime = 0;
      void gamestartSound.play().catch(() => {});
    } catch (_) { /* ignore playback errors */ }
  }

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
    clearInterval(timerInterval);
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
    seed,
    nextCanvas,
    holdCanvas,
    onScoreUpdate({ score, lines, level }) {
      _setText('scoreDisplay', score.toLocaleString());
      _setText('levelDisplay', level);
      _setText('linesDisplay', lines);
    },
    onLinesCleared({ count, score }) {
      playClearSound();
      Network.send({ type: 'lines_cleared', count, score });
    },
    onBoardUpdate(board) {
      // Always send after a piece locks (board state finalised)
      playLockSound();
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
  let gameStarted = false;

  document.addEventListener('keydown', (e) => {
    if (game.isGameOver) return;

    // During countdown (before start), ignore all gameplay inputs.
    if (!gameStarted) {
      if (['ArrowLeft', 'ArrowRight', 'ArrowDown', 'ArrowUp', ' ', 'c', 'C', 'p', 'P'].includes(e.key)) {
        e.preventDefault();
      }
      return;
    }

    // While paused, only allow unpausing.
    if (game.isPaused && !(e.key === 'p' || e.key === 'P')) {
      // Prevent browser scrolling on arrow keys/space.
      if (['ArrowLeft', 'ArrowRight', 'ArrowDown', 'ArrowUp', ' '].includes(e.key)) {
        e.preventDefault();
      }
      return;
    }
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
    paused ? pauseBgm() : resumeBgm();
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
  let _booted = false;
  let _bootFallbackTimer = null;
  let _countdownTick = null;

  function startWithCountdown() {
    if (_countdownTick) {
      clearInterval(_countdownTick);
      _countdownTick = null;
    }

    countdownOverlay.classList.remove('hidden');
    let count = 3;
    countdownText.textContent = count;

    playCountdownSound();

    _countdownTick = setInterval(() => {
      count--;
      if (count > 0) {
        countdownText.textContent = count;
      } else if (count === 0) {
        countdownText.textContent = 'GO!';
      } else {
        clearInterval(_countdownTick);
        _countdownTick = null;
        countdownOverlay.classList.add('hidden');
        gameStarted = true;
        game.start(seed);
        if (gameMode === 'time_attack') startTimer();
        playGamestartSound();
        if (gamestartSound) { gamestartSound.addEventListener('ended', playBgm); }
      }
    }, 1000);
  }

  /* ── End game ────────────────────────────────────────────────── */
  function endGame(score, lines, level) {
    if (_gameEnded) return;
    _gameEnded = true;

    clearInterval(timerInterval);
    timerInterval = null;
    stopBgm();
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
    const nav = () => {
      sessionStorage.setItem('playGameOver', 'true');
      window.location.href = '/gameover.html';
    };
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
    if (_booted) return;
    _booted = true;
    if (_bootFallbackTimer) {
      clearTimeout(_bootFallbackTimer);
      _bootFallbackTimer = null;
    }
    startWithCountdown();
  }

  if (Network.ws && Network.ws.readyState === WebSocket.OPEN) {
    boot();
  } else {
    Network.on('open', boot);
    // Fallback: if WS takes too long, still start the game
    _bootFallbackTimer = setTimeout(() => {
      if (!game._raf && !game.isGameOver) boot();
    }, 2000);
  }
})();
