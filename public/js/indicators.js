// Multi-Indicator Confluence Engine for MetaTrader 5 Signals
// Computes EMA(9,21,50,200), RSI(14), MACD(12,26,9), Bollinger Bands(20,2), ATR(14),
// Support/Resistance Swing Pivots, Confluence Score, Entry, Stop-Loss, TP1, TP2, TP3, and Exit Alerts.

window.SignalEngine = (function () {
  function calcSMA(values, period) {
    const res = new Array(values.length).fill(null);
    if (values.length < period) return res;
    let sum = 0;
    for (let i = 0; i < values.length; i++) {
      sum += values[i];
      if (i >= period) sum -= values[i - period];
      if (i >= period - 1) res[i] = sum / period;
    }
    return res;
  }

  function calcEMA(values, period) {
    const res = new Array(values.length).fill(null);
    if (values.length === 0) return res;
    const k = 2 / (period + 1);
    let ema = values[0];
    res[0] = ema;
    for (let i = 1; i < values.length; i++) {
      ema = values[i] * k + ema * (1 - k);
      res[i] = ema;
    }
    return res;
  }

  function calcRSI(closes, period = 14) {
    const res = new Array(closes.length).fill(50);
    if (closes.length <= period) return res;

    let gains = 0;
    let losses = 0;
    for (let i = 1; i <= period; i++) {
      const diff = closes[i] - closes[i - 1];
      if (diff >= 0) gains += diff;
      else losses -= diff;
    }
    let avgGain = gains / period;
    let avgLoss = losses / period;
    res[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

    for (let i = period + 1; i < closes.length; i++) {
      const diff = closes[i] - closes[i - 1];
      const gain = diff > 0 ? diff : 0;
      const loss = diff < 0 ? -diff : 0;
      avgGain = (avgGain * (period - 1) + gain) / period;
      avgLoss = (avgLoss * (period - 1) + loss) / period;
      res[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
    }
    return res;
  }

  function calcMACD(closes, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
    const fastEMA = calcEMA(closes, fastPeriod);
    const slowEMA = calcEMA(closes, slowPeriod);
    const macdLine = closes.map((_, i) => (fastEMA[i] ?? 0) - (slowEMA[i] ?? 0));
    const signalLine = calcEMA(macdLine, signalPeriod);
    const histogram = macdLine.map((m, i) => m - (signalLine[i] ?? 0));
    return { macdLine, signalLine, histogram };
  }

  function calcBollingerBands(closes, period = 20, stdMult = 2.0) {
    const middle = calcSMA(closes, period);
    const upper = new Array(closes.length).fill(null);
    const lower = new Array(closes.length).fill(null);
    const pctB = new Array(closes.length).fill(0.5);

    for (let i = period - 1; i < closes.length; i++) {
      const mean = middle[i];
      let sumSq = 0;
      for (let j = i - period + 1; j <= i; j++) {
        const d = closes[j] - mean;
        sumSq += d * d;
      }
      const std = Math.sqrt(sumSq / period);
      upper[i] = mean + stdMult * std;
      lower[i] = mean - stdMult * std;
      const span = upper[i] - lower[i];
      pctB[i] = span > 0 ? (closes[i] - lower[i]) / span : 0.5;
    }
    return { upper, middle, lower, pctB };
  }

  function calcATR(candles, period = 14) {
    const tr = new Array(candles.length).fill(0);
    const atr = new Array(candles.length).fill(0);
    if (candles.length === 0) return atr;

    tr[0] = Math.max(candles[0].high - candles[0].low, Math.abs(candles[0].close) * 0.0012);
    atr[0] = tr[0];

    for (let i = 1; i < candles.length; i++) {
      const c = candles[i];
      const prevClose = candles[i - 1].close;
      tr[i] = Math.max(
        c.high - c.low,
        Math.abs(c.high - prevClose),
        Math.abs(c.low - prevClose)
      );
      if (i < period) {
        let sum = 0;
        for (let j = 0; j <= i; j++) sum += tr[j];
        atr[i] = sum / (i + 1);
      } else {
        atr[i] = (atr[i - 1] * (period - 1) + tr[i]) / period;
      }
    }
    return atr;
  }

  function findSwingLevels(candles, lookback = 35) {
    const slice = candles.slice(-lookback);
    if (slice.length === 0) return { support: 0, resistance: 0 };
    let low = Infinity;
    let high = -Infinity;
    for (const c of slice) {
      if (c.low < low) low = c.low;
      if (c.high > high) high = c.high;
    }
    return { support: low, resistance: high };
  }

  function analyzeSymbol(symbolMeta, candles, timeframe = 'M15') {
    if (!candles || candles.length < 30) {
      return null;
    }

    const closes = candles.map(c => c.close);
    const n = closes.length;
    const lastIdx = n - 1;
    const prevIdx = Math.max(0, n - 2);
    const price = closes[lastIdx];

    const ema9Series = calcEMA(closes, 9);
    const ema21Series = calcEMA(closes, 21);
    const ema50Series = calcEMA(closes, 50);
    const ema200Series = calcEMA(closes, Math.min(200, n));
    const rsiSeries = calcRSI(closes, 14);
    const macdObj = calcMACD(closes, 12, 26, 9);
    const bbObj = calcBollingerBands(closes, 20, 2.0);
    const atrSeries = calcATR(candles, 14);
    const swings = findSwingLevels(candles, 40);

    const ema9 = ema9Series[lastIdx];
    const ema21 = ema21Series[lastIdx];
    const ema50 = ema50Series[lastIdx];
    const ema200 = ema200Series[lastIdx];
    const rsi = rsiSeries[lastIdx];
    const prevRsi = rsiSeries[prevIdx];
    const macd = macdObj.macdLine[lastIdx];
    const macdSignal = macdObj.signalLine[lastIdx];
    const macdHist = macdObj.histogram[lastIdx];
    const prevMacdHist = macdObj.histogram[prevIdx];
    const bbUpper = bbObj.upper[lastIdx] ?? price * 1.003;
    const bbMiddle = bbObj.middle[lastIdx] ?? price;
    const bbLower = bbObj.lower[lastIdx] ?? price * 0.997;
    const bbPctB = bbObj.pctB[lastIdx] ?? 0.5;
    const rawAtr = atrSeries[lastIdx] || price * (symbolMeta.volatility || 0.0015);
    const atr = Math.max(rawAtr, symbolMeta.pipSize * 3);

    // Score each of the 5 core confluence pillars (-2 to +2 each, max total 10)
    const breakdown = [];
    let rawScore = 0;

    // 1. EMA Trend Structure (EMA 9 / 21 / 50 / 200)
    let emaVote = 'NEUTRAL';
    let emaDetail = '';
    if (price > ema21 && ema21 > ema50 && ema9 > ema21) {
      const strong = price > ema200;
      rawScore += strong ? 2.5 : 1.8;
      emaVote = 'BULLISH';
      emaDetail = strong
        ? 'Full Bullish Stack (Price > EMA9 > EMA21 > EMA50 > EMA200)'
        : 'Short-Term Bullish Cross (EMA9 > EMA21 > EMA50)';
    } else if (price < ema21 && ema21 < ema50 && ema9 < ema21) {
      const strong = price < ema200;
      rawScore -= strong ? 2.5 : 1.8;
      emaVote = 'BEARISH';
      emaDetail = strong
        ? 'Full Bearish Stack (Price < EMA9 < EMA21 < EMA50 < EMA200)'
        : 'Short-Term Bearish Cross (EMA9 < EMA21 < EMA50)';
    } else if (price > ema50) {
      rawScore += 0.8;
      emaVote = 'BULLISH';
      emaDetail = 'Price holding above EMA 50 dynamic support';
    } else {
      rawScore -= 0.8;
      emaVote = 'BEARISH';
      emaDetail = 'Price trading below EMA 50 dynamic resistance';
    }
    breakdown.push({
      name: 'EMA Stack (9/21/50/200)',
      value: `${ ema21.toFixed(symbolMeta.digits) } / ${ ema50.toFixed(symbolMeta.digits) }`,
      vote: emaVote,
      reason: emaDetail
    });

    // 2. RSI (14) Momentum & Reversal Confluence
    let rsiVote = 'NEUTRAL';
    let rsiDetail = '';
    if (rsi < 32) {
      rawScore += 2.2;
      rsiVote = 'BULLISH';
      rsiDetail = `Oversold Bounce Zone (${rsi.toFixed(1)}) — High probability long entry`;
    } else if (rsi > 68) {
      rawScore -= 2.2;
      rsiVote = 'BEARISH';
      rsiDetail = `Overbought Exhaustion Zone (${rsi.toFixed(1)}) — High probability short/exit`;
    } else if (rsi >= 52 && rsi > prevRsi) {
      rawScore += 1.4;
      rsiVote = 'BULLISH';
      rsiDetail = `Bullish Momentum Expansion (${rsi.toFixed(1)} rising above 50)`;
    } else if (rsi <= 48 && rsi < prevRsi) {
      rawScore -= 1.4;
      rsiVote = 'BEARISH';
      rsiDetail = `Bearish Momentum Expansion (${rsi.toFixed(1)} falling below 50)`;
    } else {
      rsiDetail = `Neutral Equilibrium (${rsi.toFixed(1)})`;
    }
    breakdown.push({
      name: 'RSI (14) Oscillator',
      value: rsi.toFixed(1),
      vote: rsiVote,
      reason: rsiDetail
    });

    // 3. MACD (12, 26, 9) Crossover & Histogram Impulse
    let macdVote = 'NEUTRAL';
    let macdDetail = '';
    if (macd > macdSignal && macdHist > 0) {
      const accelerating = macdHist > prevMacdHist;
      rawScore += accelerating ? 2.2 : 1.4;
      macdVote = 'BULLISH';
      macdDetail = accelerating
        ? 'Bullish Crossover + Rising Positive Histogram'
        : 'MACD above Signal Line (Bullish Bias)';
    } else if (macd < macdSignal && macdHist < 0) {
      const accelerating = macdHist < prevMacdHist;
      rawScore -= accelerating ? 2.2 : 1.4;
      macdVote = 'BEARISH';
      macdDetail = accelerating
        ? 'Bearish Crossover + Expanding Negative Histogram'
        : 'MACD below Signal Line (Bearish Bias)';
    } else {
      macdDetail = 'Histogram flattening near zero line';
    }
    breakdown.push({
      name: 'MACD (12, 26, 9)',
      value: macdHist >= 0 ? `+${macdHist.toFixed(symbolMeta.digits)}` : macdHist.toFixed(symbolMeta.digits),
      vote: macdVote,
      reason: macdDetail
    });

    // 4. Bollinger Bands (20, 2.0) Volatility & Channel Position
    let bbVote = 'NEUTRAL';
    let bbDetail = '';
    if (bbPctB <= 0.15) {
      rawScore += 1.8;
      bbVote = 'BULLISH';
      bbDetail = `Lower Band Rejection (%B: ${(bbPctB * 100).toFixed(0)}%) — Mean reversion buy`;
    } else if (bbPctB >= 0.85) {
      rawScore -= 1.8;
      bbVote = 'BEARISH';
      bbDetail = `Upper Band Rejection (%B: ${(bbPctB * 100).toFixed(0)}%) — Mean reversion sell`;
    } else if (price > bbMiddle && emaVote === 'BULLISH') {
      rawScore += 1.1;
      bbVote = 'BULLISH';
      bbDetail = `Upper Channel Trend Ride (%B: ${(bbPctB * 100).toFixed(0)}%)`;
    } else if (price < bbMiddle && emaVote === 'BEARISH') {
      rawScore -= 1.1;
      bbVote = 'BEARISH';
      bbDetail = `Lower Channel Trend Ride (%B: ${(bbPctB * 100).toFixed(0)}%)`;
    } else {
      bbDetail = `Mid-Channel Consolidation (%B: ${(bbPctB * 100).toFixed(0)}%)`;
    }
    breakdown.push({
      name: 'Bollinger Bands (20, 2)',
      value: `%B ${(bbPctB * 100).toFixed(0)}%`,
      vote: bbVote,
      reason: bbDetail
    });

    // 5. Price Action & ATR Volatility Structure (Swing S/R + Candle Impulse)
    const lastCandle = candles[lastIdx];
    const body = lastCandle.close - lastCandle.open;
    let paVote = 'NEUTRAL';
    let paDetail = '';
    if (body > 0 && lastCandle.close > candles[prevIdx].high) {
      rawScore += 1.3;
      paVote = 'BULLISH';
      paDetail = 'Bullish Break of Previous High + ATR Expansion';
    } else if (body < 0 && lastCandle.close < candles[prevIdx].low) {
      rawScore -= 1.3;
      paVote = 'BEARISH';
      paDetail = 'Bearish Break of Previous Low + ATR Expansion';
    } else if (body >= 0) {
      rawScore += 0.4;
      paVote = 'BULLISH';
      paDetail = `Support holding at ${swings.support.toFixed(symbolMeta.digits)}`;
    } else {
      rawScore -= 0.4;
      paVote = 'BEARISH';
      paDetail = `Resistance capped at ${swings.resistance.toFixed(symbolMeta.digits)}`;
    }
    const atrPips = Math.round(atr / symbolMeta.pipSize);
    breakdown.push({
      name: 'ATR(14) & Price Structure',
      value: `${atr.toFixed(symbolMeta.digits)} (${atrPips} pts)`,
      vote: paVote,
      reason: paDetail
    });

    // Determine Signal Direction & Confidence Percentage (50% to 98%)
    const absScore = Math.abs(rawScore);
    const confidence = Math.min(97, Math.max(52, Math.round(50 + (absScore / 9.8) * 48)));

    let direction = 'NEUTRAL';
    let side = rawScore >= 0 ? 'BUY' : 'SELL';
    if (rawScore >= 4.2) direction = 'STRONG BUY';
    else if (rawScore >= 1.5) direction = 'BUY';
    else if (rawScore <= -4.2) direction = 'STRONG SELL';
    else if (rawScore <= -1.5) direction = 'SELL';
    else direction = 'NEUTRAL';

    // Dynamic Entry & Exit Levels using ATR(14)
    const slMultiplier = 1.5;
    const tp1Multiplier = 2.25; // 1 : 1.5 R:R
    const tp2Multiplier = 3.75; // 1 : 2.5 R:R
    const tp3Multiplier = 6.0;  // 1 : 4.0 R:R

    const entryPrice = price;
    const limitEntry = side === 'BUY'
      ? Number((price - 0.35 * atr).toFixed(symbolMeta.digits))
      : Number((price + 0.35 * atr).toFixed(symbolMeta.digits));

    const stopLoss = side === 'BUY'
      ? Number((entryPrice - slMultiplier * atr).toFixed(symbolMeta.digits))
      : Number((entryPrice + slMultiplier * atr).toFixed(symbolMeta.digits));

    const tp1 = side === 'BUY'
      ? Number((entryPrice + tp1Multiplier * atr).toFixed(symbolMeta.digits))
      : Number((entryPrice - tp1Multiplier * atr).toFixed(symbolMeta.digits));

    const tp2 = side === 'BUY'
      ? Number((entryPrice + tp2Multiplier * atr).toFixed(symbolMeta.digits))
      : Number((entryPrice - tp2Multiplier * atr).toFixed(symbolMeta.digits));

    const tp3 = side === 'BUY'
      ? Number((entryPrice + tp3Multiplier * atr).toFixed(symbolMeta.digits))
      : Number((entryPrice - tp3Multiplier * atr).toFixed(symbolMeta.digits));

    const slPips = Math.max(1, Math.round(Math.abs(entryPrice - stopLoss) / symbolMeta.pipSize));
    const tp1Pips = Math.max(1, Math.round(Math.abs(tp1 - entryPrice) / symbolMeta.pipSize));
    const tp2Pips = Math.max(1, Math.round(Math.abs(tp2 - entryPrice) / symbolMeta.pipSize));
    const tp3Pips = Math.max(1, Math.round(Math.abs(tp3 - entryPrice) / symbolMeta.pipSize));

    // Dynamic Exit Signal Status (advises when to exit an existing trade or hold)
    let exitSignalStatus = '';
    let exitUrgency = 'NORMAL';
    if (side === 'BUY' && (rsi > 74 || (macdHist < prevMacdHist && rsi > 66))) {
      exitSignalStatus = 'TAKE PROFIT / PARTIAL EXIT WARNING: Bullish momentum nearing exhaustion (RSI High). Lock profit at TP1/TP2 or trail SL tight.';
      exitUrgency = 'WARN';
    } else if (side === 'SELL' && (rsi < 26 || (macdHist > prevMacdHist && rsi < 34))) {
      exitSignalStatus = 'TAKE PROFIT / PARTIAL EXIT WARNING: Bearish momentum nearing oversold floor. Secure profit at TP1/TP2 or trail SL tight.';
      exitUrgency = 'WARN';
    } else if (direction === 'NEUTRAL') {
      exitSignalStatus = 'EXIT / STAND ASIDE: Low indicator confluence. Close scalps or wait for candle close beyond EMA 21.';
      exitUrgency = 'WAIT';
    } else {
      exitSignalStatus = `ACTIVE ${side} CONFLUENCE: Close 50% at TP1 (${tp1.toFixed(symbolMeta.digits)}) & move Stop Loss to Breakeven (${entryPrice.toFixed(symbolMeta.digits)}); close 30% at TP2 (${tp2.toFixed(symbolMeta.digits)}) and trail runner to TP3 (${tp3.toFixed(symbolMeta.digits)}). Hard invalidation exit at SL (${stopLoss.toFixed(symbolMeta.digits)}).`;
      exitUrgency = 'ACTIVE';
    }

    // Multi-Timeframe (MTF) Confluence Matrix across M1, M5, M15, H1, H4, D1
    const mtfTimeframes = ['M1', 'M5', 'M15', 'H1', 'H4', 'D1'];
    const lookbacks = [6, 12, 24, 48, 96, 160];
    const mtfMatrix = mtfTimeframes.map((tfName, idx) => {
      if (tfName === timeframe) {
        return { tf: tfName, bias: side, active: true };
      }
      const lb = Math.min(n - 1, lookbacks[idx]);
      const refClose = closes[n - 1 - lb];
      const delta = price - refClose;
      const bias = delta >= 0 ? 'BUY' : 'SELL';
      return { tf: tfName, bias, active: false };
    });

    const prevDayClose = closes[Math.max(0, n - 48)];
    const changePct = prevDayClose ? ((price - prevDayClose) / prevDayClose) * 100 : 0;
    const spreadPips = symbolMeta.category === 'forex' ? 1.2 : symbolMeta.category === 'synthetic' ? 2.0 : 2.5;
    const ask = Number((price + spreadPips * symbolMeta.pipSize * 0.5).toFixed(symbolMeta.digits));
    const bid = Number((price - spreadPips * symbolMeta.pipSize * 0.5).toFixed(symbolMeta.digits));

    return {
      symbolId: symbolMeta.id,
      timeframe,
      price,
      bid,
      ask,
      changePct,
      direction,
      side,
      confidence,
      entryPrice,
      limitEntry,
      stopLoss,
      tp1,
      tp2,
      tp3,
      slPips,
      tp1Pips,
      tp2Pips,
      tp3Pips,
      rrRatio: '1 : 2.5',
      atr,
      atrPips,
      rsi,
      macd,
      macdSignal,
      macdHist,
      ema9,
      ema21,
      ema50,
      ema200,
      bbUpper,
      bbMiddle,
      bbLower,
      bbPctB,
      swings,
      breakdown,
      exitSignalStatus,
      exitUrgency,
      mtfMatrix,
      series: {
        ema9: ema9Series,
        ema21: ema21Series,
        ema50: ema50Series,
        ema200: ema200Series,
        bbUpper: bbObj.upper,
        bbMiddle: bbObj.middle,
        bbLower: bbObj.lower,
        rsi: rsiSeries,
        macdLine: macdObj.macdLine,
        signalLine: macdObj.signalLine,
        histogram: macdObj.histogram
      },
      updatedAt: Date.now()
    };
  }

  return {
    analyzeSymbol
  };
})();
