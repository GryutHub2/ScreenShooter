'use strict'

const cv = document.getElementById('cv')
const ctx = cv.getContext('2d')
const wrap = document.getElementById('canvasWrap')
const textEdit = document.getElementById('textEdit')
const toastEl = document.getElementById('toast')
const toastMsg = document.getElementById('toastMsg')
const toastAction = document.getElementById('toastAction')

const ZOOM_STEPS = [0.1, 0.15, 0.25, 0.33, 0.5, 0.67, 0.75, 1, 1.25, 1.5, 2, 3, 4]
const WIDTHS = [2, 4, 7, 12, 20]
// 蛍光ペンの太さ。ふつうの太さ（最大 20px）では画面の文字の高さに届かないので、専用の段階を持つ
const MARKER_WIDTHS = [12, 18, 24, 32, 44]
const FONT_SIZES = [9, 12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 48, 56, 64, 80, 96]
// 文字の飾り。値は図形（`deco`）にそのまま入るので、増やすときは main.js の TEXT_DECOS も直す
const DECOS = ['auto', 'white', 'black', 'shadow', 'white-shadow', 'none']
// フチの厚み。文字の大きさに対する比で持つ（大きい字にすると太さも一緒に育つ）
const HALOS = [
  { v: 0.05, label: 'フチ 細い' },
  { v: 0.09, label: 'フチ ふつう' },
  { v: 0.16, label: 'フチ 太い' },
  { v: 0.26, label: 'フチ 極太' },
  { v: 0.40, label: 'フチ ベタ塗り' },
]
const HALO_DEFAULT = 0.09
// 書き出しの仕上げ。値は設定にそのまま入るので、増やすときは main.js の EXPORT_FINISHES も直す
const FINISHES = ['none', 'border', 'shadow', 'backdrop']
const FINISH_LABELS = { none: 'そのまま', border: '黒い縁取り', shadow: '影つき', backdrop: '背景つき' }

// 段階を増減したとき、前回の値がボタンに無いと「どれも選ばれていない」状態になるので近い段階に寄せる
function nearest(list, v) {
  return list.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a), list[0])
}

const state = {
  img: null,
  imgW: 0,
  imgH: 0,
  crop: { x: 0, y: 0, w: 0, h: 0 },
  shapes: [],
  selectedId: null,
  tool: 'rect',
  color: '#e8453c',
  lineWidth: 4,
  markerWidth: 24,
  // 蛍光ペンは色も別に持つ。ほかの道具と共通だと既定の赤で引かれてしまう
  markerColor: '#f5b400',
  fontSize: 28,
  deco: 'auto',
  halo: HALO_DEFAULT,
  zoom: 1,
  fit: true,
  undo: [],
  redo: [],
  savedPath: null,
  dirty: false,
  copied: false,
  libraryId: null,
  finish: 'none', // 書き出しの仕上げ（FINISHES）。絵の中身ではなく書き出し方の設定なので undo には入れない
  focus: false,   // 集中モード（枠も道具も出さず、絵だけを出す）
  dataUrl: '',    // 元の絵。集中モードの出入りで窓を作り直すとき本体へ返す
  orig: null,     // 撮ったときの絵（大きさを変えるときは毎回ここから作り直す）
  scale: 1,       // 撮ったときの絵に対する今の大きさ。img・図形・切り抜きはすべてこの大きさの座標
}

let nextId = 1
let pending = null       // 描いている最中の図形
let pendingCrop = null   // 切り抜き中の枠
let drag = null
let editingShape = null  // 文字を入力中の図形
let editingIsNew = false
let toastTimer = null
let presets = []         // 書き方のお気に入り4つ（editor:init で本体から届く）

// ---------------------------------------------------------------- 基本の道具

function byId(id) { return state.shapes.find((s) => s.id === id) || null }

function norm(s) {
  const x = Math.min(s.x1, s.x2)
  const y = Math.min(s.y1, s.y2)
  return { x, y, w: Math.abs(s.x2 - s.x1), h: Math.abs(s.y2 - s.y1) }
}

function luminance(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '')
  if (!m) return 0.3
  const n = parseInt(m[1], 16)
  return 0.2126 * ((n >> 16 & 255) / 255) + 0.7152 * ((n >> 8 & 255) / 255) + 0.0722 * ((n & 255) / 255)
}

// 大きさも元に戻せるよう一緒に積む（図形の座標は大きさとセットでないと意味を持たないため）
function snapshot() {
  return JSON.stringify({ shapes: state.shapes, crop: state.crop, scale: state.scale })
}

function beginChange() { return snapshot() }

// 変化が無ければ履歴に積まない（クリックしただけで「元に戻す」が増えないようにするため）
function commitChange(before) {
  if (before === snapshot()) return
  state.undo.push(before)
  if (state.undo.length > 80) state.undo.shift()
  state.redo.length = 0
  state.dirty = true
  scheduleLibrarySync()
  updateUi()
}

function restore(snap) {
  const o = JSON.parse(snap)
  if ((o.scale || 1) !== state.scale) useScale(o.scale || 1)
  state.shapes = o.shapes
  state.crop = o.crop
  state.selectedId = null
  for (const s of state.shapes) if (s.id >= nextId) nextId = s.id + 1
}

function undo() {
  if (!state.undo.length) return
  cancelText()
  const cur = snapshot()
  restore(state.undo.pop())
  state.redo.push(cur)
  state.dirty = true
  scheduleLibrarySync()
  layout(); draw(); updateUi()
}

function redo() {
  if (!state.redo.length) return
  cancelText()
  const cur = snapshot()
  restore(state.redo.pop())
  state.undo.push(cur)
  state.dirty = true
  scheduleLibrarySync()
  layout(); draw(); updateUi()
}

// ---------------------------------------------------------------- 描画

const blurTmp = document.createElement('canvas')

function drawShape(g, s, list) {
  if (s.type === 'text' && editingShape && editingShape.id === s.id) return
  g.save()
  g.lineCap = 'round'
  g.lineJoin = 'round'
  g.strokeStyle = s.color
  g.fillStyle = s.color
  g.lineWidth = s.width

  if (s.type === 'rect') {
    const r = norm(s)
    g.strokeRect(r.x, r.y, r.w, r.h)
  } else if (s.type === 'ellipse') {
    const r = norm(s)
    g.beginPath()
    g.ellipse(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, r.h / 2, 0, 0, Math.PI * 2)
    g.stroke()
  } else if (s.type === 'marker') {
    drawMarker(g, s)
  } else if (s.type === 'line') {
    g.beginPath(); g.moveTo(s.x1, s.y1); g.lineTo(s.x2, s.y2); g.stroke()
  } else if (s.type === 'arrow') {
    drawArrow(g, s)
  } else if (s.type === 'pen') {
    drawPen(g, s)
  } else if (s.type === 'step') {
    drawStep(g, s)
  } else if (s.type === 'blur') {
    drawBlur(g, s)
  } else if (s.type === 'text') {
    drawText(g, s)
  } else if (s.type === 'zoom') {
    drawZoom(g, s, list || state.shapes)
  }
  // スポットライト（spot）は1つずつは描かない。paintScene がまとめて暗幕を塗る
  g.restore()
}

// 番号は持たずに、置いた順から毎回数える。
// こうしておくと途中の1つを消したときに、残りが自動で詰まって振り直される。
function stepNumber(s) {
  let n = 0
  for (const x of state.shapes) {
    if (x.type !== 'step') continue
    n++
    if (x.id === s.id) return n
  }
  return n + 1   // まだ配列に入っていない＝いま描いているもの
}

function stepRadius(fontSize) { return Math.max(9, (fontSize || 28) * 0.75) }

function drawStep(g, s) {
  const r = norm(s)
  const cx = r.x + r.w / 2
  const cy = r.y + r.h / 2
  const rx = Math.max(4, r.w / 2)
  const ry = Math.max(4, r.h / 2)

  g.beginPath()
  g.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2)
  g.fillStyle = s.color
  g.fill()
  // 同系色の背景でも輪郭が分かるように白い縁を付ける
  g.strokeStyle = 'rgba(255,255,255,.95)'
  g.lineWidth = Math.max(2, Math.min(rx, ry) * 0.14)
  g.stroke()

  const label = String(stepNumber(s))
  const size = Math.min(rx, ry) * (label.length >= 2 ? 1.05 : 1.3)
  g.font = '700 ' + size + 'px "Yu Gothic UI", "Meiryo", system-ui, sans-serif'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillStyle = luminance(s.color) > 0.62 ? '#1b1b1b' : '#ffffff'
  g.fillText(label, cx, cy + size * 0.04)
}

function drawPen(g, s) {
  if (penPath(g, s)) g.stroke()
}

// 拾った点をそのまま結ぶとカクカクするので、点と点の中点をつなぐ曲線にして滑らかにする
function penPath(g, s) {
  const p = s.points || []
  if (!p.length) return false
  g.beginPath()
  g.moveTo(p[0].x, p[0].y)
  if (p.length < 3) {
    g.lineTo(p[p.length - 1].x, p[p.length - 1].y)
  } else {
    for (let i = 1; i < p.length - 1; i++) {
      g.quadraticCurveTo(p[i].x, p[i].y, (p[i].x + p[i + 1].x) / 2, (p[i].y + p[i + 1].y) / 2)
    }
    g.lineTo(p[p.length - 1].x, p[p.length - 1].y)
  }
  return true
}

const MARKER_ALPHA = { multiply: 0.55, normal: 0.4 }

// 蛍光ペン。1本の線を1回で塗るので、自分と重なった所が二重に濃くならない。
// 明るい地は乗算で下の文字をくっきり残す。暗い地で乗算にすると色が沈んで見えなくなるので、ふつうの半透明にする
function drawMarker(g, s) {
  const blend = s.blend === 'multiply' ? 'multiply' : 'normal'
  g.globalAlpha = MARKER_ALPHA[blend]
  if (blend === 'multiply') g.globalCompositeOperation = 'multiply'
  g.lineCap = 'butt'
  if (penPath(g, s)) g.stroke()
}

const blendTmp = document.createElement('canvas')

// 蛍光ペンの混ぜ方は、描いた時点で下の絵の明るさを測って図形に持たせる（開くたびに測り直すとぶれるため）
function markerBlend(b) {
  const x = Math.max(0, Math.floor(b.x))
  const y = Math.max(0, Math.floor(b.y))
  const w = Math.min(state.imgW, Math.ceil(b.x + b.w)) - x
  const h = Math.min(state.imgH, Math.ceil(b.y + b.h)) - y
  if (!state.img || w < 1 || h < 1) return 'normal'
  const tw = Math.max(1, Math.min(64, w))
  const th = Math.max(1, Math.min(64, h))
  blendTmp.width = tw
  blendTmp.height = th
  const t = blendTmp.getContext('2d', { willReadFrequently: true })
  t.clearRect(0, 0, tw, th)
  t.drawImage(state.img, x, y, w, h, 0, 0, tw, th)
  let sum = 0
  let n = 0
  try {
    const d = t.getImageData(0, 0, tw, th).data
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 8) continue
      sum += (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255
      n++
    }
  } catch (_) {
    return 'normal'
  }
  return n && sum / n > 0.5 ? 'multiply' : 'normal'
}

function r1(v) { return Math.round(v * 10) / 10 }

// 点を全部拾うと履歴のデータが膨らむので、一定距離動いたときだけ足す
function addPenPoint(s, p) {
  const last = s.points[s.points.length - 1]
  if (Math.hypot(p.x - last.x, p.y - last.y) < Math.max(1, 1.5 / state.zoom)) return
  s.points.push({ x: r1(p.x), y: r1(p.y) })
  s.x1 = Math.min(s.x1, p.x); s.y1 = Math.min(s.y1, p.y)
  s.x2 = Math.max(s.x2, p.x); s.y2 = Math.max(s.y2, p.y)
}

function drawArrow(g, s) {
  const dx = s.x2 - s.x1
  const dy = s.y2 - s.y1
  const len = Math.hypot(dx, dy)
  if (len < 0.5) return
  const head = Math.max(s.width * 3.6, 9)
  const ux = dx / len
  const uy = dy / len
  // 線は矢じりの手前で止める（太い線の先端が矢じりからはみ出さないようにするため）
  g.beginPath()
  g.moveTo(s.x1, s.y1)
  g.lineTo(s.x2 - ux * head * 0.85, s.y2 - uy * head * 0.85)
  g.stroke()
  const px = -uy
  const py = ux
  const hw = head * 0.52
  g.beginPath()
  g.moveTo(s.x2, s.y2)
  g.lineTo(s.x2 - ux * head + px * hw, s.y2 - uy * head + py * hw)
  g.lineTo(s.x2 - ux * head - px * hw, s.y2 - uy * head - py * hw)
  g.closePath()
  g.fill()
}

// ぼかしは絵の一部なので、切り抜き範囲の外には描かない（捨てた所がモザイクで戻ってくるため）。
// モザイクの目は枠全体から作る（切り抜きで目の並びが変わらないように）ので、塗るときだけ clip する
function drawBlur(g, s) {
  const r = norm(s)
  const x = Math.max(0, r.x)
  const y = Math.max(0, r.y)
  const w = Math.min(state.imgW, r.x + r.w) - x
  const h = Math.min(state.imgH, r.y + r.h) - y
  if (w < 2 || h < 2) return
  const c = state.crop
  g.beginPath()
  g.rect(c.x, c.y, c.w, c.h)
  g.clip()

  // 太さの段階に合わせてモザイクの粗さも変える。
  // 細かすぎると文字が読めてしまうので、いちばん細い段階でも 8px は確保する
  const block = Math.max(8, Math.round(s.width * 2.6))
  const tw = Math.max(1, Math.round(w / block))
  const th = Math.max(1, Math.round(h / block))
  blurTmp.width = tw
  blurTmp.height = th
  const t = blurTmp.getContext('2d')
  t.imageSmoothingEnabled = true
  t.imageSmoothingQuality = 'high'
  t.clearRect(0, 0, tw, th)
  t.drawImage(state.img, x, y, w, h, 0, 0, tw, th)

  g.imageSmoothingEnabled = false
  g.drawImage(blurTmp, 0, 0, tw, th, x, y, w, h)
  g.imageSmoothingEnabled = true
}

// ---------------------------------------------------------------- スポットライト・拡大鏡

// まわりを暗くする濃さ。spot ごとに変えると1枚の暗幕で表せないので固定にしている
const SPOT_DIM = 0.5

const spotLayer = document.createElement('canvas')

// 暗幕は別の canvas に「切り抜き範囲を塗る → spot の四角と蛍光ペンの線を抜く」で作ってから重ねる。
// 蛍光ペンの下まで暗くすると、乗算の蛍光ペンは暗さを掛け算で受け継いで暗幕の下にあるように見えるので、線の所は抜く
// （抜いた所はスポットが無いときと同じ見え方になる）。抜くのは不透明で1回ずつなので、重なった所も二重に暗くならない。
// はみ出した透明の部分は塗らない
function paintSpots(g, list) {
  const spots = list.filter((s) => s.type === 'spot')
  if (!spots.length) return
  const L = spotLayer
  if (L.width !== g.canvas.width || L.height !== g.canvas.height) {
    L.width = g.canvas.width
    L.height = g.canvas.height
  }
  const t = L.getContext('2d')
  t.setTransform(1, 0, 0, 1, 0, 0)
  t.globalCompositeOperation = 'source-over'
  t.clearRect(0, 0, L.width, L.height)
  t.setTransform(g.getTransform())
  const c = state.crop
  t.fillStyle = 'rgba(0,0,0,' + SPOT_DIM + ')'
  t.fillRect(c.x, c.y, c.w, c.h)
  t.globalCompositeOperation = 'destination-out'
  t.fillStyle = '#000'
  t.strokeStyle = '#000'
  for (const s of spots) {
    const r = norm(s)
    t.fillRect(r.x, r.y, r.w, r.h)
  }
  t.lineCap = 'butt'
  t.lineJoin = 'round'
  for (const s of list) {
    if (s.type !== 'marker') continue
    t.lineWidth = s.width
    if (penPath(t, s)) t.stroke()
  }
  g.save()
  g.setTransform(1, 0, 0, 1, 0, 0)
  g.drawImage(L, 0, 0)
  g.restore()
}

// 拡大鏡は「元の枠（x1..y2）」と「のぞき窓（中心 cx,cy・半径 r）」を持つ。
// 倍率は持たず、のぞき窓の直径 ÷ 元の枠の対角線で毎回決める（枠の中身が丸に全部収まる大きさ）。
// こうしておくと、どちらかのハンドルで大きさを変えるだけで倍率も変わる
function zoomScale(s) {
  const f = norm(s)
  return (2 * s.r) / Math.max(1, Math.hypot(f.w, f.h))
}

// のぞき窓の影の大きさ（画像の px）。見積もりは paintBounds でも使う
function zoomShadow(s) {
  return { blur: Math.max(4, s.r * 0.08), dy: Math.max(2, s.r * 0.03) }
}

const zoomTmp = document.createElement('canvas')

// のぞき窓の中身は state.img から直に取らない。ぼかした所が拡大で読めてしまうので、
// 拡大元の範囲だけの小さな canvas に「絵＋ぼかし」を描いてから拡大する（原寸の作業用 canvas は作らない）。
// 切り抜きで捨てた所も写さない
function drawZoom(g, s, list) {
  const f = norm(s)
  const fcx = f.x + f.w / 2
  const fcy = f.y + f.h / 2
  const k = zoomScale(s)
  const side = Math.hypot(f.w, f.h)
  const sx = fcx - side / 2
  const sy = fcy - side / 2
  const tw = Math.max(1, Math.ceil(side))
  zoomTmp.width = tw
  zoomTmp.height = tw
  const t = zoomTmp.getContext('2d')
  t.clearRect(0, 0, tw, tw)
  t.setTransform(1, 0, 0, 1, -sx, -sy)
  const c = state.crop
  t.save()
  t.beginPath()
  t.rect(c.x, c.y, c.w, c.h)
  t.clip()
  if (state.img) t.drawImage(state.img, 0, 0)
  for (const b of list) if (b.type === 'blur') drawShape(t, b)
  t.restore()

  // 元の枠と、のぞき窓へ向かう線。線は丸の中心まで引き、丸で上から隠す
  g.strokeRect(f.x, f.y, f.w, f.h)
  const dx = s.cx - fcx
  const dy = s.cy - fcy
  const inside = Math.abs(dx) <= f.w / 2 && Math.abs(dy) <= f.h / 2
  if (!inside && Math.hypot(dx, dy) > s.r) {
    const tt = Math.min(dx ? (f.w / 2) / Math.abs(dx) : Infinity, dy ? (f.h / 2) / Math.abs(dy) : Infinity)
    g.beginPath()
    g.moveTo(fcx + dx * tt, fcy + dy * tt)
    g.lineTo(s.cx, s.cy)
    g.stroke()
  }

  // 影のぼかし幅とずれは canvas の変換（拡大表示）が効かないので、drawText と同じく倍率を自分で掛ける
  const sc = g.getTransform ? (g.getTransform().a || 1) : 1
  const sh = zoomShadow(s)
  g.save()
  g.beginPath()
  g.arc(s.cx, s.cy, s.r, 0, Math.PI * 2)
  g.shadowColor = 'rgba(0,0,0,.45)'
  g.shadowBlur = sh.blur * sc
  g.shadowOffsetY = sh.dy * sc
  g.fillStyle = '#ffffff'
  g.fill()
  g.restore()

  g.save()
  g.beginPath()
  g.arc(s.cx, s.cy, s.r, 0, Math.PI * 2)
  g.clip()
  g.imageSmoothingEnabled = true
  g.imageSmoothingQuality = 'high'
  g.drawImage(zoomTmp, 0, 0, tw, tw, s.cx - s.r, s.cy - s.r, tw * k, tw * k)
  g.restore()

  g.beginPath()
  g.arc(s.cx, s.cy, s.r, 0, Math.PI * 2)
  g.lineWidth = Math.max(2, s.width)
  g.stroke()
}

// 枠を取り終えたとき（描いている最中も）、のぞき窓を枠の横に置く。
// 右 → 左 → 下 → 上 の順に、切り抜き範囲に収まる所を探す。どこにも収まらなければ右に出す（画角が広がる）。
// 「収まる」はフチの太さの半分と影まで込みで見る（paintBounds と同じ見積もり。丸だけで見ると端に寄せたとき画角が数px広がる）。
// 狭い範囲や太いフチで収まらないときは、丸を元の7割まで小さくして収まる所を探す（画角を広げるよりましなため）。
// それでも置けないほど狭いときだけ、元の大きさで丸だけが収まる所を探す
function placeLens(s) {
  const f = norm(s)
  const c = state.crop
  const diag = Math.hypot(f.w, f.h)
  // 既定は2倍。大きな枠でも丸が絵より大きくならないように抑える。
  // 半径は 0.1px 単位（あとで丸めて外へ 0.05px 出ると、それだけで画角が 1px 広がるため）なので、10倍した整数で数える
  const r0 = Math.floor(Math.max(12, Math.min(diag, Math.max(40, 0.45 * Math.min(c.w, c.h)))) * 10)
  const rMin = Math.min(r0, Math.max(120, Math.ceil(r0 * 0.7)))
  // 中心の丸め（0.05px）で外へ出ないよう、少しだけ余分に空ける
  const outerOf = (r) => {
    const sh = zoomShadow({ r })
    return r + Math.max(2, s.width || 0) / 2 + sh.blur + sh.dy + 0.1
  }
  const fcx = f.x + f.w / 2
  const fcy = f.y + f.h / 2
  const find = (r, m) => {
    const gap = Math.max(12, r * 0.3)
    const clampY = (y) => Math.max(c.y + m, Math.min(c.y + c.h - m, y))
    const clampX = (x) => Math.max(c.x + m, Math.min(c.x + c.w - m, x))
    const tries = [
      { x: f.x + f.w + gap + r, y: clampY(fcy) },
      { x: f.x - gap - r, y: clampY(fcy) },
      { x: clampX(fcx), y: f.y + f.h + gap + r },
      { x: clampX(fcx), y: f.y - gap - r },
    ]
    const fits = (p) => p.x - m >= c.x && p.x + m <= c.x + c.w && p.y - m >= c.y && p.y + m <= c.y + c.h
    return tries.find(fits)
  }
  let r = r0 / 10
  let pick = null
  for (let t = r0; t >= rMin && !pick; t--) {
    pick = find(t / 10, outerOf(t / 10))
    if (pick) r = t / 10
  }
  if (!pick) {
    r = r0 / 10
    pick = find(r, r) || { x: f.x + f.w + Math.max(12, r * 0.3) + r, y: fcy }
  }
  s.cx = r1(pick.x)
  s.cy = r1(pick.y)
  s.r = r
}

// 拡大鏡のどこを押したか。のぞき窓は上に描いてあるので先に見る。丸は中まで当たり、元の枠は枠線の近くだけ
function zoomPart(s, p, tol) {
  if (Math.hypot(p.x - s.cx, p.y - s.cy) <= s.r + tol / 2) return 'lens'
  const r = norm(s)
  const outer = p.x >= r.x - tol && p.x <= r.x + r.w + tol && p.y >= r.y - tol && p.y <= r.y + r.h + tol
  const inner = p.x > r.x + tol && p.x < r.x + r.w - tol && p.y > r.y + tol && p.y < r.y + r.h - tol
  return outer && !inner ? 'frame' : null
}

function textFont(s) {
  return '600 ' + s.fontSize + 'px "Yu Gothic UI", "Meiryo", system-ui, sans-serif'
}

const WHITE_HALO = 'rgba(255,255,255,.92)'
const BLACK_HALO = 'rgba(25,25,25,.85)'

// 「おまかせ」は文字の色と反対の縁取りを付ける（背景がごちゃついていても読めるように）
function haloColor(s) {
  const deco = s.deco || 'auto'
  if (deco === 'auto') return luminance(s.color) > 0.62 ? BLACK_HALO : WHITE_HALO
  if (deco === 'white' || deco === 'white-shadow') return WHITE_HALO
  if (deco === 'black') return BLACK_HALO
  return null   // 影だけ・飾りなし
}

// 行頭に来てはいけない字（句読点・閉じかっこ・小さい仮名など）。入力欄の折り返しと同じく、前の字ごと次の行へ送る
const NO_LINE_START = /^[、。，．,.)\]）」』】〕〉》！？!?ー・：；:;ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮヵヶ々ゝゞ〜～]/

// 1行を幅 maxW で折り返す。入力欄（textarea の pre-wrap）と同じ位置で折れるよう、
// 英数字の単語は途中で切らず、空白は行末にぶら下げる。1語で幅を超えるときだけ字の途中で切る
function wrapLine(g, line, maxW) {
  const queue = line.match(/[A-Za-z0-9_@#$%&*+=/\\'’".,:;!?()\[\]-]+|\s+|./gu) || []
  const out = []
  let toks = []
  const fits = (arr) => g.measureText(arr.join('').replace(/\s+$/, '')).width <= maxW
  while (queue.length) {
    const t = queue.shift()
    if (/^\s+$/.test(t)) { toks.push(t); continue }
    if (t.length > 1 && g.measureText(t).width > maxW) {
      // 長すぎる単語。いまの行に何かあれば先に改行してから、字ごとに分けて流し込む
      if (toks.length && !fits(toks.concat(t))) { out.push(toks.join('').replace(/\s+$/, '')); toks = [] }
      queue.unshift(...Array.from(t))
      continue
    }
    if (!toks.length || fits(toks.concat(t))) { toks.push(t); continue }
    let carry = []
    if (NO_LINE_START.test(t) && toks.length > 1 && !/^\s+$/.test(toks[toks.length - 1])) carry = [toks.pop()]
    out.push(toks.join('').replace(/\s+$/, ''))
    toks = carry.concat(t)
  }
  out.push(toks.join('').replace(/\s+$/, ''))
  return out
}

// 文字の並び。ドラッグで枠を作って置いた文字（box）は、枠の幅で折り返す。
// クリックだけで置いた文字は枠が無く、改行した所でだけ折れる
function textLayout(s) {
  const lh = s.fontSize * 1.28
  const raw = String(s.text || '').split('\n')
  if (!s.box) return { x: s.x1, y: s.y1, lh, lines: raw }
  const r = norm(s)
  ctx.save()
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.font = textFont(s)
  const maxW = Math.max(r.w, s.fontSize)
  const lines = []
  for (const l of raw) lines.push(...wrapLine(ctx, l, maxW))
  ctx.restore()
  return { x: r.x, y: r.y, w: r.w, h: r.h, lh, lines }
}

// 枠より文字が長くなったら、枠を下へ伸ばして中に収める（選んだときの枠と字がずれないように）
function fitTextBox(s) {
  if (!s || s.type !== 'text' || !s.box) return
  const t = textLayout(s)
  const need = t.lh * Math.max(1, t.lines.length)
  s.x1 = t.x; s.y1 = t.y
  s.x2 = t.x + Math.max(t.w, s.fontSize)
  s.y2 = t.y + Math.max(t.h, need)
}

function drawText(g, s) {
  const t = textLayout(s)
  const lines = t.lines
  g.font = textFont(s)
  g.textBaseline = 'top'
  g.lineJoin = 'round'
  g.miterLimit = 2
  const lh = s.fontSize * 1.28
  const halo = haloColor(s)
  const shadow = (s.deco || 'auto') === 'shadow' || s.deco === 'white-shadow'
  // 縁取りは文字の輪郭線の中央に乗る。太くするぶんは外へも内へも広がるが、
  // このあと文字を上から塗るので、文字自体は潰れずにまわりだけ埋まっていく
  const stroke = Math.max(2, s.fontSize * (s.halo || HALO_DEFAULT))
  // 影のぼかし幅とずれは canvas の変換（拡大表示）が効かないので、ここだけ自分で倍率を掛ける
  const sc = g.getTransform ? (g.getTransform().a || 1) : 1
  for (let i = 0; i < lines.length; i++) {
    const y = t.y + i * lh
    if (shadow) {
      g.save()
      g.shadowColor = 'rgba(0,0,0,.55)'
      g.shadowBlur = Math.max(2, s.fontSize * 0.18) * sc
      g.shadowOffsetX = Math.max(1, s.fontSize * 0.05) * sc
      g.shadowOffsetY = Math.max(1, s.fontSize * 0.08) * sc
      // 影を落とすためだけに一度描く。縁取りがあるならその形で落とすと輪郭がはっきりする
      if (halo) { g.strokeStyle = halo; g.lineWidth = stroke; g.strokeText(lines[i], t.x, y) }
      else { g.fillStyle = s.color; g.fillText(lines[i], t.x, y) }
      g.restore()
    }
    if (halo) {
      g.strokeStyle = halo
      g.lineWidth = stroke
      g.strokeText(lines[i], t.x, y)
    }
    g.fillStyle = s.color
    g.fillText(lines[i], t.x, y)
  }
}

function textBounds(s) {
  if (s.box) {
    const t = textLayout(s)
    return { x: t.x, y: t.y, w: Math.max(t.w, 1), h: Math.max(t.h, t.lh * Math.max(1, t.lines.length)) }
  }
  const lines = String(s.text || '').split('\n')
  ctx.save()
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.font = textFont(s)
  let w = 0
  for (const l of lines) w = Math.max(w, ctx.measureText(l).width)
  ctx.restore()
  const lh = s.fontSize * 1.28
  return { x: s.x1, y: s.y1, w: Math.max(w, s.fontSize * 0.6), h: lh * Math.max(1, lines.length) }
}

function unionRect(a, b) {
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y }
}

function shapeBounds(s) {
  if (s.type === 'text') return textBounds(s)
  const r = norm(s)
  const pad = (s.type === 'line' || s.type === 'arrow') ? s.width : s.width / 2
  const b = { x: r.x - pad, y: r.y - pad, w: r.w + pad * 2, h: r.h + pad * 2 }
  // 拡大鏡は元の枠とのぞき窓の両方を囲む
  if (s.type === 'zoom') {
    const rr = s.r + Math.max(2, s.width) / 2
    return unionRect(b, { x: s.cx - rr, y: s.cy - rr, w: rr * 2, h: rr * 2 })
  }
  return b
}

// 実際に色が乗る範囲。文字はフチと影が字より外にはみ出すので、そのぶんを足す。
// スポットライトは切り抜き範囲の中しか塗らないので、画角を広げない（null）。
// ぼかしも切り抜き範囲の中にしか描かないので、範囲と重なる所だけ（重ならなければ null）
function paintBounds(s) {
  if (s.type === 'spot') return null
  const b = shapeBounds(s)
  if (s.type === 'blur') {
    const c = state.crop
    const x1 = Math.max(b.x, c.x), y1 = Math.max(b.y, c.y)
    const x2 = Math.min(b.x + b.w, c.x + c.w), y2 = Math.min(b.y + b.h, c.y + c.h)
    return x2 > x1 && y2 > y1 ? { x: x1, y: y1, w: x2 - x1, h: y2 - y1 } : null
  }
  if (s.type === 'zoom') {
    const sh = zoomShadow(s)
    const rr = s.r + Math.max(2, s.width) / 2 + sh.blur + sh.dy
    return unionRect(b, { x: s.cx - rr, y: s.cy - rr, w: rr * 2, h: rr * 2 })
  }
  if (s.type !== 'text') return b
  const halo = Math.max(2, s.fontSize * (s.halo || HALO_DEFAULT)) / 2
  const deco = s.deco || 'auto'
  const shadow = (deco === 'shadow' || deco === 'white-shadow') ? s.fontSize * 0.26 : 0
  const m = Math.max(halo, shadow)
  return { x: b.x - m, y: b.y - m, w: b.w + m * 2, h: b.h + m * 2 }
}

// 表示と保存に使う範囲。切り抜いた範囲に、外へはみ出した書き込みのぶんを足して広げる。
// 足したところは塗らないので透明のまま（編集画面ではチェック柄が透けて見える）。
// ドラッグや文字入力の途中で伸び縮みすると画面が落ち着かないので、そのあいだは frozenView で固定する。
let frozenView = null

function view() {
  if (frozenView) return frozenView
  const c = state.crop
  let x1 = c.x, y1 = c.y, x2 = c.x + c.w, y2 = c.y + c.h
  for (const s of state.shapes) {
    const b = paintBounds(s)
    if (!b) continue
    if (b.x < x1) x1 = b.x
    if (b.y < y1) y1 = b.y
    if (b.x + b.w > x2) x2 = b.x + b.w
    if (b.y + b.h > y2) y2 = b.y + b.h
  }
  x1 = Math.floor(x1); y1 = Math.floor(y1)
  return { x: x1, y: y1, w: Math.max(1, Math.ceil(x2 - x1)), h: Math.max(1, Math.ceil(y2 - y1)) }
}

function freezeView() { frozenView = view() }
function unfreezeView() { frozenView = null }

// 画角がはみ出しぶんで広がっているか（ステータスバーの表示に使う）
function isWidened() {
  const v = view()
  const c = state.crop
  return v.w > c.w || v.h > c.h
}

function handlesFor(s) {
  // 枠のある文字は、枠の大きさ（＝折り返す幅）を四角と同じハンドルで変えられる
  if (s.type === 'text' && !s.box) return []
  if (s.type === 'line' || s.type === 'arrow') {
    return [{ id: 'p1', x: s.x1, y: s.y1 }, { id: 'p2', x: s.x2, y: s.y2 }]
  }
  const r = norm(s)
  // 鉛筆・蛍光ペンを真横（真縦）に引くと枠の高さ（幅）がほぼ 0 になり、8つのハンドルが線の上に重なる。
  // そのままだと線の真ん中が上下の辺のハンドルに当たって動かせないので、潰れた向きのハンドルは出さない
  if (s.type === 'pen' || s.type === 'marker') {
    const min = 28 / state.zoom
    const flatH = r.h < min
    const flatW = r.w < min
    if (flatH || flatW) {
      const hs = []
      if (!flatW) hs.push({ id: 'e', x: r.x + r.w, y: r.y + r.h / 2 }, { id: 'w', x: r.x, y: r.y + r.h / 2 })
      if (!flatH) hs.push({ id: 'n', x: r.x + r.w / 2, y: r.y }, { id: 's', x: r.x + r.w / 2, y: r.y + r.h })
      return hs
    }
  }
  // 拡大鏡は元の枠の8つに、のぞき窓の右下（大きさ＝倍率を変える所）を1つ足す
  const lens = s.type === 'zoom'
    ? [{ id: 'r', x: s.cx + s.r * Math.SQRT1_2, y: s.cy + s.r * Math.SQRT1_2 }]
    : []
  return lens.concat([
    { id: 'nw', x: r.x, y: r.y },
    { id: 'n', x: r.x + r.w / 2, y: r.y },
    { id: 'ne', x: r.x + r.w, y: r.y },
    { id: 'e', x: r.x + r.w, y: r.y + r.h / 2 },
    { id: 'se', x: r.x + r.w, y: r.y + r.h },
    { id: 's', x: r.x + r.w / 2, y: r.y + r.h },
    { id: 'sw', x: r.x, y: r.y + r.h },
    { id: 'w', x: r.x, y: r.y + r.h / 2 },
  ])
}

function drawHandles(g, s) {
  const z = state.zoom
  g.save()
  g.lineWidth = 1 / z
  // 拡大鏡は元の枠とのぞき窓を別々に囲む（両方を囲む大きな四角だと、どこが掴めるのか分からないため）
  const outline = () => {
    if (s.type !== 'zoom') {
      const b = shapeBounds(s)
      g.strokeRect(b.x - 2 / z, b.y - 2 / z, b.w + 4 / z, b.h + 4 / z)
      return
    }
    const f = norm(s)
    const pad = s.width / 2 + 2 / z
    g.strokeRect(f.x - pad, f.y - pad, f.w + pad * 2, f.h + pad * 2)
    g.beginPath()
    g.arc(s.cx, s.cy, s.r + Math.max(2, s.width) / 2 + 2 / z, 0, Math.PI * 2)
    g.stroke()
  }
  g.strokeStyle = 'rgba(0,0,0,.7)'
  outline()
  g.setLineDash([4 / z, 3 / z])
  g.strokeStyle = 'rgba(255,255,255,.95)'
  outline()
  g.setLineDash([])
  // 蛍光ペンを持っているあいだの蛍光ペンは掴めない（押すと次の線になる）ので、ハンドルの四角は出さない
  if (!grabbable(s)) { g.restore(); return }
  const hs = 4.5 / z
  for (const p of handlesFor(s)) {
    g.fillStyle = '#fff'
    g.strokeStyle = '#1b1b1b'
    g.fillRect(p.x - hs, p.y - hs, hs * 2, hs * 2)
    g.strokeRect(p.x - hs, p.y - hs, hs * 2, hs * 2)
  }
  g.restore()
}

// 文字の枠をドラッグで取っているあいだの薄い点線（Screenpresso と同じ見え方）
function drawTextBoxGuide(g, s) {
  const r = norm(s)
  const z = state.zoom
  g.save()
  g.lineWidth = 1 / z
  g.strokeStyle = 'rgba(0,0,0,.45)'
  g.strokeRect(r.x, r.y, r.w, r.h)
  g.setLineDash([3 / z, 3 / z])
  g.strokeStyle = 'rgba(255,255,255,.9)'
  g.strokeRect(r.x, r.y, r.w, r.h)
  g.restore()
}

function drawCropOverlay(g, c) {
  const r = norm({ x1: c.x1, y1: c.y1, x2: c.x2, y2: c.y2 })
  const z = state.zoom
  g.save()
  g.fillStyle = 'rgba(0,0,0,.45)'
  // 選んだ範囲の外側だけを暗くする（2つの四角を evenodd で塗って内側に穴をあける）
  const v = view()
  g.beginPath()
  g.rect(v.x, v.y, v.w, v.h)
  g.rect(r.x, r.y, r.w, r.h)
  g.fill('evenodd')
  g.strokeStyle = '#fff'
  g.lineWidth = 1 / z
  g.strokeRect(r.x, r.y, r.w, r.h)
  g.restore()
}

// 下の段に回す図形（見た目がほかの図形より下になるもの）
const UNDER_TYPES = new Set(['marker', 'spot', 'zoom'])

// 絵と図形を描く。画面・コピー・保存・サムネイル・分割保存はすべてここを通す（1か所だけ重なり順が違う、を防ぐため）。
// 重ねる順は「絵 → ぼかし → 暗幕（スポットライト） → のぞき窓（拡大鏡） → 蛍光ペン → その他の図形」。
// 下の段に回す図形が無い絵は、これまでどおり置いた順に描く（ぼかしを後から置くと矢印の上にかかる、という今までの絵の見た目を変えないため）
// 絵は切り抜き範囲の中だけに描く。画角が広がっても、切り抜いて捨てた所は透明のまま（出てくると切り抜いた意味がない）
function paintScene(g, extra) {
  if (state.img) {
    const c = state.crop
    g.save()
    g.beginPath()
    g.rect(c.x, c.y, c.w, c.h)
    g.clip()
    g.drawImage(state.img, 0, 0)
    g.restore()
  }
  const list = extra ? state.shapes.concat(extra) : state.shapes
  if (!list.some((s) => UNDER_TYPES.has(s.type))) {
    for (const s of list) drawShape(g, s, list)
    return
  }
  for (const s of list) if (s.type === 'blur') drawShape(g, s, list)
  paintSpots(g, list)
  for (const s of list) if (s.type === 'zoom') drawShape(g, s, list)
  for (const s of list) if (s.type === 'marker') drawShape(g, s, list)
  for (const s of list) if (s.type !== 'blur' && !UNDER_TYPES.has(s.type)) drawShape(g, s, list)
}

// スポットライトは枠線を描かないので、スポットライトの道具を持っているあいだは置いた範囲を点線で見せる
function drawSpotGuides(g) {
  for (const s of state.shapes) if (s.type === 'spot') drawTextBoxGuide(g, s)
}

function draw() {
  const dpr = window.devicePixelRatio || 1
  const v = view()
  const vw = Math.max(1, Math.round(v.w * state.zoom))
  const vh = Math.max(1, Math.round(v.h * state.zoom))
  cv.style.width = vw + 'px'
  cv.style.height = vh + 'px'
  const bw = Math.round(vw * dpr)
  const bh = Math.round(vh * dpr)
  if (cv.width !== bw || cv.height !== bh) { cv.width = bw; cv.height = bh }

  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, cv.width, cv.height)
  const k = state.zoom * dpr
  ctx.setTransform(k, 0, 0, k, -v.x * k, -v.y * k)
  ctx.imageSmoothingQuality = 'high'

  // 描いている最中の図形も同じ重なり順に入れる（離した瞬間に上下が入れ替わらないように）
  paintScene(ctx, pending && pending.type !== 'text' ? pending : null)
  if (pending && pending.type === 'text') drawTextBoxGuide(ctx, pending)
  if (state.tool === 'spot') drawSpotGuides(ctx)
  const sel = byId(state.selectedId)
  if (sel && !pending && !pendingCrop) drawHandles(ctx, sel)
  if (pendingCrop) drawCropOverlay(ctx, pendingCrop)
  drawSnapGuides(ctx)
  syncHand(false)
}

// 保存・コピー用の素の絵（仕上げなし）。ツールの枠やハンドルは含めない
function exportCanvas() {
  const v = view()
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(v.w))
  c.height = Math.max(1, Math.round(v.h))
  const g = c.getContext('2d')
  g.imageSmoothingQuality = 'high'
  g.setTransform(1, 0, 0, 1, -v.x, -v.y)
  paintScene(g)
  return c
}

// 保存・コピーの出口はここ1つ（コピー・_書き込み.png・名前を付けて保存・履歴からの Ctrl+C）。
// 仕上げはここで包むだけで、元の絵にも図形のデータにも入れない
function exportPNG() {
  return finishedCanvas().toDataURL('image/png')
}

function finishedCanvas() {
  const c = exportCanvas()
  if (state.finish === 'none') return c
  const out = wrapFinish(c, state.finish)
  c.width = 1     // 包んだあとの素の絵は要らない（大きい絵のときのため）
  c.height = 1
  return out
}

// 仕上げの寸法。余白・角の丸み・影は絵の大きさに比例させる（小さい絵に大きな余白、を避けるため）。
// 影が余白からはみ出して切れないよう、ぼかしは余白の半分弱に収める
function finishLayout(w, h, style) {
  const pad = Math.round(Math.min(160, Math.max(28, Math.max(w, h) * (style === 'backdrop' ? 0.07 : 0.04))))
  return {
    pad,
    radius: Math.round(Math.min(18, Math.max(6, Math.min(w, h) * 0.02))),
    blur: Math.round(pad * 0.45),
    offY: Math.round(pad * 0.12),
  }
}

// 仕上げで包む。背景 → 影つきの角丸の札 → その札の形で切り抜いた絵、の順に描く。
// 絵に直接影を付けると、はみ出した文字で広がった透明な所が素通しになり、影が札でなく文字の形に落ちるため。
// 貼り先によっては透明が黒くなるので、影つき・背景つきは必ず不透明にする（影つきの背景は白）
function wrapFinish(src, style) {
  const w = src.width
  const h = src.height
  if (style === 'border') return withBorder(src)
  const m = finishLayout(w, h, style)
  const c = document.createElement('canvas')
  c.width = w + m.pad * 2
  c.height = h + m.pad * 2
  const g = c.getContext('2d')
  g.imageSmoothingQuality = 'high'
  if (style === 'backdrop') {
    const gr = g.createLinearGradient(0, 0, c.width, c.height)
    gr.addColorStop(0, '#e6ecf5')
    gr.addColorStop(1, '#c2cde0')
    g.fillStyle = gr
  } else {
    g.fillStyle = '#ffffff'
  }
  g.fillRect(0, 0, c.width, c.height)
  const card = () => {
    g.beginPath()
    g.roundRect(m.pad, m.pad, w, h, m.radius)
  }
  g.save()
  g.shadowColor = style === 'backdrop' ? 'rgba(20,30,50,.34)' : 'rgba(0,0,0,.28)'
  g.shadowBlur = m.blur
  g.shadowOffsetY = m.offY
  g.fillStyle = '#ffffff'
  card()
  g.fill()
  g.restore()
  g.save()
  card()
  g.clip()
  g.drawImage(src, m.pad, m.pad)
  g.restore()
  return c
}

// 黒い縁取り。余白は付けず、絵の外周に線を足すだけ（白くない所に貼っても白い帯が出ないように）
const BORDER_PX = 2
function withBorder(src) {
  const c = document.createElement('canvas')
  c.width = src.width + BORDER_PX * 2
  c.height = src.height + BORDER_PX * 2
  const g = c.getContext('2d')
  g.fillStyle = '#000000'
  g.fillRect(0, 0, c.width, c.height)
  g.clearRect(BORDER_PX, BORDER_PX, src.width, src.height)
  g.drawImage(src, BORDER_PX, BORDER_PX)
  return c
}

// 仕上げを付けたときの見え方。白いページに貼ったつもりで、書き出す絵そのものを窓いっぱいに出す
const finishPreview = document.getElementById('finishPreview')
function showFinishPreview() {
  commitText()
  const box = document.getElementById('finishPreviewBox')
  box.textContent = ''
  const c = finishedCanvas()
  box.appendChild(c)
  document.getElementById('finishPreviewCap').textContent = '仕上げ：' + FINISH_LABELS[state.finish]
    + '（' + c.width + ' × ' + c.height + ' px）・クリックか Esc で閉じる'
  finishPreview.hidden = false
}
function hideFinishPreview() {
  if (finishPreview.hidden) return false
  finishPreview.hidden = true
  document.getElementById('finishPreviewBox').textContent = ''
  return true
}
finishPreview.addEventListener('click', hideFinishPreview)

// 履歴一覧に出す小さい絵（書き込み後の見た目）
function exportThumb() {
  // 一覧の表示は最大 240px まで大きくできるので、その倍の大きさで作っておく
  const v = view()
  const k = Math.min(1, 264 / v.h, 700 / v.w)
  const w = Math.max(1, Math.round(v.w * k))
  const h = Math.max(1, Math.round(v.h * k))
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const g = c.getContext('2d')
  g.imageSmoothingQuality = 'high'
  g.setTransform(k, 0, 0, k, -v.x * k, -v.y * k)
  paintScene(g)
  return c.toDataURL('image/png')
}

// ---------------------------------------------------------------- 分割して保存
//
// Google ドキュメントなどは、貼り付けた画像の「面積」に上限があり（2500万ピクセル²）、
// さらに長辺を基準に縮めるため、縦長すぎる絵は横方向まで巻き添えで潰れて文字が読めなくなる。
// 1枚ずつが「ふつうの縦横比」になるように切り分けると、そのまま貼れる。

const DOC_MAX_AREA = 24000000     // 1枚あたりの面積の目安（上限 2500万より少し内側）
const DOC_MAX_ASPECT = 1.2        // 1枚あたり「横 : 縦」がこれを超えないようにする

function isTallImage() {
  const v = view()
  return v.h > v.w * DOC_MAX_ASPECT * 1.25
}

function splitPieces() {
  const v = view()
  const W = Math.round(v.w)
  const H = Math.round(v.h)
  const limit = Math.max(200, Math.min(Math.round(W * DOC_MAX_ASPECT), Math.floor(DOC_MAX_AREA / Math.max(1, W))))
  const n = Math.max(2, Math.ceil(H / limit))
  const h = Math.ceil(H / n)
  const out = []
  for (let y = 0; y < H; y += h) out.push({ y, h: Math.min(h, H - y) })
  return out
}

function exportPiece(piece) {
  const v = view()
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(v.w))
  c.height = Math.max(1, Math.round(piece.h))
  const g = c.getContext('2d')
  g.imageSmoothingQuality = 'high'
  g.setTransform(1, 0, 0, 1, -v.x, -(v.y + piece.y))
  paintScene(g)
  const url = c.toDataURL('image/png')
  c.width = 1     // 大きい絵を何枚も作るので、使い終わったら手放す
  c.height = 1
  return url
}

// 分割保存には仕上げを付けない（1枚の札が途中で切れて、つないで貼ると継ぎ目に余白と影が挟まるため）
async function doSplitSave() {
  commitText()
  flushLibrary()
  const pieces = splitPieces()
  let group = null
  let last = null
  for (let i = 0; i < pieces.length; i++) {
    toast('分割して保存中… ' + (i + 1) + ' / ' + pieces.length)
    const r = await window.api.invoke('app:savePiece', {
      dataUrl: exportPiece(pieces[i]),
      index: i + 1,
      total: pieces.length,
      group,
    })
    if (!r || !r.ok) { toast('分割保存に失敗しました： ' + ((r && r.error) || '')); return }
    group = r.group
    last = r.path
  }
  toast(pieces.length + '枚に分けて保存しました' + (state.finish !== 'none' ? '（分割では仕上げは付けません）' : ''), last)
}

// ---------------------------------------------------------------- 履歴への自動保存
//
// 書き込んだ図形は「焼かずに」履歴へ送る。保存を押さなくても、あとから開き直して動かし直せる。

let syncTimer = null

function isCropped() {
  return state.crop.x !== 0 || state.crop.y !== 0
    || state.crop.w !== state.imgW || state.crop.h !== state.imgH
}

function scheduleLibrarySync() {
  if (!state.libraryId) return
  clearTimeout(syncTimer)
  syncTimer = setTimeout(() => flushLibrary(), 700)
}

// 図形は画像に焼かず、位置データだけを履歴へ送る。
// 元の絵は保存先フォルダに1個あるだけなので、次に開いたときもここから並べ直せる。
function flushLibrary() {
  if (!state.libraryId) return
  clearTimeout(syncTimer)
  try {
    window.api.send('library:updateShapes', {
      id: state.libraryId,
      shapes: state.shapes,
      crop: state.crop,
      scale: state.scale,
      thumbDataUrl: exportThumb(),
    })
  } catch (err) {
    console.error('履歴への保存に失敗:', err)
  }
}

// 今見えている絵が、撮った時のままかどうか。
// 違うときだけ「_書き込み.png」を別に出す（同じ絵を2個作らないため）
function isEdited() {
  return state.shapes.length > 0 || isCropped() || state.scale !== 1
}

// 書き出す絵が元の絵と違うか。仕上げだけでも違う絵になるので、原本を動かさず「_書き込み.png」を別に出す
function needsExport() {
  return isEdited() || state.finish !== 'none'
}

// ---------------------------------------------------------------- 絵の大きさを変える
//
// 今の絵は「撮ったときの絵（state.orig）× state.scale」。変えるたびに撮ったときの絵から作り直すので、
// 50% → 75% → 100% と何度変えても劣化が積み重ならない。縮め方は resample.js（Lanczos）。
// canvas の drawImage で縮めると文字がにじむので使わない。
// 図形・切り抜きは今の大きさの座標で持ち、大きさを変えたら同じ倍率を掛け直す（書き込みは描き直すのでにじまない）

const SCALE_MIN = 0.02
const SCALE_MAX = 8
const SCALED_MAX_SIDE = 16384          // canvas が作れる大きさの手前
const SCALED_MAX_AREA = 100000000
let origPixels = null                  // 撮ったときの絵の画素（何度も読むので1回だけ取る）
const scaledCache = new Map()          // 元に戻す・やり直すで行き来したとき作り直さないよう、少しだけ覚える

function validScale(s) { return Number.isFinite(s) && s >= SCALE_MIN && s <= SCALE_MAX }

function scaledSize(s) {
  return {
    w: Math.max(1, Math.round(state.orig.naturalWidth * s)),
    h: Math.max(1, Math.round(state.orig.naturalHeight * s)),
  }
}

function scaledImage(s) {
  if (s === 1) return state.orig
  if (scaledCache.has(s)) return scaledCache.get(s)
  const W = state.orig.naturalWidth
  const H = state.orig.naturalHeight
  if (!origPixels) {
    const c = document.createElement('canvas')
    c.width = W
    c.height = H
    const g = c.getContext('2d')
    g.drawImage(state.orig, 0, 0)
    origPixels = g.getImageData(0, 0, W, H).data
  }
  const z = scaledSize(s)
  const px = window.Resample.resample(origPixels, W, H, s, z.w, z.h)
  const c = document.createElement('canvas')
  c.width = z.w
  c.height = z.h
  c.getContext('2d').putImageData(new ImageData(px, z.w, z.h), 0, 0)
  if (scaledCache.size >= 3) scaledCache.delete(scaledCache.keys().next().value)
  scaledCache.set(s, c)
  return c
}

// 絵だけを差し替える（図形は動かさない）。元に戻す・開き直しでは図形がすでにその大きさの座標なのでこちら
function useScale(s) {
  state.img = scaledImage(s)
  state.scale = s
  const z = scaledSize(s)
  state.imgW = z.w
  state.imgH = z.h
}

// 掛け直すたびに 600.0000000000001 のような端数がたまるので、見た目に出ない桁で丸める
function r6(v) { return Math.round(v * 1e6) / 1e6 }

function scaleShape(s, k) {
  for (const key of ['x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'width', 'fontSize']) {
    if (typeof s[key] === 'number') s[key] = r6(s[key] * k)
  }
  if (s.points) for (const p of s.points) { p.x = r6(p.x * k); p.y = r6(p.y * k) }
}

// 絵・図形・切り抜きをまとめて s 倍（撮ったとき基準）にする。1回の変更なので Ctrl+Z で戻せる
function resizeTo(s) {
  if (!state.orig || s === state.scale) return
  commitText()
  const before = beginChange()
  const k = s / state.scale
  const c = state.crop
  const full = !isCropped()
  useScale(s)
  for (const sh of state.shapes) { scaleShape(sh, k); fitTextBox(sh) }
  if (full) {
    state.crop = { x: 0, y: 0, w: state.imgW, h: state.imgH }
  } else {
    // 切り抜き範囲は整数に丸める（半端だと縁が半透明の 1px になる）。はみ出したら内へ寄せる
    const w = Math.max(1, Math.min(state.imgW, Math.round(c.w * k)))
    const h = Math.max(1, Math.min(state.imgH, Math.round(c.h * k)))
    state.crop = {
      x: Math.max(0, Math.min(state.imgW - w, Math.round(c.x * k))),
      y: Math.max(0, Math.min(state.imgH - h, Math.round(c.y * k))),
      w, h,
    }
  }
  commitChange(before)
  layout()
  draw()
  updateUi()
}

function pctText(s) { return (Math.round(s * 1000) / 10) + '%' }

// ---- 大きさを変えるダイアログ
// ％は撮ったときの大きさに対する割合（何度押しても同じ大きさになる）。幅・高さは出来上がりの大きさ。
// 縦横の比はいつも保つ（崩すと文字がゆがむだけなので、比を崩す指定は置かない）

const rzDlg = document.getElementById('resizeDlg')
const rzEls = {
  pct: document.getElementById('rzPct'),
  width: document.getElementById('rzWidth'),
  height: document.getElementById('rzHeight'),
}
let rzMode = 'pct'
let rzLast = null      // 前回 OK したときの値（editor:init で本体から届く）

function rzView() {
  const v = view()
  return { w: Math.round(v.w), h: Math.round(v.h) }
}

// 撮ったときの大きさでの出来上がり範囲。切り抜きもはみ出しも無ければ元の絵の大きさそのもの。
// 今の大きさ（四捨五入ずみ）から逆算すると倍率が 2 から 1.997 のようにずれ、整数倍の拡大にならないため
function rzBase() {
  if (!isCropped() && !isWidened()) return { w: state.orig.naturalWidth, h: state.orig.naturalHeight }
  const v = view()
  return { w: v.w / state.scale, h: v.h / state.scale }
}

// 入力から「撮ったとき基準の倍率」と出来上がりの大きさを出す
function rzTarget(mode) {
  const b = rzBase()
  const n = Number(rzEls[mode].value)
  let s = NaN
  if (mode === 'pct') s = n / 100
  else if (mode === 'width') s = n / b.w
  else s = n / b.h
  if (!(n > 0) || !Number.isFinite(s)) return { err: '数字を入れてください' }
  const out = { s, w: Math.max(1, Math.round(b.w * s)), h: Math.max(1, Math.round(b.h * s)) }
  if (s < SCALE_MIN) return Object.assign(out, { err: '小さすぎます' })
  const z = scaledSize(s)
  if (s > SCALE_MAX || z.w > SCALED_MAX_SIDE || z.h > SCALED_MAX_SIDE || z.w * z.h > SCALED_MAX_AREA) {
    return Object.assign(out, { err: '大きすぎます（1辺 ' + SCALED_MAX_SIDE + 'px まで）' })
  }
  return out
}

function rzRefresh() {
  for (const m of Object.keys(rzEls)) {
    rzDlg.querySelector('input[name="rzMode"][value="' + m + '"]').checked = m === rzMode
  }
  const p = rzTarget('pct')
  const w = rzTarget('width')
  const h = rzTarget('height')
  document.getElementById('rzPctOut').textContent = p.err ? '' : '→ ' + p.w + ' × ' + p.h + ' px'
  document.getElementById('rzWidthOut').textContent = w.err ? 'px' : 'px × ' + w.h
  document.getElementById('rzHeightOut').textContent = h.err ? 'px' : 'px（幅 ' + h.w + '）'
  const t = rzTarget(rzMode)
  const ok = !t.err
  document.getElementById('rzOk').disabled = !ok
  const res = document.getElementById('rzResult')
  res.textContent = ok ? t.w + ' × ' + t.h + ' px（撮ったときの ' + pctText(t.s) + '）' : t.err
  res.classList.toggle('err', !ok)
  let hint = ''
  if (ok) {
    const whole = Math.abs(t.s - Math.round(t.s)) < 1e-9
    if (Math.abs(t.s - 1) < 1e-9) hint = '撮ったときの大きさそのままです。'
    else if (t.s > 1 && whole) hint = '整数倍の拡大なので、点をそのまま大きくします（にじみません）。'
    else if (t.s > 1) hint = '半端な倍率の拡大は少しにじみます。200%・300% のような整数倍にすると、にじまずくっきり拡大できます。'
    else hint = '文字がにじみにくい方式（Lanczos）で縮めます。元の字が小さい画面は、縮めたぶん字も小さくなって読みにくくなります。'
  }
  document.getElementById('rzHint').textContent = hint
}

function openResize() {
  if (!state.orig) return
  commitText()
  hideFinishPreview()
  const v = rzView()
  const b = rzBase()
  const base = { w: Math.round(b.w), h: Math.round(b.h) }
  document.getElementById('rzNow').textContent = v.w + ' × ' + v.h + ' px'
    + (state.scale !== 1 ? '（撮ったとき ' + base.w + ' × ' + base.h + ' px の ' + pctText(state.scale) + '）' : '')
  const last = rzLast || {}
  rzMode = ['pct', 'width', 'height'].includes(last.mode) ? last.mode : 'pct'
  rzEls.pct.value = String(last.pct > 0 ? last.pct : 50)
  rzEls.width.value = String(last.width > 0 ? last.width : v.w)
  rzEls.height.value = String(last.height > 0 ? last.height : v.h)
  document.getElementById('rzReset').disabled = state.scale === 1
  rzDlg.hidden = false
  rzRefresh()
  rzEls[rzMode].focus()
  rzEls[rzMode].select()
}

function closeResize() {
  if (rzDlg.hidden) return false
  rzDlg.hidden = true
  return true
}

function rzApply() {
  const t = rzTarget(rzMode)
  if (t.err) return
  rzLast = {
    mode: rzMode,
    pct: Number(rzEls.pct.value) || 50,
    width: Math.round(Number(rzEls.width.value)) || 0,
    height: Math.round(Number(rzEls.height.value)) || 0,
  }
  window.api.send('app:setDefaults', { resize: rzLast })
  closeResize()
  resizeTo(t.s)
  const v = rzView()
  toast('サイズを ' + v.w + ' × ' + v.h + ' px にしました（Ctrl+Z で戻せます）')
}

for (const m of Object.keys(rzEls)) {
  rzEls[m].addEventListener('input', () => { rzMode = m; rzRefresh() })
  rzEls[m].addEventListener('focus', () => { if (rzMode !== m) { rzMode = m; rzRefresh() } })
}
rzDlg.querySelectorAll('input[name="rzMode"]').forEach((r) => {
  r.addEventListener('change', () => { rzMode = r.value; rzRefresh(); rzEls[rzMode].focus(); rzEls[rzMode].select() })
})
rzDlg.querySelectorAll('.rzChip').forEach((b) => {
  b.addEventListener('click', () => { rzEls.pct.value = b.dataset.pct; rzMode = 'pct'; rzRefresh() })
})
document.getElementById('rzOk').addEventListener('click', rzApply)
document.getElementById('rzCancel').addEventListener('click', closeResize)
document.getElementById('rzReset').addEventListener('click', () => {
  closeResize()
  resizeTo(1)
  toast('撮ったときの大きさに戻しました（Ctrl+Z で戻せます）')
})
// 暗い所（ダイアログの外）を押したら閉じる
rzDlg.addEventListener('mousedown', (e) => { if (e.target === rzDlg) closeResize() })

// ---------------------------------------------------------------- 表示倍率

function layout() {
  if (state.fit) {
    // 集中モードは余白を取らない（窓いっぱいに絵を出すため）
    const pad = state.focus ? 0 : 40
    const availW = wrap.clientWidth - pad
    const availH = wrap.clientHeight - pad
    const v = view()
    const z = Math.min(availW / v.w, availH / v.h)
    // ふつうは等倍まで。集中モードだけは、窓の大きさの丸め誤差ぶん（数%）まで伸ばして隙間をなくす
    const max = state.focus ? 1.02 : 1
    state.zoom = (isFinite(z) && z > 0) ? Math.min(max, z) : 1
  }
  updateUi()
}

function setZoom(z, fit) {
  state.fit = !!fit
  state.zoom = Math.max(0.05, Math.min(8, z))
  cancelText()
  layout()
  draw()
  syncHand(true)
}

// ---------------------------------------------------------------- つかんで動かす

// 絵が窓からはみ出して（スクロールバーが出て）いるか
function canPan() {
  return wrap.scrollWidth > wrap.clientWidth + 1 || wrap.scrollHeight > wrap.clientHeight + 1
}

// 「つかむ」は、はみ出しているときだけ押せる。
// 倍率を変えてはみ出したら自動で持ち替え、収まったら元の道具に戻す。
// 描いている途中に画角が広がっても持ち替えないよう、自動の持ち替えは倍率・窓の大きさが変わったときだけ
const handBtn = document.querySelector('.tool[data-tool="hand"]')
let handBackTool = 'rect'
function syncHand(zoomed) {
  const ok = canPan()
  handBtn.disabled = !ok
  if (!ok && state.tool === 'hand') setTool(handBackTool)
  else if (ok && zoomed && state.tool !== 'hand') setTool('hand')
}

let pan = null
// 絵の上でも余白でも掴めるよう、窓（wrap）側で先に受けて、道具の処理（cv 側）へは渡さない
wrap.addEventListener('pointerdown', (e) => {
  if (state.tool !== 'hand' || e.button !== 0) return
  // スクロールバーの上を押したときは、ふつうにスクロールバーを動かす
  const r = wrap.getBoundingClientRect()
  if (e.clientX - r.left - wrap.clientLeft >= wrap.clientWidth) return
  if (e.clientY - r.top - wrap.clientTop >= wrap.clientHeight) return
  e.preventDefault()
  e.stopPropagation()
  if (editingShape) commitText()
  pan = { x: e.clientX, y: e.clientY, sl: wrap.scrollLeft, st: wrap.scrollTop }
  try { wrap.setPointerCapture(e.pointerId) } catch (_) {}
  wrap.classList.add('panning')
}, true)
wrap.addEventListener('pointermove', (e) => {
  if (!pan) return
  wrap.scrollLeft = pan.sl - (e.clientX - pan.x)
  wrap.scrollTop = pan.st - (e.clientY - pan.y)
})
function endPan() {
  pan = null
  wrap.classList.remove('panning')
}
wrap.addEventListener('pointerup', endPan)
wrap.addEventListener('pointercancel', endPan)

function zoomStep(dir) {
  const cur = state.zoom
  if (dir > 0) {
    for (const z of ZOOM_STEPS) if (z > cur + 0.001) return setZoom(z, false)
    return setZoom(8, false)
  }
  for (let i = ZOOM_STEPS.length - 1; i >= 0; i--) if (ZOOM_STEPS[i] < cur - 0.001) return setZoom(ZOOM_STEPS[i], false)
  return setZoom(0.05, false)
}

// ---------------------------------------------------------------- 集中モード

// 枠も道具も出さず絵だけにする。どこかのページに貼ったときの見え方を確かめるためのもの。
// 窓の枠は開いたあとから外せないので、本体側に同じ中身の窓を作り直してもらう
function toggleFocus() {
  if (!state.dataUrl) return
  cancelText()
  flushLibrary()
  const v = view()
  window.api.send('editor:focus', {
    on: !state.focus,
    dataUrl: state.dataUrl,
    viewW: Math.round(v.w),
    viewH: Math.round(v.h),
    // 履歴に書いていない今の状態も一緒に渡す（作り直しで消えないように）
    carry: {
      shapes: state.shapes,
      crop: state.crop,
      scale: state.scale,
      // 集中モードははみ出さない（つかめない）ので、つかむ前の道具を渡す
      tool: state.tool === 'hand' ? handBackTool : state.tool,
      color: state.color,
      markerColor: state.markerColor,
      lineWidth: state.lineWidth,
      markerWidth: state.markerWidth,
      fontSize: state.fontSize,
      deco: state.deco,
      halo: state.halo,
      finish: state.finish,
      savedPath: state.savedPath,
      copied: state.copied,
      // 自動ぼかしの読み取り中なら、作り直した窓でやり直す（今の窓の結果は窓ごと捨てられるため）
      findPrivate: privScanning,
      privNotice: privNoticeEl.hidden ? '' : privNoticeMsg.textContent,
    },
  })
}

let lastAspect = 0

// 切り抜くと絵の比が変わるので、窓の形も追わせる。
// 描いている最中（画角を止めているあいだ）は送らない。窓が伸び縮みして描きにくくなるため
function syncAspect() {
  if (!state.focus || frozenView) return
  const v = view()
  const a = v.w / v.h
  if (!isFinite(a) || a <= 0 || Math.abs(a - lastAspect) < 0.002) return
  lastAspect = a
  window.api.send('editor:aspect', { w: Math.round(v.w), h: Math.round(v.h) })
}

// ---------------------------------------------------------------- 当たり判定

function toImg(e) {
  const r = cv.getBoundingClientRect()
  const v = view()
  return {
    x: v.x + (e.clientX - r.left) / state.zoom,
    y: v.y + (e.clientY - r.top) / state.zoom,
  }
}

function distToSegment(p, x1, y1, x2, y2) {
  const dx = x2 - x1
  const dy = y2 - y1
  const len2 = dx * dx + dy * dy
  if (len2 === 0) return Math.hypot(p.x - x1, p.y - y1)
  let t = ((p.x - x1) * dx + (p.y - y1) * dy) / len2
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(p.x - (x1 + t * dx), p.y - (y1 + t * dy))
}

function hitShape(s, p) {
  // スポットライトは枠線が無いので、太さは当たりの幅に使わない（明るい所と暗い所の境目の近くだけ）
  const tol = s.type === 'spot' ? 7 / state.zoom : Math.max(6 / state.zoom, s.width)
  if (s.type === 'zoom') return !!zoomPart(s, p, tol)
  if (s.type === 'line' || s.type === 'arrow') {
    return distToSegment(p, s.x1, s.y1, s.x2, s.y2) <= tol
  }
  if (s.type === 'ellipse') return nearEllipse(s, p, tol)
  if (s.type === 'pen' || s.type === 'marker') {
    // 蛍光ペンは太いので、見えている線の幅（半分）までを当たりにする
    const t = s.type === 'marker' ? Math.max(6 / state.zoom, s.width / 2) : tol
    const pts = s.points || []
    if (pts.length === 1) return Math.hypot(p.x - pts[0].x, p.y - pts[0].y) <= t
    for (let i = 1; i < pts.length; i++) {
      if (distToSegment(p, pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y) <= t) return true
    }
    return false
  }
  if (s.type === 'text') {
    const b = textBounds(s)
    return p.x >= b.x - 3 && p.x <= b.x + b.w + 3 && p.y >= b.y - 3 && p.y <= b.y + b.h + 3
  }
  const r = norm(s)
  const inside = p.x >= r.x - tol && p.x <= r.x + r.w + tol && p.y >= r.y - tol && p.y <= r.y + r.h + tol
  if (!inside) return false
  if (s.type === 'blur' || s.type === 'step') return true
  // 四角は中が空なので、枠の近くだけを当たりにする（重なった図形を掴み分けられるように）
  const inner = p.x > r.x + tol && p.x < r.x + r.w - tol && p.y > r.y + tol && p.y < r.y + r.h - tol
  return !inner
}

// 丸は中が空なので、輪の近くだけを当たりにする（四角と同じ扱い。中に別のものを描けるように）。
// 中心から点へ向かう線が輪と交わる所までの距離で測る（細長い楕円でも十分な近さで当たる）
function nearEllipse(s, p, tol) {
  const r = norm(s)
  const rx = r.w / 2
  const ry = r.h / 2
  const cx = r.x + rx
  const cy = r.y + ry
  // ほとんど線のような丸は、対角線ではなく長いほうの軸を線として扱う
  if (rx < 1 || ry < 1) {
    return rx < 1
      ? distToSegment(p, cx, r.y, cx, r.y + r.h) <= tol
      : distToSegment(p, r.x, cy, r.x + r.w, cy) <= tol
  }
  const dx = p.x - cx
  const dy = p.y - cy
  const k = Math.hypot(dx / rx, dy / ry)
  if (k < 1e-6) return Math.min(rx, ry) <= tol
  return Math.hypot(dx, dy) * Math.abs(1 - 1 / k) <= tol
}

// 蛍光ペンを持っているあいだは、置いた蛍光ペンを掴まない（隣の行を続けてなぞれるように）
function grabbable(s) {
  return !(state.tool === 'marker' && s.type === 'marker')
}

// 見た目がほかの図形より下にある蛍光ペンは、掴むのも最後に回す（上に見えているほうを先に掴む）。
// forGrab のときは、いまの道具で掴めないものを飛ばす
function hitTest(p, forGrab) {
  for (let i = state.shapes.length - 1; i >= 0; i--) {
    const s = state.shapes[i]
    if (UNDER_TYPES.has(s.type)) continue
    if (hitShape(s, p)) return s
  }
  for (let i = state.shapes.length - 1; i >= 0; i--) {
    const s = state.shapes[i]
    if (!UNDER_TYPES.has(s.type)) continue
    if (forGrab && !grabbable(s)) continue
    if (hitShape(s, p)) return s
  }
  return null
}

function hitHandle(s, p) {
  const tol = 7 / state.zoom
  for (const h of handlesFor(s)) {
    if (Math.abs(p.x - h.x) <= tol && Math.abs(p.y - h.y) <= tol) return h
  }
  return null
}

// 大きさを変える所のカーソル。Windows 標準のサイズ変更の矢印にそろえる
// （十字だと「掴んでいる」感が出ないため。Screenpresso と同じ見え方）
const HANDLE_CURSOR = {
  nw: 'nwse-resize', se: 'nwse-resize',
  ne: 'nesw-resize', sw: 'nesw-resize',
  n: 'ns-resize', s: 'ns-resize',
  e: 'ew-resize', w: 'ew-resize',
  r: 'nwse-resize',
}

function handleCursor(s, h) {
  // 線・矢印の端は向きが決まっていないので、線の傾きに近い矢印を選ぶ
  if (h.id === 'p1' || h.id === 'p2') {
    const a = ((Math.atan2(s.y2 - s.y1, s.x2 - s.x1) * 180 / Math.PI) + 180) % 180
    if (a < 22.5 || a >= 157.5) return 'ew-resize'
    if (a < 67.5) return 'nwse-resize'
    if (a < 112.5) return 'ns-resize'
    return 'nesw-resize'
  }
  return HANDLE_CURSOR[h.id] || 'move'
}

// 図形を丸ごと動かす（ドラッグ・貼り付け・矢印キー）。拡大鏡ののぞき窓も一緒に動かす
function moveShape(s, dx, dy) {
  s.x1 += dx; s.y1 += dy; s.x2 += dx; s.y2 += dy
  if (s.points) for (const pt of s.points) { pt.x = r1(pt.x + dx); pt.y = r1(pt.y + dy) }
  if (s.type === 'zoom') { s.cx += dx; s.cy += dy }
}

// 拡大鏡はドラッグした所だけを動かす。のぞき窓なら窓だけ、元の枠なら枠だけ（＝拡大する場所が変わる）
function moveDragged(s, part, dx, dy) {
  if (s.type !== 'zoom' || !part) return moveShape(s, dx, dy)
  if (part === 'lens') { s.cx += dx; s.cy += dy; return }
  s.x1 += dx; s.y1 += dy; s.x2 += dx; s.y2 += dy
}

function applyResize(s, handle, p, orig) {
  if (s.type === 'zoom' && handle === 'r') {
    s.r = r1(Math.max(8, Math.hypot(p.x - s.cx, p.y - s.cy)))
    return
  }
  if (s.type === 'line' || s.type === 'arrow') {
    if (handle === 'p1') { s.x1 = p.x; s.y1 = p.y } else { s.x2 = p.x; s.y2 = p.y }
    return
  }
  let x1 = Math.min(orig.x1, orig.x2)
  let y1 = Math.min(orig.y1, orig.y2)
  let x2 = Math.max(orig.x1, orig.x2)
  let y2 = Math.max(orig.y1, orig.y2)
  if (handle.indexOf('w') >= 0) x1 = p.x
  if (handle.indexOf('e') >= 0) x2 = p.x
  if (handle.indexOf('n') >= 0) y1 = p.y
  if (handle.indexOf('s') >= 0) y2 = p.y

  // 連番マーカーは丸のままにしたいので、縦横のうち大きいほうにそろえる
  if (s.type === 'step') {
    const d = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1))
    if (handle.indexOf('w') >= 0) x1 = x2 - d; else x2 = x1 + d
    if (handle.indexOf('n') >= 0) y1 = y2 - d; else y2 = y1 + d
  }

  // 鉛筆・蛍光ペンは枠だけ動かしても線は動かないので、元の枠と新しい枠の比で点をまとめて伸ばす
  if ((s.type === 'pen' || s.type === 'marker') && orig.points && orig.points.length) {
    const o = norm(orig)
    const sx = o.w > 0.001 ? (x2 - x1) / o.w : 1
    const sy = o.h > 0.001 ? (y2 - y1) / o.h : 1
    s.points = orig.points.map((pt) => ({
      x: r1(x1 + (pt.x - o.x) * sx),
      y: r1(y1 + (pt.y - o.y) * sy),
    }))
  }
  s.x1 = x1; s.y1 = y1; s.x2 = x2; s.y2 = y2
}

function removeShape(id) {
  const i = state.shapes.findIndex((s) => s.id === id)
  if (i >= 0) state.shapes.splice(i, 1)
  if (state.selectedId === id) state.selectedId = null
}

// ------------------------------------------------ 図形のコピー・貼り付け

// 真上に重ねると増えたことに気づけないので、貼るたびに必ずずらす
const PASTE_GAP = 20

let clipShape = null  // Ctrl+C で控えた図形（画面の外のクリップボードとは別物）
let clipStep = 0      // 続けて貼ったときに階段状にずらすための回数

function copyShape() {
  const s = byId(state.selectedId)
  if (!s) return false
  clipShape = JSON.parse(JSON.stringify(s))
  clipStep = 0
  toast('図形をコピーしました（Ctrl+V で貼り付け）')
  return true
}

function pasteShape() {
  if (!clipShape) return false
  clipStep++
  const s = JSON.parse(JSON.stringify(clipShape))
  s.id = nextId++
  // 切り抜きの外へ出すと view() が広がって余白が増えるので、はみ出す側とは逆へずらす
  const b = shapeBounds(s)
  const c = state.crop
  const d = PASTE_GAP * clipStep
  const dx = (b.x + b.w + d <= c.x + c.w) ? d : -d
  const dy = (b.y + b.h + d <= c.y + c.h) ? d : -d
  moveShape(s, dx, dy)
  const before = beginChange()
  state.shapes.push(s)
  state.selectedId = s.id
  commitChange(before)
  updateUi()
  draw()
  return true
}

// ---------------------------------------------------------------- 文字の入力

function positionTextEditor() {
  if (!editingShape) return
  const r = cv.getBoundingClientRect()
  const wr = wrap.getBoundingClientRect()
  const v = view()
  const t = textLayout(editingShape)
  const left = (r.left - wr.left) + wrap.scrollLeft + (t.x - v.x) * state.zoom
  const top = (r.top - wr.top) + wrap.scrollTop + (t.y - v.y) * state.zoom
  textEdit.style.left = left + 'px'
  textEdit.style.top = top + 'px'
}

// 枠のある文字は、入力欄を枠の大きさに固定する。はみ出した行は欄の中でスクロールして見る
function autoSizeTextEditor() {
  if (editingShape && editingShape.box) {
    const t = textLayout(editingShape)
    textEdit.style.width = (Math.max(t.w, editingShape.fontSize) * state.zoom) + 'px'
    textEdit.style.height = (Math.max(t.h, t.lh) * state.zoom) + 'px'
    return
  }
  textEdit.style.width = '10px'
  textEdit.style.height = '10px'
  textEdit.style.width = Math.min(textEdit.scrollWidth + 10, 1200) + 'px'
  textEdit.style.height = (textEdit.scrollHeight + 4) + 'px'
}

function openTextEditor(s, isNew) {
  commitText()
  editingShape = s
  editingIsNew = !!isNew
  const px = s.fontSize * state.zoom
  textEdit.hidden = false
  textEdit.value = s.text || ''
  textEdit.style.color = s.color
  textEdit.style.font = '600 ' + px + 'px "Yu Gothic UI", "Meiryo", system-ui, sans-serif'
  textEdit.style.lineHeight = (px * 1.28) + 'px'
  // 枠のある文字は白い欄の中で折り返す。白い字だと白地に消えるので、明るい色のときだけ地を暗くする
  textEdit.wrap = s.box ? 'soft' : 'off'
  textEdit.classList.toggle('box', !!s.box)
  textEdit.classList.toggle('dark', !!s.box && luminance(s.color) > 0.62)
  textEdit.scrollTop = 0
  freezeView()
  positionTextEditor()
  autoSizeTextEditor()
  draw()
  setTimeout(() => {
    textEdit.focus()
    const n = textEdit.value.length
    textEdit.setSelectionRange(n, n)
  }, 0)
}

function commitText() {
  if (!editingShape) return
  const s = editingShape
  const wasNew = editingIsNew
  const text = textEdit.value.replace(/[\r\n\s]+$/, '')
  editingShape = null
  editingIsNew = false
  textEdit.hidden = true

  const before = beginChange()
  if (!text) {
    if (!wasNew) removeShape(s.id)
  } else {
    s.text = text
    fitTextBox(s)
    if (wasNew) state.shapes.push(s)
    state.selectedId = s.id
  }
  commitChange(before)
  unfreezeView()
  draw()
}

function cancelText() {
  if (!editingShape) return
  editingShape = null
  editingIsNew = false
  textEdit.hidden = true
  unfreezeView()
  draw()
}

textEdit.addEventListener('input', autoSizeTextEditor)
textEdit.addEventListener('blur', () => { if (editingShape) commitText() })

// ---------------------------------------------------------------- マウス操作

cv.addEventListener('contextmenu', (e) => {
  e.preventDefault()
  const s = hitTest(toImg(e))
  if (!s) return
  const before = beginChange()
  removeShape(s.id)
  commitChange(before)
  draw()
})

cv.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return
  if (editingShape) { commitText(); return }
  const p = toImg(e)
  try { cv.setPointerCapture(e.pointerId) } catch (_) {}
  freezeView()

  // すでに置いたものの上なら、どの道具を持っていても掴む（動かす・大きさを変える）。
  // 中身を直したいときはダブルクリック。切り抜きは範囲を取る操作なので、ここは素通しする。
  if (state.tool !== 'crop') {
    const sel = byId(state.selectedId)
    const h = sel && grabbable(sel) ? hitHandle(sel, p) : null
    if (h) {
      drag = { mode: 'resize', id: sel.id, handle: h.id, orig: Object.assign({}, sel), before: beginChange() }
      cv.style.cursor = handleCursor(sel, h)
      return
    }
    const s = hitTest(p, true)
    if (s) {
      state.selectedId = s.id
      // 拡大鏡は、のぞき窓と元の枠のどちらを押したかで動かすものが変わる
      const part = s.type === 'zoom' ? zoomPart(s, p, Math.max(6 / state.zoom, s.width)) : null
      // 動かした量は押した所からの合計で持つ（Shift で引き寄せたとき、ずれが積み重ならないように）
      drag = { mode: 'move', id: s.id, part, sx: p.x, sy: p.y, ox: 0, oy: 0, before: beginChange() }
      updateUi()
      draw()
      return
    }
    // 何も無い所を押したとき。選択の道具なら選択を外すだけで終わり
    if (state.tool === 'select') {
      state.selectedId = null
      updateUi()
      draw()
      return
    }
  }

  // 文字はドラッグで入力する枠を取る。離した時点で入力欄を開く（endDrag）
  if (state.tool === 'text') {
    pending = {
      id: nextId++, type: 'text', color: state.color, width: state.lineWidth,
      fontSize: state.fontSize, deco: state.deco, halo: state.halo,
      x1: p.x, y1: p.y, x2: p.x, y2: p.y, text: '',
    }
    state.selectedId = null
    drag = { mode: 'draw', cx: p.x, cy: p.y }
    draw()
    return
  }

  if (state.tool === 'crop') {
    pendingCrop = { x1: p.x, y1: p.y, x2: p.x, y2: p.y }
    drag = { mode: 'crop' }
    draw()
    return
  }

  pending = {
    id: nextId++, type: state.tool, color: state.tool === 'marker' ? state.markerColor : state.color,
    width: state.tool === 'marker' ? state.markerWidth : state.lineWidth,
    fontSize: state.fontSize, x1: p.x, y1: p.y, x2: p.x, y2: p.y,
  }
  // 鉛筆・蛍光ペンは x1..x2 を「線を囲む枠」として使い、線そのものは points に持つ
  if (state.tool === 'pen' || state.tool === 'marker') pending.points = [{ x: r1(p.x), y: r1(p.y) }]
  // 描いている最中の見た目用。離したときに線の下全体で測り直す（endDrag）
  if (state.tool === 'marker') {
    const m = state.markerWidth
    pending.blend = markerBlend({ x: p.x - m, y: p.y - m / 2, w: m * 2, h: m })
  }
  // 拡大鏡ののぞき窓は、枠を広げるたびに枠の横へ置き直す（pointermove）
  if (state.tool === 'zoom') placeLens(pending)
  // 連番マーカーは押した場所が中心。そのまま離せば既定の大きさで置ける
  if (state.tool === 'step') {
    const rr = stepRadius(state.fontSize)
    // Shift を押しながら置くと、ほかの図形の中心・端にそろう
    const guides = { px: p.x, py: p.y }
    if (e.shiftKey) {
      const o = snapOffset({ x: p.x - rr, y: p.y - rr, w: rr * 2, h: rr * 2 }, null, null)
      p.x += o.dx; p.y += o.dy
      guides.guideX = o.gx; guides.guideY = o.gy
    }
    state.selectedId = null
    drag = Object.assign({ mode: 'draw', cx: p.x, cy: p.y }, guides)
    pending.x1 = p.x - rr; pending.y1 = p.y - rr
    pending.x2 = p.x + rr; pending.y2 = p.y + rr
    draw()
    return
  }
  state.selectedId = null
  drag = { mode: 'draw', cx: p.x, cy: p.y }
  draw()
})

cv.addEventListener('pointermove', (e) => {
  if (state.tool === 'hand') return
  if (!drag) {
    // 置いたものの上では掴めるので、その合図にカーソルを変える（切り抜きは範囲取りなので出さない）
    if (state.tool !== 'crop') {
      const p = toImg(e)
      const sel = byId(state.selectedId)
      const h = sel && grabbable(sel) ? hitHandle(sel, p) : null
      cv.style.cursor = h ? handleCursor(sel, h)
        : hitTest(p, true) ? 'move'
        : (state.tool === 'select' ? 'default' : 'crosshair')
    }
    return
  }
  const p = toImg(e)

  if (drag.mode === 'draw' && pending) {
    if (pending.type === 'marker' && e.shiftKey) {
      // Shift で、押した高さのまま真横に引く（ログの1行をなぞる用）
      const p0 = pending.points[0]
      pending.points = [p0, { x: r1(p.x), y: p0.y }]
      pending.x1 = Math.min(p0.x, p.x); pending.x2 = Math.max(p0.x, p.x)
      pending.y1 = p0.y; pending.y2 = p0.y
    } else if (pending.type === 'pen' || pending.type === 'marker') {
      addPenPoint(pending, p)
    } else if (pending.type === 'step') {
      // 押した場所を中心に、引っ張った距離が半径。クリックの手ぶれ（と Shift で吸い付いたずれ）は
      // ドラッグと見なさず、文字の大きさに合わせた既定の大きさのままにする（数px 動くだけで最小に縮むため）
      if (!drag.sized && Math.hypot(p.x - drag.px, p.y - drag.py) < 6 / state.zoom) return
      drag.sized = true
      const rr = Math.max(9, Math.hypot(p.x - drag.cx, p.y - drag.cy))
      pending.x1 = drag.cx - rr; pending.y1 = drag.cy - rr
      pending.x2 = drag.cx + rr; pending.y2 = drag.cy + rr
    } else {
      pending.x2 = p.x
      pending.y2 = p.y
      if (e.shiftKey) constrain(pending)
      if (pending.type === 'zoom') placeLens(pending)
    }
  } else if (drag.mode === 'crop' && pendingCrop) {
    pendingCrop.x2 = p.x
    pendingCrop.y2 = p.y
  } else if (drag.mode === 'move') {
    const s = byId(drag.id)
    if (s) {
      let tx = p.x - drag.sx
      let ty = p.y - drag.sy
      drag.guideX = null
      drag.guideY = null
      // Shift を押しているあいだは、ほかの図形の中心・端（と等間隔の位置）へ引き寄せる
      if (e.shiftKey) {
        const b = alignBox(s, drag.part)
        const o = snapOffset({ x: b.x + tx - drag.ox, y: b.y + ty - drag.oy, w: b.w, h: b.h }, s.id, drag.part)
        tx += o.dx; ty += o.dy
        drag.guideX = o.gx; drag.guideY = o.gy
      }
      moveDragged(s, drag.part, tx - drag.ox, ty - drag.oy)
      drag.ox = tx; drag.oy = ty
    }
  } else if (drag.mode === 'resize') {
    const s = byId(drag.id)
    if (s) applyResize(s, drag.handle, p, drag.orig)
  }
  draw()
})

// ---- Shift+ドラッグの引き寄せ
// 見えないグリッドの代わりに、ほかの図形の「左端・中心・右端」「上端・中心・下端」と、
// 縦（横）に並んだ2つと同じ間隔になる位置へ吸い付ける。番号を縦に 1 2 3… と並べる用
const SNAP_PX = 8   // 画面上でこの距離（CSS px）まで近づいたら吸い付く

// そろえる基準の四角。拡大鏡はのぞき窓と元の枠を別々に扱う
function alignBox(s, part) {
  if (s.type === 'zoom' && part === 'lens') return { x: s.cx - s.r, y: s.cy - s.r, w: s.r * 2, h: s.r * 2 }
  if (s.type === 'text') return shapeBounds(s)
  return norm(s)
}

function snapTargets(exceptId) {
  const boxes = []
  for (const o of state.shapes) {
    if (o.id === exceptId) continue
    boxes.push(alignBox(o, null))
    if (o.type === 'zoom') boxes.push(alignBox(o, 'lens'))
  }
  const xs = []   // { v, kind: 'edge' | 'center' }
  const ys = []
  const c = state.crop
  for (const b of boxes.concat([{ x: c.x, y: c.y, w: c.w, h: c.h }])) {
    xs.push({ v: b.x, kind: 'edge' }, { v: b.x + b.w, kind: 'edge' }, { v: b.x + b.w / 2, kind: 'center' })
    ys.push({ v: b.y, kind: 'edge' }, { v: b.y + b.h, kind: 'edge' }, { v: b.y + b.h / 2, kind: 'center' })
  }
  // 等間隔：同じ列（中心の横位置がほぼ同じ）に並んだ2つの間隔を、その先へ延ばした位置
  const tol = SNAP_PX / state.zoom
  for (let i = 0; i < boxes.length; i++) {
    for (let j = 0; j < boxes.length; j++) {
      if (i === j) continue
      const a = boxes[i], b = boxes[j]
      const ax = a.x + a.w / 2, ay = a.y + a.h / 2, bx = b.x + b.w / 2, by = b.y + b.h / 2
      if (Math.abs(ax - bx) < tol && Math.abs(ay - by) > tol) ys.push({ v: 2 * ay - by, kind: 'center' })
      if (Math.abs(ay - by) < tol && Math.abs(ax - bx) > tol) xs.push({ v: 2 * ax - bx, kind: 'center' })
    }
  }
  return { xs, ys }
}

// 四角 box をいちばん近い基準へ寄せる量。寄せた基準線の位置（gx/gy）はガイド線の表示に使う
function snapOffset(box, exceptId) {
  const t = snapTargets(exceptId)
  const tol = SNAP_PX / state.zoom
  const pick = (lo, size, list) => {
    // 中心を先に見る。端と同じ近さなら中心にそろえた扱いにする（ガイド線を中心に引くため）
    const mine = [{ v: lo + size / 2, kind: 'center' }, { v: lo, kind: 'edge' }, { v: lo + size, kind: 'edge' }]
    let best = null
    for (const m of mine) {
      for (const g of list) {
        if (g.kind !== m.kind) continue
        const d = g.v - m.v
        if (Math.abs(d) <= tol && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, at: g.v }
      }
    }
    return best
  }
  const bx = pick(box.x, box.w, t.xs)
  const by = pick(box.y, box.h, t.ys)
  return { dx: bx ? bx.d : 0, dy: by ? by.d : 0, gx: bx ? bx.at : null, gy: by ? by.at : null }
}

// 吸い付いた基準線。見えている範囲の端から端まで細い線で出す
function drawSnapGuides(g) {
  if (!drag || (drag.guideX == null && drag.guideY == null)) return
  const v = view()
  const z = state.zoom
  g.save()
  g.lineWidth = 1 / z
  g.strokeStyle = '#ff2d9b'
  g.beginPath()
  if (drag.guideX != null) { g.moveTo(drag.guideX, v.y); g.lineTo(drag.guideX, v.y + v.h) }
  if (drag.guideY != null) { g.moveTo(v.x, drag.guideY); g.lineTo(v.x + v.w, drag.guideY) }
  g.stroke()
  g.restore()
}

// Shift を押しながらで、正方形／水平・垂直・斜め45度にそろえる
function constrain(s) {
  const dx = s.x2 - s.x1
  const dy = s.y2 - s.y1
  if (s.type === 'line' || s.type === 'arrow') {
    const a = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4)
    const len = Math.hypot(dx, dy)
    s.x2 = s.x1 + Math.cos(a) * len
    s.y2 = s.y1 + Math.sin(a) * len
  } else {
    const d = Math.max(Math.abs(dx), Math.abs(dy))
    s.x2 = s.x1 + Math.sign(dx || 1) * d
    s.y2 = s.y1 + Math.sign(dy || 1) * d
  }
}

function endDrag() {
  unfreezeView()
  if (!drag) return
  const mode = drag.mode
  const before = drag.before
  drag = null

  if (mode === 'draw' && pending && pending.type === 'text') {
    const s = pending
    pending = null
    const r = norm(s)
    // クリックだけ（ほとんど動かしていない）なら枠なし。改行した所でだけ折れる、これまでの置き方
    if (r.w * state.zoom > 8 && r.h * state.zoom > 8) {
      // 画面の外まで引っ張っても、枠は見えている範囲に収める（はみ出すと画角が広がる）
      const v = view()
      const x1 = Math.max(r.x, v.x), y1 = Math.max(r.y, v.y)
      const x2 = Math.min(r.x + r.w, v.x + v.w), y2 = Math.min(r.y + r.h, v.y + v.h)
      s.box = true
      s.x1 = x1; s.y1 = y1
      s.x2 = Math.max(x2, x1 + s.fontSize)
      s.y2 = Math.max(y2, y1 + s.fontSize * 1.28)
    } else {
      s.x2 = s.x1; s.y2 = s.y1
    }
    updateUi()
    openTextEditor(s, true)
    return
  }

  if (mode === 'draw' && pending) {
    const isLine = pending.type === 'line' || pending.type === 'arrow'
    const ok = pending.type === 'step'
      ? true                              // クリックしただけでも置ける
      : pending.type === 'pen'
        ? pending.points.length >= 2
      // 蛍光ペンは Shift で押しただけでも2点になるので、少しは引いたかも見る
      : pending.type === 'marker'
        ? pending.points.length >= 2 && (pending.x2 - pending.x1) + (pending.y2 - pending.y1) > 2
        : isLine
        ? Math.hypot(pending.x2 - pending.x1, pending.y2 - pending.y1) > 4
        : (Math.abs(pending.x2 - pending.x1) > 4 && Math.abs(pending.y2 - pending.y1) > 4)
    const snap = beginChange()
    if (ok && pending.type === 'marker') pending.blend = markerBlend(shapeBounds(pending))
    if (ok) {
      state.shapes.push(pending)
      state.selectedId = pending.id
    }
    pending = null
    commitChange(snap)
  } else if (mode === 'crop' && pendingCrop) {
    const r = norm({ x1: pendingCrop.x1, y1: pendingCrop.y1, x2: pendingCrop.x2, y2: pendingCrop.y2 })
    pendingCrop = null
    if (r.w > 8 && r.h > 8) {
      const snap = beginChange()
      const x = Math.max(0, Math.round(r.x))
      const y = Math.max(0, Math.round(r.y))
      const w = Math.min(state.imgW - x, Math.round(r.w))
      const h = Math.min(state.imgH - y, Math.round(r.h))
      state.crop = { x, y, w, h }
      // 切り抜いた外に丸ごと出ている書き込みは消す。残すと画角がそのぶん広がって切り抜けない
      // スポットライトとぼかしは切り抜き範囲で切り詰められる（paintBounds が null になりうる）ので、自分の四角で判定する
      state.shapes = state.shapes.filter((sh) => {
        const b = (sh.type === 'spot' || sh.type === 'blur') ? norm(sh) : paintBounds(sh)
        return !b || (b.x + b.w > x && b.y + b.h > y && b.x < x + w && b.y < y + h)
      })
      if (!byId(state.selectedId)) state.selectedId = null
      state.fit = true
      commitChange(snap)
      layout()
    }
  } else if (before) {
    // 枠を細くして行が増えたら、枠を下へ伸ばして収める
    if (mode === 'resize') fitTextBox(byId(state.selectedId))
    commitChange(before)
  }
  updateUi()
  draw()
}

// 置いたものの中身を直すのはダブルクリック。1回のクリックは掴むほうに使う
cv.addEventListener('dblclick', (e) => {
  if (state.tool === 'hand') return
  const s = hitTest(toImg(e))
  if (s && s.type === 'text') openTextEditor(s, false)
})

cv.addEventListener('pointerup', endDrag)
cv.addEventListener('pointercancel', endDrag)

wrap.addEventListener('wheel', (e) => {
  if (!e.ctrlKey) return
  e.preventDefault()
  zoomStep(e.deltaY < 0 ? 1 : -1)
}, { passive: false })

// ---------------------------------------------------------------- ツールバー

function setTool(tool) {
  if (tool === 'hand' && handBtn.disabled) return
  commitText()
  // 「つかむ」から戻るときの行き先。はみ出しが無くなったら自動でここへ戻す
  if (tool === 'hand' && state.tool !== 'hand') handBackTool = state.tool
  state.tool = tool
  if (tool !== 'select' && tool !== 'hand') state.selectedId = null
  cv.classList.toggle('select', tool === 'select')
  wrap.classList.toggle('hand', tool === 'hand')
  // 「つかむ」の手のカーソルは CSS 側で出す（直に書くとそちらが勝ってしまう）
  cv.style.cursor = tool === 'hand' ? '' : tool === 'select' ? 'default' : 'crosshair'
  updateUi()
  draw()
}

// 選択中の図形があれば、色・太さの変更をその図形にも反映する
function applyStyle(patch) {
  Object.assign(state, patch)
  const s = byId(state.selectedId)
  if (s) {
    const before = beginChange()
    if (patch.color && s.type !== 'marker') s.color = patch.color
    if (patch.markerColor && s.type === 'marker') s.color = patch.markerColor
    if (patch.lineWidth && s.type !== 'text' && s.type !== 'marker') s.width = patch.lineWidth
    if (patch.markerWidth && s.type === 'marker') s.width = patch.markerWidth
    if (patch.fontSize && s.type === 'text') { s.fontSize = patch.fontSize; fitTextBox(s) }
    if (patch.deco && s.type === 'text') s.deco = patch.deco
    if (patch.halo && s.type === 'text') s.halo = patch.halo
    // マーカーは文字サイズで丸ごと大きさが変わる（中心はそのまま）
    if (patch.fontSize && s.type === 'step') {
      const r0 = norm(s)
      const cx = r0.x + r0.w / 2
      const cy = r0.y + r0.h / 2
      const rr = stepRadius(patch.fontSize)
      s.fontSize = patch.fontSize
      s.x1 = cx - rr; s.y1 = cy - rr; s.x2 = cx + rr; s.y2 = cy + rr
    }
    commitChange(before)
  }
  window.api.send('app:setDefaults', {
    color: state.color, markerColor: state.markerColor, lineWidth: state.lineWidth, markerWidth: state.markerWidth,
    fontSize: state.fontSize, deco: state.deco, halo: state.halo,
  })
  updateUi()
  draw()
}

document.querySelectorAll('.tool').forEach((b) => {
  b.addEventListener('click', () => setTool(b.dataset.tool))
})
// 色の欄は、選んでいる図形（無ければ持っている道具）が蛍光ペンなら蛍光ペンの色を、それ以外は共通の色を変える
function colorKey() {
  const sel = byId(state.selectedId)
  return (sel ? sel.type : state.tool) === 'marker' ? 'markerColor' : 'color'
}
document.querySelectorAll('.sw[data-color]').forEach((b) => {
  b.addEventListener('click', () => applyStyle({ [colorKey()]: b.dataset.color }))
})
document.getElementById('colorPick').addEventListener('input', (e) => {
  applyStyle({ [colorKey()]: e.target.value })
})
document.querySelectorAll('#widths .wd').forEach((b) => {
  b.addEventListener('click', () => applyStyle({ lineWidth: Number(b.dataset.width) }))
})
document.querySelectorAll('#markerWidths .wd').forEach((b) => {
  b.addEventListener('click', () => applyStyle({ markerWidth: Number(b.dataset.width) }))
})
const fontSizeEl = document.getElementById('fontSize')
const fontDecoEl = document.getElementById('fontDeco')
for (const n of FONT_SIZES) {
  const o = document.createElement('option')
  o.value = String(n)
  o.textContent = n + ' px'
  fontSizeEl.appendChild(o)
}
fontSizeEl.addEventListener('change', () => applyStyle({ fontSize: Number(fontSizeEl.value) }))
fontDecoEl.addEventListener('change', () => applyStyle({ deco: fontDecoEl.value }))

const fontHaloEl = document.getElementById('fontHalo')
for (const h of HALOS) {
  const o = document.createElement('option')
  o.value = String(h.v)
  o.textContent = h.label
  fontHaloEl.appendChild(o)
}
fontHaloEl.addEventListener('change', () => applyStyle({ halo: Number(fontHaloEl.value) }))

// 仕上げは絵ごとではなく「最後に選んだもの」を設定に覚える（資料づくりの間は毎回同じ仕上げで出すため）。
// 選んでも見え方は出さない（毎回出ると邪魔で、白い下地の上では縁や背景の範囲を見誤るため）。
// プルダウンに残ると矢印キーで仕上げが変わってしまうので手放す
const finishEl = document.getElementById('finish')
for (const f of FINISHES) {
  const o = document.createElement('option')
  o.value = f
  o.textContent = '仕上げ：' + FINISH_LABELS[f]
  finishEl.appendChild(o)
}
finishEl.addEventListener('change', () => {
  state.finish = FINISHES.includes(finishEl.value) ? finishEl.value : 'none'
  finishEl.blur()
  window.api.send('app:setDefaults', { finish: state.finish })
  updateUi()
})
document.getElementById('btnFinishView').addEventListener('click', () => showFinishPreview())

// ---------------------------------------------------------------- 書き方のお気に入り

// 登録できる道具。選択・つかむ・切り抜きは書き方を持たないので入れない（main.js の PRESET_TOOLS と同じ）
const PRESET_TOOLS = ['rect', 'ellipse', 'arrow', 'line', 'pen', 'marker', 'text', 'step', 'blur', 'spot', 'zoom']
const favBtns = Array.from(document.querySelectorAll('.fav'))

// お気に入りの、その道具で意味のある項目だけを取り出す。
// 全部当てると、文字のお気に入りを押したとき選んでいた矢印の太さまで変わってしまうため
function presetPatch(p) {
  if (p.tool === 'marker') return { markerColor: p.color, markerWidth: nearest(MARKER_WIDTHS, p.lineWidth) }
  if (p.tool === 'spot') return {}
  if (p.tool === 'blur') return { lineWidth: nearest(WIDTHS, p.lineWidth) }
  const patch = { color: p.color }
  if (p.tool === 'text' || p.tool === 'step') patch.fontSize = nearest(FONT_SIZES, p.fontSize)
  else patch.lineWidth = nearest(WIDTHS, p.lineWidth)
  if (p.tool === 'text') {
    patch.deco = DECOS.includes(p.deco) ? p.deco : 'auto'
    patch.halo = nearest(HALOS.map((h) => h.v), p.halo)
  }
  return patch
}

// ボタンの説明（title）。色の名前は色の欄のボタンの title から取る
function describePreset(p) {
  const sw = document.querySelector('.sw[data-color="' + p.color + '"]')
  const color = sw ? sw.title : '好きな色'
  const toolBtn = document.querySelector('.tool[data-tool="' + p.tool + '"] span')
  const tool = toolBtn ? toolBtn.textContent : p.tool
  const q = presetPatch(p)
  if (p.tool === 'text') {
    const deco = Array.from(fontDecoEl.options).find((o) => o.value === q.deco)
    const halo = HALOS.find((h) => h.v === q.halo)
    const hasHalo = q.deco !== 'shadow' && q.deco !== 'none'
    return color + '・文字 ' + q.fontSize + 'px・' + (deco ? deco.textContent : '') + (hasHalo && halo ? '（' + halo.label + '）' : '')
  }
  if (p.tool === 'step') return color + '・番号 ' + q.fontSize + 'px'
  if (p.tool === 'spot') return 'スポットライト'
  const wBtn = p.tool === 'marker'
    ? document.querySelector('#markerWidths .wd[data-width="' + q.markerWidth + '"]')
    : document.querySelector('#widths .wd[data-width="' + q.lineWidth + '"]')
  const width = wBtn ? wBtn.title.replace('蛍光ペン ', '') : ''
  if (p.tool === 'blur') return 'ぼかし・' + width
  return color + '・' + tool + '・' + width
}

// ボタンの見た目は「その道具の絵を、その色で」。道具の絵はツールバーのものを写して使う
function renderPresets() {
  favBtns.forEach((b, i) => {
    const p = presets[i]
    b.textContent = ''
    b.hidden = !p
    if (!p) return
    const n = document.createElement('b')
    n.textContent = String(i + 1)
    b.appendChild(n)
    const svg = document.querySelector('.tool[data-tool="' + p.tool + '"] svg')
    if (svg) b.appendChild(svg.cloneNode(true))
    b.style.setProperty('--c', p.tool === 'spot' || p.tool === 'blur' ? 'var(--fg)' : p.color)
    b.classList.toggle('halo', p.tool === 'text' && (p.deco === 'white' || p.deco === 'white-shadow'))
    b.classList.toggle('dark', p.tool !== 'spot' && p.tool !== 'blur' && luminance(p.color) < 0.12)
    b.title = (i + 1) + '：' + describePreset(p)
      + '\nクリック（またはキー ' + (i + 1) + '）でこの書き方に持ち替え'
      + '\nCtrl+クリックで、いまの書き方をここに登録'
  })
  syncPresetUi()
}

function setPresets(list) {
  presets = Array.isArray(list)
    ? list.slice(0, 4).map((p) => (p && PRESET_TOOLS.includes(p.tool) && typeof p.color === 'string' ? p : null))
    : []
  renderPresets()
}

// いまの道具と書き方がお気に入りと同じなら、そのボタンを光らせる
function syncPresetUi() {
  favBtns.forEach((b, i) => {
    const p = presets[i]
    const on = !!p && !state.selectedId && p.tool === state.tool
      && Object.entries(presetPatch(p)).every(([k, v]) => String(state[k]).toLowerCase() === String(v).toLowerCase())
    b.classList.toggle('on', on)
  })
}

// 押したら、その道具に持ち替えて書き方を一度に切り替える。
// 図形を選んでいれば applyStyle がその図形にも当てる（入力中の文字は確定させて、選んだ状態にしてから当てる）
function applyPreset(i) {
  const p = presets[i]
  if (!p || drag || pending || pendingCrop) return
  commitText()
  applyStyle(presetPatch(p))
  setTool(p.tool)
}

// いまの書き方。図形を選んでいればその図形の書き方、無ければ持っている道具と今の設定
function currentStyle() {
  const sel = byId(state.selectedId)
  const tool = sel ? sel.type : state.tool
  if (!PRESET_TOOLS.includes(tool)) return null
  const marker = tool === 'marker'
  const p = {
    tool,
    color: marker ? state.markerColor : state.color,
    lineWidth: marker ? state.markerWidth : state.lineWidth,
    fontSize: state.fontSize,
    deco: state.deco,
    halo: state.halo,
  }
  if (sel) {
    if (sel.color) p.color = sel.color
    if (sel.type !== 'text' && sel.type !== 'step' && sel.width) p.lineWidth = sel.width
    if (sel.fontSize) p.fontSize = sel.fontSize
    if (sel.type === 'text') {
      if (DECOS.includes(sel.deco)) p.deco = sel.deco
      if (Number(sel.halo) > 0) p.halo = Number(sel.halo)
    }
  }
  p.color = String(p.color).toLowerCase()
  return p
}

// 登録は Ctrl+クリック。右クリックは、編集画面では「図形を消す」操作なので使わない（紛らわしいため）
function registerPreset(i) {
  commitText()
  const p = currentStyle()
  if (!p) {
    toast('先に道具（文字・矢印・四角など）を選ぶか、図形を選んでから Ctrl+クリックしてください')
    return
  }
  presets[i] = p
  renderPresets()
  window.api.send('app:setStylePreset', { index: i, preset: p })
  toast('お気に入り ' + (i + 1) + ' に「' + describePreset(p) + '」を登録しました')
}

favBtns.forEach((b, i) => {
  b.addEventListener('click', (e) => {
    if (e.ctrlKey || e.metaKey) registerPreset(i)
    else applyPreset(i)
  })
})

// 別の編集画面で登録し直したとき、こちらの4つもそろえる（古い4つのまま登録して上書きし合わないように）
window.api.on('editor:stylePresets', setPresets)

document.getElementById('btnLibrary').addEventListener('click', () => {
  flushLibrary()
  window.api.send('library:show')
})
// 撮り直しは新しい1枚として開く。書き込みは引き継がないので、この絵のぶんは先に履歴へ流しておく
document.getElementById('btnRetake').addEventListener('click', () => {
  commitText()
  flushLibrary()
  window.api.send('editor:retake')
})
document.getElementById('btnFocus').addEventListener('click', () => toggleFocus())
// 浮かせるのは見えている絵そのもの（仕上げの余白・影は付けない）。
// 画角の左上も渡すと、本体が撮った位置にぴったり重ねて出す（切り抜き・はみ出しがあってもずれない）
document.getElementById('btnPin').addEventListener('click', () => {
  if (!state.img) return
  commitText()
  flushLibrary()
  const v = view()
  // 位置は撮ったときの絵の座標で渡す（本体は撮った場所に重ねるのに使う。大きさを変えた絵でも左上をそこに合わせる）
  window.api.send('editor:pin', { dataUrl: exportCanvas().toDataURL('image/png'), x: v.x / state.scale, y: v.y / state.scale })
})
document.getElementById('btnResize').addEventListener('click', () => openResize())
document.getElementById('btnUndo').addEventListener('click', undo)
document.getElementById('btnRedo').addEventListener('click', redo)
document.getElementById('btnCopy').addEventListener('click', () => doCopy())
document.getElementById('btnSave').addEventListener('click', () => doSave(false))
document.getElementById('btnSaveAs').addEventListener('click', () => doSave(true))
document.getElementById('btnSplit').addEventListener('click', () => doSplitSave())
document.getElementById('btnZoomIn').addEventListener('click', () => zoomStep(1))
document.getElementById('btnZoomOut').addEventListener('click', () => zoomStep(-1))
document.getElementById('btnZoom100').addEventListener('click', () => setZoom(1, false))
document.getElementById('btnZoomFit').addEventListener('click', () => setZoom(1, true))

// 太さの欄は、道具や選んだ図形で中身（太さ・蛍光ペンの太さ・文字の大きさ）が入れ替わる。
// 幅が変わるとツールバーの折り返しが変わって絵が上下にずれるので、いちばん広い中身の幅を先に確保しておく
function reserveOptsWidth() {
  const opts = document.getElementById('opts')
  const groups = ['widths', 'markerWidths', 'fonts'].map((id) => document.getElementById(id))
  const keep = groups.map((g) => g.hidden).concat(fontDecoEl.hidden, fontHaloEl.hidden)
  opts.style.minWidth = ''
  fontDecoEl.hidden = false
  fontHaloEl.hidden = false
  let w = 0
  for (const g of groups) {
    for (const x of groups) x.hidden = x !== g
    w = Math.max(w, opts.getBoundingClientRect().width)
  }
  groups.forEach((g, i) => { g.hidden = keep[i] })
  fontDecoEl.hidden = keep[3]
  fontHaloEl.hidden = keep[4]
  opts.style.minWidth = Math.ceil(w) + 'px'
}

function updateUi() {
  document.querySelectorAll('.tool').forEach((b) => b.classList.toggle('on', b.dataset.tool === state.tool))
  const curColor = state[colorKey()]
  document.querySelectorAll('.sw[data-color]').forEach((b) => {
    b.classList.toggle('on', b.dataset.color.toLowerCase() === curColor.toLowerCase())
  })
  const pick = document.getElementById('colorPick')
  if (pick.value.toLowerCase() !== curColor.toLowerCase()) pick.value = curColor
  document.querySelectorAll('#widths .wd').forEach((b) => b.classList.toggle('on', Number(b.dataset.width) === state.lineWidth))
  document.querySelectorAll('#markerWidths .wd').forEach((b) => b.classList.toggle('on', Number(b.dataset.width) === state.markerWidth))
  fontSizeEl.value = String(state.fontSize)
  fontDecoEl.value = state.deco
  fontHaloEl.value = String(state.halo)
  finishEl.value = state.finish
  document.getElementById('btnFinishView').hidden = state.finish === 'none'

  const sel = byId(state.selectedId)
  // 太さ・文字の欄は、選んでいる図形（無ければ持っている道具）に合わせて1種類だけ出す。
  // 2種類同時に出ると reserveOptsWidth() で取った幅を超え、ツールバーの段が増えて絵が下へずれる
  const kind = sel ? sel.type : state.tool
  // 文字サイズは、文字と連番マーカー（丸の大きさ）で使う
  const textMode = kind === 'text'
  document.getElementById('fonts').hidden = !(textMode || kind === 'step')
  // 飾りは文字だけのもの。連番マーカーのときは出さない
  fontDecoEl.hidden = !textMode
  // フチの太さは、フチが出る飾りを選んでいるときだけ意味がある
  fontHaloEl.hidden = !textMode || state.deco === 'shadow' || state.deco === 'none'
  // 文字と連番マーカーは線の太さを使わないので出さない。蛍光ペンは専用の太さを出す
  // スポットライトの暗さは固定なので、太さも出さない
  document.getElementById('widths').hidden = kind === 'text' || kind === 'step' || kind === 'marker' || kind === 'spot'
  document.getElementById('markerWidths').hidden = kind !== 'marker'

  // 縦長のときだけ「分割保存」を出す（ふつうの絵では使わないため）
  const split = document.getElementById('btnSplit')
  const tall = view().w > 0 && isTallImage()
  split.hidden = !tall
  if (tall) split.textContent = '分割保存（' + splitPieces().length + '枚）'

  document.getElementById('btnUndo').disabled = state.undo.length === 0
  document.getElementById('btnRedo').disabled = state.redo.length === 0
  const v = view()
  document.getElementById('stSize').textContent = Math.round(v.w) + ' × ' + Math.round(v.h) + ' px'
    + (isWidened() ? '（はみ出したぶんを足しています）' : '')
  // 倍率はボタンの中に出す（サイズ表示に足すと下の帯が最小幅に収まらない）
  const rb = document.getElementById('btnResize')
  rb.classList.toggle('on', state.scale !== 1)
  rb.textContent = state.scale !== 1 ? 'サイズ ' + pctText(state.scale) : 'サイズ'
  document.getElementById('stZoom').textContent = Math.round(state.zoom * 100) + '%'
  const focusBtn = document.getElementById('btnFocus')
  focusBtn.textContent = state.focus ? '集中を解除' : '集中'
  focusBtn.classList.toggle('primary', state.focus)
  syncPresetUi()
  updateTip()
  syncAspect()
}

// 「保存」を押すと何が起きるかを、その時の状態に合わせて出す
function updateTip() {
  const tip = document.getElementById('stTip')
  if (!state.savedPath) { tip.textContent = '保存先に書き出せませんでした（「保存」でやり直せます）'; return }
  const what = (state.shapes.length || isCropped()) ? '書き込み'
    : state.scale !== 1 ? 'サイズ変更' : '仕上げ（' + FINISH_LABELS[state.finish] + '）'
  tip.textContent = needsExport()
    ? what + 'は「保存」で ' + baseNameOf(state.savedPath) + '_書き込み.png として別に出ます（元の絵はそのまま）'
    : '保存済み： ' + fileNameOf(state.savedPath)
}

// ---------------------------------------------------------------- 保存・コピー

function toast(msg, filePath) {
  toastMsg.textContent = msg
  toastAction.hidden = !filePath
  toastAction.onclick = filePath ? () => window.api.send('app:reveal', filePath) : null
  toastEl.hidden = false
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { toastEl.hidden = true }, 4200)
}

async function doCopy() {
  commitText()
  const r = await window.api.invoke('app:copy', exportPNG())
  if (r && r.ok) {
    state.copied = true
    toast('クリップボードにコピーしました' + (state.finish !== 'none' ? '（' + FINISH_LABELS[state.finish] + '）' : ''))
  } else {
    toast('コピーに失敗しました')
  }
}

// 撮った時点でもう保存されている。ここでやるのは
//   書き込みがあるとき … 焼いた絵を「_書き込み.png」として別に出す（元の絵はそのまま）
//   名前を付けるとき   … 元の絵をその名前へ動かす（増やさない）
// 済んだらそのまま閉じる。失敗・名前のダイアログをやめたときは、やり直せるように閉じない。
// 保存できたときは、本体が Ctrl+C と同じ絵をクリップボードにも入れている（r.copied）。
async function doSave(saveAs) {
  commitText()
  flushLibrary()
  const r = await window.api.invoke('app:save', {
    dataUrl: exportPNG(),
    saveAs: !!saveAs,
    // 仕上げだけのときも「書き込みあり」として扱う。元の絵と違う絵なので、原本を動かさず別名で出す
    edited: needsExport(),
    libraryId: state.libraryId,
  })
  if (!r || r.canceled) return
  if (!r.ok) { toast('保存に失敗しました： ' + (r.error || '')); return }

  state.dirty = false
  if (r.moved) state.savedPath = r.path
  // 保存は済んでいるので、コピーだけ失敗したときは閉じずに知らせる（閉じるとお知らせが見えない）。押し直せばよい
  if (!r.copied) { toast('保存はできましたが、クリップボードへのコピーに失敗しました'); return }
  // 書き込みが無いときは撮った時のファイルがそのまま残っているので、閉じるだけでよい
  requestClose()
}

function fileNameOf(p) {
  return String(p || '').split(/[\\/]/).pop()
}

// 拡張子を外したファイル名
function baseNameOf(p) {
  return fileNameOf(p).replace(/\.[^.]+$/, '')
}

// ---------------------------------------------------------------- キーボード

window.addEventListener('keydown', (e) => {
  if (e.target === textEdit) {
    if (e.key === 'Escape') { e.preventDefault(); cancelText() }
    else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); commitText() }
    return
  }

  // 大きさのダイアログを出している間は、道具の持ち替えなどのキーを効かせない（数字を打つとき「V」などで道具が変わるため）
  if (!rzDlg.hidden) {
    if (e.key === 'Escape') { e.preventDefault(); closeResize() }
    else if (e.key === 'Enter') { e.preventDefault(); rzApply() }
    return
  }

  const mod = e.ctrlKey || e.metaKey

  if (mod && e.altKey && (e.key === 's' || e.key === 'S')) { e.preventDefault(); doSave(true); return }
  if (mod && !e.altKey) {
    const k = e.key.toLowerCase()
    if (k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); return }
    if ((k === 'z' && e.shiftKey) || k === 'y') { e.preventDefault(); redo(); return }
    if (k === 'c') { e.preventDefault(); if (!copyShape()) doCopy(); return }
    if (k === 'v') { e.preventDefault(); pasteShape(); return }
    if (k === 's') { e.preventDefault(); doSave(false); return }
    if (k === '0') { e.preventDefault(); setZoom(1, false); return }
    if (k === '9') { e.preventDefault(); setZoom(1, true); return }
    return
  }
  if (e.altKey) return

  // 数字キー 1〜4 は書き方のお気に入り。プルダウンにいるときは、そちらの項目選びに譲る
  if (/^[1-4]$/.test(e.key)) {
    if (e.target && (e.target.tagName === 'SELECT' || e.target.tagName === 'INPUT')) return
    e.preventDefault()
    applyPreset(Number(e.key) - 1)
    return
  }

  if (e.key === 'Delete' || e.key === 'Backspace') {
    if (!state.selectedId) return
    e.preventDefault()
    const before = beginChange()
    removeShape(state.selectedId)
    commitChange(before)
    updateUi()
    draw()
    return
  }

  if (e.key === 'Escape') {
    e.preventDefault()
    if (hideFinishPreview()) return
    if (state.selectedId) { state.selectedId = null; updateUi(); draw() }
    else if (state.focus) toggleFocus()
    else requestClose()
    return
  }

  if (e.key.startsWith('Arrow') && state.selectedId) {
    e.preventDefault()
    const step = e.shiftKey ? 10 : 1
    const s = byId(state.selectedId)
    const before = beginChange()
    if (e.key === 'ArrowLeft') moveShape(s, -step, 0)
    if (e.key === 'ArrowRight') moveShape(s, step, 0)
    if (e.key === 'ArrowUp') moveShape(s, 0, -step)
    if (e.key === 'ArrowDown') moveShape(s, 0, step)
    commitChange(before)
    draw()
    return
  }

  if (e.key === 'f' || e.key === 'F') { e.preventDefault(); toggleFocus(); return }

  const tools = {
    v: 'select', h: 'hand', r: 'rect', e: 'ellipse', a: 'arrow', l: 'line', p: 'pen', m: 'marker',
    t: 'text', n: 'step', b: 'blur', s: 'spot', z: 'zoom', c: 'crop',
  }
  const t = tools[e.key.toLowerCase()]
  if (t) { e.preventDefault(); setTool(t) }
})

// ---------------------------------------------------------------- 終了

// 閉じる前に、まだ送っていない書き込みを履歴へ流し込む。
// 履歴に必ず残るので「保存しますか？」は聞かない。
function requestClose() {
  try {
    commitText()
    flushLibrary()
  } catch (err) {
    console.error(err)   // 何かあっても閉じられなくなるほうが困るので、そのまま閉じる
  }
  window.api.send('app:closeWindow')
}

window.addEventListener('resize', () => {
  if (editingShape) positionTextEditor()
  layout()
  draw()
})

// ---------------------------------------------------------------- 起動

window.api.on('editor:title', (t) => {
  document.getElementById('titleText').textContent = String(t || '')
})

window.api.on('editor:init', (d) => {
  state.color = d.color || state.color
  state.markerColor = d.markerColor || state.markerColor
  state.lineWidth = nearest(WIDTHS, d.lineWidth || state.lineWidth)
  state.markerWidth = nearest(MARKER_WIDTHS, d.markerWidth || state.markerWidth)
  state.fontSize = nearest(FONT_SIZES, d.fontSize || state.fontSize)
  state.deco = DECOS.includes(d.deco) ? d.deco : state.deco
  state.halo = nearest(HALOS.map((h) => h.v), Number(d.halo) || state.halo)
  state.finish = FINISHES.includes(d.finish) ? d.finish : 'none'
  setPresets(d.stylePresets)
  rzLast = d.resizeLast || null
  state.libraryId = d.libraryId || null
  state.savedPath = d.savedPath || null
  state.focus = !!d.focus
  state.dataUrl = d.dataUrl || ''
  document.body.classList.toggle('focus', state.focus)
  // 範囲選択で撮った絵だけ撮り直せる（全画面・スクロール撮影・取り込んだ絵は範囲を覚えていない）
  document.getElementById('btnRetake').hidden = !d.canRetake

  // 集中モードの出入りで窓を作り直したときは、履歴より新しい「画面側の今の状態」で上書きする
  const carry = d.carry || null
  if (carry) {
    if (carry.color) state.color = carry.color
    if (carry.markerColor) state.markerColor = carry.markerColor
    if (carry.lineWidth) state.lineWidth = nearest(WIDTHS, carry.lineWidth)
    if (carry.markerWidth) state.markerWidth = nearest(MARKER_WIDTHS, carry.markerWidth)
    if (carry.fontSize) state.fontSize = nearest(FONT_SIZES, carry.fontSize)
    if (DECOS.includes(carry.deco)) state.deco = carry.deco
    if (Number(carry.halo) > 0) state.halo = nearest(HALOS.map((h) => h.v), Number(carry.halo))
    if (FINISHES.includes(carry.finish)) state.finish = carry.finish
    if (carry.savedPath) state.savedPath = carry.savedPath
    state.copied = !!carry.copied
  }
  document.getElementById('colorPick').value = state.color

  const img = new Image()
  img.onload = () => {
    state.orig = img
    origPixels = null
    scaledCache.clear()
    // 大きさを変えてある絵は、図形も切り抜きもその大きさの座標なので、先に絵を同じ大きさにしておく。
    // 集中モードの出入りでは、履歴より新しい carry のほうを使う
    const want = carry && typeof carry.scale === 'number' ? carry.scale : Number(d.scale)
    try { useScale(validScale(want) ? want : 1) } catch (err) { console.error('大きさを変えられませんでした:', err); useScale(1) }
    state.crop = { x: 0, y: 0, w: state.imgW, h: state.imgH }

    // 履歴から開き直したときは、前に描いた図形をそのまま復活させる（焼き込んでいないので動かせる）。
    // 集中モードの出入りでは、履歴より新しい carry のほうを使う（図形を全部消した直後も合わせるため）
    const from = (carry && Array.isArray(carry.shapes)) ? carry : d
    if (Array.isArray(from.shapes) && from.shapes.length) {
      state.shapes = from.shapes
      for (const s of state.shapes) if (s.id >= nextId) nextId = s.id + 1
    }
    if (from.crop && from.crop.w > 0 && from.crop.h > 0) state.crop = from.crop

    // 履歴パネルの Ctrl+C 用の見えない窓。Ctrl+C と同じ exportPNG() で書き出して返すだけ（窓は本体が捨てる）
    // 画角の左上（元の絵の座標）も返す。浮かせるとき、撮った位置にぴったり重ねるのに使う
    if (d.exportOnly) {
      document.fonts.ready.then(() => {
        const v = view()
        window.api.send('editor:exported', { dataUrl: exportPNG(), x: v.x / state.scale, y: v.y / state.scale })
      })
      return
    }

    setTool((carry && carry.tool) || 'rect')
    reserveOptsWidth()
    layout()
    draw()
    if (d.addShapes) addShapesFromMain(d.addShapes)
    if (carry && carry.privNotice) showPrivNotice(carry.privNotice)
    if (d.autoBlur || (carry && carry.findPrivate)) findPrivate(false)
    // プルダウンの幅は字の形が読み込まれてから決まるので、そろったら測り直す
    document.fonts.ready.then(() => { reserveOptsWidth(); layout(); draw() })
  }
  img.src = d.dataUrl
})

// 道具を出すかどうかは本体側がカーソルの実位置で決めて送ってくる。
// 画面側の mouseleave は、窓の枠ぎわや「つかんで動かす」領域の上を通ると取りこぼす
window.api.on('editor:ui', (on) => {
  document.body.classList.toggle('ui', !!on)
})

window.api.on('editor:requestClose', requestClose)

// 本体が見つけた「違い」の四角を足す（履歴の「違いに赤枠を付ける」）。
// 1回の変更として積むので Ctrl+Z でまとめて消せ、commitChange が履歴とサムネイルにも書き戻す。
// 切り抜きの外に出るぶんは内側に詰める（外に出た図形は画角を広げて「切り抜けない」に戻るため）。
// 線は太さの半分だけ座標の外へ出る（shapeBounds）ので、そのぶん内へ寄せて線の外側を端に合わせる
function addShapesFromMain(d) {
  if (!d || !Array.isArray(d.shapes) || !state.img) return
  commitText()
  const c = state.crop
  const before = beginChange()
  let added = 0
  // 本体が見つける違いは撮ったときの絵の座標。大きさを変えてあれば今の座標に直す（線の太さはそのまま）
  const k = state.scale
  for (const s0 of d.shapes) {
    const s = Object.assign({}, s0, { x1: s0.x1 * k, y1: s0.y1 * k, x2: s0.x2 * k, y2: s0.y2 * k })
    const half = (s.width || 0) / 2
    const x1 = Math.max(Math.min(s.x1, s.x2), c.x + half)
    const y1 = Math.max(Math.min(s.y1, s.y2), c.y + half)
    const x2 = Math.min(Math.max(s.x1, s.x2), c.x + c.w - half)
    const y2 = Math.min(Math.max(s.y1, s.y2), c.y + c.h - half)
    if (x2 - x1 < 4 || y2 - y1 < 4) continue
    state.shapes.push(Object.assign({}, s, { id: nextId++, x1, y1, x2, y2 }))
    added++
  }
  state.selectedId = null
  commitChange(before)
  updateUi()
  draw()
  toast(added ? added + ' か所に枠を付けました（ふつうの四角なので、消す・動かす・色を変えるができます）'
    : '違いは切り抜いた範囲の外だけでした')
}

window.api.on('editor:addShapes', addShapesFromMain)

// ---------------------------------------------------------------- 個人情報の自動ぼかし

const privNoticeEl = document.getElementById('privNotice')
const privNoticeMsg = document.getElementById('privNoticeMsg')
const btnAutoBlur = document.getElementById('btnAutoBlur')
// 自動で置くぼかしの太さ。既定の太さ4（約10pxのモザイク）だと小さい字は形が残るので、粗い段階を使う
const AUTO_BLUR_WIDTH = 12
let privScanning = false

function showPrivNotice(msg) {
  privNoticeMsg.textContent = msg
  privNoticeEl.hidden = false
}
document.getElementById('privNoticeClose').addEventListener('click', () => { privNoticeEl.hidden = true })

// 描いている・文字を打っている最中に図形を足すと、その操作の「元に戻す」やドラッグの途中の状態と混ざるので、終わるまで待つ
function whenIdle(fn) {
  if (drag || pending || pendingCrop || editingShape) { setTimeout(() => whenIdle(fn), 250); return }
  fn()
}

// 文字を読むのは本体（Windows の文字読み取り）。読んでいる間も編集は続けられる。
// manual はボタンから押したとき。自動のときは、失敗しても見つからなくても何も出さない。
// 読んでいる間のボタンの文字は「自動ぼかし」より短くする（長くすると下の帯が1行に収まらず、右端の倍率が窓の外に出る）
async function findPrivate(manual) {
  if (privScanning || !state.img) return
  if (!state.libraryId) { if (manual) toast('この絵は読み取れません'); return }
  privScanning = true
  btnAutoBlur.disabled = true
  btnAutoBlur.textContent = '確認中…'
  let r = null
  try { r = await window.api.invoke('editor:findPrivate') } catch (_) { r = null }
  privScanning = false
  btnAutoBlur.disabled = false
  btnAutoBlur.textContent = '自動ぼかし'
  if (!r || !Array.isArray(r.boxes)) { if (manual) toast('文字を読み取れませんでした'); return }
  whenIdle(() => placePrivateBlurs(r.boxes, manual))
}

// 見つかった四角にぼかしを置く。ふつうのぼかし（blur）なので、動かす・消す・Ctrl+Z 1回でまとめて戻すができる。
// 読んでいる間に切り抜いたときは、今の切り抜き範囲の中だけに置く（外に出すと画角が広がって切り抜けなくなるため）。
// すでにぼかしてある所には重ねない（手で置いたぼかしや、前に自動で置いたものを増やさないため）
function placePrivateBlurs(boxes, manual) {
  if (!state.img) return
  const c = state.crop
  const blurs = state.shapes.filter((sh) => sh.type === 'blur').map(norm)
  const before = beginChange()
  let added = 0
  // 読み取りは保存先の元の絵で行うので、四角は撮ったときの座標。大きさを変えてあれば今の座標に直す
  const k = state.scale
  for (const b0 of boxes) {
    const b = { x: b0.x * k, y: b0.y * k, w: b0.w * k, h: b0.h * k }
    const x1 = Math.max(b.x, c.x), y1 = Math.max(b.y, c.y)
    const x2 = Math.min(b.x + b.w, c.x + c.w), y2 = Math.min(b.y + b.h, c.y + c.h)
    if (x2 - x1 < 4 || y2 - y1 < 4) continue
    const area = (x2 - x1) * (y2 - y1)
    let covered = 0
    for (const r of blurs) {
      const ow = Math.min(x2, r.x + r.w) - Math.max(x1, r.x)
      const oh = Math.min(y2, r.y + r.h) - Math.max(y1, r.y)
      if (ow > 0 && oh > 0) covered += ow * oh
    }
    if (covered >= area * 0.8) continue
    const s = {
      id: nextId++, type: 'blur', color: state.color, width: AUTO_BLUR_WIDTH, fontSize: state.fontSize,
      x1, y1, x2, y2,
    }
    state.shapes.push(s)
    blurs.push(norm(s))
    added++
  }
  if (!added) {
    if (manual) toast('新しく見つかったものはありませんでした（見落としはあるので、自分の目でも確認してください）')
    return
  }
  commitChange(before)
  updateUi()
  draw()
  // 読み終わる前にコピーしていたら、クリップボードの絵にはぼかしが入っていない
  showPrivNotice('個人情報・APIキーらしきものを' + added + 'か所見つけてぼかしました。見落としが必ずあるので、必ず自分の目でも確認してください。'
    + (state.copied ? '（ぼかす前にコピーした絵にはぼかしが入っていません。もう一度コピーしてください）' : ''))
}

btnAutoBlur.addEventListener('click', () => findPrivate(true))
