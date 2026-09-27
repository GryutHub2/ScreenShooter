'use strict'

// 同じ大きさの2枚を比べて、変わった所を囲む四角の一覧を返す（履歴の「違いに赤枠を付ける」）。
// 扱うのは BGRA の生データ（Electron の nativeImage.toBitmap() がこの形）。
// Electron に依存しないのでそのままテストできる。

const DEFAULTS = {
  threshold: 40,     // 1画素の色の差（R/G/B のいちばん大きい差）がこれ以下なら同じとみなす。文字のにじみ・圧縮ノイズ用
  cell: 8,           // 数えるマスの1辺(px)。変わった画素はマスごとに数えてからまとめる（速さのため）
  gap: 2,            // これだけのマス数（×cell px）以内に近い変化は1つの枠にまとめる
  minPixels: 8,      // 変わった画素がこれより少ない塊は捨てる
  caretW: 4,         // 幅がこれ以下で、
  caretH: 128,       // 高さがこれ以下の縦の細い塊は捨てる（点滅カーソル。大きな文字・高い拡大率だと縦に長い）
  thin: 3,           // 高さがこれ以下で、
  thinLong: 48,      // 幅がこれ以下の横の細い塊は捨てる（下線のカーソル）
  pad: 4,            // 枠を変化より少し外に出す（枠線が変わった所に被らないように）
  maxBoxes: 30,      // これより多いときは、マスを粗くしてまとめ、数を減らす
}

// マスごとに「変わった画素の数」と「変わった画素だけを囲む範囲」を数える。
// 同じ画素は 4 バイトまとめて比べて飛ばす（ほとんどが同じなので、縦長の絵でもこれで速い）
function scanCells(a, b, width, height, o) {
  const C = o.cell
  const gw = Math.ceil(width / C)
  const gh = Math.ceil(height / C)
  const n = gw * gh
  const count = new Int32Array(n)
  const minX = new Int32Array(n).fill(width)
  const minY = new Int32Array(n).fill(height)
  const maxX = new Int32Array(n).fill(-1)
  const maxY = new Int32Array(n).fill(-1)
  const aligned = a.byteOffset % 4 === 0 && b.byteOffset % 4 === 0
  const a32 = aligned ? new Uint32Array(a.buffer, a.byteOffset, width * height) : null
  const b32 = aligned ? new Uint32Array(b.buffer, b.byteOffset, width * height) : null
  const T = o.threshold
  let total = 0
  for (let y = 0; y < height; y++) {
    const row = y * width
    const gy = (y / C) | 0
    for (let x = 0; x < width; x++) {
      const i = row + x
      if (aligned && a32[i] === b32[i]) continue
      const p = i * 4
      const d0 = Math.abs(a[p] - b[p])
      const d1 = Math.abs(a[p + 1] - b[p + 1])
      const d2 = Math.abs(a[p + 2] - b[p + 2])
      if (d0 <= T && d1 <= T && d2 <= T) continue
      const c = gy * gw + ((x / C) | 0)
      count[c]++
      if (x < minX[c]) minX[c] = x
      if (x > maxX[c]) maxX[c] = x
      if (y < minY[c]) minY[c] = y
      if (y > maxY[c]) maxY[c] = y
      total++
    }
  }
  return { gw, gh, count, minX, minY, maxX, maxY, total }
}

// 近いマス同士（gap マス以内）を1つの塊にまとめ、塊ごとに画素数と範囲を出す
function groupCells(g, gap) {
  const { gw, gh, count } = g
  const cells = []
  for (let i = 0; i < count.length; i++) if (count[i]) cells.push(i)
  const parent = new Map()
  for (const c of cells) parent.set(c, c)
  const find = (c) => {
    let r = c
    while (parent.get(r) !== r) r = parent.get(r)
    while (parent.get(c) !== r) { const nx = parent.get(c); parent.set(c, r); c = nx }
    return r
  }
  for (const c of cells) {
    const cx = c % gw
    const cy = (c / gw) | 0
    // 後ろ側（同じ行の右と、下の行）だけ見れば、全部の組を1回ずつ見たことになる
    for (let dy = 0; dy <= gap; dy++) {
      const ny = cy + dy
      if (ny >= gh) break
      for (let dx = -gap; dx <= gap; dx++) {
        if (dy === 0 && dx <= 0) continue
        const nx = cx + dx
        if (nx < 0 || nx >= gw) continue
        const nc = ny * gw + nx
        if (!count[nc]) continue
        const r1 = find(c)
        const r2 = find(nc)
        if (r1 !== r2) parent.set(r1, r2)
      }
    }
  }
  const blobs = new Map()
  for (const c of cells) {
    const r = find(c)
    let b = blobs.get(r)
    if (!b) { b = { n: 0, x1: Infinity, y1: Infinity, x2: -1, y2: -1 }; blobs.set(r, b) }
    b.n += count[c]
    if (g.minX[c] < b.x1) b.x1 = g.minX[c]
    if (g.minY[c] < b.y1) b.y1 = g.minY[c]
    if (g.maxX[c] > b.x2) b.x2 = g.maxX[c]
    if (g.maxY[c] > b.y2) b.y2 = g.maxY[c]
  }
  return [...blobs.values()]
}

// マスを縦横2つずつまとめた粗い格子を作る。まとめる距離を広げる代わりにこちらで広げる
// （距離を広げると、1マスごとに見る近所の数が距離の2乗で増えて、縦長の絵で遅くなるため）
function coarsen(g) {
  const gw = Math.ceil(g.gw / 2)
  const gh = Math.ceil(g.gh / 2)
  const n = gw * gh
  const out = {
    gw, gh, total: g.total,
    count: new Int32Array(n),
    minX: new Int32Array(n).fill(0x7fffffff),
    minY: new Int32Array(n).fill(0x7fffffff),
    maxX: new Int32Array(n).fill(-1),
    maxY: new Int32Array(n).fill(-1),
  }
  for (let y = 0; y < g.gh; y++) {
    for (let x = 0; x < g.gw; x++) {
      const c = y * g.gw + x
      if (!g.count[c]) continue
      const d = (y >> 1) * gw + (x >> 1)
      out.count[d] += g.count[c]
      if (g.minX[c] < out.minX[d]) out.minX[d] = g.minX[c]
      if (g.minY[c] < out.minY[d]) out.minY[d] = g.minY[c]
      if (g.maxX[c] > out.maxX[d]) out.maxX[d] = g.maxX[c]
      if (g.maxY[c] > out.maxY[d]) out.maxY[d] = g.maxY[c]
    }
  }
  return out
}

// 小さすぎる塊（色の揺れの取りこぼし）と、細長い小さな塊（点滅カーソル）は変化として数えない。
// 縦のカーソルは文字の高さ×画面の拡大率ぶん伸びる（32px の文字・150% で 64px）ので、縦だけ長さの上限を大きく取る
function isNoise(b, o) {
  if (b.n < o.minPixels) return true
  const w = b.x2 - b.x1 + 1
  const h = b.y2 - b.y1 + 1
  if (w <= o.caretW && h <= o.caretH) return true
  if (h <= o.thin && w <= o.thinLong) return true
  return false
}

// 余白を足した枠が重なる・接するものは1つにする（枠どうしが重なって見づらくならないように）
function mergeBoxes(boxes) {
  const out = boxes.map((b) => ({ ...b }))
  let changed = true
  while (changed) {
    changed = false
    for (let i = 0; i < out.length; i++) {
      for (let j = i + 1; j < out.length; j++) {
        const p = out[i]
        const q = out[j]
        if (p.x > q.x + q.w || q.x > p.x + p.w || p.y > q.y + q.h || q.y > p.y + p.h) continue
        const x = Math.min(p.x, q.x)
        const y = Math.min(p.y, q.y)
        p.w = Math.max(p.x + p.w, q.x + q.w) - x
        p.h = Math.max(p.y + p.h, q.y + q.h) - y
        p.x = x
        p.y = y
        out.splice(j, 1)
        j--
        changed = true
      }
    }
  }
  return out
}

function toBoxes(blobs, width, height, pad) {
  return blobs.map((b) => {
    const x1 = Math.max(0, b.x1 - pad)
    const y1 = Math.max(0, b.y1 - pad)
    const x2 = Math.min(width, b.x2 + 1 + pad)
    const y2 = Math.min(height, b.y2 + 1 + pad)
    return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 }
  })
}

// a が古いほう、b が新しいほう（どちらも width × height の BGRA）。
// 返すのは画像座標の四角 { x, y, w, h } の一覧（上から順）と、変わった画素の数。
// 枠が maxBoxes を超えるときは、マスを倍々に粗くして大きくまとめる（散らばった枠は読めないため）
function findDiffBoxes(a, b, width, height, opts) {
  const o = Object.assign({}, DEFAULTS, opts || {})
  if (!a || !b || width <= 0 || height <= 0) return { boxes: [], changed: 0 }
  if (a.length < width * height * 4 || b.length < width * height * 4) throw new Error('画素の数が大きさと合いません')
  const g = scanCells(a, b, width, height, o)
  if (!g.total) return { boxes: [], changed: 0 }

  let grid = g
  let boxes = []
  for (;;) {
    const blobs = groupCells(grid, o.gap).filter((bl) => !isNoise(bl, o))
    // 塊が多すぎるときは重ね合わせを試すまでもないので、先にマスを粗くする（重なりの判定は数の2乗かかるため）
    if (blobs.length <= o.maxBoxes * 20 || (grid.gw === 1 && grid.gh === 1)) {
      boxes = mergeBoxes(toBoxes(blobs, width, height, o.pad))
      if (boxes.length <= o.maxBoxes || (grid.gw === 1 && grid.gh === 1)) break
    }
    grid = coarsen(grid)
  }
  boxes.sort((p, q) => p.y - q.y || p.x - q.x)
  return { boxes, changed: g.total }
}

module.exports = { findDiffBoxes, DEFAULTS }
