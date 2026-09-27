'use strict'

// 画面に浮かせた絵。移動・大きさ・濃さは本体が窓ごと変えるので、ここは操作を本体へ伝えるだけ。
// 移動に -webkit-app-region: drag を使わないのは、その上では右クリックとホイールが届かなくなるため

const img = document.getElementById('img')
const badge = document.getElementById('badge')
let badgeTimer = null
let dragging = false
let shown = false

const HINT = 'ドラッグで移動・ホイールか縁のドラッグで大きさ・Ctrl+ホイールで濃さ・ダブルクリックで閉じる'
const EDGE = 10          // 縁からこの幅（CSS px）の中を押すと大きさを変える
const HINT_MS = 2600
const HINT_MIN_W = 240   // これより狭い絵では案内が収まらないので出さない

function showBadge(text, ms) {
  badge.textContent = text
  badge.hidden = false
  clearTimeout(badgeTimer)
  badgeTimer = setTimeout(() => { badge.hidden = true }, ms || 900)
}

// 読み込み直したとき（loadGuarded のやり直し）にも届く。絵が出てから本体に見せてもらう
window.api.on('pin:init', (d) => {
  img.onload = () => {
    window.api.send('pin:ready')
    if (!shown && window.innerWidth >= HINT_MIN_W) showBadge(HINT, HINT_MS)
    shown = true
  }
  img.src = d.dataUrl
})

window.api.on('pin:status', (text) => showBadge(String(text || '')))

// 押した所が縁ならその向き（'n' 'se' など）。小さな絵では真ん中を掴めるよう、縁の幅を 1/4 までに抑える
function edgeAt(x, y) {
  const w = window.innerWidth
  const h = window.innerHeight
  const ex = Math.min(EDGE, w / 4)
  const ey = Math.min(EDGE, h / 4)
  const v = y < ey ? 'n' : y > h - ey ? 's' : ''
  const hz = x < ex ? 'w' : x > w - ex ? 'e' : ''
  return v + hz
}

// 縁の上ではカーソルを大きさ変更の形にする（CSS 側で body[data-edge] ごとに決める）
document.addEventListener('pointermove', (e) => {
  if (dragging) return
  const edge = edgeAt(e.clientX, e.clientY)
  if (document.body.dataset.edge !== edge) document.body.dataset.edge = edge
})

// 押しているあいだ、本体がカーソルの実位置を読んで窓を動かす（pointermove ごとに送るより滑らか）。
// 縁を押したときは、同じやり方で大きさを変える（縦横の比はそのまま）
document.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return
  try { document.documentElement.setPointerCapture(e.pointerId) } catch (_) {}
  dragging = true
  const edge = edgeAt(e.clientX, e.clientY)
  if (edge) window.api.send('pin:resizeStart', edge)
  else window.api.send('pin:dragStart')
})

function endDrag() {
  if (!dragging) return
  dragging = false
  window.api.send('pin:dragEnd')
}
document.addEventListener('pointerup', endDrag)
document.addEventListener('pointercancel', endDrag)
document.addEventListener('lostpointercapture', endDrag)
window.addEventListener('blur', endDrag)

document.addEventListener('dblclick', () => window.api.send('pin:close'))

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { e.preventDefault(); window.api.send('pin:close') }
})

// passive: false にしないと Ctrl+ホイールで画面側の拡大が動いてしまう
window.addEventListener('wheel', (e) => {
  e.preventDefault()
  if (!e.deltaY) return
  window.api.send('pin:wheel', {
    dy: e.deltaY,
    ctrl: e.ctrlKey,
    fx: window.innerWidth ? e.clientX / window.innerWidth : 0.5,
    fy: window.innerHeight ? e.clientY / window.innerHeight : 0.5,
  })
}, { passive: false })

window.addEventListener('contextmenu', (e) => {
  e.preventDefault()
  endDrag()
  window.api.send('pin:menu')
})
