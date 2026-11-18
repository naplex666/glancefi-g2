import {
  waitForEvenAppBridge,
  TextContainerProperty,
  CreateStartUpPageContainer,
  TextContainerUpgrade,
  OsEventTypeList,
} from '@evenrealities/even_hub_sdk'

// GlanceFi — Hyperliquid paper trading on Even G2.
// Paper trading only: no real orders, no wallet, no funds, no signing.
// Live prices from Hyperliquid public info API (no key):
//   POST https://api.hyperliquid.xyz/info {"type":"allMids"}
//   POST ... {"type":"candleSnapshot","req":{"coin":"BTC","interval":"1h",...}}

const COINS = ['BTC', 'ETH', 'SOL'] as const
type Coin = (typeof COINS)[number]
const PAPER_SIZE_USD = 100

const HL_INFO = 'https://api.hyperliquid.xyz/info'

interface Price {
  mid: number
  chg24: number | null
}
const prices: Record<Coin, Price> = {
  BTC: { mid: NaN, chg24: null },
  ETH: { mid: NaN, chg24: null },
  SOL: { mid: NaN, chg24: null },
}
let lastFetchOk = false
let lastFetchAt = 0

interface PaperPosition {
  coin: Coin
  side: 'LONG'
  entry: number
  size: number
  openedAt: number
}
let position: PaperPosition | null = loadPosition()

function loadPosition(): PaperPosition | null {
  try {
    const raw = localStorage.getItem('glancefi.position')
    return raw ? (JSON.parse(raw) as PaperPosition) : null
  } catch {
    return null
  }
}
function savePosition() {
  try {
    if (position) localStorage.setItem('glancefi.position', JSON.stringify(position))
    else localStorage.removeItem('glancefi.position')
  } catch {
    // local storage unavailable — paper position lives in memory only
  }
}

const ALERTS = [
  { coin: 'BTC' as Coin, dir: '>', px: 65000 },
  { coin: 'ETH' as Coin, dir: '<', px: 1750 },
  { coin: 'SOL' as Coin, dir: '>', px: 80 },
]
let alertIdx = 0
const fired = new Set<string>()

// ---------- Telegram alert digest (Best Telegram angle) ----------
// Token + chat id are the user's own config, stored only in this device's
// localStorage (set from the phone companion below). Never shipped in the
// repo, never hard-coded. Tap on the Telegram screen sends one digest.
const TG_API = 'https://api.telegram.org'
let tgStatus = ''
function tgConfig(): { token: string; chat: string } | null {
  try {
    const token = (localStorage.getItem('glancefi.tg.token') || '').trim()
    const chat = (localStorage.getItem('glancefi.tg.chat') || '').trim()
    return token && chat ? { token, chat } : null
  } catch {
    return null
  }
}
function digestText(): string {
  const lines = [`GlanceFi digest — ${new Date().toLocaleTimeString()}`]
  for (const coin of COINS) {
    const p = prices[coin]
    lines.push(`${coin} ${fmt(p.mid)}${fmtChg(p.chg24) ? `  ${fmtChg(p.chg24)} 24h` : ''}`)
  }
  if (position) {
    const p = prices[position.coin]
    const pnl = Number.isFinite(p.mid)
      ? ((p.mid - position.entry) / position.entry) * position.size
      : NaN
    lines.push(`Pos: ${position.coin} LONG $${position.size}  PnL ${Number.isFinite(pnl) ? (pnl >= 0 ? '+' : '') + pnl.toFixed(2) : '...'}`)
  } else {
    lines.push('Pos: none')
  }
  lines.push(fired.size > 0 ? `Alerts hit: ${[...fired].join(', ')}` : 'Alerts: none hit')
  lines.push('Paper only — no real orders.')
  return lines.join('\n')
}
async function sendTelegramDigest(): Promise<void> {
  const cfg = tgConfig()
  if (!cfg) {
    tgStatus = 'Belum diset: isi token + chat di HP dulu.'
    await render()
    return
  }
  tgStatus = 'Mengirim...'
  await render()
  try {
    const res = await fetch(`${TG_API}/bot${cfg.token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: cfg.chat, text: digestText() }),
    })
    tgStatus = res.ok ? 'Terkirim ke Telegram.' : `Gagal (${res.status}) — cek token/chat.`
  } catch {
    tgStatus = 'Gagal kirim — cek koneksi.'
  }
  await render()
}

type Screen = 'home' | 'trade' | 'position' | 'alerts' | 'telegram'
const SCREENS: Screen[] = ['home', 'trade', 'position', 'alerts', 'telegram']
let screen: Screen = 'home'
let selected = 0

// ---------- price fetching ----------

function fmt(n: number): string {
  if (!Number.isFinite(n)) return '...'
  return n >= 1000
    ? n.toLocaleString('en-US', { maximumFractionDigits: 0 })
    : n.toLocaleString('en-US', { maximumFractionDigits: 2 })
}
function fmtChg(c: number | null): string {
  if (c === null || !Number.isFinite(c)) return ''
  return `${c >= 0 ? '+' : ''}${(c * 100).toFixed(1)}%`
}

async function fetchMids(): Promise<void> {
  const res = await fetch(HL_INFO, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'allMids' }),
  })
  if (!res.ok) throw new Error(`allMids HTTP ${res.status}`)
  const mids = (await res.json()) as Record<string, string>
  for (const coin of COINS) {
    const v = Number(mids[coin])
    if (Number.isFinite(v)) prices[coin].mid = v
  }
  lastFetchOk = true
  lastFetchAt = Date.now()
  checkAlerts()
}

async function fetchChg24(): Promise<void> {
  const now = Date.now()
  for (const coin of COINS) {
    try {
      const res = await fetch(HL_INFO, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'candleSnapshot',
          req: { coin, interval: '1h', startTime: now - 25 * 3600_000, endTime: now },
        }),
      })
      if (!res.ok) continue
      const candles = (await res.json()) as { o: string; c: string }[]
      if (candles.length >= 2) {
        const open = Number(candles[0].o)
        const close = Number(candles[candles.length - 1].c)
        if (open > 0 && Number.isFinite(close)) prices[coin].chg24 = (close - open) / open
      }
    } catch {
      // keep previous 24h change
    }
  }
}

function checkAlerts() {
  for (const a of ALERTS) {
    const mid = prices[a.coin].mid
    if (!Number.isFinite(mid)) continue
    const hit = a.dir === '>' ? mid > a.px : mid < a.px
    if (hit) fired.add(`${a.coin}${a.dir}${a.px}`)
  }
}

async function refreshPrices() {
  try {
    await fetchMids()
  } catch (err) {
    console.error('price fetch failed:', err)
  }
  await render()
}

// ---------- screens ----------

function coinLine(coin: Coin, marker: string): string {
  const p = prices[coin]
  const chg = fmtChg(p.chg24)
  return `${marker} ${coin} ${fmt(p.mid)}${chg ? `  ${chg} 24h` : ''}`
}

function homeText(): string {
  const lines = ['GLANCEFI — Hyperliquid']
  for (let i = 0; i < COINS.length; i++) {
    lines.push(coinLine(COINS[i], i === selected ? '>' : ' '))
  }
  if (position) {
    const p = prices[position.coin]
    const pnl = Number.isFinite(p.mid)
      ? ((p.mid - position.entry) / position.entry) * position.size
      : NaN
    lines.push(`Pos: ${position.coin} LONG $${position.size}  PnL ${Number.isFinite(pnl) ? (pnl >= 0 ? '+' : '') + pnl.toFixed(2) : '...'}`)
  } else {
    lines.push('Pos: none — paper only')
  }
  if (fired.size > 0) lines.push(`Alert hit: ${[...fired].join(', ')}`)
  if (!lastFetchOk) lines.push('Fetching prices...')
  return lines.join('\n')
}

function tradeText(): string {
  const coin = COINS[selected]
  const p = prices[coin]
  if (position) {
    return [
      'TRADE — close position?',
      `${position.coin} LONG $${position.size}`,
      `Entry ${fmt(position.entry)}  Now ${fmt(p.mid)}`,
      '',
      '> TAP: close paper position',
      '  Swipe: back to prices',
    ].join('\n')
  }
  return [
    'TRADE — paper long',
    `${coin}  ${fmt(p.mid)}${fmtChg(p.chg24) ? `  ${fmtChg(p.chg24)} 24h` : ''}`,
    `Size $${PAPER_SIZE_USD}  Lev 1x`,
    'No real order. No wallet.',
    '',
    '> TAP: confirm paper long',
    '  Swipe: back to prices',
  ].join('\n')
}

function positionText(): string {
  if (!position) {
    return ['POSITION', 'No open paper position.', '', 'Go to Trade to open', 'a $100 paper long.', '', 'Tap: cycle coin'].join('\n')
  }
  const p = prices[position.coin]
  const pnl = Number.isFinite(p.mid)
    ? ((p.mid - position.entry) / position.entry) * position.size
    : NaN
  return [
    'POSITION — paper',
    `${position.coin} LONG $${position.size}`,
    `Entry ${fmt(position.entry)}`,
    `Now   ${fmt(p.mid)}`,
    `PnL   ${Number.isFinite(pnl) ? (pnl >= 0 ? '+' : '') + pnl.toFixed(2) : '...'}`,
    '',
    '> TAP: close position',
  ].join('\n')
}

function alertsText(): string {
  const lines = ['ALERTS']
  ALERTS.forEach((a, i) => {
    const key = `${a.coin}${a.dir}${a.px}`
    lines.push(`${i === alertIdx ? '>' : ' '} ${a.coin} ${a.dir} ${a.px.toLocaleString('en-US')}${fired.has(key) ? '  HIT' : ''}`)
  })
  lines.push('', 'Tap: next alert', 'Swipe: back to prices')
  return lines.join('\n')
}

function telegramText(): string {
  // Compact: the glasses body fits ~8 lines. The full digestText() is what
  // gets sent to Telegram; here we show the same numbers, squeezed.
  const lines = [`TELEGRAM — digest ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`]
  for (const coin of COINS) {
    const p = prices[coin]
    lines.push(`${coin} ${fmt(p.mid)}${fmtChg(p.chg24) ? `  ${fmtChg(p.chg24)} 24h` : ''}`)
  }
  if (position) {
    const p = prices[position.coin]
    const pnl = Number.isFinite(p.mid)
      ? ((p.mid - position.entry) / position.entry) * position.size
      : NaN
    lines.push(`Pos: ${position.coin} LONG $${position.size}  PnL ${Number.isFinite(pnl) ? (pnl >= 0 ? '+' : '') + pnl.toFixed(2) : '...'}`)
  } else {
    lines.push('Pos: none')
  }
  lines.push(fired.size > 0 ? `Alerts hit: ${[...fired].join(', ')}` : 'Alerts: none hit')
  lines.push(tgConfig() ? '> TAP: kirim digest ke Telegram' : '> TAP: cek status (set di HP dulu)')
  if (tgStatus) lines.push(tgStatus)
  return lines.join('\n')
}

function screenText(): string {
  switch (screen) {
    case 'home':
      return homeText()
    case 'trade':
      return tradeText()
    case 'position':
      return positionText()
    case 'alerts':
      return alertsText()
    case 'telegram':
      return telegramText()
  }
}

function pagerLabel(): string {
  const names: Record<Screen, string> = {
    home: 'Prices',
    trade: 'Trade',
    position: 'Position',
    alerts: 'Alerts',
    telegram: 'Telegram',
  }
  return `${names[screen]}  ·  tap: act  ·  swipe: screens  ·  dbl-tap: exit`
}

// ---------- bridge ----------

const bridge = await waitForEvenAppBridge()

const body = new TextContainerProperty({
  xPosition: 0,
  yPosition: 0,
  width: 576,
  height: 240,
  borderWidth: 0,
  borderColor: 5,
  paddingLength: 4,
  containerID: 1,
  containerName: 'body',
  content: 'GLANCEFI\nFetching prices...',
  isEventCapture: 1,
})

const pager = new TextContainerProperty({
  xPosition: 0,
  yPosition: 250,
  width: 576,
  height: 30,
  borderWidth: 0,
  borderColor: 5,
  paddingLength: 4,
  containerID: 2,
  containerName: 'pager',
  content: pagerLabel(),
  isEventCapture: 0,
})

const created = await bridge.createStartUpPageContainer(
  new CreateStartUpPageContainer({ containerTotalNum: 2, textObject: [body, pager] }),
)
if (created !== 0) console.error('createStartUpPageContainer failed:', created)
console.log('APP_READY')

let rendering: Promise<unknown> = Promise.resolve()
async function render() {
  const text = screenText()
  const label = pagerLabel()
  rendering = rendering.then(async () => {
    await bridge.textContainerUpgrade(
      new TextContainerUpgrade({ containerID: 1, containerName: 'body', content: text }),
    )
    await bridge.textContainerUpgrade(
      new TextContainerUpgrade({ containerID: 2, containerName: 'pager', content: label }),
    )
  })
  await rendering
  mirrorCompanion()

// Telegram config (companion only, stored in localStorage on this device)
try {
  const tokenInput = document.getElementById('tgToken') as HTMLInputElement | null
  const chatInput = document.getElementById('tgChat') as HTMLInputElement | null
  const saveBtn = document.getElementById('tgSave')
  const statusEl = document.getElementById('tgStatus')
  if (tokenInput) tokenInput.value = localStorage.getItem('glancefi.tg.token') || ''
  if (chatInput) chatInput.value = localStorage.getItem('glancefi.tg.chat') || ''
  if (statusEl && tgConfig()) statusEl.textContent = 'Tersimpan — siap kirim digest.'
  saveBtn?.addEventListener('click', () => {
    try {
      localStorage.setItem('glancefi.tg.token', tokenInput?.value.trim() || '')
      localStorage.setItem('glancefi.tg.chat', chatInput?.value.trim() || '')
      if (statusEl) statusEl.textContent = tgConfig() ? 'Tersimpan — siap kirim digest.' : 'Isi token + chat id dulu.'
    } catch {
      if (statusEl) statusEl.textContent = 'Gagal simpan.'
    }
    render().catch(err => console.error(err))
  })
} catch {
  // companion config unavailable — glasses screens still work
}
}

function doTap() {
  if (screen === 'home') {
    selected = (selected + 1) % COINS.length
  } else if (screen === 'trade') {
    if (position) {
      position = null
      savePosition()
      screen = 'position'
    } else {
      const coin = COINS[selected]
      const mid = prices[coin].mid
      if (Number.isFinite(mid)) {
        position = { coin, side: 'LONG', entry: mid, size: PAPER_SIZE_USD, openedAt: Date.now() }
        savePosition()
        screen = 'position'
      }
    }
  } else if (screen === 'position') {
    if (position) {
      position = null
      savePosition()
    }
    screen = 'trade'
  } else if (screen === 'alerts') {
    alertIdx = (alertIdx + 1) % ALERTS.length
  } else if (screen === 'telegram') {
    sendTelegramDigest().catch(err => console.error(err))
    return
  }
  render().catch(err => console.error(err))
}

function moveScreen(dir: 1 | -1) {
  const i = SCREENS.indexOf(screen)
  screen = SCREENS[(i + dir + SCREENS.length) % SCREENS.length]
  render().catch(err => console.error(err))
}

let cleanedUp = false
function cleanup() {
  if (cleanedUp) return
  cleanedUp = true
  unsubscribe()
}

// CLICK_EVENT is 0 and protobuf omits zero-value fields, so a single tap
// arrives as an envelope with eventType undefined. Resolve the default
// INSIDE the envelope check (same pattern as the official template).
function eventTypeOf(envelope?: { eventType?: OsEventTypeList }): OsEventTypeList | null {
  if (!envelope) return null
  return envelope.eventType ?? OsEventTypeList.CLICK_EVENT
}

const unsubscribe = bridge.onEvenHubEvent(event => {
  const sysType = eventTypeOf(event.sysEvent)
  const textType = eventTypeOf(event.textEvent)

  if (sysType === OsEventTypeList.DOUBLE_CLICK_EVENT || textType === OsEventTypeList.DOUBLE_CLICK_EVENT) {
    bridge.shutDownPageContainer(1)
    return
  }
  if (textType === OsEventTypeList.SCROLL_TOP_EVENT) {
    moveScreen(-1)
    return
  }
  if (textType === OsEventTypeList.SCROLL_BOTTOM_EVENT) {
    moveScreen(1)
    return
  }
  if (sysType === OsEventTypeList.CLICK_EVENT || textType === OsEventTypeList.CLICK_EVENT) {
    doTap()
    return
  }
  if (sysType === OsEventTypeList.SYSTEM_EXIT_EVENT || sysType === OsEventTypeList.ABNORMAL_EXIT_EVENT) {
    cleanup()
  }
})

window.addEventListener('beforeunload', cleanup)

// ---------- companion mirror (phone-side WebView) ----------

const app = document.querySelector<HTMLDivElement>('#app')!
app.innerHTML = `
  <main style="margin:auto;padding:24px;max-width:680px;box-sizing:border-box;">
    <header style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
      <h1 style="font-size:18px;font-weight:600;margin:0;">GlanceFi — Hyperliquid paper trading</h1>
      <span id="pageCount" style="font-size:12px;color:#919191;"></span>
    </header>
    <pre id="mirror" style="background:#2E2E2E;border:1px solid #3E3E3E;border-radius:12px;padding:20px;font-size:15px;line-height:1.55;white-space:pre-wrap;word-break:break-word;color:#E5E5E5;margin:0;"></pre>
    <section style="margin-top:16px;background:#2E2E2E;border:1px solid #3E3E3E;border-radius:12px;padding:16px;">
      <h2 style="font-size:14px;margin:0 0 8px;">Telegram digest (opsional)</h2>
      <p style="font-size:12px;color:#919191;margin:0 0 12px;">Token bot + chat id disimpan di HP ini saja, tidak ikut ke repo. Tap di layar Telegram kacamata untuk kirim digest.</p>
      <label style="display:block;font-size:12px;margin-bottom:4px;">Bot token</label>
      <input id="tgToken" type="password" placeholder="123456:ABC..." style="width:100%;box-sizing:border-box;padding:8px;border-radius:8px;border:1px solid #3E3E3E;background:#1E1E1E;color:#E5E5E5;margin-bottom:10px;">
      <label style="display:block;font-size:12px;margin-bottom:4px;">Chat id</label>
      <input id="tgChat" type="text" placeholder="@Zec3on atau -100..." style="width:100%;box-sizing:border-box;padding:8px;border-radius:8px;border:1px solid #3E3E3E;background:#1E1E1E;color:#E5E5E5;margin-bottom:10px;">
      <button id="tgSave" style="padding:8px 16px;border-radius:8px;border:0;background:#2E7D32;color:#fff;cursor:pointer;">Simpan</button>
      <span id="tgStatus" style="font-size:12px;color:#919191;margin-left:10px;"></span>
    </section>
    <footer style="font-size:12px;color:#7B7B7B;text-align:center;margin-top:16px;">
      Paper trading only — no real orders, no wallet, no funds. Tap glasses: act · swipe: screens · double-tap: exit
    </footer>
  </main>
`

function mirrorCompanion() {
  const mirror = document.getElementById('mirror')
  const count = document.getElementById('pageCount')
  if (mirror) mirror.textContent = screenText()
  if (count) count.textContent = lastFetchOk ? `live · ${new Date(lastFetchAt).toLocaleTimeString()}` : 'fetching…'
}

mirrorCompanion()

// ---------- live prices ----------
refreshPrices().catch(err => console.error(err))
setInterval(refreshPrices, 15_000)
setInterval(() => {
  fetchChg24().then(() => render()).catch(err => console.error(err))
}, 60_000)
fetchChg24().then(() => render()).catch(err => console.error(err))
