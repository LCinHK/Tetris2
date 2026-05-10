/**
 * gameover.js – Game Over page logic
 * Reads results from localStorage and renders the game over screen.
 */
(function () {
  'use strict';

  /* ── Load data ───────────────────────────────────────────────── */
  let lastGame = {};
  let stats    = {};
  let settings = {};
  try { lastGame = JSON.parse(localStorage.getItem('lastGame') || '{}'); } catch (_) {}
  try { stats    = JSON.parse(localStorage.getItem('stats')    || '{}'); } catch (_) {}
  try { settings = JSON.parse(localStorage.getItem('settings') || '{}'); } catch (_) {}

  // One-time trigger from previous page: play win/gameover sound when requested.
  const soundEnabled = settings.soundEnabled !== false;
  if (sessionStorage.getItem('playGameOver') === 'true') {
    sessionStorage.removeItem('playGameOver');
    if (soundEnabled) {
      try {
        const soundSrc = (lastGame.result === 'win') ? '/audio/win.mp3' : '/audio/gameover.mp3';
        const gameOverSound = new Audio(soundSrc);
        gameOverSound.currentTime = 0;
        void gameOverSound.play().catch(() => {});
      } catch (_) { /* ignore playback errors */ }
    }
  }

  /* ── Mode labels ─────────────────────────────────────────────── */
  const modeLabels = {
    score_attack: 'Score Attack',
    time_attack:  'Time Attack',
  };

  /* ── Populate header ─────────────────────────────────────────── */
  const title    = document.getElementById('goTitle');
  const subtitle = document.getElementById('goSubtitle');

  const result = lastGame.result;
  const hadOpponent = lastGame.hadOpponent === true;
  const isSolo = !hadOpponent;
  const opponent = lastGame.opponent || null;
  const lines  = lastGame.linesCleared || 0;

  console.log('[gameover] init', {
    hadOpponent,
    isSolo,
    lobbyCode: lastGame.lobbyCode || null,
    result: lastGame.result,
    networkReady: !!window.Network,
  });

  const wrapper = document.querySelector('.gameover-wrapper');
  if (wrapper && !hadOpponent) wrapper.classList.add('no-opponent');

  if (title) {
    if      (result === 'win')     title.textContent = '🏆 YOU WIN!';
    else if (result === 'loss' && hadOpponent) title.textContent = '😵 YOU LOST!';
    else if (result === 'loss')    title.textContent = '💀 GAME OVER';
    else if (result === 'time_up') title.textContent = "⏰ TIME'S UP!";
    else                           title.textContent = 'GAME OVER';
  }

  if (subtitle) {
    if (result === 'win') {
      subtitle.textContent = 'Excellent! Your opponent ran out of moves.';
    } else if (result === 'loss') {
      subtitle.textContent = 'Hang in there — better luck next time!';
    } else {
      subtitle.textContent = lines >= 30
        ? '🏆 Impressive performance!'
        : lines >= 15
          ? '👍 Not bad – keep practicing!'
          : '💪 Better luck next time!';
    }
  }

  /* ── Score card ──────────────────────────────────────────────── */
  _setText('finalScore', (lastGame.score || 0).toLocaleString());
  _setText('finalLines', lastGame.linesCleared || 0);
  _setText('finalLevel', lastGame.level || 1);
  _setText('finalMode',  modeLabels[lastGame.gameMode] || (lastGame.gameMode || '–'));
  _setText('allTimeHigh', (stats.highScore || 0).toLocaleString());

  const opponentCard = document.getElementById('opponentCard');
  if (hadOpponent && opponent && opponentCard) {
    opponentCard.classList.remove('hidden');
    _setText('opponentName', opponent.name || 'Opponent');
    _setText('opponentScore', (opponent.score || 0).toLocaleString());
    _setText('opponentLines', opponent.lines || 0);
    _setText('opponentLevel', opponent.level || 1);
  }

  /* ── Score history table ─────────────────────────────────────── */
  const historyBody = document.getElementById('historyBody');
  const scores = (stats.scores || []).slice().reverse();

  if (historyBody && scores.length > 0) {
    historyBody.innerHTML = '';
    const currentScore = lastGame.score || 0;
    let markedCurrent  = false;

    scores.forEach((s, i) => {
      const tr = document.createElement('tr');
      // Mark the most recent matching score as current game
      if (!markedCurrent && s.score === currentScore) {
        tr.className = 'current';
        markedCurrent = true;
      }
      const date = s.date ? new Date(s.date).toLocaleDateString() : '–';
      tr.innerHTML = `
        <td>${i + 1}</td>
        <td>${(s.score || 0).toLocaleString()}</td>
        <td>${s.linesCleared || 0}</td>
        <td>${modeLabels[s.gameMode] || s.gameMode || '–'}</td>
        <td>${date}</td>
      `;
      historyBody.appendChild(tr);
    });
  }

  /* ── Buttons ─────────────────────────────────────────────────── */
  const playAgainBtn = document.getElementById('playAgainBtn');
  if (playAgainBtn) {
    playAgainBtn.addEventListener('click', () => {
      console.log('[gameover] play again clicked', {
        isSolo,
        lobbyCode: lastGame.lobbyCode || null,
        hasNetwork: !!window.Network,
      });
      if (isSolo) {
        startSoloGame();
        return;
      }

      if (!window.Network) {
        console.log('[gameover] Network missing on multiplayer rematch');
        window.location.href = '/';
        return;
      }

      const lobbyCode = lastGame.lobbyCode || null;
      if (!lobbyCode) {
        console.log('[gameover] Missing lobbyCode for rematch');
        window.alert('Unable to request a rematch. Please return to Home.');
        return;
      }

      playAgainBtn.disabled = true;
      playAgainBtn.textContent = '⏳ Waiting for opponent...';
      if (subtitle) subtitle.textContent = 'Waiting for your opponent to respond...';

      sendRematchRequest(lobbyCode);
    });
  }

  document.getElementById('homeBtn').addEventListener('click', () => {
    window.location.href = '/';
  });

  /* ── Rematch handlers (multiplayer) ─────────────────────────── */
  if (window.Network) {
    Network.on('rematch_invite', (msg) => {
      console.log('[gameover] rematch_invite', msg);
      const fromName = (msg && msg.fromName) ? msg.fromName : 'Your opponent';
      const prompt = `${fromName} is inviting you to a rematch — ready for another round of Tetris?`;
      const accepted = window.confirm(prompt);
      console.log('[gameover] rematch_invite response', { accepted });
      Network.send({
        type: 'rematch_response',
        lobbyCode: msg && msg.lobbyCode ? msg.lobbyCode : (lastGame.lobbyCode || null),
        accepted,
      });
      if (!accepted && playAgainBtn) {
        playAgainBtn.disabled = false;
        playAgainBtn.textContent = '▶ Play Again';
      }
    });

    Network.on('rematch_declined', (msg) => {
      console.log('[gameover] rematch_declined', msg);
      if (playAgainBtn) {
        playAgainBtn.disabled = false;
        playAgainBtn.textContent = '▶ Play Again';
      }
      const name = (msg && msg.fromName) ? msg.fromName : 'Your opponent';
      window.alert(`${name} is not ready to play again right now.`);
      if (subtitle) subtitle.textContent = 'Your opponent declined the rematch.';
    });

    Network.on('game_start', (msg) => {
      console.log('[gameover] game_start received', msg);
      startNetworkGame(msg);
    });
  } else {
    console.log('[gameover] Network not available; rematch handlers not bound');
  }

  /* ── Helpers ─────────────────────────────────────────────────── */
  function _setText(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  }

  function startSoloGame() {
    console.log('[gameover] startSoloGame');
    const mode = lastGame.gameMode || settings.gameMode || 'score_attack';
    localStorage.setItem('currentGame', JSON.stringify({
      gameMode: mode,
    }));
    window.location.href = '/game.html';
  }

  function startNetworkGame(msg) {
    if (!msg) return;
    console.log('[gameover] startNetworkGame', {
      lobbyCode: msg.lobbyCode || lastGame.lobbyCode || null,
      gameMode: msg.gameMode || lastGame.gameMode || 'score_attack',
    });
    localStorage.setItem('currentGame', JSON.stringify({
      lobbyCode: msg.lobbyCode || lastGame.lobbyCode || null,
      gameMode: msg.gameMode || lastGame.gameMode || 'score_attack',
      seed: msg.seed,
      players: msg.players,
      cheatCode: msg.cheatCode,
      cheatUsesMax: msg.cheatUsesMax,
      cheatUsesRemaining: msg.cheatUsesRemaining,
    }));
    window.location.href = '/game.html';
  }

  function sendRematchRequest(lobbyCode) {
    if (!window.Network) return;
    if (Network.ws && Network.ws.readyState === WebSocket.OPEN) {
      console.log('[gameover] rematch_request send (ws open)', { lobbyCode });
      Network.send({ type: 'rematch_request', lobbyCode });
      return;
    }

    const onOpen = () => {
      console.log('[gameover] ws open, sending rematch_request', { lobbyCode });
      Network.off('open', onOpen);
      Network.send({ type: 'rematch_request', lobbyCode });
    };
    console.log('[gameover] ws not open, waiting for open event', {
      readyState: Network.ws ? Network.ws.readyState : null,
      lobbyCode,
    });
    Network.on('open', onOpen);
  }
})();
