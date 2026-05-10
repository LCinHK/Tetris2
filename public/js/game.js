/**
 * game.js – Game page logic
 * Depends on: network.js, tetris.js, cheat.js
 */
(function () {
    'use strict';

    /* ── Read game config from sessionStorage ───────────────────── */
    let gameConfig = {};
    try { gameConfig = JSON.parse(sessionStorage.getItem('currentGame') || '{}'); } catch (_) { }

    let settings = {};
    try { settings = JSON.parse(sessionStorage.getItem('settings') || '{}'); } catch (_) { }

    const gameMode = gameConfig.gameMode || 'score_attack';
    const isSolo = !gameConfig.players || gameConfig.players.length < 2;

    function _randomSeed() {
        // Prefer cryptographically-strong randomness when available.
        try {
            if (window.crypto && window.crypto.getRandomValues) {
                const buf = new Uint32Array(1);
                window.crypto.getRandomValues(buf);
                return buf[0] >>> 0;
            }
        } catch (_) { }
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
            void bgm.play().catch(() => { });
        } catch (_) { /* ignore playback errors */ }
    }

    function stopBgm() {
        if (!bgm) return;
        bgm.pause();
        try { bgm.currentTime = 0; } catch (_) { }
    }

    function pauseBgm() {
        if (!bgm) return;
        bgm.pause();
    }

    function resumeBgm() {
        if (!bgm) return;
        void bgm.play().catch(() => { });
    }

    function playClearSound() {
        if (!clearSound) return;
        try {
            clearSound.currentTime = 0;
            void clearSound.play().catch(() => { });
        } catch (_) { /* ignore playback errors */ }
    }

    function playLockSound() {
        if (!lockSound) return;
        try {
            lockSound.currentTime = 0;
            void lockSound.play().catch(() => { });
        } catch (_) { /* ignore playback errors */ }
    }

    function playCountdownSound() {
        if (!countdownSound) return;
        try {
            countdownSound.currentTime = 0;
            void countdownSound.play().catch(() => { });
        } catch (_) { /* ignore playback errors */ }
    }

    function playGamestartSound() {
        if (!gamestartSound) return;
        try {
            gamestartSound.currentTime = 0;
            void gamestartSound.play().catch(() => { });
        } catch (_) { /* ignore playback errors */ }
    }

    /* ── DOM refs ─────────────────────────────────────────────────── */
    const gameCanvas = document.getElementById('gameCanvas');
    const opponentCanvas = document.getElementById('opponentCanvas');
    const opponentArea = document.getElementById('opponentArea');
    const opponentLabel = document.getElementById('opponentLabel');
    const opponentScore = document.getElementById('opponentScore');
    const nextCanvas = document.getElementById('nextCanvas');
    const holdCanvas = document.getElementById('holdCanvas');
    const modeBadge = document.getElementById('modeBadge');
    const timerDisplay = document.getElementById('timerDisplay');
    const homeBtn = document.getElementById('homeBtn');
    const pauseOverlay = document.getElementById('pauseOverlay');
    const countdownOverlay = document.getElementById('countdownOverlay');
    const countdownText = document.getElementById('countdownText');
    const myBoardLabel = document.getElementById('myBoardLabel');
    const cheatActivateBtn = document.getElementById('cheatActivateBtn');
    const cheatUsesDisplay = document.getElementById('cheatUsesDisplay');
    const cheatTimerDisplay = document.getElementById('cheatTimerDisplay');

    /* ── Mode badge ──────────────────────────────────────────────── */
    const modeLabels = { score_attack: 'Score Attack', time_attack: 'Time Attack' };
    if (modeBadge) modeBadge.textContent = modeLabels[gameMode] || gameMode;

    /* ── Show opponent area if multiplayer ───────────────────────── */
    if (!isSolo && opponentArea) {
        opponentArea.classList.remove('hidden');
        opponentArea.style.display = 'flex';
        if (gameConfig.players) {
            const myId = Network.clientId || '';
            const opp = gameConfig.players.find(p => p.id !== myId);
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
                endGame(undefined, undefined, undefined, true);
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
    let _opponentGameOver = false;
    let _gameEnded = false;
    let _opponentSnapshot = { name: '', score: 0, lines: 0, level: 1 };

    const game = new TetrisGame(gameCanvas, {
        cellSize: 30,
        seed,
        // In Time Attack, ramp difficulty with elapsed (unpaused) play time.
        // Other modes keep classic line-based leveling.
        levelUpByTimeMs: gameMode === 'time_attack' ? 30000 : 0,
        nextCanvas,
        holdCanvas,
        onScoreUpdate({ score, lines, level }) {
            _setText('scoreDisplay', score.toLocaleString());
            _setText('levelDisplay', level);
            _setText('linesDisplay', lines);
        },
        onLinesCleared({ count, score }) {
            playClearSound();
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
                lobbyCode: gameConfig.lobbyCode || null,
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
                lobbyCode: gameConfig.lobbyCode || null,
            });
        },
        onGameOver({ score, lines, level }) {
            endGame(score, lines, level, false);
        },
    });

    /* ── Cheat manager ───────────────────────────────────────────── */
    const SOLO_CHEAT_MAX_USES = 5;
    let soloCheatUsesRemaining = SOLO_CHEAT_MAX_USES;
    let soloCheatActivationCount = 0;

    const cheat = new CheatManager({
        enabled: settings.cheatEnabled !== false,
        onActivate(seq) {
            if (isSolo && !gameConfig.lobbyCode) {
                if (soloCheatUsesRemaining <= 0) {
                    notify('Cheat limit reached.', 'error');
                    return;
                }
                soloCheatUsesRemaining -= 1;
                soloCheatActivationCount += 1;
                const nextCheatCode = _getSoloCheatSequence(soloCheatActivationCount, seed);
                handleCheatActivated({
                    effects: _pickSoloCheatEffects(),
                    duration: 30000,
                    nextCheatCode,
                    cheatUsesMax: SOLO_CHEAT_MAX_USES,
                    cheatUsesRemaining: soloCheatUsesRemaining,
                });
                return;
            }

            const wsReady = Network.ws && Network.ws.readyState === WebSocket.OPEN;
            if (!wsReady) {
                notify('Cheat request failed (network not ready).', 'error');
                return;
            }
            Network.send({
                type: 'cheat_activate',
                sequence: seq,
                lobbyCode: gameConfig.lobbyCode || null,
                manual: true,
            });
        },
        onProgress(done, total) { /* handled by CheatManager internally */ },
        onDeactivate() {
            game.scoreBoost = false;
            gameCanvas.classList.remove('obfuscated');
            clearCheatTimer();
        },
    });

    if (gameConfig.cheatCode) {
        cheat.setSequence(gameConfig.cheatCode);
    } else if (isSolo) {
        cheat.setSequence(_getSoloCheatSequence(soloCheatActivationCount, seed));
    }
    cheat.attach();

    function updateCheatUses({ cheatUsesMax, cheatUsesRemaining } = {}) {
        if (!cheatUsesDisplay) return;
        const max = Number(cheatUsesMax);
        const remaining = Number(cheatUsesRemaining);
        if (Number.isFinite(max) && Number.isFinite(remaining)) {
            cheatUsesDisplay.textContent = `Uses: ${remaining}/${max}`;
            if (cheatActivateBtn) cheatActivateBtn.disabled = remaining <= 0;
        }
    }

    if (Number.isFinite(gameConfig.cheatUsesMax)) {
        updateCheatUses({
            cheatUsesMax: gameConfig.cheatUsesMax,
            cheatUsesRemaining: gameConfig.cheatUsesRemaining,
        });
    } else if (isSolo) {
        updateCheatUses({
            cheatUsesMax: SOLO_CHEAT_MAX_USES,
            cheatUsesRemaining: soloCheatUsesRemaining,
        });
    }

    let cheatTimerInterval = null;
    let cheatTimerEnd = 0;

    function clearCheatTimer() {
        if (cheatTimerInterval) {
            clearInterval(cheatTimerInterval);
            cheatTimerInterval = null;
        }
        if (cheatTimerDisplay) cheatTimerDisplay.textContent = '';
    }

    function startCheatTimer(durationMs) {
        if (!cheatTimerDisplay) return;
        if (!Number.isFinite(durationMs) || durationMs <= 0) {
            clearCheatTimer();
            return;
        }

        cheatTimerEnd = Date.now() + durationMs;
        clearCheatTimer();
        cheatTimerInterval = setInterval(() => {
            const leftMs = Math.max(0, cheatTimerEnd - Date.now());
            const leftSec = Math.ceil(leftMs / 1000);
            cheatTimerDisplay.textContent = `Cheat active: ${leftSec}s`;
            if (leftMs <= 0) clearCheatTimer();
        }, 250);
    }

    function tryActivateCheat() {
        if (!gameStarted) {
            notify('Cheat available after the game starts.', 'error');
            return;
        }
        if (cheat.triggerManual()) return;
        if (cheat.isActive()) {
            notify('Cheat already active.', 'error');
        } else {
            notify('Cheat not ready yet.', 'error');
        }
    }

    if (cheatActivateBtn) {
        cheatActivateBtn.addEventListener('click', () => {
            if (game.isGameOver) return;
            tryActivateCheat();
        });
    }

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
        if (game.isPaused && !(e.key === 'p' || e.key === 'P' || e.key === 'F2')) {
            // Prevent browser scrolling on arrow keys/space.
            if (['ArrowLeft', 'ArrowRight', 'ArrowDown', 'ArrowUp', ' '].includes(e.key)) {
                e.preventDefault();
            }
            return;
        }
        switch (e.key) {
            case 'ArrowLeft': e.preventDefault(); game.moveLeft(); break;
            case 'ArrowRight': e.preventDefault(); game.moveRight(); break;
            case 'ArrowDown': e.preventDefault(); game.softDrop(); break;
            case 'ArrowUp': e.preventDefault(); game.rotate(); break;
            case ' ':
                e.preventDefault();
                if (!hardDropLocked) { hardDropLocked = true; game.hardDrop(); }
                break;
            case 'c': case 'C': game.hold(); break;
            case 'p': case 'P': togglePause(); break;
            case 'F2':
                e.preventDefault();
                tryActivateCheat();
                break;
        }
    });

    document.addEventListener('keyup', (e) => {
        if (e.key === ' ') hardDropLocked = false;
    });

    function togglePause() {
        if (game.isGameOver) return;
        if (!isSolo) {
            notify('Pause is disabled in multiplayer.', 'error');
            return;
        }
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

        game.drawCountdownPreview();
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
    function endGame(score, lines, level, isTimeUp) {
        if (_gameEnded) return;
        _gameEnded = true;

        if (!game.isGameOver) {
            game.isGameOver = true;
            game.pause();
        }

        clearInterval(timerInterval);
        timerInterval = null;
        stopBgm();
        cheat.detach();

        const finalScore = score !== undefined ? score : game.score;
        const finalLines = lines !== undefined ? lines : game.lines;
        const finalLevel = level !== undefined ? level : game.level;

        // Determine match outcome for the game-over page
        let result;
        if (isSolo) {
            if (gameMode === 'time_attack' && isTimeUp) {
                result = 'time_up';
            } else {
                result = 'solo';
            }
        } else if (_opponentGameOver) {
            result = 'win';
        } else if (gameMode === 'time_attack' && isTimeUp) {
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
            lobbyCode: gameConfig.lobbyCode || null,
        });

        sessionStorage.setItem('lastGame', JSON.stringify({
            score: finalScore,
            linesCleared: finalLines,
            level: finalLevel,
            gameMode,
            result,
            hadOpponent: !isSolo,
            lobbyCode: gameConfig.lobbyCode || null,
            opponent: !isSolo ? _opponentSnapshot : null,
        }));

        // Wait for server to confirm with full stats, then navigate
        const nav = () => {
            sessionStorage.setItem('playGameOver', 'true');
            window.location.href = '/gameover.html';
        };
        Network.on('game_over_confirmed', (msg) => {
            if (msg.stats) {
                const localStats = _loadLocalStats();
                const merged = _mergeStats(localStats, msg.stats);
                sessionStorage.setItem('stats', JSON.stringify(merged));
            }
            nav();
        });
        // Fallback timeout in case of network issue
        setTimeout(nav, 3000);
    }

    /* ── Network events ──────────────────────────────────────────── */
    Network.on('opponent_update', (msg) => {
        if (opponentArea && !opponentArea.classList.contains('hidden')) {
            if (msg.playerName && opponentLabel) {
                opponentLabel.textContent = msg.playerName.toUpperCase();
            }
            if (msg.board) drawOpponentBoard(opponentCanvas, msg.board);
            if (opponentScore) opponentScore.textContent = (msg.score || 0).toLocaleString();
            _setText('opponentLevel', msg.level || 1);
            _setText('opponentLines', msg.lines || 0);
        }

            _opponentSnapshot = {
                name: msg.playerName || _opponentSnapshot.name || 'Opponent',
                score: Number(msg.score) || 0,
                lines: Number(msg.lines) || 0,
                level: Number(msg.level) || 1,
            };
    });

    Network.on('opponent_game_over', (msg) => {
        _opponentGameOver = true;
        const overlay = document.getElementById('opponentOverlay');
        if (overlay) overlay.classList.remove('hidden');
        notify(`Opponent finished with ${(msg.score || 0).toLocaleString()} pts! You win!`, 'success');
        _opponentSnapshot = {
            name: msg.playerName || _opponentSnapshot.name || 'Opponent',
            score: Number(msg.score) || _opponentSnapshot.score || 0,
            lines: _opponentSnapshot.lines || 0,
            level: _opponentSnapshot.level || 1,
        };
        endGame(game.score, game.lines, game.level, false);
    });

    Network.on('cheat_activated', (msg) => {
        handleCheatActivated(msg);
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
        updateCheatUses(msg);
    });

    Network.on('game_start', (msg) => {
        // In case we receive this while on game page (reconnect scenario)
        if (msg.cheatCode) cheat.setSequence(msg.cheatCode);
        updateCheatUses(msg);
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
        el.className = type;
        el.classList.remove('hidden');
        clearTimeout(el._timer);
        el._timer = setTimeout(() => el.classList.add('hidden'), 3500);
    }

    function _setText(id, val) {
        const el = document.getElementById(id);
        if (el) el.textContent = val;
    }

    function _loadLocalStats() {
        try { return JSON.parse(sessionStorage.getItem('stats') || '{}'); }
        catch (_) { return {}; }
    }

    function _mergeStats(localStats, serverStats) {
        const localScores = Array.isArray(localStats.scores) ? localStats.scores : [];
        const serverScores = Array.isArray(serverStats.scores) ? serverStats.scores : [];

        const mergedScores = localScores.slice();
        serverScores.forEach((s) => {
            const exists = mergedScores.some(ls =>
                ls.score === s.score &&
                ls.linesCleared === s.linesCleared &&
                ls.gameMode === s.gameMode &&
                ls.date === s.date
            );
            if (!exists) mergedScores.push(s);
        });

        // Keep only the most recent 10 scores by date (or preserve insertion order).
        mergedScores.sort((a, b) => {
            const da = a && a.date ? new Date(a.date).getTime() : 0;
            const db = b && b.date ? new Date(b.date).getTime() : 0;
            return da - db;
        });
        if (mergedScores.length > 10) mergedScores.splice(0, mergedScores.length - 10);

        const highScore = Math.max(
            Number(localStats.highScore) || 0,
            Number(serverStats.highScore) || 0,
            ...mergedScores.map(s => Number(s.score) || 0)
        );

        return {
            name: serverStats.name || localStats.name || '',
            gamesPlayed: Math.max(
                Number(localStats.gamesPlayed) || 0,
                Number(serverStats.gamesPlayed) || 0,
                mergedScores.length
            ),
            highScore,
            totalLinesCleared: Math.max(
                Number(localStats.totalLinesCleared) || 0,
                Number(serverStats.totalLinesCleared) || 0
            ),
            wins: Math.max(Number(localStats.wins) || 0, Number(serverStats.wins) || 0),
            losses: Math.max(Number(localStats.losses) || 0, Number(serverStats.losses) || 0),
            scores: mergedScores,
        };
    }

    function handleCheatActivated(msg) {
        if (!msg) return;
        cheat.markActive(msg.duration || 30000);

        const effects = Array.isArray(msg.effects)
            ? msg.effects
            : (msg.cheatType ? [{ type: msg.cheatType, duration: msg.duration }] : []);

        const effectLabels = [];
        effects.forEach((eff) => {
            if (eff.type === 'score_boost') {
                game.activateScoreBoost(eff.duration || 30000);
                effectLabels.push('Score Boost');
            } else if (eff.type === 'slow_drop') {
                game.activateSlowDrop(eff.duration || 30000, eff.multiplier || 1.7);
                effectLabels.push('Slow Drop');
            } else if (eff.type === 'opponent_obfuscate') {
                effectLabels.push('Opponent Obfuscate');
            }
        });

        if (effectLabels.length > 0) {
            notify(`Cheat activated: ${effectLabels.join(' + ')}`, 'success');
        }

        startCheatTimer(msg.duration || 30000);
        if (msg.nextCheatCode) cheat.setSequence(msg.nextCheatCode);
        updateCheatUses(msg);
    }

    function _getSoloCheatSequence(activationCount, baseSeed) {
        const safeCount = Math.max(0, Math.floor(Number(activationCount) || 0));
        const pairs = 3 + Math.min(safeCount, SOLO_CHEAT_MAX_USES + 1);
        const pool = ['1','2','3','4','5','6','7','8','9'];
        const rng = _mulberry32((baseSeed >>> 0) + safeCount * 101);
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

    function _mulberry32(seedValue) {
        let s = seedValue >>> 0;
        return function () {
            s += 0x6d2b79f5;
            let t = Math.imul(s ^ (s >>> 15), 1 | s);
            t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    function _pickSoloCheatEffects() {
        return [
            { type: 'score_boost', duration: 30000 },
            { type: 'slow_drop', duration: 30000, multiplier: 1.7 },
        ];
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
