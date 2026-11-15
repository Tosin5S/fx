// 100% Live Cloud Market Data Engine (No simulated or generated candles):
// 1. Live Deriv WebSocket API (wss://ws.derivws.com/websockets/v3?app_id=1089) for Synthetics, FX, Metals & Indices
// 2. Live Binance Global Market Data API (wss://data-stream.binance.vision + https://data-api.binance.vision) for Crypto, Gold & FX
// 3. Server-side Yahoo Finance / Binance Cloud API (/api/candles) for Commodities, Forex & Global Stock Indices

window.MarketDataFeed = (function () {
  const GRANULARITY_MAP = {
    M1: 60,
    M5: 300,
    M15: 900,
    M30: 1800,
    H1: 3600,
    H4: 14400,
    D1: 86400
  };

  const BINANCE_TF_MAP = {
    M1: '1m',
    M5: '5m',
    M15: '15m',
    M30: '30m',
    H1: '1h',
    H4: '4h',
    D1: '1d'
  };

  const candleStore = new Map(); // key: `${symbolId}_${tf}` -> { candles: [], source: string, loading: boolean, error: string|null }
  let derivSocket = null;
  let derivConnected = false;
  let binanceSocket = null;
  let binanceConnected = false;
  let activeTimeframe = 'M15';
  let onTickCallback = null;
  let onStatusCallback = null;
  let reqIdCounter = 1;
  const reqMap = new Map();
  let derivReconnectTimer = null;

  function ensureSlot(symbolMeta, tf = activeTimeframe) {
    const key = `${symbolMeta.id}_${tf}`;
    if (!candleStore.has(key)) {
      candleStore.set(key, {
        candles: [],
        source: 'Connecting to Live Feed...',
        loading: true,
        error: null
      });
    }
    return candleStore.get(key);
  }

  function notifyStatus() {
    if (typeof onStatusCallback === 'function') {
      onStatusCallback({
        derivConnected,
        binanceConnected
      });
    }
  }

  function connectDerivWebSocket(symbols, tf) {
    try {
      if (derivReconnectTimer) {
        clearTimeout(derivReconnectTimer);
        derivReconnectTimer = null;
      }
      if (derivSocket && (derivSocket.readyState === WebSocket.OPEN || derivSocket.readyState === WebSocket.CONNECTING)) {
        derivSocket.onclose = null;
        derivSocket.close();
      }

      derivSocket = new WebSocket('wss://ws.derivws.com/websockets/v3?app_id=1089');

      derivSocket.onopen = () => {
        derivConnected = true;
        notifyStatus();
        subscribeDerivSymbols(symbols, tf);
      };

      derivSocket.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          const reqInfo = reqMap.get(msg.req_id);
          if (!reqInfo) return;

          const { symbolMeta, tf: reqTf } = reqInfo;
          const key = `${symbolMeta.id}_${reqTf}`;

          if (msg.error) {
            // If Deriv market is closed or symbol unavailable on Deriv, fall back to Yahoo/Binance live REST
            if (symbolMeta.yahooSymbol || symbolMeta.binanceSymbol) {
              fetchCloudRestCandles(symbolMeta, reqTf);
            } else {
              const slot = ensureSlot(symbolMeta, reqTf);
              slot.loading = false;
              slot.error = msg.error.message || 'Market closed';
            }
            return;
          }

          if (msg.candles && Array.isArray(msg.candles) && msg.candles.length >= 20) {
            const parsed = msg.candles.map(c => ({
              time: Number(c.epoch),
              open: Number(c.open),
              high: Number(c.high),
              low: Number(c.low),
              close: Number(c.close),
              volume: 1
            }));
            candleStore.set(key, {
              candles: parsed,
              source: 'Deriv MT5 WebSocket (Live)',
              loading: false,
              error: null
            });
            if (typeof onTickCallback === 'function') {
              onTickCallback(symbolMeta.id, reqTf);
            }
          } else if (msg.ohlc) {
            const o = msg.ohlc;
            const entry = ensureSlot(symbolMeta, reqTf);
            const list = entry.candles;
            const candleObj = {
              time: Number(o.open_time || o.epoch),
              open: Number(o.open),
              high: Number(o.high),
              low: Number(o.low),
              close: Number(o.close),
              volume: 1
            };
            if (list.length > 0 && list[list.length - 1].time === candleObj.time) {
              list[list.length - 1] = candleObj;
            } else {
              list.push(candleObj);
              if (list.length > 220) list.shift();
            }
            entry.source = 'Deriv MT5 WebSocket (Live)';
            entry.loading = false;
            entry.error = null;
            if (typeof onTickCallback === 'function') {
              onTickCallback(symbolMeta.id, reqTf);
            }
          }
        } catch (err) {
          // Ignore malformed frame
        }
      };

      derivSocket.onerror = () => {
        derivConnected = false;
        notifyStatus();
      };

      derivSocket.onclose = () => {
        derivConnected = false;
        notifyStatus();
        derivReconnectTimer = setTimeout(() => connectDerivWebSocket(symbols, activeTimeframe), 4000);
      };
    } catch (e) {
      derivConnected = false;
      notifyStatus();
    }
  }

  function subscribeDerivSymbols(symbols, tf) {
    if (!derivSocket || derivSocket.readyState !== WebSocket.OPEN) return;
    const granularity = GRANULARITY_MAP[tf] || 900;

    symbols.forEach((sym, index) => {
      if (!sym.derivSymbol) return;
      const reqId = reqIdCounter++;
      reqMap.set(reqId, { symbolMeta: sym, tf });
      setTimeout(() => {
        if (derivSocket && derivSocket.readyState === WebSocket.OPEN) {
          derivSocket.send(JSON.stringify({
            ticks_history: sym.derivSymbol,
            adjust_start_time: 1,
            count: 200,
            end: 'latest',
            granularity,
            style: 'candles',
            subscribe: 1,
            req_id: reqId
          }));
        }
      }, index * 60);
    });
  }

  function connectBinanceStream(symbols) {
    try {
      if (binanceSocket && (binanceSocket.readyState === WebSocket.OPEN || binanceSocket.readyState === WebSocket.CONNECTING)) {
        binanceSocket.onclose = null;
        binanceSocket.close();
      }
      const streams = symbols
        .filter(s => s.binanceSymbol)
        .map(s => `${s.binanceSymbol.toLowerCase()}@miniTicker`)
        .join('/');
      if (!streams) return;

      // Use data-stream.binance.vision which works globally (including US/Render servers)
      binanceSocket = new WebSocket(`wss://data-stream.binance.vision/stream?streams=${streams}`);
      binanceSocket.onopen = () => {
        binanceConnected = true;
        notifyStatus();
      };
      binanceSocket.onmessage = (evt) => {
        try {
          const payload = JSON.parse(evt.data);
          const d = payload?.data;
          if (!d || !d.s || !d.c) return;
          const sym = symbols.find(s => s.binanceSymbol === d.s);
          if (!sym) return;
          const closePrice = parseFloat(d.c);
          if (!isFinite(closePrice)) return;

          const entry = ensureSlot(sym, activeTimeframe);
          const list = entry.candles;
          if (list.length > 0) {
            const last = list[list.length - 1];
            last.close = Number(closePrice.toFixed(sym.digits));
            if (last.close > last.high) last.high = last.close;
            if (last.close < last.low) last.low = last.close;
            entry.source = 'Binance Live WebSocket';
            if (typeof onTickCallback === 'function') {
              onTickCallback(sym.id, activeTimeframe);
            }
          }
        } catch (e) {}
      };
      binanceSocket.onerror = () => {
        binanceConnected = false;
        notifyStatus();
      };
      binanceSocket.onclose = () => {
        binanceConnected = false;
        notifyStatus();
      };
    } catch (e) {
      binanceConnected = false;
      notifyStatus();
    }
  }

  async function fetchDirectBinanceBrowser(symbolMeta, tf) {
    if (!symbolMeta.binanceSymbol) return false;
    try {
      const interval = BINANCE_TF_MAP[tf] || '15m';
      const url = `https://data-api.binance.vision/api/v3/klines?symbol=${encodeURIComponent(symbolMeta.binanceSymbol)}&interval=${interval}&limit=200`;
      const res = await fetch(url);
      if (!res.ok) return false;
      const rows = await res.json();
      if (!Array.isArray(rows) || rows.length < 20) return false;
      const candles = rows.map(r => ({
        time: Math.floor(Number(r[0]) / 1000),
        open: parseFloat(r[1]),
        high: parseFloat(r[2]),
        low: parseFloat(r[3]),
        close: parseFloat(r[4]),
        volume: parseFloat(r[5])
      }));
      candleStore.set(`${symbolMeta.id}_${tf}`, {
        candles,
        source: 'Binance Spot API (Live)',
        loading: false,
        error: null
      });
      if (typeof onTickCallback === 'function') {
        onTickCallback(symbolMeta.id, tf);
      }
      return true;
    } catch (e) {
      return false;
    }
  }

  async function fetchCloudRestCandles(symbolMeta, tf) {
    if (symbolMeta.binanceSymbol) {
      const ok = await fetchDirectBinanceBrowser(symbolMeta, tf);
      if (ok) return;
    }
    if (!symbolMeta.yahooSymbol && !symbolMeta.binanceSymbol) return;
    try {
      const params = new URLSearchParams({ tf });
      if (symbolMeta.binanceSymbol) params.set('binance', symbolMeta.binanceSymbol);
      if (symbolMeta.yahooSymbol) params.set('yahoo', symbolMeta.yahooSymbol);
      const res = await fetch(`/api/candles?${params.toString()}`);
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data.candles) && data.candles.length >= 20) {
        const key = `${symbolMeta.id}_${tf}`;
        candleStore.set(key, {
          candles: data.candles,
          source: data.source || 'Yahoo Finance Live API',
          loading: false,
          error: null
        });
        if (typeof onTickCallback === 'function') {
          onTickCallback(symbolMeta.id, tf);
        }
      }
    } catch (e) {
      // Keep waiting for live feed
    }
  }

  function startRestPollLoop(symbols) {
    // Refresh REST-backed symbols (e.g. Yahoo Finance commodities/indices) every 30 seconds with real market data
    setInterval(() => {
      symbols.forEach((sym, idx) => {
        if (!sym.derivSymbol && (sym.yahooSymbol || sym.binanceSymbol)) {
          setTimeout(() => fetchCloudRestCandles(sym, activeTimeframe), idx * 150);
        }
      });
    }, 30000);
  }

  function init(symbols, initialTf, tickCb, statusCb) {
    activeTimeframe = initialTf || 'M15';
    onTickCallback = tickCb;
    onStatusCallback = statusCb;

    symbols.forEach(sym => ensureSlot(sym, activeTimeframe));

    // Connect live WebSockets
    connectDerivWebSocket(symbols, activeTimeframe);
    connectBinanceStream(symbols);

    // Hydrate Binance & Yahoo Finance REST candles immediately in parallel
    symbols.forEach((sym, idx) => {
      if (sym.binanceSymbol || sym.yahooSymbol) {
        setTimeout(() => fetchCloudRestCandles(sym, activeTimeframe), idx * 80);
      }
    });

    startRestPollLoop(symbols);
  }

  function setTimeframe(symbols, newTf) {
    activeTimeframe = newTf;
    symbols.forEach(sym => ensureSlot(sym, newTf));
    connectDerivWebSocket(symbols, newTf);
    symbols.forEach((sym, idx) => {
      if (sym.binanceSymbol || sym.yahooSymbol) {
        setTimeout(() => fetchCloudRestCandles(sym, newTf), idx * 80);
      }
    });
  }

  function getSymbolData(symbolMeta, tf = activeTimeframe) {
    return ensureSlot(symbolMeta, tf);
  }

  return {
    init,
    setTimeframe,
    getSymbolData,
    fetchCloudRestCandles
  };
})();
