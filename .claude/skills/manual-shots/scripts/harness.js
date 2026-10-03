// 手順書用の GIF を撮るための共通部品。場面ごとの台本（scenes/*.js）から使う。
// 本物の main.js を使い捨ての設定で動かし、マウス・キーは input.ps1 で本物の入力として送る
// （右クリックメニューやホイールは、本物の入力でないと実物どおりに動かないため）。
const { app, BrowserWindow, screen, ipcMain } = require('electron')
const Module = require('module')
const path = require('path')
const fs = require('fs')
const { spawn } = require('child_process')

// scripts → manual-shots → skills → .claude → プロジェクト
const ROOT = path.resolve(__dirname, '..', '..', '..', '..')

const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith('--' + k + '=')); return a ? a.slice(k.length + 3) : d }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let WORK, RUN, OUT, LOGF
const lines = []
function log(...a) {
  lines.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' '))
  if (LOGF) fs.writeFileSync(LOGF, lines.join('\n'), 'utf8')
}

// 使い捨ての置き場を作り、設定を書いてから main.js を読み込む。
// 返す A は main.js の中の関数・変数への窓口（名前が無くなっていたら null）
function boot(scene) {
  WORK = arg('work')
  if (!WORK) throw new Error('--work=<使い捨てフォルダ> が要る')
  RUN = arg('run', '1')
  const dir = (n) => path.join(WORK, scene + '-' + RUN, n)
  const UD = dir('userdata'), SAVE = dir('save'), STAGE = dir('stage')
  OUT = dir('out')
  LOGF = path.join(WORK, scene + '-' + RUN, 'log.txt')
  for (const d of [UD, SAVE, STAGE, OUT]) fs.mkdirSync(d, { recursive: true })
  app.setPath('userData', UD)
  fs.writeFileSync(path.join(UD, 'settings.json'), JSON.stringify({
    hotkeyRegion: '', saveDir: SAVE, autoBlur: false, libraryPinned: true,
    recordAudio: false, recordAutoBlur: false, recordCountdown: 0, captureCursor: false, gifMaxWidth: Number(arg('gifw', '0')), recordFps: 15, gifFps: 10,
  }), 'utf8')

  const MAIN = path.join(ROOT, 'main.js')
  const names = ['startRecording', 'stopRecording', 'closeRecordWindow', 'deleteEntry', 'notifyLibraryChanged',
    'openPin', 'openEditor', 'fitContentBounds', 'libraryWin', 'editorWins', 'pinWins', 'DIFF_COLOR', 'DIFF_WIDTH', 'startRegionCapture', 'recording', 'openSettings', 'settingsWin']
  const expose = names.map((n) => `get ${n}() { return typeof ${n} === 'undefined' ? null : ${n} }`).join(',\n')
  const mm = new Module(MAIN, module)
  mm.filename = MAIN
  mm.paths = Module._nodeModulePaths(ROOT)
  mm._compile(fs.readFileSync(MAIN, 'utf8') + '\n;global.__app = {\n' + expose + '\n}\n', MAIN)

  // 時間切れの保険。キーの押しっぱなしを残さないよう input.ps1 を先に終わらせる
  setTimeout(() => { log('TIMEOUT'); finish(2) }, Number(arg('timeout', '300000')))
  return { A: global.__app, UD, SAVE, STAGE, OUT, WORK, RUN, arg, log }
}

const wins = () => BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed())
const byUrl = (s) => wins().filter((w) => w.webContents.getURL().includes(s))
async function waitFor(fn, ms = 10000) {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    try { const v = await fn(); if (v) return v } catch (_) {}
    await sleep(120)
  }
  return null
}

// DIP の点・四角を、input.ps1 と録画が使う実ピクセルに直す
function phys(x, y) { const q = screen.dipToScreenPoint({ x, y }); return { x: Math.round(q.x), y: Math.round(q.y) } }
function physRect(r) {
  const tl = phys(r.x, r.y)
  const br = phys(r.x + r.width, r.y + r.height)
  // MP4 は縦横が偶数でないと録れない
  return { x: tl.x, y: tl.y, width: (br.x - tl.x) & ~1, height: (br.y - tl.y) & ~1 }
}

// ---- 本物の入力（input.ps1）
let ps = null
let psBuf = ''
const psWaiters = []
let CAPS = {}
function onPsLine(line) {
  if (!line) return
  log('ps', line)
  if (line.startsWith('CAP ')) caption(CAPS[line.slice(4)])
  if (line === 'CAPOFF') caption(null)
  if (line === 'CLICK') ripple()
  for (let i = psWaiters.length - 1; i >= 0; i--) {
    if (psWaiters[i].t === line) { psWaiters[i].r(); psWaiters.splice(i, 1) }
  }
}
function waitLine(t, ms = 30000) {
  return new Promise((resolve, reject) => {
    psWaiters.push({ t, r: resolve })
    setTimeout(() => reject(new Error('timeout waiting for ' + t)), ms)
  })
}
function startInput() {
  ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'input.ps1')], { stdio: ['pipe', 'pipe', 'pipe'] })
  ps.stdout.on('data', (d) => {
    psBuf += d.toString()
    let i
    while ((i = psBuf.indexOf('\n')) >= 0) { onPsLine(psBuf.slice(0, i).trim()); psBuf = psBuf.slice(i + 1) }
  })
  ps.stderr.on('data', (d) => log('ps-err', d.toString()))
  return waitLine('READY', 20000)
}
// 命令を順に流して、全部終わるまで待つ。押す瞬間には録画用の矢印に波紋を出す
async function run(cmds) {
  const out = []
  for (const c of cmds) { if (c === 'click' || c === 'rclick' || c === 'ldown') out.push('echo CLICK'); out.push(c) }
  ps.stdin.write(out.concat(['echo END']).join('\n') + '\n')
  await waitLine('END', 120000)
}
const mv = (p, ms) => `move ${p.x} ${p.y} ${ms}`
const cap = (id) => 'echo CAP ' + id   // 字幕の文字は日本語なので、input.ps1 には番号だけ通す

// ---- 字幕（録画に写る赤い吹き出し）
let capWin = null
function makeCaption(rectDip, caps) {
  CAPS = caps
  capWin = new BrowserWindow({
    x: rectDip.x, y: rectDip.y, width: rectDip.width, height: rectDip.height,
    frame: false, transparent: true, resizable: false, focusable: false, skipTaskbar: true,
    hasShadow: false, show: false, alwaysOnTop: true,
  })
  capWin.setIgnoreMouseEvents(true)
  capWin.setAlwaysOnTop(true, 'screen-saver')
  return capWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(
    '<!doctype html><meta charset="utf-8"><style>html,body{margin:0;height:100%;background:transparent;overflow:hidden}'
    + 'body{display:flex;align-items:center;justify-content:center}'
    + '#c{background:rgba(232,69,60,.96);color:#fff;font:bold 22px "Yu Gothic UI","Meiryo",sans-serif;padding:9px 20px;border-radius:12px;box-shadow:0 2px 10px rgba(0,0,0,.35)}'
    + '</style><div id="c"></div>'))
}
function moveCaption(rectDip) { if (capWin && !capWin.isDestroyed()) capWin.setBounds(rectDip) }
function caption(text) {
  if (!capWin || capWin.isDestroyed()) return
  if (!text) { capWin.hide(); return }
  capWin.webContents.executeJavaScript('document.getElementById("c").textContent = ' + JSON.stringify(text))
  capWin.showInactive()
  capWin.moveTop()
}

// ---- 録画用の矢印。Windows の「入力中にポインターを隠す」がオンだと、キーを打ったあとは
// 手でマウスを動かすまで本物の矢印が消えたまま（台本の移動では戻らない）なので、自前で描いて重ねる
const CUR = 80
let curWin = null
let curTimer = null
async function makeCursor() {
  curWin = new BrowserWindow({
    width: CUR, height: CUR, frame: false, transparent: true, resizable: false, focusable: false,
    skipTaskbar: true, hasShadow: false, show: false, alwaysOnTop: true,
  })
  curWin.setIgnoreMouseEvents(true)
  curWin.setAlwaysOnTop(true, 'screen-saver')
  const h = CUR / 2
  await curWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(
    '<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:transparent;overflow:hidden}'
    + `#r{position:absolute;left:${h - 18}px;top:${h - 18}px;width:36px;height:36px;border-radius:50%;border:4px solid rgba(232,69,60,.9);box-sizing:border-box;opacity:0}`
    + '#r.on{animation:p .45s ease-out}@keyframes p{0%{opacity:1;transform:scale(.3)}100%{opacity:0;transform:scale(1.4)}}'
    + `svg{position:absolute;left:${h}px;top:${h}px;filter:drop-shadow(1px 2px 2px rgba(0,0,0,.45))}</style>`
    + '<div id="r"></div><svg width="22" height="33" viewBox="0 0 22 33"><path d="M1 1 L1 25 L7 19.5 L11.5 30 L15.5 28.3 L11 18 L19.5 18 Z" fill="#fff" stroke="#000" stroke-width="1.6" stroke-linejoin="round"/></svg>'
    + '<script>function ripple(){const r=document.getElementById("r");r.classList.remove("on");void r.offsetWidth;r.classList.add("on")}</script>'))
  // 窓の真ん中が矢印の先。右クリックのメニューも最前面なので、ときどき持ち上げて矢印を上に保つ
  let n = 0
  curTimer = setInterval(() => {
    if (!curWin || curWin.isDestroyed()) return
    const p = screen.getCursorScreenPoint()
    curWin.setPosition(Math.round(p.x - CUR / 2), Math.round(p.y - CUR / 2))
    if (curShown && ++n % 6 === 0) curWin.moveTop()
  }, 16)
  curWin.showInactive()
}
// 字幕と矢印を一時的に隠す／戻す。アプリが画面を静止画にする瞬間（範囲選択の暗幕・スクロール撮影）に
// 写り込ませないため
let curShown = true
function overlaysVisible(on) {
  curShown = on
  if (curWin && !curWin.isDestroyed()) { if (on) { curWin.showInactive(); curWin.moveTop() } else curWin.hide() }
  if (!on && capWin && !capWin.isDestroyed()) capWin.hide()
}

function ripple() {
  if (curWin && !curWin.isDestroyed()) curWin.webContents.executeJavaScript('ripple()').catch(() => {})
}

// ---- アプリ自身の録画機能で1本撮る。cmds は命令の配列か async 関数。rectDip の範囲を録り、GIF を OUT/<name>.gif に写す
async function clip(ctx, name, rectDip, cmds) {
  const { A, SAVE, OUT } = ctx
  const disp = screen.getDisplayMatching(rectDip)
  const o = phys(disp.bounds.x, disp.bounds.y)
  const r = physRect(rectDip)
  const crop = { x: r.x - o.x, y: r.y - o.y, width: r.width, height: r.height }
  const before = new Set(fs.readdirSync(SAVE))
  A.startRecording(disp, crop)
  // record.js は録り始めても合図を送らないので、画面側の phase を見に行く
  const started = await waitFor(async () => {
    const w = byUrl('record.html')[0]
    return w && await w.webContents.executeJavaScript("typeof phase !== 'undefined' && phase === 'rec'")
  }, 15000)
  if (!started) throw new Error('recording did not start: ' + name)
  await sleep(900)
  // 命令の配列か、途中でアプリの様子を待つときは async 関数（中で run() を何回か呼ぶ）
  if (typeof cmds === 'function') await cmds()
  else await run(cmds)
  await sleep(200)
  A.stopRecording()
  const gif = await waitFor(() => fs.readdirSync(SAVE).find((f) => f.endsWith('.gif') && !before.has(f)), 120000)
  if (!gif) throw new Error('gif not written: ' + name)
  await sleep(400)
  fs.copyFileSync(path.join(SAVE, gif), path.join(OUT, name + '.gif'))
  log('gif', name, fs.statSync(path.join(OUT, name + '.gif')).size)
  A.closeRecordWindow()
  await sleep(600)
}

// ---- アプリの録画機能を使わずに1本撮る（録画そのものを見せるときなど、アプリの録画が使えない場面用）。
// grabber.ps1 が rectDip を ms ごとに撮り、アプリの GIF 部品（lib/gif.js）でつなぐ。
// Windows の「写さない」設定（setContentProtection）が付いた窓は写らないので、見せたい窓は先に外しておく
async function grabClip(ctx, name, rectDip, cmds, ms = 100) {
  const r = physRect(rectDip)
  // 消さずに済むよう、毎回新しいフォルダに撮る
  const dir = path.join(ctx.OUT, name + '-frames-' + Date.now())
  const g = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'grabber.ps1'),
    '-X', r.x, '-Y', r.y, '-W', r.width, '-H', r.height, '-Dir', dir, '-Ms', ms].map(String), { stdio: 'ignore' })
  const done = new Promise((res) => g.on('exit', res))
  if (!(await waitFor(() => fs.existsSync(dir) && fs.readdirSync(dir).some((f) => f.endsWith('.png')), 20000))) throw new Error('grabber did not start')
  await sleep(300)
  try {
    if (typeof cmds === 'function') await cmds()
    else await run(cmds)
  } finally {
    fs.writeFileSync(path.join(dir, 'stop'), '')
    await done
  }
  const { nativeImage } = require('electron')
  const GifLib = require(path.join(ROOT, 'lib', 'gif.js'))
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.png')).sort()
  const times = files.map((f) => Number(f.slice(0, -4)))
  const gif = GifLib.createGif(r.width, r.height)
  for (let i = 0; i < files.length; i++) {
    const bgra = nativeImage.createFromPath(path.join(dir, files[i])).toBitmap()
    const rgba = new Uint8ClampedArray(bgra.length)
    for (let p = 0; p < bgra.length; p += 4) { rgba[p] = bgra[p + 2]; rgba[p + 1] = bgra[p + 1]; rgba[p + 2] = bgra[p]; rgba[p + 3] = 255 }
    gif.addFrame(rgba, i ? times[i] - times[i - 1] : 0)
  }
  // 最後のコマを少し見せてから終える（同じ絵を足すと、前のコマが長く出る）
  if (files.length) {
    const last = nativeImage.createFromPath(path.join(dir, files[files.length - 1])).toBitmap()
    const rgba = new Uint8ClampedArray(last.length)
    for (let p = 0; p < last.length; p += 4) { rgba[p] = last[p + 2]; rgba[p + 1] = last[p + 1]; rgba[p + 2] = last[p]; rgba[p + 3] = 255 }
    gif.addFrame(rgba, 1200)
  }
  fs.writeFileSync(path.join(ctx.OUT, name + '.gif'), Buffer.from(gif.finish()))
  log('gif', name, 'frames', files.length, 'ms', times.length ? times[times.length - 1] : 0, 'bytes', fs.statSync(path.join(ctx.OUT, name + '.gif')).size)
}

// 録画を開かずに、その範囲の静止画だけ撮る（位置合わせの確認用）
async function grab(rectDip, file) {
  const r = physRect(rectDip)
  await run([`grab ${r.x} ${r.y} ${r.width} ${r.height} ${file}`])
}

// 録る範囲の全体を無地の窓で覆う（ほかの窓より先に作る）。架空の画面の窓より広く録るときは必ず使う。
// 覆わないと、すき間から本物の画面が写る
async function makeBackdrop(rectDip, color) {
  const w = new BrowserWindow({
    x: rectDip.x, y: rectDip.y, width: rectDip.width, height: rectDip.height, useContentSize: true,
    frame: false, resizable: false, focusable: false, skipTaskbar: true, hasShadow: false, show: false,
    alwaysOnTop: true, backgroundColor: color || '#2b2f36',
  })
  w.setIgnoreMouseEvents(true)
  await w.loadURL('data:text/html,<body style="margin:0;background:' + encodeURIComponent(color || '#2b2f36') + '"></body>')
  w.showInactive()
  return w
}

// 架空の画面（<work>/dummy/<name>.png）を取り込んで編集画面で開き、画面の真ん中・最前面に置く。
// 返す at(x, y) は「絵の座標 → 画面の実ピクセル」、img は絵が見えている四角（DIP）、el(sel) は画面の部品の四角（DIP）
async function openInEditor(ctx, name, height) {
  const { app, screen: scr } = require('electron')
  const src = path.join(ctx.STAGE, 'ScreenShooter_2026-09-28_' + name + '.png')
  fs.copyFileSync(path.join(ctx.WORK, 'dummy', name + '.png'), src)
  app.emit('second-instance', {}, [process.execPath, src], ctx.STAGE)
  const ed = await waitFor(() => byUrl('editor.html')[0], 15000)
  if (!ed) throw new Error('editor did not open')
  await waitFor(() => ed.webContents.executeJavaScript('!!(state && state.img)'), 15000)
  const wa = scr.getPrimaryDisplay().workArea
  const eb = ed.getBounds()
  ed.setBounds({ x: Math.round(wa.x + (wa.width - eb.width) / 2), y: Math.round(wa.y + (wa.height - height) / 2), width: eb.width, height })
  ed.setAlwaysOnTop(true)
  await sleep(900)
  const g = await ed.webContents.executeJavaScript(
    '(() => { const r = cv.getBoundingClientRect(); const v = view(); return { left: r.left, top: r.top, w: r.width, h: r.height, zoom: state.zoom, vx: v.x, vy: v.y } })()')
  const cb = ed.getContentBounds()
  log('editor', cb, 'canvas', g)
  const at = (x, y) => phys(cb.x + g.left + (x - g.vx) * g.zoom, cb.y + g.top + (y - g.vy) * g.zoom)
  const img = { x: cb.x + g.left, y: cb.y + g.top, w: g.w, h: g.h }
  const el = async (sel) => {
    const r = await ed.webContents.executeJavaScript(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height } })()`)
    return r && { x: cb.x + r.x, y: cb.y + r.y, width: r.width, height: r.height }
  }
  return { ed, cb, g, at, img, el }
}

// 本物のキーでは日本語が打てないので、欄に1文字ずつ入れて打っているように見せる（input を流して画面側の処理も走らせる）
function typeInto(win, sel, text, ms = 130) {
  return win.webContents.executeJavaScript(`(async () => {
    const el = document.querySelector(${JSON.stringify(sel)})
    el.focus()
    for (const ch of ${JSON.stringify(text)}) {
      el.value += ch
      el.selectionStart = el.selectionEnd = el.value.length
      el.dispatchEvent(new Event('input', { bubbles: true }))
      await new Promise((r) => setTimeout(r, ${ms}))
    }
    return true })()`)
}

let finishing = false
async function finish(code) {
  if (finishing) return
  finishing = true
  if (curTimer) clearInterval(curTimer)
  try { ps && ps.stdin.write('quit\n') } catch (_) {}
  await sleep(400)
  try { ps && ps.kill() } catch (_) {}
  app.exit(code || 0)
}

// 場面の本体を動かす。例外はログに残して必ず後片付けする
function main(scene, body) {
  let ctx
  try { ctx = boot(scene) } catch (e) { console.error(e); app.exit(1); return }
  app.whenReady().then(async () => {
    let code = 0
    try {
      await sleep(1500)
      await startInput()
      await body(ctx)
      log('DONE')
    } catch (e) {
      code = 1
      log('ERR', String(e && e.stack || e))
    }
    await finish(code)
  })
}

module.exports = {
  ROOT, arg, sleep, log, wins, byUrl, waitFor, phys, physRect,
  run, mv, cap, typeInto, overlaysVisible, makeBackdrop, grabClip, makeCaption, moveCaption, caption, makeCursor, clip, grab, main, openInEditor,
}
