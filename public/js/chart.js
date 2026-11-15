// High-DPI Interactive MT5 Candlestick + Entry/Exit Levels + Oscillator Chart Engine
window.SignalChart = (function () {
  let mainCanvas = null;
  let subCanvas = null;
  let hoverIndex = null;
  let currentSymbol = null;
  let currentCandles = [];
  let currentSignal = null;
  let subMode = 'RSI'; // 'RSI' or 'MACD'
  let visibleCount = 90;
  let showEMA = true;
  let showBB = true;
  let showLevels = true;

  function init(mainCanvasEl, subCanvasEl) {
    mainCanvas = mainCanvasEl;
    subCanvas = subCanvasEl;

    const handleMove = (e) => {
      if (!mainCanvas || currentCandles.length === 0) return;
      const rect = mainCanvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const padLeft = 14;
      const padRight = 108;
      const plotW = Math.max(10, rect.width - padLeft - padRight);
      const slice = currentCandles.slice(-visibleCount);
      if (x < padLeft || x > rect.width - padRight) {
        hoverIndex = null;
      } else {
        const idx = Math.floor(((x - padLeft) / plotW) * slice.length);
        hoverIndex = Math.max(0, Math.min(slice.length - 1, idx));
      }
      draw();
    };

    mainCanvas.addEventListener('mousemove', handleMove);
    mainCanvas.addEventListener('mouseleave', () => {
      hoverIndex = null;
      draw();
    });

    mainCanvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (e.deltaY < 0) {
        visibleCount = Math.max(35, visibleCount - 10);
      } else {
        visibleCount = Math.min(180, visibleCount + 10);
      }
      draw();
    }, { passive: false });

    window.addEventListener('resize', () => draw());
  }

  function setOptions(opts = {}) {
    if (typeof opts.subMode === 'string') subMode = opts.subMode;
    if (typeof opts.showEMA === 'boolean') showEMA = opts.showEMA;
    if (typeof opts.showBB === 'boolean') showBB = opts.showBB;
    if (typeof opts.showLevels === 'boolean') showLevels = opts.showLevels;
    draw();
  }

  function render(symbolMeta, candles, signal) {
    currentSymbol = symbolMeta;
    currentCandles = candles || [];
    currentSignal = signal;
    draw();
  }

  function drawHorizontalLevel(ctx, y, width, padLeft, padRight, color, label, priceText, dashed = true) {
    if (y < 8 || y > ctx.canvas.clientHeight - 8) return;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.25;
    if (dashed) ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(padLeft, y);
    ctx.lineTo(width - padRight, y);
    ctx.stroke();
    ctx.setLineDash([]);

    // Right price pill
    const pillX = width - padRight + 2;
    const pillW = padRight - 4;
    const pillH = 18;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(pillX, y - pillH / 2, pillW, pillH, 4);
    ctx.fill();

    ctx.fillStyle = '#070b14';
    ctx.font = 'bold 10px "JetBrains Mono", Consolas, monospace';
    ctx.textAlign = 'left';
    ctx.fillText(priceText, pillX + 5, y + 3.5);

    // Inline tag on right side of plot
    ctx.font = '600 10px Inter, system-ui, sans-serif';
    const tagW = ctx.measureText(label).width + 12;
    ctx.fillStyle = 'rgba(10, 15, 28, 0.88)';
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(width - padRight - tagW - 8, y - 9, tagW, 17, 3);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = color;
    ctx.fillText(label, width - padRight - tagW - 2, y + 3);
    ctx.restore();
  }

  function draw() {
    if (!mainCanvas || !currentSymbol || !currentSignal || currentCandles.length < 10) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = mainCanvas.getBoundingClientRect();
    const width = rect.width || 720;
    const height = rect.height || 340;
    mainCanvas.width = width * dpr;
    mainCanvas.height = height * dpr;

    const ctx = mainCanvas.getContext('2d');
    ctx.scale(dpr, dpr);

    // Background
    ctx.fillStyle = '#0b101e';
    ctx.fillRect(0, 0, width, height);

    const padLeft = 14;
    const padRight = 108;
    const padTop = 26;
    const padBottom = 24;
    const plotW = Math.max(50, width - padLeft - padRight);
    const plotH = Math.max(50, height - padTop - padBottom);

    const totalLen = currentCandles.length;
    const startIdx = Math.max(0, totalLen - visibleCount);
    const slice = currentCandles.slice(startIdx);
    const count = slice.length;

    // Determine Y range including visible candles AND Entry/SL/TP1/TP2 levels if enabled
    let minPrice = Infinity;
    let maxPrice = -Infinity;
    for (let i = 0; i < count; i++) {
      const c = slice[i];
      if (c.low < minPrice) minPrice = c.low;
      if (c.high > maxPrice) maxPrice = c.high;
      if (showBB) {
        const bbu = currentSignal.series.bbUpper[startIdx + i];
        const bbl = currentSignal.series.bbLower[startIdx + i];
        if (bbu != null && bbu > maxPrice) maxPrice = bbu;
        if (bbl != null && bbl < minPrice) minPrice = bbl;
      }
    }

    if (showLevels) {
      const lvls = [currentSignal.entryPrice, currentSignal.stopLoss, currentSignal.tp1, currentSignal.tp2];
      for (const lv of lvls) {
        if (lv < minPrice) minPrice = lv;
        if (lv > maxPrice) maxPrice = lv;
      }
    }

    const span = Math.max(currentSymbol.pipSize * 10, maxPrice - minPrice);
    minPrice -= span * 0.06;
    maxPrice += span * 0.06;
    const priceRange = maxPrice - minPrice;

    const yForPrice = (p) => padTop + ((maxPrice - p) / priceRange) * plotH;
    const xForIdx = (i) => padLeft + ((i + 0.5) / count) * plotW;

    // Horizontal & Vertical Grid Lines
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.08)';
    ctx.lineWidth = 1;
    const gridRows = 6;
    ctx.font = '10px "JetBrains Mono", Consolas, monospace';
    ctx.fillStyle = '#64748b';
    for (let r = 0; r <= gridRows; r++) {
      const y = padTop + (r / gridRows) * plotH;
      const pVal = maxPrice - (r / gridRows) * priceRange;
      ctx.beginPath();
      ctx.moveTo(padLeft, y);
      ctx.lineTo(width - padRight, y);
      ctx.stroke();
      ctx.fillText(pVal.toFixed(currentSymbol.digits), width - padRight + 6, y + 3);
    }

    const stepV = Math.max(1, Math.floor(count / 6));
    for (let i = 0; i < count; i += stepV) {
      const x = xForIdx(i);
      ctx.beginPath();
      ctx.moveTo(x, padTop);
      ctx.lineTo(x, height - padBottom);
      ctx.stroke();

      const dt = new Date(slice[i].time * 1000);
      const timeLabel = `${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`;
      ctx.fillStyle = '#64748b';
      ctx.fillText(timeLabel, x - 14, height - 7);
    }

    // Draw Bollinger Bands channel if enabled
    if (showBB) {
      ctx.save();
      ctx.beginPath();
      let started = false;
      for (let i = 0; i < count; i++) {
        const u = currentSignal.series.bbUpper[startIdx + i];
        if (u == null) continue;
        const x = xForIdx(i);
        const y = yForPrice(u);
        if (!started) {
          ctx.moveTo(x, y);
          started = true;
        } else {
          ctx.lineTo(x, y);
        }
      }
      for (let i = count - 1; i >= 0; i--) {
        const l = currentSignal.series.bbLower[startIdx + i];
        if (l == null) continue;
        ctx.lineTo(xForIdx(i), yForPrice(l));
      }
      ctx.closePath();
      ctx.fillStyle = 'rgba(56, 189, 248, 0.05)';
      ctx.fill();

      // Upper & Lower BB strokes
      ['bbUpper', 'bbLower'].forEach(key => {
        ctx.beginPath();
        ctx.strokeStyle = 'rgba(56, 189, 248, 0.28)';
        ctx.lineWidth = 1;
        let s = false;
        for (let i = 0; i < count; i++) {
          const val = currentSignal.series[key][startIdx + i];
          if (val == null) continue;
          const x = xForIdx(i);
          const y = yForPrice(val);
          if (!s) {
            ctx.moveTo(x, y);
            s = true;
          } else {
            ctx.lineTo(x, y);
          }
        }
        ctx.stroke();
      });
      ctx.restore();
    }

    // Draw EMA 21, EMA 50, EMA 200
    if (showEMA) {
      const emaConfigs = [
        { key: 'ema21', color: '#f59e0b', width: 1.5 },
        { key: 'ema50', color: '#38bdf8', width: 1.5 },
        { key: 'ema200', color: '#a855f7', width: 1.8 }
      ];
      emaConfigs.forEach(cfg => {
        ctx.beginPath();
        ctx.strokeStyle = cfg.color;
        ctx.lineWidth = cfg.width;
        let s = false;
        for (let i = 0; i < count; i++) {
          const val = currentSignal.series[cfg.key][startIdx + i];
          if (val == null) continue;
          const x = xForIdx(i);
          const y = yForPrice(val);
          if (!s) {
            ctx.moveTo(x, y);
            s = true;
          } else {
            ctx.lineTo(x, y);
          }
        }
        ctx.stroke();
      });
    }

    // Draw Candlesticks
    const candleW = Math.max(2.5, Math.min(11, (plotW / count) * 0.68));
    for (let i = 0; i < count; i++) {
      const c = slice[i];
      const x = xForIdx(i);
      const isBull = c.close >= c.open;
      const color = isBull ? '#10b981' : '#f43f5e';

      ctx.strokeStyle = color;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(x, yForPrice(c.high));
      ctx.lineTo(x, yForPrice(c.low));
      ctx.stroke();

      const yOpen = yForPrice(c.open);
      const yClose = yForPrice(c.close);
      const top = Math.min(yOpen, yClose);
      const bodyH = Math.max(1.5, Math.abs(yClose - yOpen));
      ctx.fillStyle = color;
      ctx.fillRect(x - candleW / 2, top, candleW, bodyH);
    }

    // Draw Entry, Stop Loss, TP1, TP2, TP3 Signal Lines
    if (showLevels) {
      const d = currentSymbol.digits;
      drawHorizontalLevel(
        ctx,
        yForPrice(currentSignal.tp3),
        width,
        padLeft,
        padRight,
        '#34d399',
        `EXIT TP3 (1:4.0 R:R | +${currentSignal.tp3Pips} pts)`,
        currentSignal.tp3.toFixed(d)
      );
      drawHorizontalLevel(
        ctx,
        yForPrice(currentSignal.tp2),
        width,
        padLeft,
        padRight,
        '#10b981',
        `EXIT TP2 (1:2.5 R:R | +${currentSignal.tp2Pips} pts)`,
        currentSignal.tp2.toFixed(d)
      );
      drawHorizontalLevel(
        ctx,
        yForPrice(currentSignal.tp1),
        width,
        padLeft,
        padRight,
        '#2dd4bf',
        `EXIT TP1 (1:1.5 R:R | +${currentSignal.tp1Pips} pts)`,
        currentSignal.tp1.toFixed(d)
      );
      drawHorizontalLevel(
        ctx,
        yForPrice(currentSignal.entryPrice),
        width,
        padLeft,
        padRight,
        '#38bdf8',
        `${currentSignal.side} ENTRY ZONE`,
        currentSignal.entryPrice.toFixed(d),
        false
      );
      drawHorizontalLevel(
        ctx,
        yForPrice(currentSignal.stopLoss),
        width,
        padLeft,
        padRight,
        '#f43f5e',
        `EXIT SL (1.5x ATR | -${currentSignal.slPips} pts)`,
        currentSignal.stopLoss.toFixed(d)
      );
    }

    // Top-left Legend + Hover OHLC Inspector
    const inspectIdx = hoverIndex != null ? hoverIndex : count - 1;
    const hovered = slice[inspectIdx] || slice[count - 1];
    ctx.font = '600 11px "JetBrains Mono", Consolas, monospace';
    ctx.fillStyle = '#e2e8f0';
    const ohlcStr = `${currentSymbol.id} [${currentSignal.timeframe}]  O:${hovered.open.toFixed(currentSymbol.digits)}  H:${hovered.high.toFixed(currentSymbol.digits)}  L:${hovered.low.toFixed(currentSymbol.digits)}  C:${hovered.close.toFixed(currentSymbol.digits)}`;
    ctx.fillText(ohlcStr, padLeft + 4, 17);

    if (hoverIndex != null) {
      const hx = xForIdx(hoverIndex);
      ctx.save();
      ctx.strokeStyle = 'rgba(226, 232, 240, 0.35)';
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(hx, padTop);
      ctx.lineTo(hx, height - padBottom);
      ctx.stroke();
      ctx.restore();
    }

    drawSubChart(startIdx, count, padLeft, padRight, plotW);
  }

  function drawSubChart(startIdx, count, padLeft, padRight, plotW) {
    if (!subCanvas || !currentSignal) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = subCanvas.getBoundingClientRect();
    const width = rect.width || 720;
    const height = rect.height || 110;
    subCanvas.width = width * dpr;
    subCanvas.height = height * dpr;

    const ctx = subCanvas.getContext('2d');
    ctx.scale(dpr, dpr);

    ctx.fillStyle = '#090d19';
    ctx.fillRect(0, 0, width, height);

    const padTop = 18;
    const padBottom = 12;
    const plotH = Math.max(30, height - padTop - padBottom);
    const xForIdx = (i) => padLeft + ((i + 0.5) / count) * plotW;

    if (subMode === 'RSI') {
      const yForRsi = (r) => padTop + ((100 - r) / 100) * plotH;

      // Overbought 70 / Mid 50 / Oversold 30 guides
      [
        { lvl: 70, color: 'rgba(244, 63, 94, 0.35)' },
        { lvl: 50, color: 'rgba(148, 163, 184, 0.2)' },
        { lvl: 30, color: 'rgba(16, 185, 129, 0.35)' }
      ].forEach(g => {
        const y = yForRsi(g.lvl);
        ctx.strokeStyle = g.color;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(padLeft, y);
        ctx.lineTo(width - padRight, y);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = '#64748b';
        ctx.font = '10px "JetBrains Mono", monospace';
        ctx.fillText(String(g.lvl), width - padRight + 6, y + 3);
      });

      ctx.beginPath();
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 1.6;
      for (let i = 0; i < count; i++) {
        const rVal = currentSignal.series.rsi[startIdx + i] ?? 50;
        const x = xForIdx(i);
        const y = yForRsi(rVal);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      ctx.fillStyle = '#94a3b8';
      ctx.font = '600 10px "JetBrains Mono", monospace';
      ctx.fillText(`RSI (14): ${currentSignal.rsi.toFixed(1)}`, padLeft + 4, 13);
    } else {
      // MACD (12, 26, 9) sub-pane
      const macdSlice = currentSignal.series.macdLine.slice(startIdx, startIdx + count);
      const sigSlice = currentSignal.series.signalLine.slice(startIdx, startIdx + count);
      const histSlice = currentSignal.series.histogram.slice(startIdx, startIdx + count);

      let maxAbs = 0.00001;
      for (let i = 0; i < count; i++) {
        maxAbs = Math.max(
          maxAbs,
          Math.abs(macdSlice[i] || 0),
          Math.abs(sigSlice[i] || 0),
          Math.abs(histSlice[i] || 0)
        );
      }
      const midY = padTop + plotH / 2;
      const yForVal = (v) => midY - (v / (maxAbs * 1.15)) * (plotH / 2);

      // Zero line
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.22)';
      ctx.beginPath();
      ctx.moveTo(padLeft, midY);
      ctx.lineTo(width - padRight, midY);
      ctx.stroke();

      // Histogram bars
      const barW = Math.max(2, (plotW / count) * 0.58);
      for (let i = 0; i < count; i++) {
        const h = histSlice[i] || 0;
        const x = xForIdx(i);
        const y = yForVal(h);
        ctx.fillStyle = h >= 0 ? 'rgba(16, 185, 129, 0.65)' : 'rgba(244, 63, 94, 0.65)';
        ctx.fillRect(x - barW / 2, Math.min(midY, y), barW, Math.max(1, Math.abs(y - midY)));
      }

      // MACD & Signal lines
      ctx.beginPath();
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 1.4;
      for (let i = 0; i < count; i++) {
        const x = xForIdx(i);
        const y = yForVal(macdSlice[i] || 0);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      ctx.beginPath();
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 1.4;
      for (let i = 0; i < count; i++) {
        const x = xForIdx(i);
        const y = yForVal(sigSlice[i] || 0);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      ctx.fillStyle = '#94a3b8';
      ctx.font = '600 10px "JetBrains Mono", monospace';
      ctx.fillText(
        `MACD(12,26,9) Hist: ${currentSignal.macdHist.toFixed(currentSymbol.digits)}`,
        padLeft + 4,
        13
      );
    }
  }

  return {
    init,
    render,
    setOptions
  };
})();
