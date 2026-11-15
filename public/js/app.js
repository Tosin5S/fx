// Main Application Controller for MT5 OmniSignal Pro WebApp
(function () {
  const state = {
    symbols: [...window.MT5_SYMBOLS],
    activeCategory: 'all',
    activeTimeframe: 'M15',
    signalFilter: 'ALL',
    searchQuery: '',
    selectedSymbolId: 'XAUUSD',
    watchlist: new Set(JSON.parse(localStorage.getItem('mt5_watchlist') || '["XAUUSD","EURUSD","VOL75","BTCUSD","NAS100","BOOM1000"]')),
    signals: new Map(),
    alertHistory: [],
    soundEnabled: false,
    accountBalance: 1000,
    riskPercent: 1.0
  };

  // Load any user-added custom MT5 symbols from localStorage
  try {
    const savedCustom = JSON.parse(localStorage.getItem('mt5_custom_symbols') || '[]');
    if (Array.isArray(savedCustom)) {
      savedCustom.forEach(cs => {
        if (!state.symbols.some(s => s.id === cs.id)) {
          state.symbols.push(cs);
        }
      });
    }
  } catch (e) {}

  function saveWatchlist() {
    localStorage.setItem('mt5_watchlist', JSON.stringify([...state.watchlist]));
  }

  function playAlertTone(isBuy = true) {
    if (!state.soundEnabled) return;
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(isBuy ? 587.33 : 440, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(isBuy ? 880 : 329.63, ctx.currentTime + 0.18);
      gain.gain.setValueAtTime(0.08, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.22);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.23);
    } catch (e) {}
  }

  function showToast(msg) {
    const container = document.getElementById('toastContainer');
    if (!container) return;
    const el = document.createElement('div');
    el.className = 'toast-item';
    el.textContent = msg;
    container.appendChild(el);
    setTimeout(() => {
      el.classList.add('fade-out');
      setTimeout(() => el.remove(), 300);
    }, 2400);
  }

  function copyText(text, label) {
    navigator.clipboard?.writeText(String(text)).then(() => {
      showToast(`Copied ${label}: ${text}`);
    }).catch(() => {
      showToast(`${label}: ${text}`);
    });
  }

  function recomputeAllSignals(targetSymbolId = null) {
    const list = targetSymbolId
      ? state.symbols.filter(s => s.id === targetSymbolId)
      : state.symbols;

    list.forEach(sym => {
      const dataObj = window.MarketDataFeed.getSymbolData(sym, state.activeTimeframe);
      const prevSig = state.signals.get(sym.id);
      const sig = window.SignalEngine.analyzeSymbol(sym, dataObj.candles, state.activeTimeframe);
      if (sig) {
        sig.source = dataObj.source;
        state.signals.set(sym.id, sig);

        // Log alert when a high-confidence signal flips or initializes
        if (
          sig.confidence >= 78 &&
          sig.direction !== 'NEUTRAL' &&
          (!prevSig || prevSig.direction !== sig.direction)
        ) {
          const alertItem = {
            id: `${sym.id}_${Date.now()}`,
            symbolId: sym.id,
            mt5: sym.mt5,
            category: sym.category,
            timeframe: state.activeTimeframe,
            direction: sig.direction,
            side: sig.side,
            confidence: sig.confidence,
            entry: sig.entryPrice.toFixed(sym.digits),
            sl: sig.stopLoss.toFixed(sym.digits),
            tp1: sig.tp1.toFixed(sym.digits),
            tp2: sig.tp2.toFixed(sym.digits),
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
          };
          state.alertHistory.unshift(alertItem);
          if (state.alertHistory.length > 30) state.alertHistory.pop();
          if (prevSig) playAlertTone(sig.side === 'BUY');
        }
      }
    });
  }

  function getFilteredSymbols() {
    return state.symbols.filter(sym => {
      if (state.activeCategory !== 'all' && sym.category !== state.activeCategory) {
        return false;
      }
      if (state.searchQuery) {
        const q = state.searchQuery.toLowerCase();
        const match =
          sym.id.toLowerCase().includes(q) ||
          sym.mt5.toLowerCase().includes(q) ||
          sym.name.toLowerCase().includes(q) ||
          sym.subCategory.toLowerCase().includes(q);
        if (!match) return false;
      }
      const sig = state.signals.get(sym.id);
      if (!sig) return true;

      if (state.signalFilter === 'BUY' && sig.side !== 'BUY') return false;
      if (state.signalFilter === 'SELL' && sig.side !== 'SELL') return false;
      if (state.signalFilter === 'STRONG' && sig.confidence < 78) return false;
      if (state.signalFilter === 'WATCHLIST' && !state.watchlist.has(sym.id)) return false;
      return true;
    });
  }

  function renderSummaryBar() {
    let buyCount = 0;
    let sellCount = 0;
    let strongCount = 0;

    state.symbols.forEach(sym => {
      const sig = state.signals.get(sym.id);
      if (!sig) return;
      if (sig.direction.includes('BUY')) buyCount++;
      if (sig.direction.includes('SELL')) sellCount++;
      if (sig.confidence >= 80 && sig.direction !== 'NEUTRAL') strongCount++;
    });

    const totalEl = document.getElementById('statTotalSymbols');
    const buyEl = document.getElementById('statBuySignals');
    const sellEl = document.getElementById('statSellSignals');
    const strongEl = document.getElementById('statStrongSignals');
    if (totalEl) totalEl.textContent = state.symbols.length;
    if (buyEl) buyEl.textContent = buyCount;
    if (sellEl) sellEl.textContent = sellCount;
    if (strongEl) strongEl.textContent = strongCount;
  }

  function getBadgeClass(direction) {
    if (direction === 'STRONG BUY') return 'sig-badge strong-buy';
    if (direction === 'BUY') return 'sig-badge buy';
    if (direction === 'STRONG SELL') return 'sig-badge strong-sell';
    if (direction === 'SELL') return 'sig-badge sell';
    return 'sig-badge neutral';
  }

  function getCategoryLabel(cat) {
    switch (cat) {
      case 'forex': return 'FOREX';
      case 'commodities': return 'COMMODITY';
      case 'synthetic': return 'SYNTHETIC';
      case 'crypto': return 'CRYPTO';
      case 'indices': return 'INDEX CFD';
      default: return cat.toUpperCase();
    }
  }

  function renderScannerTable() {
    const tbody = document.getElementById('scannerTableBody');
    const countLabel = document.getElementById('scannerResultCount');
    if (!tbody) return;

    const filtered = getFilteredSymbols();
    if (countLabel) {
      countLabel.textContent = `Showing ${filtered.length} of ${state.symbols.length} MT5 Instruments`;
    }

    const rowsHtml = filtered.map(sym => {
      const sig = state.signals.get(sym.id);
      if (!sig) return '';
      const d = sym.digits;
      const isSelected = sym.id === state.selectedSymbolId;
      const isStarred = state.watchlist.has(sym.id);
      const chgClass = sig.changePct >= 0 ? 'pos' : 'neg';
      const chgSign = sig.changePct >= 0 ? '+' : '';
      const confColor = sig.side === 'BUY' ? '#10b981' : '#f43f5e';

      return `
        <tr class="scanner-row ${isSelected ? 'selected-row' : ''}" data-symbol="${sym.id}">
          <td class="star-cell" data-star="${sym.id}" title="Toggle Watchlist">
            <span class="star-icon ${isStarred ? 'active' : ''}">${isStarred ? '★' : '☆'}</span>
          </td>
          <td>
            <div class="sym-cell">
              <div class="sym-primary">
                <span class="sym-ticker">${sym.id}</span>
                <span class="cat-pill cat-${sym.category}">${getCategoryLabel(sym.category)}</span>
              </div>
              <div class="sym-sub">${sym.mt5} • ${sym.name}</div>
            </div>
          </td>
          <td class="mono-cell">
            <div class="price-main">${sig.price.toFixed(d)}</div>
            <div class="price-chg ${chgClass}">${chgSign}${sig.changePct.toFixed(2)}%</div>
          </td>
          <td>
            <span class="${getBadgeClass(sig.direction)}">${sig.direction}</span>
          </td>
          <td>
            <div class="conf-wrap">
              <div class="conf-top">
                <span class="conf-val">${sig.confidence}%</span>
                <span class="conf-rr">${sig.rrRatio}</span>
              </div>
              <div class="conf-bar-bg">
                <div class="conf-bar-fill" style="width:${sig.confidence}%; background:${confColor}"></div>
              </div>
            </div>
          </td>
          <td class="mono-cell entry-col">${sig.entryPrice.toFixed(d)}</td>
          <td class="mono-cell sl-col">
            <div>${sig.stopLoss.toFixed(d)}</div>
            <span class="pip-sub">-${sig.slPips} pts</span>
          </td>
          <td class="mono-cell tp-col">
            <div>${sig.tp1.toFixed(d)}</div>
            <span class="pip-sub">+${sig.tp1Pips} pts</span>
          </td>
          <td class="mono-cell tp-col">
            <div>${sig.tp2.toFixed(d)}</div>
            <span class="pip-sub">+${sig.tp2Pips} pts</span>
          </td>
          <td class="mono-cell tp-col">
            <div>${sig.tp3.toFixed(d)}</div>
            <span class="pip-sub">+${sig.tp3Pips} pts</span>
          </td>
          <td class="mono-cell ind-mini-col">
            <span class="mini-tag ${sig.rsi < 35 ? 'bull' : sig.rsi > 65 ? 'bear' : ''}">RSI ${sig.rsi.toFixed(0)}</span>
            <span class="mini-tag ${sig.macdHist >= 0 ? 'bull' : 'bear'}">MACD ${sig.macdHist >= 0 ? '▲' : '▼'}</span>
          </td>
        </tr>
      `;
    }).join('');

    tbody.innerHTML = rowsHtml || `
      <tr>
        <td colspan="11" class="empty-scanner">No MetaTrader 5 instruments match your current filter.</td>
      </tr>
    `;
  }

  function renderSelectedInstrumentPanel() {
    const sym = state.symbols.find(s => s.id === state.selectedSymbolId) || state.symbols[0];
    if (!sym) return;
    const dataObj = window.MarketDataFeed.getSymbolData(sym, state.activeTimeframe);
    const sig = state.signals.get(sym.id);
    if (!sig) return;

    const d = sym.digits;

    // Update Chart Header
    document.getElementById('chartSymbolTitle').textContent = `${sym.id} (${sym.mt5})`;
    document.getElementById('chartSymbolDesc').textContent = `${sym.name} • ${getCategoryLabel(sym.category)} • ${dataObj.source}`;
    document.getElementById('chartLivePrice').textContent = sig.price.toFixed(d);
    const chgEl = document.getElementById('chartLiveChange');
    chgEl.textContent = `${sig.changePct >= 0 ? '+' : ''}${sig.changePct.toFixed(2)}%`;
    chgEl.className = `chart-change-pill ${sig.changePct >= 0 ? 'pos' : 'neg'}`;

    const badgeEl = document.getElementById('chartSignalBadge');
    badgeEl.className = getBadgeClass(sig.direction);
    badgeEl.textContent = `${sig.direction} (${sig.confidence}%)`;

    // Render Candlestick + Indicator Chart
    window.SignalChart.render(sym, dataObj.candles, sig);

    // Update Right Panel Signal Ticket
    document.getElementById('ticketSymbolCode').textContent = sym.mt5;
    document.getElementById('ticketTimeframe').textContent = state.activeTimeframe;
    const ticketDirEl = document.getElementById('ticketDirectionBadge');
    ticketDirEl.className = getBadgeClass(sig.direction);
    ticketDirEl.textContent = sig.direction;

    document.getElementById('ticketConfidenceVal').textContent = `${sig.confidence}% Confluence`;
    const gaugeFill = document.getElementById('ticketConfidenceFill');
    gaugeFill.style.width = `${sig.confidence}%`;
    gaugeFill.style.background = sig.side === 'BUY' ? '#10b981' : '#f43f5e';

    document.getElementById('valMarketEntry').textContent = sig.entryPrice.toFixed(d);
    document.getElementById('valLimitEntry').textContent = sig.limitEntry.toFixed(d);
    document.getElementById('valBidAsk').textContent = `${sig.bid.toFixed(d)} / ${sig.ask.toFixed(d)}`;

    document.getElementById('valStopLoss').textContent = sig.stopLoss.toFixed(d);
    document.getElementById('subStopLoss').textContent = `1.5x ATR (-${sig.slPips} pts)`;

    document.getElementById('valTp1').textContent = sig.tp1.toFixed(d);
    document.getElementById('subTp1').textContent = `1:1.5 R:R (+${sig.tp1Pips} pts • Exit 50%)`;

    document.getElementById('valTp2').textContent = sig.tp2.toFixed(d);
    document.getElementById('subTp2').textContent = `1:2.5 R:R (+${sig.tp2Pips} pts • Exit 30%)`;

    document.getElementById('valTp3').textContent = sig.tp3.toFixed(d);
    document.getElementById('subTp3').textContent = `1:4.0 R:R (+${sig.tp3Pips} pts • Exit 20%)`;

    // Exit Strategy Advisory Box
    const exitBox = document.getElementById('exitAdvisoryBox');
    exitBox.className = `exit-advisory-box urgency-${sig.exitUrgency.toLowerCase()}`;
    document.getElementById('exitAdvisoryText').textContent = sig.exitSignalStatus;

    // Multi-Timeframe Matrix
    const mtfContainer = document.getElementById('mtfMatrixGrid');
    if (mtfContainer) {
      mtfContainer.innerHTML = sig.mtfMatrix.map(item => `
        <div class="mtf-cell ${item.active ? 'mtf-active' : ''}" data-tf="${item.tf}">
          <span class="mtf-tf">${item.tf}</span>
          <span class="mtf-bias ${item.bias === 'BUY' ? 'bull' : 'bear'}">${item.bias}</span>
        </div>
      `).join('');
    }

    // 5-Pillar Confluence Breakdown
    const confluenceList = document.getElementById('confluenceBreakdownList');
    if (confluenceList) {
      confluenceList.innerHTML = sig.breakdown.map(b => `
        <div class="conf-pillar-item">
          <div class="conf-pillar-header">
            <span class="pillar-name">${b.name}</span>
            <span class="pillar-val mono">${b.value}</span>
            <span class="pillar-vote vote-${b.vote.toLowerCase()}">${b.vote}</span>
          </div>
          <div class="conf-pillar-reason">${b.reason}</div>
        </div>
      `).join('');
    }

    // Update Risk & Lot Calculator
    updateRiskCalculator(sym, sig);
  }

  function updateRiskCalculator(sym, sig) {
    const riskUsd = (state.accountBalance * state.riskPercent) / 100;
    const priceRisk = Math.max(sym.pipSize, Math.abs(sig.entryPrice - sig.stopLoss));

    // Approximate MT5 lot calculation normalized across FX, Metals, Synthetics, Crypto
    let rawLot = riskUsd / (priceRisk * (sym.contractSize || 1));
    if (sym.category === 'forex') {
      // Standard 100k lot = $10/pip on USD quote pairs
      rawLot = riskUsd / Math.max(1, sig.slPips * 10);
    }
    const minLot = sym.id === 'VOL75' ? 0.001 : 0.01;
    const lotSize = Math.max(minLot, Number(rawLot.toFixed(sym.id === 'VOL75' ? 3 : 2)));

    const rewardTp1 = (riskUsd * 1.5).toFixed(2);
    const rewardTp2 = (riskUsd * 2.5).toFixed(2);
    const rewardTp3 = (riskUsd * 4.0).toFixed(2);

    const lotEl = document.getElementById('calcLotSize');
    const riskEl = document.getElementById('calcRiskUsd');
    const r1El = document.getElementById('calcRewardTp1');
    const r2El = document.getElementById('calcRewardTp2');
    const r3El = document.getElementById('calcRewardTp3');

    if (lotEl) lotEl.textContent = `${lotSize} Lots`;
    if (riskEl) riskEl.textContent = `-$${riskUsd.toFixed(2)}`;
    if (r1El) r1El.textContent = `+$${rewardTp1}`;
    if (r2El) r2El.textContent = `+$${rewardTp2}`;
    if (r3El) r3El.textContent = `+$${rewardTp3}`;
  }

  function renderAlertsFeed() {
    const feedEl = document.getElementById('liveAlertsFeed');
    if (!feedEl) return;

    if (state.alertHistory.length === 0) {
      feedEl.innerHTML = `<div class="empty-alerts">Scanning all MT5 instruments for high-confluence setups...</div>`;
      return;
    }

    feedEl.innerHTML = state.alertHistory.slice(0, 12).map(a => `
      <div class="alert-card" data-symbol="${a.symbolId}">
        <div class="alert-top">
          <span class="alert-sym">${a.symbolId} <small>(${a.timeframe})</small></span>
          <span class="${getBadgeClass(a.direction)}">${a.direction} ${a.confidence}%</span>
          <span class="alert-time">${a.time}</span>
        </div>
        <div class="alert-levels mono">
          <span>Entry: <b>${a.entry}</b></span>
          <span class="sl-txt">SL: <b>${a.sl}</b></span>
          <span class="tp-txt">TP1: <b>${a.tp1}</b></span>
          <span class="tp-txt">TP2: <b>${a.tp2}</b></span>
        </div>
      </div>
    `).join('');
  }

  function bindEvents() {
    // Category Tabs
    document.querySelectorAll('.cat-tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.cat-tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.activeCategory = btn.dataset.cat;
        renderScannerTable();
      });
    });

    // Timeframe Buttons
    document.querySelectorAll('.tf-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.tf-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.activeTimeframe = btn.dataset.tf;
        window.MarketDataFeed.setTimeframe(state.symbols, state.activeTimeframe);
        recomputeAllSignals();
        renderSummaryBar();
        renderScannerTable();
        renderSelectedInstrumentPanel();
      });
    });

    // Signal Filter Buttons
    document.querySelectorAll('.sig-filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.sig-filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.signalFilter = btn.dataset.filter;
        renderScannerTable();
      });
    });

    // Search Input
    const searchInput = document.getElementById('symbolSearchInput');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        state.searchQuery = e.target.value.trim();
        renderScannerTable();
      });
    }

    // Scanner Row Click & Star Watchlist Click
    const tbody = document.getElementById('scannerTableBody');
    if (tbody) {
      tbody.addEventListener('click', (e) => {
        const starCell = e.target.closest('[data-star]');
        if (starCell) {
          e.stopPropagation();
          const id = starCell.dataset.star;
          if (state.watchlist.has(id)) state.watchlist.delete(id);
          else state.watchlist.add(id);
          saveWatchlist();
          renderScannerTable();
          return;
        }
        const row = e.target.closest('.scanner-row');
        if (row && row.dataset.symbol) {
          state.selectedSymbolId = row.dataset.symbol;
          renderScannerTable();
          renderSelectedInstrumentPanel();
        }
      });
    }

    // MTF cell click switches timeframe
    const mtfGrid = document.getElementById('mtfMatrixGrid');
    if (mtfGrid) {
      mtfGrid.addEventListener('click', (e) => {
        const cell = e.target.closest('[data-tf]');
        if (!cell) return;
        const tf = cell.dataset.tf;
        const tfBtn = document.querySelector(`.tf-btn[data-tf="${tf}"]`);
        if (tfBtn) tfBtn.click();
      });
    }

    // Alert feed click selects symbol
    const feedEl = document.getElementById('liveAlertsFeed');
    if (feedEl) {
      feedEl.addEventListener('click', (e) => {
        const card = e.target.closest('.alert-card');
        if (card && card.dataset.symbol) {
          state.selectedSymbolId = card.dataset.symbol;
          renderScannerTable();
          renderSelectedInstrumentPanel();
        }
      });
    }

    // Chart Overlay Toggles
    const toggleEMA = document.getElementById('toggleEMA');
    const toggleBB = document.getElementById('toggleBB');
    const toggleLevels = document.getElementById('toggleLevels');
    const subOscSelect = document.getElementById('subOscSelect');

    if (toggleEMA) {
      toggleEMA.addEventListener('change', () => window.SignalChart.setOptions({ showEMA: toggleEMA.checked }));
    }
    if (toggleBB) {
      toggleBB.addEventListener('change', () => window.SignalChart.setOptions({ showBB: toggleBB.checked }));
    }
    if (toggleLevels) {
      toggleLevels.addEventListener('change', () => window.SignalChart.setOptions({ showLevels: toggleLevels.checked }));
    }
    if (subOscSelect) {
      subOscSelect.addEventListener('change', () => window.SignalChart.setOptions({ subMode: subOscSelect.value }));
    }

    // Copy buttons for Entry, SL, TP1, TP2, TP3, and Full Signal Ticket
    document.querySelectorAll('[data-copy-target]').forEach(btn => {
      btn.addEventListener('click', () => {
        const targetId = btn.dataset.copyTarget;
        const label = btn.dataset.copyLabel || 'Price';
        const val = document.getElementById(targetId)?.textContent;
        if (val) copyText(val, label);
      });
    });

    const copyFullBtn = document.getElementById('btnCopyFullTicket');
    if (copyFullBtn) {
      copyFullBtn.addEventListener('click', () => {
        const sym = state.symbols.find(s => s.id === state.selectedSymbolId);
        const sig = state.signals.get(state.selectedSymbolId);
        if (!sym || !sig) return;
        const d = sym.digits;
        const text = [
          `=== MT5 SIGNAL: ${sym.id} (${sym.mt5}) [${state.activeTimeframe}] ===`,
          `Action: ${sig.direction} (${sig.confidence}% Confluence)`,
          `Market Entry: ${sig.entryPrice.toFixed(d)} (Limit Pullback: ${sig.limitEntry.toFixed(d)})`,
          `Stop Loss (Exit): ${sig.stopLoss.toFixed(d)} (-${sig.slPips} pts)`,
          `Take Profit 1 (50% Exit): ${sig.tp1.toFixed(d)} (+${sig.tp1Pips} pts | 1:1.5 R:R)`,
          `Take Profit 2 (30% Exit): ${sig.tp2.toFixed(d)} (+${sig.tp2Pips} pts | 1:2.5 R:R)`,
          `Take Profit 3 (20% Exit): ${sig.tp3.toFixed(d)} (+${sig.tp3Pips} pts | 1:4.0 R:R)`
        ].join('\n');
        copyText(text, `${sym.id} Full Signal Ticket`);
      });
    }

    // Sound Alert Toggle
    const soundBtn = document.getElementById('btnToggleSound');
    if (soundBtn) {
      soundBtn.addEventListener('click', () => {
        state.soundEnabled = !state.soundEnabled;
        soundBtn.classList.toggle('active', state.soundEnabled);
        soundBtn.textContent = state.soundEnabled ? '🔊 Alerts ON' : '🔇 Alerts Muted';
        if (state.soundEnabled) playAlertTone(true);
      });
    }

    // Risk Calculator Inputs
    const balInput = document.getElementById('inputAccountBalance');
    const riskInput = document.getElementById('inputRiskPercent');
    if (balInput) {
      balInput.addEventListener('input', () => {
        state.accountBalance = Math.max(10, parseFloat(balInput.value) || 1000);
        const sym = state.symbols.find(s => s.id === state.selectedSymbolId);
        const sig = state.signals.get(state.selectedSymbolId);
        if (sym && sig) updateRiskCalculator(sym, sig);
      });
    }
    if (riskInput) {
      riskInput.addEventListener('input', () => {
        state.riskPercent = Math.max(0.1, Math.min(25, parseFloat(riskInput.value) || 1.0));
        const sym = state.symbols.find(s => s.id === state.selectedSymbolId);
        const sig = state.signals.get(state.selectedSymbolId);
        if (sym && sig) updateRiskCalculator(sym, sig);
      });
    }

    // Custom MT5 Symbol Modal
    const openCustomBtn = document.getElementById('btnAddCustomSymbol');
    const modalEl = document.getElementById('customSymbolModal');
    const closeCustomBtn = document.getElementById('btnCloseCustomModal');
    const formCustom = document.getElementById('customSymbolForm');

    if (openCustomBtn && modalEl) {
      openCustomBtn.addEventListener('click', () => modalEl.classList.remove('hidden'));
    }
    if (closeCustomBtn && modalEl) {
      closeCustomBtn.addEventListener('click', () => modalEl.classList.add('hidden'));
    }
    if (formCustom) {
      formCustom.addEventListener('submit', (e) => {
        e.preventDefault();
        const code = document.getElementById('customSymCode').value.trim().toUpperCase();
        const name = document.getElementById('customSymName').value.trim() || `${code} MT5 Instrument`;
        const category = document.getElementById('customSymCat').value;
        const basePrice = Math.max(0.0001, parseFloat(document.getElementById('customSymPrice').value) || 100);
        if (!code) return;

        const digits = basePrice < 2 ? 5 : basePrice < 50 ? 3 : 2;
        const pipSize = digits === 5 ? 0.0001 : digits === 3 ? 0.01 : 0.1;
        const newSym = {
          id: code,
          mt5: `${code}m`,
          name,
          category,
          subCategory: 'Custom MT5',
          digits,
          pipSize,
          contractSize: 100,
          basePrice,
          volatility: 0.0022,
          derivSymbol: null,
          yahooSymbol: null,
          binanceSymbol: null
        };

        if (!state.symbols.some(s => s.id === code)) {
          state.symbols.unshift(newSym);
          const saved = JSON.parse(localStorage.getItem('mt5_custom_symbols') || '[]');
          saved.push(newSym);
          localStorage.setItem('mt5_custom_symbols', JSON.stringify(saved));
        }

        state.selectedSymbolId = code;
        recomputeAllSignals();
        renderSummaryBar();
        renderScannerTable();
        renderSelectedInstrumentPanel();
        modalEl.classList.add('hidden');
        formCustom.reset();
        showToast(`Added ${code} to MT5 Signal Scanner`);
      });
    }
  }

  function initApp() {
    window.SignalChart.init(
      document.getElementById('mainSignalCanvas'),
      document.getElementById('subOscillatorCanvas')
    );

    bindEvents();

    window.MarketDataFeed.init(
      state.symbols,
      state.activeTimeframe,
      (updatedSymbolId) => {
        recomputeAllSignals(updatedSymbolId);
        renderSummaryBar();
        renderScannerTable();
        if (!updatedSymbolId || updatedSymbolId === state.selectedSymbolId) {
          renderSelectedInstrumentPanel();
        }
        renderAlertsFeed();
      },
      (status) => {
        const derivDot = document.getElementById('derivStatusDot');
        const derivTxt = document.getElementById('derivStatusText');
        if (derivDot && derivTxt) {
          derivDot.className = `status-dot ${status.derivConnected ? 'online' : 'standby'}`;
          derivTxt.textContent = status.derivConnected ? 'Deriv WS: Live' : 'Deriv WS: Cloud Sync';
        }
        const binDot = document.getElementById('binanceStatusDot');
        const binTxt = document.getElementById('binanceStatusText');
        if (binDot && binTxt) {
          binDot.className = `status-dot ${status.binanceConnected ? 'online' : 'standby'}`;
          binTxt.textContent = status.binanceConnected ? 'Binance/FX: Live' : 'Binance/FX: Cloud Sync';
        }
      }
    );

    recomputeAllSignals();
    renderSummaryBar();
    renderScannerTable();
    renderSelectedInstrumentPanel();
    renderAlertsFeed();
  }

  document.addEventListener('DOMContentLoaded', initApp);
})();
