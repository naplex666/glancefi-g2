# GlanceFi — Hyperliquid paper trading on Even G2

Glanceable crypto trading on smart glasses: live Hyperliquid prices, one-tap paper trades, open position and PnL — all readable at a glance, no phone unlock.

## Problem
Traders check prices by unlocking their phone, opening an app, and reading a dense screen. On G2, the moment should be one glance: price, position, one tap to act.

## Who it is for
Hyperliquid traders who want price + position awareness hands-free during a trading session.

## How it works
- Live prices (BTC / ETH / SOL) from Hyperliquid's public info API — `POST https://api.hyperliquid.xyz/info`, `{"type":"allMids"}`, no key, no signing.
- Tap cycles the selected coin. Tap again opens a one-tap paper-trade confirm. Paper positions are stored locally; PnL is computed against live mids.
- Alerts list for price thresholds; Telegram digest mirrors the same alerts (read-only).
- Paper trading only. No real orders, no wallet, no funds, no seed phrases, no private keys. Nothing is ever sent to `/exchange`.

## Track
Crypto & DeFi (Hyperliquid).

## Setup
1. Install Node.js 20+ and the Even Hub tooling: `npm install -g @evenrealities/evenhub-cli @evenrealities/evenhub-simulator`
2. `npm install`
3. `npm run dev` in one terminal, `evenhub-simulator http://localhost:5173` in another.
4. Tap the simulator canvas to cycle coins and paper-trade; double-tap exits (system dialog).

## What existed before 23 Nov 2026
Concept, track research, skills install, and this spec only. All app code was written during build week 23–29 Nov 2026.

## Feature requests for the APIs used (up to 5)
1. Hyperliquid: a lightweight 24h change field in `allMids` so glasses apps avoid a second `candleSnapshot` call.
2. Even Hub SDK: a built-in paper/confirm dialog primitive (yes/no with one tap) instead of hand-rolled text containers.
3. Even Hub SDK: text-container brightness control per container, not just global.
4. Even Hub simulator: headless screenshot mode for CI so demo frames can be captured without a window.
5. Even Hub docs: a canonical STT provider example for the `asr` template (currently a placeholder).

## Demo
Video (max 3 min) shows the app running in the Even Hub simulator: prices, tap-cycle, paper long + confirm, position + PnL, alerts, double-tap exit.
