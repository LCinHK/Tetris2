/**
 * network.js – Shared WebSocket client
 * Connects to the server and exposes a simple message bus.
 * Loaded on every page; individual page scripts add handlers via Network.on().
 */
(function () {
  'use strict';

  const Network = {
    ws: null,
    _handlers: {},
    clientId: null,
    playerName: localStorage.getItem('playerName') || '',

    connect() {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      this.ws = new WebSocket(`${proto}://${location.host}`);

      this.ws.addEventListener('open', () => {
        // Restore player name
        if (this.playerName) {
          this.send({ type: 'set_name', name: this.playerName });
        }
        this._emit('open');
      });

      this.ws.addEventListener('message', (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          if (msg.type === 'connected') {
            this.clientId = msg.clientId;
            if (!this.playerName) this.playerName = msg.playerName;
          }
          this._emit(msg.type, msg);
          this._emit('*', msg);
        } catch (_) { /* ignore */ }
      });

      this.ws.addEventListener('close', () => { this._emit('close'); });
      this.ws.addEventListener('error', () => { this._emit('error'); });
    },

    send(obj) {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify(obj));
      }
    },

    on(type, fn) {
      if (!this._handlers[type]) this._handlers[type] = [];
      this._handlers[type].push(fn);
    },

    off(type, fn) {
      if (!this._handlers[type]) return;
      this._handlers[type] = this._handlers[type].filter(h => h !== fn);
    },

    _emit(type, data) {
      const hs = this._handlers[type];
      if (hs) hs.forEach(h => h(data));
    },
  };

  window.Network = Network;
  Network.connect();
})();
