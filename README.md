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

## Plot limit fix ("too many plots, limit is 64")

TradingView counts every `plot*()`, `bgcolor()` and `alertcondition()` call
toward a 64-plot limit, plus one extra count for each colour argument that is
not a compile-time constant (input colours included). v2.4 used about 75:

| Source | Count |
|---|---|
| 16 `plotshape()` markers (input `color` / `textcolor`) | 40 |
| 20 `alertcondition()` | 20 |
| 4 EMA / range `plot()` with input colours | 8 |
| 6 Data Window `plot()` | 6 |
| `bgcolor()` | 1 |

The Spring / UTAD / SOS / SOW / sweep, MACD / OBV divergence and phase-change
markers are now drawn with labels (`f_marker()`), which do not count toward
the limit. The script now uses about 36 plot counts. Markers look the same
and use the same inputs; only the most recent 500 labels stay on the chart.
`request.security()` has its own separate limit; the MTF calls now return
only the 10 fields the bias, alerts and dashboard use.

## Phase hold during confirmation

While a new raw phase is waiting `Bars Required To Confirm Phase` bars, the
detector now keeps showing the last confirmed phase instead of dropping to
NEUTRAL. Phase changes go directly from one phase to the next (e.g. MARKUP →
RE-ACCUMULATION), and a one-bar blip no longer re-fires the same phase-change
label or alert. NEUTRAL now appears only when NEUTRAL itself is confirmed.
