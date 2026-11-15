# MT5 OmniSignal Pro — Multi-Asset Entry & Exit Signal WebApp

Real-time Entry and Exit (`Stop Loss`, `TP1`, `TP2`, `TP3`) signal dashboard covering **all MetaTrader 5 tradable markets**:
- **Forex**: Majors, Crosses & Exotics (`EURUSD`, `GBPUSD`, `USDJPY`, `USDCHF`, `AUDUSD`, `USDCAD`, `NZDUSD`, `EURGBP`, `EURJPY`, `GBPJPY`, `EURAUD`, `GBPAUD`, `AUDJPY`, `CHFJPY`, `EURCAD`, `USDZAR`)
- **Commodities (Metals & Energies)**: `XAUUSD` (Gold), `XAGUSD` (Silver), `XPTUSD` (Platinum), `XPDUSD` (Palladium), `USOIL` (WTI Crude), `UKOIL` (Brent Crude), `NGAS` (Natural Gas), `COPPER`
- **Synthetic Indices (Deriv / MT5)**: `Volatility 10/25/50/75/100 Index` (standard & `1s` variants), `Boom 300/500/1000 Index`, `Crash 300/500/1000 Index`, `Step Index`, `Jump 25/75 Index`, `Range Break 100 Index`
- **Cryptocurrencies**: `BTCUSD`, `ETHUSD`, `SOLUSD`, `BNBUSD`, `XRPUSD`, `ADAUSD`, `DOGEUSD`, `AVAXUSD`, `LINKUSD`, `LTCUSD`
- **Global Stock Indices (CFDs)**: `NAS100` (USTEC), `US500` (S&P 500), `US30` (Dow Jones 30), `GER40` (DAX 40), `UK100` (FTSE 100), `JPN225` (Nikkei 225)
- **Custom MT5 Symbols**: Add any broker-specific MT5 ticker directly from the UI (`+ Add MT5 Symbol`).

## Signal Engine (5-Pillar Multi-Indicator Confluence)
1. **EMA Trend Stack (`EMA 9 / 21 / 50 / 200`)**: Trend alignment & dynamic support/resistance.
2. **RSI (`14`)**: Wilder's Relative Strength Index for momentum & overbought/oversold reversal zones.
3. **MACD (`12, 26, 9`)**: Signal line crossovers & histogram acceleration.
4. **Bollinger Bands (`20, 2.0`)**: Volatility channel `%B` position, band rejection & breakout detection.
5. **ATR (`14`) Dynamic Exit Levels**:
   - **Market Entry & Limit Pullback Entry**
   - **Exit Stop Loss (`SL`)**: `1.5x ATR(14)` invalidation price + point distance
   - **Exit Take Profit 1 (`TP1`)**: `1:1.5 R:R` (`2.25x ATR`) — Partial close 50% & move SL to breakeven
   - **Exit Take Profit 2 (`TP2`)**: `1:2.5 R:R` (`3.75x ATR`) — Close 30% core position
   - **Exit Take Profit 3 (`TP3`)**: `1:4.0 R:R` (`6.0x ATR`) — Final 20% runner target

## Quick Start

```bash
npm start
```

Then open **http://localhost:3000** in your browser.
