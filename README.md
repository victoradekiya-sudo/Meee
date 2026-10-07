# Market Phase Detector v2.4 [Wyckoff MTF + MACD/OBV]

TradingView Pine Script v6 indicator: `MarketPhaseDetector_v2.4.pine`.

## What changed from v2.3

### New input groups
- **04 — On-Balance Volume**: slope length, signal EMA, weight in trend score,
  weight in Acc/Dist pressure, "OBV must confirm SOS/SOW", OBV divergence toggle.
- **05 — MACD**: enable toggle, fast/slow/signal lengths, source, MA type (EMA/SMA),
  weight in trend score, weight in Acc/Dist pressure, "MACD must confirm SOS/SOW",
  "MACD must confirm Spring/UTAD", divergence toggle and source (histogram / line).
- **06 — Divergence**: pivot length, max bars between pivots, memory, show labels.
- Smart alerts: **Require Local MACD / OBV Agreement**.

### Engine
- **Trend score** now includes an ATR-normalised MACD component (line + histogram)
  and a volume-normalised OBV slope component. The total is re-normalised so it
  still spans ±100 and existing thresholds keep their meaning.
- **Accumulation / Distribution pressure**: the old fixed "OBV slope = 15 pts" is
  replaced by a weighted OBV block (slope, OBV vs signal, OBV divergence) plus a
  MACD block (MACD vs signal, histogram direction, MACD divergence). Scores are
  re-normalised to 0–100.
- **Events**: SOS/SOW can require MACD histogram and OBV-vs-signal confirmation;
  Spring/UTAD can require a turning histogram or a recent MACD divergence.
- **Divergences**: non-repainting regular divergences (price swing pivots vs MACD
  and vs OBV), confirmed `Pivot Length` bars after the pivot.

### MTF / bias / alerts
- Primary and local timeframes also return MACD/OBV state; the dashboard shows
  `M+/M−` and `O+/O−` next to each trend score.
- Combined bias gets ±1 when primary MACD and OBV fully agree (range −5..+5).
- Smart alerts can require local MACD/OBV agreement; Risk Warning can also fire
  early on a local bearish MACD/OBV divergence with rolling momentum.
- New alerts: MACD bullish/bearish divergence, OBV bullish/bearish divergence,
  MACD bullish/bearish cross.

### Dashboard
- New **MACD** and **OBV** rows (state, histogram direction, divergence status).
- Events row now also shows active divergences.
- Trend score, pressures, MACD histogram and MACD/OBV bias appear in the Data Window.

Setting MACD/OBV weights to 0 and disabling the confirmation toggles returns
behaviour close to v2.3.

## Plot limit fix (runtime error 10140)

Pine counts every value returned by `request.security()` toward the 64-plot
limit. The primary and local MTF calls each returned the full 26-value engine
tuple (52 plots), which together with the script's own plots, shapes and
alert conditions exceeded 64. Each timeframe now returns only the fields the
bias, smart alerts and dashboard use (phase, trend, acc/dist pressure,
SOS/SOW, MACD/OBV bias and divergence state), packed into two integers by
`f_mtfPacked()` and decoded with `f_mtfUnpack()`. Behaviour is unchanged.
