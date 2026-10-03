'use strict'

const shotEl = document.getElementById('shot')
const dimEl = document.getElementById('dim')
const selEl = document.getElementById('sel')
const snapEl = document.getElementById('snap')
const selSizeEl = document.getElementById('selSize')
const guideV = document.getElementById('guideV')
const guideH = document.getElementById('guideH')
const hintEl = document.getElementById('hint')
const hintSnap = document.getElementById('hintSnap')
const hintScroll = document.getElementById('hintScroll')
const hintRecord = document.getElementById('hintRecord')
const loupeEl = document.getElementById('loupe')
const loupeCv = document.getElementById('loupeCv')
const loupeInfo = document.getElementById('loupeInfo')
const lctx = loupeCv.getContext('2d')

const LOUPE_SRC = 17   // 拡大鏡が取り込む元ピクセル数（奇数にして中心を1ピクセルに合わせる）
const LOUPE_SIZE = 132

const img = new Image()
let displayId = null
let scaleX = 1     // CSSピクセル → 画像の実ピクセル
let scaleY = 1
let dragging = false
let done = false
let startX = 0
let startY = 0
let lastX = 0
let lastY = 0
let curX = -1      // いまのカーソル位置（吸い付き枠の計算に使う）。矢印キーで動かすと実際のカーソルとずれる
let curY = -1
let rawX = null    // 最後に届いた本物のカーソル位置。ここから動いたら、矢印キーで動かした分は捨てる
let rawY = null

// ウィンドウ吸い付き
let winRects = null    // [{ r:[x,y,w,h], c:[[x,y,w,h], ...] }, ...] 手前の窓が先
let snapList = null    // カーソル下の候補。小さい順、最後が窓そのもの
let snapKey = ''
let snapIndex = 0

window.api.on('overlay:init', (d) => {
  displayId = d.displayId
  if (d.mode === 'scroll') {
    hintEl.hidden = true
    hintScroll.hidden = false
  } else if (d.mode === 'record') {
    hintEl.hidden = true
    hintRecord.hidden = false
  }
  img.onload = () => {
    shotEl.src = d.dataUrl
    scaleX = img.naturalWidth / window.innerWidth
    scaleY = img.naturalHeight / window.innerHeight
    window.api.send('overlay:ready', { displayId, focus: !!d.isCursorHere })
  }
  img.src = d.dataUrl
})

// ウィンドウの位置一覧は撮影と並行して集めるので、あとから届く
window.api.on('overlay:rects', (d) => {
  winRects = (d && Array.isArray(d.windows) && d.windows.length) ? d.windows : null
  hintSnap.hidden = !winRects
  if (!dragging && !done) { computeSnap(curX, curY); renderSnap() }
})

function clampX(v) { return Math.max(0, Math.min(window.innerWidth, v)) }
function clampY(v) { return Math.max(0, Math.min(window.innerHeight, v)) }

function currentRect() {
  const x = Math.min(startX, lastX)
  const y = Math.min(startY, lastY)
  return { x, y, w: Math.abs(lastX - startX), h: Math.abs(lastY - startY) }
}

// 保存される実サイズ（画面の拡大率ぶんCSSピクセルとは違う）を出す
function showSizeLabel(x, y, w, h, below) {
  selSizeEl.hidden = false
  selSizeEl.textContent = Math.round(w * scaleX) + ' × ' + Math.round(h * scaleY) + ' px'
  let ly = y - 26
  if (ly < 4 || below) ly = y + h + 6
  if (ly + 24 > window.innerHeight) ly = Math.max(4, y - 26)
  selSizeEl.style.left = Math.max(2, Math.min(x, window.innerWidth - 120)) + 'px'
  selSizeEl.style.top = ly + 'px'
}

function updateSelection() {
  const r = currentRect()
  selEl.hidden = false
  selEl.style.left = r.x + 'px'
  selEl.style.top = r.y + 'px'
  selEl.style.width = r.w + 'px'
  selEl.style.height = r.h + 'px'
  showSizeLabel(r.x, r.y, r.w, r.h, false)
}

function updateGuides(x, y) {
  guideV.style.left = x + 'px'
  guideH.style.top = y + 'px'
}

// ---------------------------------------------------------------- ウィンドウ吸い付き

function rectHas(r, x, y) {
  return x >= r[0] && x <= r[0] + r[2] && y >= r[1] && y <= r[1] + r[3]
}

// いちばん手前にある窓を1つだけ選び、その窓と、カーソルの下にある部品を候補にする。
// 奥に隠れている窓を拾わないよう、手前から探して最初に当たったところで止める。
function computeSnap(x, y) {
  if (!winRects || x < 0 || y < 0) { snapList = null; snapKey = ''; return }
  let found = null
  for (const w of winRects) {
    if (rectHas(w.r, x, y)) { found = w; break }
  }
  if (!found) { snapList = null; snapKey = ''; return }

  const list = []
  for (const c of found.c) if (rectHas(c, x, y)) list.push(c)
  list.sort((a, b) => a[2] * a[3] - b[2] * b[3])
  list.push(found.r)

  const key = list.map((r) => r.join(',')).join('|')
  if (key !== snapKey) { snapKey = key; snapIndex = 0 }
  snapList = list
}

function snapRect() {
  if (!snapList || !snapList.length) return null
  return snapList[Math.min(snapIndex, snapList.length - 1)]
}

function renderSnap() {
  const r = snapRect()
  if (!r || dragging || done) {
    snapEl.hidden = true
    if (!dragging && !done) {
      dimEl.hidden = false
      guideV.hidden = false
      guideH.hidden = false
      selSizeEl.hidden = true
    }
    return
  }
  snapEl.hidden = false
  snapEl.style.left = r[0] + 'px'
  snapEl.style.top = r[1] + 'px'
  snapEl.style.width = r[2] + 'px'
  snapEl.style.height = r[3] + 'px'
  // 吸い付き枠が暗幕の役をするので、全面の暗幕と十字ガイドは引っ込める
  dimEl.hidden = true
  guideV.hidden = true
  guideH.hidden = true
  showSizeLabel(r[0], r[1], r[2], r[3], false)
}

// ---------------------------------------------------------------- 拡大鏡

function updateLoupe(x, y) {
  const zoom = LOUPE_SIZE / LOUPE_SRC
  const half = (LOUPE_SRC - 1) / 2
  lctx.imageSmoothingEnabled = false
  lctx.fillStyle = '#0b0b0b'
  lctx.fillRect(0, 0, LOUPE_SIZE, LOUPE_SIZE)
  if (img.complete && img.naturalWidth) {
    lctx.drawImage(img, x * scaleX - half, y * scaleY - half, LOUPE_SRC, LOUPE_SRC, 0, 0, LOUPE_SIZE, LOUPE_SIZE)
  }
  const c = Math.floor(LOUPE_SRC / 2) * zoom
  lctx.strokeStyle = 'rgba(255, 70, 70, 0.95)'
  lctx.lineWidth = 2
  lctx.strokeRect(c + 1, c + 1, zoom - 2, zoom - 2)

  if (dragging) {
    const r = currentRect()
    loupeInfo.textContent = Math.round(r.w * scaleX) + ' × ' + Math.round(r.h * scaleY)
  } else {
    loupeInfo.textContent = Math.round(x * scaleX) + ', ' + Math.round(y * scaleY)
  }

  const OFF = 22
  let lx = x + OFF
  let ly = y + OFF
  if (lx + LOUPE_SIZE + 8 > window.innerWidth) lx = x - OFF - LOUPE_SIZE
  if (ly + LOUPE_SIZE + 26 > window.innerHeight) ly = y - OFF - LOUPE_SIZE - 22
  loupeEl.style.left = Math.max(4, lx) + 'px'
  loupeEl.style.top = Math.max(4, ly) + 'px'
}

// ---------------------------------------------------------------- 結果を返す

function finish(rect) {
  if (done) return
  done = true
  window.api.send('overlay:select', { displayId, rect })
}

function cancel() {
  if (done) return
  done = true
  window.api.send('overlay:cancel')
}

// 本物のカーソルが動いていなければ、矢印キーで動かした位置を使う
function pointFrom(e) {
  const x = clampX(e.clientX)
  const y = clampY(e.clientY)
  const moved = rawX === null || Math.abs(x - rawX) > 0.01 || Math.abs(y - rawY) > 0.01
  rawX = x
  rawY = y
  return moved || curX < 0 ? { x, y, real: true } : { x: curX, y: curY, real: false }
}

window.addEventListener('pointerdown', (e) => {
  if (done) return
  if (e.button !== 0) { cancel(); return }
  const p = pointFrom(e)
  dragging = true
  startX = lastX = p.x
  startY = lastY = p.y
  snapEl.hidden = true
  dimEl.hidden = true
  guideV.hidden = true
  guideH.hidden = true
  hintEl.hidden = true
  hintScroll.hidden = true
  hintRecord.hidden = true
  updateSelection()
  try { document.documentElement.setPointerCapture(e.pointerId) } catch (_) {}
})

window.addEventListener('pointermove', (e) => {
  if (done) return
  const p = pointFrom(e)
  if (!p.real) return
  const x = p.x
  const y = p.y
  curX = x
  curY = y
  if (dragging) {
    lastX = x
    lastY = y
    updateSelection()
  } else {
    updateGuides(x, y)
    computeSnap(x, y)
    renderSnap()
  }
  updateLoupe(x, y)
})

window.addEventListener('pointerup', (e) => {
  if (done || !dragging) return
  dragging = false
  // 押したまま矢印キーで動かしていたら、その位置で離したことにする
  const p = pointFrom(e)
  lastX = p.x
  lastY = p.y
  const r = currentRect()
  // ほとんど動かさずに離した＝クリック。吸い付き枠があればそれを撮る
  if (r.w < 5 || r.h < 5) {
    const s = snapRect()
    if (s) { finish({ x: s[0], y: s[1], w: s[2], h: s[3] }); return }
    cancel()
    return
  }
  finish(r)
})

// ホイールで、部品 → もっと大きい部品 → 窓ぜんたい と広げる
window.addEventListener('wheel', (e) => {
  if (done || dragging || !snapList) return
  e.preventDefault()
  const next = snapIndex + (e.deltaY > 0 ? 1 : -1)
  snapIndex = Math.max(0, Math.min(snapList.length - 1, next))
  renderSnap()
}, { passive: false })

window.addEventListener('contextmenu', (e) => { e.preventDefault(); cancel() })

window.addEventListener('keydown', (e) => {
  if (done) return
  if (e.key === 'Escape') { e.preventDefault(); cancel(); return }
  if (e.key.startsWith('Arrow')) { e.preventDefault(); nudge(e); return }
  if (e.code === 'Space') {
    e.preventDefault()
    finish({ x: 0, y: 0, w: window.innerWidth, h: window.innerHeight })
  }
})

// 矢印キーで、保存される絵の1ピクセル（Shift で10ピクセル）ずつ動かす。
// 押す前は始点（＝十字の位置）、ドラッグ中は終点を動かす。マウスを動かすと本物のカーソルの位置に戻る
function nudge(e) {
  if (curX < 0 && !dragging) return
  const n = e.shiftKey ? 10 : 1
  const dx = (e.key === 'ArrowLeft' ? -n : e.key === 'ArrowRight' ? n : 0) / scaleX
  const dy = (e.key === 'ArrowUp' ? -n : e.key === 'ArrowDown' ? n : 0) / scaleY
  if (dragging) {
    lastX = clampX(lastX + dx)
    lastY = clampY(lastY + dy)
    curX = lastX
    curY = lastY
    updateSelection()
    updateLoupe(lastX, lastY)
    return
  }
  curX = clampX(curX + dx)
  curY = clampY(curY + dy)
  updateGuides(curX, curY)
  computeSnap(curX, curY)
  renderSnap()
  updateLoupe(curX, curY)
}

// カーソルがこの画面に無い状態で開いたときも拡大鏡を出しておく
window.addEventListener('DOMContentLoaded', () => {
  updateGuides(-10, -10)
})
