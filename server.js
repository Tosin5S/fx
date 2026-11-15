const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

// Map timeframe to Yahoo Finance interval & range
const YAHOO_TF_MAP = {
  M1: { interval: '1m', range: '1d' },
  M5: { interval: '5m', range: '5d' },
  M15: { interval: '15m', range: '5d' },
  M30: { interval: '30m', range: '1mo' },
  H1: { interval: '60m', range: '1mo' },
  H4: { interval: '60m', range: '3mo' },
  D1: { interval: '1d', range: '1y' }
};

// Map timeframe to Binance interval
const BINANCE_TF_MAP = {
  M1: '1m',
  M5: '5m',
  M15: '15m',
  M30: '30m',
  H1: '1h',
  H4: '4h',
  D1: '1d'
};

async function fetchWithTimeout(url, options = {}, timeoutMs = 4500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) MT5OmniSignal/1.0',
        ...(options.headers || {})
      }
    });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchBinanceCandles(binanceSymbol, tf = 'M15', limit = 220) {
  const interval = BINANCE_TF_MAP[tf] || '15m';
  const endpoints = [
    `https://data-api.binance.vision/api/v3/klines?symbol=${encodeURIComponent(binanceSymbol)}&interval=${interval}&limit=${limit}`,
    `https://api.binance.com/api/v3/klines?symbol=${encodeURIComponent(binanceSymbol)}&interval=${interval}&limit=${limit}`
  ];
  let lastErr = null;
  for (const url of endpoints) {
    try {
      const res = await fetchWithTimeout(url);
      if (!res.ok) throw new Error(`Binance HTTP ${res.status}`);
      const rows = await res.json();
      if (!Array.isArray(rows) || rows.length < 20) throw new Error('Insufficient Binance klines');
      return rows.map(r => ({
        time: Math.floor(Number(r[0]) / 1000),
        open: parseFloat(r[1]),
        high: parseFloat(r[2]),
        low: parseFloat(r[3]),
        close: parseFloat(r[4]),
        volume: parseFloat(r[5])
      }));
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('Binance fetch failed');
}

async function fetchYahooCandles(yahooSymbol, tf = 'M15') {
  const cfg = YAHOO_TF_MAP[tf] || YAHOO_TF_MAP.M15;
  const hosts = ['query1.finance.yahoo.com', 'query2.finance.yahoo.com'];
  let result = null;
  let lastErr = null;
  for (const host of hosts) {
    try {
      const url = `https://${host}/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?interval=${cfg.interval}&range=${cfg.range}`;
      const res = await fetchWithTimeout(url);
      if (!res.ok) throw new Error(`Yahoo HTTP ${res.status}`);
      const data = await res.json();
      result = data?.chart?.result?.[0];
      if (result && Array.isArray(result.timestamp)) break;
    } catch (e) {
      lastErr = e;
    }
  }
  if (!result || !Array.isArray(result.timestamp)) {
    throw lastErr || new Error('Invalid Yahoo chart payload');
  }
  const timestamps = result.timestamp;
  const quote = result.indicators?.quote?.[0] || {};
  const candles = [];
  for (let i = 0; i < timestamps.length; i++) {
    const o = quote.open?.[i];
    const h = quote.high?.[i];
    const l = quote.low?.[i];
    const c = quote.close?.[i];
    if (o != null && h != null && l != null && c != null) {
      candles.push({
        time: timestamps[i],
        open: Number(o),
        high: Number(h),
        low: Number(l),
        close: Number(c),
        volume: Number(quote.volume?.[i] || 0)
      });
    }
  }

  // Aggregate 60m into 4h when H4 is requested
  if (tf === 'H4' && candles.length >= 20) {
    const h4 = [];
    for (let i = 0; i < candles.length; i += 4) {
      const slice = candles.slice(i, i + 4);
      if (slice.length === 0) continue;
      h4.push({
        time: slice[0].time,
        open: slice[0].open,
        high: Math.max(...slice.map(x => x.high)),
        low: Math.min(...slice.map(x => x.low)),
        close: slice[slice.length - 1].close,
        volume: slice.reduce((a, b) => a + b.volume, 0)
      });
    }
    return h4.slice(-220);
  }

  if (candles.length < 20) throw new Error('Insufficient Yahoo candles');
  return candles.slice(-220);
}

const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;

  // CORS headers for local dev flexibility
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (pathname === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      status: 'ok',
      service: 'MT5 OmniSignal Cloud Engine',
      timestamp: new Date().toISOString()
    }));
    return;
  }

  if (pathname === '/api/candles') {
    const yahooSymbol = parsedUrl.searchParams.get('yahoo');
    const binanceSymbol = parsedUrl.searchParams.get('binance');
    const tf = parsedUrl.searchParams.get('tf') || 'M15';

    try {
      if (binanceSymbol) {
        try {
          const candles = await fetchBinanceCandles(binanceSymbol, tf);
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ source: 'Binance Spot/Perp API', candles }));
          return;
        } catch (err) {
          // Fall through to Yahoo if available
        }
      }
      if (yahooSymbol) {
        const candles = await fetchYahooCandles(yahooSymbol, tf);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ source: 'Yahoo Finance Cloud API', candles }));
        return;
      }
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'No upstream symbol specified' }));
    } catch (error) {
      res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: error.message || 'Upstream fetch failed' }));
    }
    return;
  }

  // Serve static files from /public
  let filePath = pathname === '/' ? '/index.html' : pathname;
  const resolvedPath = path.normalize(path.join(PUBLIC_DIR, filePath));

  if (!resolvedPath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(resolvedPath, (err, content) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Not Found');
      } else {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Internal Server Error');
      }
      return;
    }
    const ext = path.extname(resolvedPath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
    res.end(content);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`MT5 OmniSignal WebApp running on port ${PORT}`);
});
