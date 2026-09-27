'use strict'

// Windows から来るウィンドウの位置（物理ピクセル・画面ぜんぶ通しの座標）を、
// 1つの画面のオーバーレイの CSS ピクセルに直す。
// Electron を使わないのでそのままテストできる。

// Windows のモニタ（物理ピクセル）と Electron の画面（DIP）を突き合わせる。
// 左上から順に並べて大きさが一致することを確かめ、1つでも合わなければ null を返す
// （対応を取り違えると、まったく違う場所に枠が出てしまうため、諦めたほうが安全）。
function mapMonitors(displays, monitors) {
  if (!Array.isArray(displays) || !Array.isArray(monitors)) return null
  if (!displays.length || monitors.length !== displays.length) return null

  const ds = displays.slice().sort((a, b) => a.bounds.x - b.bounds.x || a.bounds.y - b.bounds.y)
  const ms = monitors.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const map = new Map()
  for (let i = 0; i < ds.length; i++) {
    const d = ds[i]
    const m = ms[i]
    if (m[2] !== Math.round(d.bounds.width * (d.scaleFactor || 1))) return null
    if (m[3] !== Math.round(d.bounds.height * (d.scaleFactor || 1))) return null
    map.set(d.id, m)
  }
  return map
}

function round1(v) { return Math.round(v * 10) / 10 }

// bounds は DIP（＝オーバーレイの CSS ピクセル）、imageSize は撮った絵の実ピクセル。
// その比で割ると CSS ピクセルになる。画面の外にはみ出した分は切り落とす。
function convertRects(bounds, imageSize, monitor, windows) {
  const W = bounds.width
  const H = bounds.height
  const kx = imageSize.width / W
  const ky = imageSize.height / H
  if (!(kx > 0) || !(ky > 0)) return []

  const conv = (r) => {
    if (!Array.isArray(r) || r.length < 4) return null
    const x1 = Math.max(0, (r[0] - monitor[0]) / kx)
    const y1 = Math.max(0, (r[1] - monitor[1]) / ky)
    const x2 = Math.min(W, (r[0] - monitor[0] + r[2]) / kx)
    const y2 = Math.min(H, (r[1] - monitor[1] + r[3]) / ky)
    if (x2 - x1 < 8 || y2 - y1 < 8) return null
    return [round1(x1), round1(y1), round1(x2 - x1), round1(y2 - y1)]
  }

  const out = []
  for (const wd of (windows || [])) {
    const r = conv(wd && wd.r)
    if (!r) continue
    const c = []
    for (const cr of ((wd && wd.c) || [])) {
      const v = conv(cr)
      if (v) c.push(v)
    }
    out.push({ r, c })
  }
  return out
}

module.exports = { mapMonitors, convertRects }
