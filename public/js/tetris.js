/**
 * tetris.js – Core Tetris game engine (no external dependencies)
 *
 * Usage:
 *   const game = new TetrisGame(canvas, options);
 *   game.start();
 */
(function () {
  'use strict';

  /* ─────────────────────────────────────────
     Piece definitions (SRS shapes & colors)
  ───────────────────────────────────────── */
  const PIECES = {
    I: { shape: [[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]], color: '#00f0f0' },
    O: { shape: [[1,1],[1,1]],                              color: '#f0f000' },
    T: { shape: [[0,1,0],[1,1,1],[0,0,0]],                  color: '#a000f0' },
    S: { shape: [[0,1,1],[1,1,0],[0,0,0]],                  color: '#00f000' },
    Z: { shape: [[1,1,0],[0,1,1],[0,0,0]],                  color: '#f00000' },
    J: { shape: [[1,0,0],[1,1,1],[0,0,0]],                  color: '#0000f0' },
    L: { shape: [[0,0,1],[1,1,1],[0,0,0]],                  color: '#f0a000' },
  };
  const PIECE_KEYS = Object.keys(PIECES);

  /* SRS wall-kick offsets [from rotation][to rotation] → array of {x,y} tests */
  const KICKS_JLSTZ = {
    '0→1': [{x:0,y:0},{x:-1,y:0},{x:-1,y:1},{x:0,y:-2},{x:-1,y:-2}],
    '1→0': [{x:0,y:0},{x:1,y:0},{x:1,y:-1},{x:0,y:2},{x:1,y:2}],
    '1→2': [{x:0,y:0},{x:1,y:0},{x:1,y:-1},{x:0,y:2},{x:1,y:2}],
    '2→1': [{x:0,y:0},{x:-1,y:0},{x:-1,y:1},{x:0,y:-2},{x:-1,y:-2}],
    '2→3': [{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:-2},{x:1,y:-2}],
    '3→2': [{x:0,y:0},{x:-1,y:0},{x:-1,y:-1},{x:0,y:2},{x:-1,y:2}],
    '3→0': [{x:0,y:0},{x:-1,y:0},{x:-1,y:-1},{x:0,y:2},{x:-1,y:2}],
    '0→3': [{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:-2},{x:1,y:-2}],
  };
  const KICKS_I = {
    '0→1': [{x:0,y:0},{x:-2,y:0},{x:1,y:0},{x:-2,y:-1},{x:1,y:2}],
    '1→0': [{x:0,y:0},{x:2,y:0},{x:-1,y:0},{x:2,y:1},{x:-1,y:-2}],
    '1→2': [{x:0,y:0},{x:-1,y:0},{x:2,y:0},{x:-1,y:2},{x:2,y:-1}],
    '2→1': [{x:0,y:0},{x:1,y:0},{x:-2,y:0},{x:1,y:-2},{x:-2,y:1}],
    '2→3': [{x:0,y:0},{x:2,y:0},{x:-1,y:0},{x:2,y:1},{x:-1,y:-2}],
    '3→2': [{x:0,y:0},{x:-2,y:0},{x:1,y:0},{x:-2,y:-1},{x:1,y:2}],
    '3→0': [{x:0,y:0},{x:1,y:0},{x:-2,y:0},{x:1,y:-2},{x:-2,y:1}],
    '0→3': [{x:0,y:0},{x:-1,y:0},{x:2,y:0},{x:-1,y:2},{x:2,y:-1}],
  };

  /* Scoring */
  const LINE_SCORES = [0, 100, 300, 500, 800];

  /* Drop-speed table: interval in ms per level (1–20+) */
  function dropInterval(level) {
    const speeds = [800,717,633,550,467,383,300,217,133,100,83,83,83,67,67,67,50,50,50,33,33];
    return speeds[Math.min(level - 1, speeds.length - 1)];
  }

  /* ─────────────────────────────────────────
     SeededRandom (Mulberry32) for reproducible piece bags
  ───────────────────────────────────────── */
  function SeededRandom(seed) {
    let s = seed >>> 0;
    return function () {
      s += 0x6d2b79f5;
      let t = Math.imul(s ^ s >>> 15, 1 | s);
      t ^= t + Math.imul(t ^ t >>> 7, 61 | t);
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  /* Fisher-Yates shuffle using a seeded random */
  function shuffleArray(arr, rng) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  /* Rotate a 2-D matrix 90° clockwise */
  function rotateCW(matrix) {
    const rows = matrix.length, cols = matrix[0].length;
    return Array.from({ length: cols }, (_, c) =>
      Array.from({ length: rows }, (__, r) => matrix[rows - 1 - r][c])
    );
  }

  /* ─────────────────────────────────────────
     TetrisGame class
  ───────────────────────────────────────── */
  class TetrisGame {
    constructor(canvas, options = {}) {
      this.canvas  = canvas;
      this.ctx     = canvas.getContext('2d');
      this.COLS    = 10;
      this.ROWS    = 20;
      this.CELL    = options.cellSize || 30;

      canvas.width  = this.COLS * this.CELL;
      canvas.height = this.ROWS * this.CELL;

      /* Callbacks */
      this.onScoreUpdate  = options.onScoreUpdate  || (() => {});
      this.onLinesCleared = options.onLinesCleared || (() => {});
      this.onGameOver     = options.onGameOver     || (() => {});
      this.onBoardUpdate  = options.onBoardUpdate  || (() => {});

      /* Canvases for next / hold */
      this.nextCanvas = options.nextCanvas || null;
      this.holdCanvas = options.holdCanvas || null;

      this._reset(options.seed || 0);
    }

    _reset(seed) {
      this.board        = Array.from({ length: this.ROWS }, () => new Array(this.COLS).fill(null));
      this.score        = 0;
      this.level        = 1;
      this.lines        = 0;
      this.isGameOver   = false;
      this.isPaused     = false;
      this.holdPiece    = null;
      this.holdUsed     = false;
      this.scoreBoost   = false;
      this.obfuscated   = false;
      this._lastDrop    = 0;
      this._raf         = null;
      this._rng         = SeededRandom(seed);
      this._bag         = [];
      this.currentPiece = null;
      this.ghostY       = 0;
      this._spawn();
    }

    /* ── 7-bag piece generation ─────────────────────────────────── */
    _nextFromBag() {
      if (this._bag.length === 0) {
        this._bag = shuffleArray([...PIECE_KEYS], this._rng);
      }
      return this._bag.pop();
    }

    _makePiece(key) {
      const def = PIECES[key];
      return {
        key,
        shape: def.shape.map(r => [...r]),
        color: def.color,
        x: Math.floor((this.COLS - def.shape[0].length) / 2),
        y: key === 'I' ? -1 : 0,
        rot: 0,
      };
    }

    _spawn() {
      if (!this.nextPiece) this.nextPiece = this._makePiece(this._nextFromBag());
      this.currentPiece = this.nextPiece;
      this.nextPiece    = this._makePiece(this._nextFromBag());
      this.holdUsed     = false;
      this._updateGhost();
      this._drawNext();

      if (!this._fits(this.currentPiece, 0, 0)) {
        this.isGameOver = true;
        cancelAnimationFrame(this._raf);
        this._draw();
        this.onGameOver({ score: this.score, lines: this.lines, level: this.level });
      }
    }

    /* ── Collision / fit check ─────────────────────────────────── */
    _fits(piece, dx, dy, shapeOverride) {
      const shape = shapeOverride || piece.shape;
      for (let r = 0; r < shape.length; r++) {
        for (let c = 0; c < shape[r].length; c++) {
          if (!shape[r][c]) continue;
          const nx = piece.x + c + dx;
          const ny = piece.y + r + dy;
          if (nx < 0 || nx >= this.COLS || ny >= this.ROWS) return false;
          if (ny >= 0 && this.board[ny][nx]) return false;
        }
      }
      return true;
    }

    _updateGhost() {
      let drop = 0;
      while (this._fits(this.currentPiece, 0, drop + 1)) drop++;
      this.ghostY = this.currentPiece.y + drop;
    }

    /* ── Piece locking ────────────────────────────────────────── */
    _lock() {
      const p = this.currentPiece;
      for (let r = 0; r < p.shape.length; r++) {
        for (let c = 0; c < p.shape[r].length; c++) {
          if (!p.shape[r][c]) continue;
          const ny = p.y + r;
          if (ny < 0) { this.isGameOver = true; break; }
          this.board[ny][p.x + c] = p.color;
        }
      }
      this._clearLines();
      this.onBoardUpdate(this._serializeBoard());
      this._spawn();
    }

    _clearLines() {
      let cleared = 0;
      for (let r = this.ROWS - 1; r >= 0; r--) {
        if (this.board[r].every(c => c !== null)) {
          this.board.splice(r, 1);
          this.board.unshift(new Array(this.COLS).fill(null));
          cleared++;
          r++; // recheck same row index
        }
      }
      if (cleared > 0) {
        let points = (LINE_SCORES[cleared] || 1200) * this.level;
        if (this.scoreBoost) points *= 2;
        this.score += points;
        this.lines += cleared;
        this.level = Math.floor(this.lines / 10) + 1;
        this.onScoreUpdate({ score: this.score, lines: this.lines, level: this.level });
        this.onLinesCleared({ count: cleared, score: this.score });
      }
    }

    /* ── Public controls ─────────────────────────────────────── */
    moveLeft()  { if (this._fits(this.currentPiece, -1, 0)) { this.currentPiece.x--; this._updateGhost(); this._draw(); } }
    moveRight() { if (this._fits(this.currentPiece,  1, 0)) { this.currentPiece.x++; this._updateGhost(); this._draw(); } }

    softDrop() {
      if (this._fits(this.currentPiece, 0, 1)) {
        this.currentPiece.y++;
        this._lastDrop = performance.now();
        this._draw();
      } else {
        this._lock();
      }
    }

    hardDrop() {
      while (this._fits(this.currentPiece, 0, 1)) this.currentPiece.y++;
      this._lock();
    }

    rotate() {
      const p   = this.currentPiece;
      const rot = rotateCW(p.shape);
      const newRot = (p.rot + 1) % 4;
      const kickKey = `${p.rot}→${newRot}`;
      const kicks = p.key === 'I' ? KICKS_I[kickKey] : KICKS_JLSTZ[kickKey];

      if (kicks) {
        for (const k of kicks) {
          if (this._fits(p, k.x, -k.y, rot)) {
            p.shape = rot;
            p.x += k.x;
            p.y -= k.y;
            p.rot = newRot;
            this._updateGhost();
            this._draw();
            return;
          }
        }
      } else if (this._fits(p, 0, 0, rot)) {
        p.shape = rot;
        p.rot = newRot;
        this._updateGhost();
        this._draw();
      }
    }

    hold() {
      if (this.holdUsed) return;
      if (!this.holdPiece) {
        this.holdPiece = this._makePiece(this.currentPiece.key);
        this._spawn();
      } else {
        const tmp = this._makePiece(this.holdPiece.key);
        this.holdPiece = this._makePiece(this.currentPiece.key);
        this.currentPiece = tmp;
        this._updateGhost();
      }
      this.holdUsed = true;
      this._drawHold();
      this._draw();
    }

    pause()  { this.isPaused = true;  cancelAnimationFrame(this._raf); }
    resume() { this.isPaused = false; this._lastDrop = performance.now(); this._loop(performance.now()); }

    togglePause() {
      if (this.isPaused) this.resume(); else this.pause();
      return this.isPaused;
    }

    /* Add garbage lines (obstacle mode) */
    addGarbageLines(count) {
      for (let i = 0; i < count; i++) {
        const hole = Math.floor(Math.random() * this.COLS);
        const row  = new Array(this.COLS).fill('#555555');
        row[hole]  = null;
        this.board.shift();
        this.board.push(row);
      }
      this._draw();
    }

    /* Activate score-boost cheat */
    activateScoreBoost(durationMs) {
      this.scoreBoost = true;
      setTimeout(() => { this.scoreBoost = false; }, durationMs);
    }

    /* ── Game loop ─────────────────────────────────────────────── */
    start(seed) {
      if (seed !== undefined) this._reset(seed);
      this._lastDrop = performance.now();
      this._loop(performance.now());
    }

    _loop(ts) {
      if (this.isGameOver || this.isPaused) return;
      const interval = dropInterval(this.level);
      if (ts - this._lastDrop >= interval) {
        if (this._fits(this.currentPiece, 0, 1)) {
          this.currentPiece.y++;
          this._updateGhost();
        } else {
          this._lock();
          if (this.isGameOver) return;
        }
        this._lastDrop = ts;
      }
      this._draw();
      this._raf = requestAnimationFrame(ts => this._loop(ts));
    }

    /* ── Rendering ─────────────────────────────────────────────── */
    _draw() {
      const { ctx, COLS, ROWS, CELL } = this;
      ctx.clearRect(0, 0, COLS * CELL, ROWS * CELL);

      // Background grid
      ctx.fillStyle = '#0d0d1a';
      ctx.fillRect(0, 0, COLS * CELL, ROWS * CELL);
      ctx.strokeStyle = '#1a1a35';
      ctx.lineWidth = 0.5;
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          ctx.strokeRect(c * CELL, r * CELL, CELL, CELL);
        }
      }

      // Board (locked pieces)
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          if (this.board[r][c]) {
            this._drawCell(ctx, c, r, this.board[r][c], CELL);
          }
        }
      }

      // Ghost piece
      const p = this.currentPiece;
      if (p) {
        for (let r = 0; r < p.shape.length; r++) {
          for (let c = 0; c < p.shape[r].length; c++) {
            if (!p.shape[r][c]) continue;
            const ny = this.ghostY + r;
            if (ny >= 0 && ny < ROWS) {
              ctx.fillStyle = 'rgba(255,255,255,0.12)';
              ctx.fillRect((p.x + c) * CELL + 1, ny * CELL + 1, CELL - 2, CELL - 2);
            }
          }
        }

        // Active piece
        for (let r = 0; r < p.shape.length; r++) {
          for (let c = 0; c < p.shape[r].length; c++) {
            if (!p.shape[r][c]) continue;
            const ny = p.y + r;
            if (ny >= 0) this._drawCell(ctx, p.x + c, ny, p.color, CELL);
          }
        }
      }
    }

    _drawCell(ctx, col, row, color, cell) {
      const x = col * cell, y = row * cell;
      ctx.fillStyle = color;
      ctx.fillRect(x + 1, y + 1, cell - 2, cell - 2);
      // Highlight edge
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.fillRect(x + 1, y + 1, cell - 2, 3);
      ctx.fillRect(x + 1, y + 1, 3, cell - 2);
      // Shadow edge
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.fillRect(x + 1, y + cell - 4, cell - 2, 3);
      ctx.fillRect(x + cell - 4, y + 1, 3, cell - 2);
    }

    _drawMini(ctx, piece, size) {
      if (!piece) return;
      ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
      ctx.fillStyle = '#0d0d1a';
      ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
      const { shape, color } = piece;
      const offX = Math.floor((4 - shape[0].length) / 2);
      const offY = Math.floor((4 - shape.length) / 2);
      for (let r = 0; r < shape.length; r++) {
        for (let c = 0; c < shape[r].length; c++) {
          if (shape[r][c]) this._drawCell(ctx, offX + c, offY + r, color, size);
        }
      }
    }

    _drawNext() {
      if (!this.nextCanvas) return;
      const ctx  = this.nextCanvas.getContext('2d');
      const cell = Math.floor(this.nextCanvas.width / 4);
      this._drawMini(ctx, this.nextPiece, cell);
    }

    _drawHold() {
      if (!this.holdCanvas) return;
      const ctx  = this.holdCanvas.getContext('2d');
      const cell = Math.floor(this.holdCanvas.width / 4);
      this._drawMini(ctx, this.holdPiece, cell);
    }

    /* ── Serialisation for network sync ─────────────────────────── */
    _serializeBoard() {
      return this.board.map(row => row.map(c => c || 0));
    }
  }

  /* ─────────────────────────────────────────
     Draw an opponent's serialised board onto a canvas
  ───────────────────────────────────────── */
  function drawOpponentBoard(canvas, boardData) {
    if (!canvas || !boardData) return;
    const ROWS = boardData.length;
    const COLS = boardData[0] ? boardData[0].length : 10;
    const CELL = Math.floor(canvas.width / COLS);
    const ctx  = canvas.getContext('2d');

    ctx.fillStyle = '#0d0d1a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = '#1a1a35';
    ctx.lineWidth = 0.5;

    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        ctx.strokeRect(c * CELL, r * CELL, CELL, CELL);
        if (boardData[r][c]) {
          ctx.fillStyle = boardData[r][c];
          ctx.fillRect(c * CELL + 1, r * CELL + 1, CELL - 2, CELL - 2);
        }
      }
    }
  }

  window.TetrisGame      = TetrisGame;
  window.drawOpponentBoard = drawOpponentBoard;
})();
