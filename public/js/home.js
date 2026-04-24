/**
 * home.js – Home page logic
 * Depends on: network.js (loaded before this)
 */
(function () {
  'use strict';

  /* ── DOM refs ─────────────────────────────────────────────────── */
  const playerNameInput = document.getElementById('playerName');
  const setNameBtn      = document.getElementById('setNameBtn');
  const gameModeSelect  = document.getElementById('gameModeSelect');
  const createGameBtn   = document.getElementById('createGameBtn');
  const lobbyCodeInput  = document.getElementById('lobbyCodeInput');
  const joinGameBtn     = document.getElementById('joinGameBtn');
  const lobbyPanel      = document.getElementById('lobbyPanel');
  const lobbyCodeDisplay= document.getElementById('lobbyCodeDisplay');
  const lobbyModeDisplay= document.getElementById('lobbyModeDisplay');
  const playerList      = document.getElementById('playerList');
  const readyBtn        = document.getElementById('readyBtn');
  const leaveLobbyBtn   = document.getElementById('leaveLobbyBtn');
  const waitingMsg      = document.getElementById('waitingMsg');

  const cheatEnabledCb  = document.getElementById('cheatEnabled');
  const soundEnabledCb  = document.getElementById('soundEnabled');
  const defaultModeSelect = document.getElementById('defaultMode');
  const saveSettingsBtn = document.getElementById('saveSettingsBtn');

  /* ── Local state ─────────────────────────────────────────────── */
  let currentLobbyCode = null;
  let isReady = false;

  /* ── Restore persisted state ─────────────────────────────────── */
  function restoreState() {
    const name = localStorage.getItem('playerName') || '';
    if (name) playerNameInput.value = name;

    const settings = _loadSettings();
    cheatEnabledCb.checked  = settings.cheatEnabled;
    soundEnabledCb.checked  = settings.soundEnabled;
    defaultModeSelect.value = settings.gameMode || 'score_attack';
    if (gameModeSelect) gameModeSelect.value = settings.gameMode || 'score_attack';

    _renderStats(_loadStats());
  }

  function _loadSettings() {
    try { return JSON.parse(localStorage.getItem('settings') || '{}'); }
    catch (_) { return {}; }
  }

  function _loadStats() {
    try { return JSON.parse(localStorage.getItem('stats') || '{}'); }
    catch (_) { return {}; }
  }

  function _saveStats(stats) {
    localStorage.setItem('stats', JSON.stringify(stats));
  }

  /* ── Stats display ───────────────────────────────────────────── */
  function _renderStats(stats) {
    _setText('statGames',    stats.gamesPlayed    || 0);
    _setText('statHighScore',stats.highScore      || 0);
    _setText('statLines',    stats.totalLinesCleared || 0);
    _setText('statWinLoss',  `${stats.wins || 0} / ${stats.losses || 0}`);

    const historyEl = document.getElementById('scoreHistory');
    if (!historyEl) return;
    historyEl.innerHTML = '';
    const scores = (stats.scores || []).slice().reverse();
    scores.forEach((s, i) => {
      const li = document.createElement('li');
      const date = s.date ? new Date(s.date).toLocaleDateString() : '';
      li.textContent = `#${i + 1}: ${s.score.toLocaleString()} pts  (${s.linesCleared} lines, ${s.gameMode || '?'}) ${date}`;
      historyEl.appendChild(li);
    });
  }

  /* ── Lobby UI ────────────────────────────────────────────────── */
  function showLobby(code, gameMode, players) {
    currentLobbyCode = code;
    lobbyPanel.classList.remove('hidden');
    lobbyCodeDisplay.textContent = code;
    lobbyModeDisplay.textContent = _modeLabel(gameMode);
    isReady = false;
    readyBtn.disabled = false;
    readyBtn.textContent = '✔ Ready';
    _renderPlayerList(players);
  }

  function _renderPlayerList(players) {
    playerList.innerHTML = '';
    players.forEach(p => {
      const div = document.createElement('div');
      div.className = 'player-item';
      div.innerHTML = `
        <span>${_esc(p.name)}</span>
        ${p.isHost  ? '<span class="badge badge-host">HOST</span>'   : ''}
        ${p.isReady ? '<span class="badge badge-ready">READY</span>' : ''}
      `;
      playerList.appendChild(div);
    });

    const allReady = players.length > 0 && players.every(p => p.isReady);
    waitingMsg.textContent = allReady
      ? 'All players ready – starting…'
      : players.length < 2
        ? 'Waiting for a second player… (or Ready to play solo)'
        : 'Waiting for all players to ready up…';
  }

  function hideLobby() {
    currentLobbyCode = null;
    lobbyPanel.classList.add('hidden');
  }

  /* ── Notification toast ──────────────────────────────────────── */
  function notify(msg, type = '') {
    const el = document.getElementById('notification');
    if (!el) return;
    el.textContent = msg;
    el.className   = `${type}`;
    el.classList.remove('hidden');
    clearTimeout(el._timer);
    el._timer = setTimeout(() => el.classList.add('hidden'), 3000);
  }

  /* ── Event handlers ──────────────────────────────────────────── */
  setNameBtn.addEventListener('click', () => {
    const name = playerNameInput.value.trim();
    if (!name) return notify('Please enter a name.', 'error');
    Network.playerName = name;
    localStorage.setItem('playerName', name);
    Network.send({ type: 'set_name', name });
    notify(`Name set to "${name}"`, 'success');
  });

  createGameBtn.addEventListener('click', () => {
    if (!Network.playerName) {
      playerNameInput.focus();
      return notify('Please set your name first.', 'error');
    }
    Network.send({ type: 'create_lobby', gameMode: gameModeSelect.value });
  });

  joinGameBtn.addEventListener('click', () => {
    const code = lobbyCodeInput.value.trim().toUpperCase();
    if (code.length < 4) return notify('Please enter a valid lobby code.', 'error');
    if (!Network.playerName) {
      playerNameInput.focus();
      return notify('Please set your name first.', 'error');
    }
    Network.send({ type: 'join_lobby', code });
  });

  readyBtn.addEventListener('click', () => {
    if (!currentLobbyCode) return;
    isReady = true;
    readyBtn.disabled = true;
    readyBtn.textContent = '✔ Waiting…';
    Network.send({ type: 'player_ready' });
  });

  leaveLobbyBtn.addEventListener('click', () => {
    Network.send({ type: 'leave_lobby' });
    hideLobby();
  });

  saveSettingsBtn.addEventListener('click', () => {
    const settings = {
      cheatEnabled: cheatEnabledCb.checked,
      soundEnabled: soundEnabledCb.checked,
      gameMode:     defaultModeSelect.value,
    };
    localStorage.setItem('settings', JSON.stringify(settings));
    Network.send({ type: 'save_settings', settings });
    if (gameModeSelect) gameModeSelect.value = settings.gameMode;
    notify('Settings saved.', 'success');
  });

  lobbyCodeInput.addEventListener('input', () => {
    lobbyCodeInput.value = lobbyCodeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  });
  lobbyCodeInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') joinGameBtn.click();
  });

  /* ── WebSocket handlers ──────────────────────────────────────── */
  Network.on('open', () => {
    // Request stats and settings from server (or use localStorage fallback)
    Network.send({ type: 'get_stats' });
    Network.send({ type: 'get_settings' });
  });

  Network.on('name_set', msg => {
    localStorage.setItem('playerName', msg.name);
  });

  Network.on('lobby_created', msg => {
    showLobby(msg.code, msg.gameMode, msg.players);
    notify(`Lobby ${msg.code} created!`, 'success');
  });

  Network.on('lobby_joined', msg => {
    showLobby(msg.code, msg.gameMode, msg.players);
    notify(`Joined lobby ${msg.code}`, 'success');
  });

  Network.on('lobby_updated', msg => {
    if (currentLobbyCode === msg.code) {
      _renderPlayerList(msg.players);
    }
  });

  Network.on('player_ready', msg => {
    if (currentLobbyCode) _renderPlayerList(msg.players);
  });

  Network.on('game_start', msg => {
    // Persist lobby info for game page
    localStorage.setItem('currentGame', JSON.stringify({
      lobbyCode: currentLobbyCode,
      gameMode:  msg.gameMode,
      seed:      msg.seed,
      players:   msg.players,
      cheatCode: msg.cheatCode,
    }));
    const settings = _loadSettings();
    localStorage.setItem('settings', JSON.stringify(
      Object.assign(settings, { cheatEnabled: cheatEnabledCb.checked, soundEnabled: soundEnabledCb.checked })
    ));
    window.location.href = '/game.html';
  });

  Network.on('stats', msg => {
    if (msg.stats) {
      _saveStats(msg.stats);
      _renderStats(msg.stats);
    }
  });

  Network.on('settings', msg => {
    if (msg.settings) {
      const s = msg.settings;
      cheatEnabledCb.checked  = s.cheatEnabled !== false;
      soundEnabledCb.checked  = s.soundEnabled !== false;
      if (s.gameMode) defaultModeSelect.value = s.gameMode;
    }
  });

  Network.on('error', msg => {
    if (msg && msg.message) notify(msg.message, 'error');
  });

  /* ── Helpers ─────────────────────────────────────────────────── */
  function _setText(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  }
  function _esc(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }
  function _modeLabel(mode) {
    return { score_attack: 'Score Attack', time_attack: 'Time Attack (3 min)', obstacle: 'Obstacle' }[mode] || mode;
  }

  /* ── Init ─────────────────────────────────────────────────────── */
  restoreState();
})();
