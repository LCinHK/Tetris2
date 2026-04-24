/**
 * gameover.js – Game Over page logic
 * Reads results from localStorage and renders the game over screen.
 */
(function () {
  'use strict';

  /* ── Load data ───────────────────────────────────────────────── */
  let lastGame = {};
  let stats    = {};
  try { lastGame = JSON.parse(localStorage.getItem('lastGame') || '{}'); } catch (_) {}
  try { stats    = JSON.parse(localStorage.getItem('stats')    || '{}'); } catch (_) {}

  /* ── Mode labels ─────────────────────────────────────────────── */
  const modeLabels = {
    score_attack: 'Score Attack',
    time_attack:  'Time Attack',
    obstacle:     'Obstacle',
  };

  /* ── Populate header ─────────────────────────────────────────── */
  const title    = document.getElementById('goTitle');
  const subtitle = document.getElementById('goSubtitle');

  // If the player won (server sets stats.wins), show winner message
  // We detect a "win" if this score equals the most recent win entry
  // Simple heuristic: if this score is non-zero, just show "Game Over"
  if (title) title.textContent = lastGame.score > 0 ? 'GAME OVER' : 'GAME OVER';
  if (subtitle) {
    const lines = lastGame.linesCleared || 0;
    subtitle.textContent = lines >= 30
      ? '🏆 Impressive performance!'
      : lines >= 15
        ? '👍 Not bad – keep practicing!'
        : '💪 Better luck next time!';
  }

  /* ── Score card ──────────────────────────────────────────────── */
  _setText('finalScore', (lastGame.score || 0).toLocaleString());
  _setText('finalLines', lastGame.linesCleared || 0);
  _setText('finalLevel', lastGame.level || 1);
  _setText('finalMode',  modeLabels[lastGame.gameMode] || (lastGame.gameMode || '–'));
  _setText('allTimeHigh', (stats.highScore || 0).toLocaleString());

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
  document.getElementById('playAgainBtn').addEventListener('click', () => {
    // Re-use the same lobby config if possible; otherwise go home to create new
    const currentGame = localStorage.getItem('currentGame');
    if (currentGame) {
      try {
        const cfg = JSON.parse(currentGame);
        // Update seed for new game
        cfg.seed = Math.floor(Math.random() * 1e6);
        localStorage.setItem('currentGame', JSON.stringify(cfg));
      } catch (_) {}
    }
    // Navigate back to home to let the player set up again
    window.location.href = '/';
  });

  document.getElementById('homeBtn').addEventListener('click', () => {
    window.location.href = '/';
  });

  /* ── Helpers ─────────────────────────────────────────────────── */
  function _setText(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  }
})();
