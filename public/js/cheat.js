/**
 * cheat.js – Cheat code detection system
 *
 * Tracks the player's key sequence and fires a callback when the
 * current cheat code is entered correctly.
 *
 * Behaviour:
 *  - Activated by completing the exact key sequence shown in #cheatPanel.
 *  - Lasts 30 s then deactivates automatically (server also enforces this).
 *  - Changes to a harder sequence after each successful activation.
 *  - Can be disabled via settings (cheatEnabled flag).
 */
(function () {
  'use strict';

  const TRACKED_KEYS = new Set([
    'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  ]);

  class CheatManager {
    constructor(options = {}) {
      this.enabled     = options.enabled !== false;
      this.onActivate  = options.onActivate  || (() => {});  // (sequence) => void
      this.onDeactivate= options.onDeactivate|| (() => {});
      this.onProgress  = options.onProgress  || (() => {});  // (idx, total) => void

      this._sequence   = [];   // current required cheat sequence
      this._progress   = [];   // keys entered so far
      this._active     = false;
      this._expiryTimer= null;

      this._keyHandler = this._onKey.bind(this);
    }

    /* Set the target sequence (received from server) */
    setSequence(seq) {
      this._sequence = seq ? [...seq] : [];
      this._progress = [];
      this._renderKeys();
    }

    /* Attach keyboard listener */
    attach() {
      document.addEventListener('keydown', this._keyHandler, true);
    }

    detach() {
      document.removeEventListener('keydown', this._keyHandler, true);
    }

    _onKey(e) {
      if (!this.enabled || this._active) return;
      if (!TRACKED_KEYS.has(e.key))      return;
      // Only intercept for cheat when game is running (no modifier keys pressed
      // during cheat input – they could conflict with game controls, so we track
      // the same arrow keys the game uses; the game handles them separately)

      if (!this._sequence.length) return;

      const expected = this._sequence[this._progress.length];
      if (e.key === expected) {
        this._progress.push(e.key);
        this.onProgress(this._progress.length, this._sequence.length);
        this._renderKeys();

        if (this._progress.length === this._sequence.length) {
          this._trigger();
        }
      } else {
        // Wrong key – reset progress
        this._progress = [];
        this.onProgress(0, this._sequence.length);
        this._renderKeys();
      }
    }

    _trigger() {
      const seq = [...this._progress];
      this._progress = [];
      this.onActivate(seq);
    }

    /* Called by game.js when server confirms activation */
    markActive(durationMs) {
      this._active = true;
      clearTimeout(this._expiryTimer);
      this._expiryTimer = setTimeout(() => {
        this._active = false;
        this.onDeactivate();
        this._renderKeys();
      }, durationMs);
      this._renderKeys();
    }

    /* Called by game.js when server sends next code */
    updateNextSequence(seq) {
      this.setSequence(seq);
    }

    isActive() { return this._active; }

    /* ── UI helpers ─────────────────────────────────────────────── */
    _renderKeys() {
      const panel   = document.getElementById('cheatPanel');
      const display = document.getElementById('cheatKeysDisplay');
      const status  = document.getElementById('cheatStatus');
      if (!panel || !display) return;

      if (!this.enabled || !this._sequence.length) {
        panel.classList.add('hidden');
        return;
      }
      panel.classList.remove('hidden');

      // Build key badges
      display.innerHTML = '';
      this._sequence.forEach((key, i) => {
        const span = document.createElement('span');
        span.className = 'cheat-key';
        span.textContent = _keyLabel(key);
        if (i < this._progress.length)  span.classList.add('done');
        display.appendChild(span);
      });

      if (status) {
        if (this._active) {
          status.textContent = '✔ CHEAT ACTIVE!';
          status.style.color = 'var(--accent)';
        } else {
          status.textContent = this._progress.length
            ? `${this._progress.length}/${this._sequence.length} keys…`
            : '';
          status.style.color = 'var(--green)';
        }
      }
    }
  }

  function _keyLabel(key) {
    const map = {
      ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
    };
    return map[key] || key;
  }

  window.CheatManager = CheatManager;
})();
