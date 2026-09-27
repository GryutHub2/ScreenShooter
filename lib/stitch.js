'use strict'

// スクロールしながら撮った絵を、重なりを見つけて縦につなぐ。
// 扱うのは BGRA の生データ（Electron の nativeImage.toBitmap() がこの形）。
// Electron に依存しないのでそのままテストできる。

// 1行ぶんを1つの数にまとめる。横は間引く（速さのため。ずれの検出には十分）。
// x0/x1 を渡すと、その横幅の範囲だけを見る。
// 端に動く広告やサイドバーがあると行ぜんたいが毎回変わってしまうので、
// 見つからなかったときに「真ん中だけ」で測り直すのに使う。
function rowHashes(buf, width, height, stride, x0, x1) {
  const from = Math.max(0, Math.floor(x0 || 0))
  const to = Math.min(width, Math.floor(x1 === undefined || x1 === null ? width : x1))
  const span = Math.max(1, to - from)
  const step = Math.max(1, Math.floor(span / 96)) * 4
  const out = new Int32Array(height)
  const startByte = from * 4
  const endByte = to * 4
  for (let y = 0; y < height; y++) {
    const base = y * stride
    let h = 2166136261
    for (let x = startByte; x < endByte; x += step) {
      h = Math.imul(h ^ buf[base + x], 16777619)
      h = Math.imul(h ^ buf[base + x + 1], 16777619)
      h = Math.imul(h ^ buf[base + x + 2], 16777619)
    }
    out[y] = h
  }
  return out
}

function distinctCount(rows, start, len) {
  const seen = new Set()
  for (let i = 0; i < len; i++) seen.add(rows[start + i])
  return seen.size
}

function bandAt(rows, height, frac) {
  const bandH = Math.max(12, Math.min(160, Math.floor(height * 0.2)))
  const start = Math.floor(height * frac)
  if (start < 0 || start + bandH > height) return null
  return { start, height: bandH, distinct: distinctCount(rows, start, bandH) }
}

// 下へスクロールした量を探すための帯。
// 帯が下にあるほど「見つけられるスクロール量の上限」が大きくなるので、下から順に見る。
// 上に貼り付いたヘッダーは動かないので、上端は使わない。
// 真っ白な帯だとどこでも一致してしまうので、行の種類が少なすぎるところは飛ばす。
function pickBand(rows, height) {
  let fallback = null
  for (const frac of [0.72, 0.6, 0.48, 0.34]) {
    const b = bandAt(rows, height, frac)
    if (!b) continue
    if (b.distinct >= 6) return b
    if (!fallback || b.distinct > fallback.distinct) fallback = b
  }
  return fallback
}

// 上へスクロールした量を探すための帯（上寄り）。
// マウスの向きが逆に設定されている環境を見分けるために使う。
function pickBandTop(rows, height) {
  let fallback = null
  for (const frac of [0.1, 0.2, 0.3]) {
    const b = bandAt(rows, height, frac)
    if (!b) continue
    if (b.distinct >= 6) return b
    if (!fallback || b.distinct > fallback.distinct) fallback = b
  }
  return fallback
}

// prev の帯が、next の nextStart の位置にどれだけ一致するか
function scoreOffset(prevRows, nextRows, band, nextStart) {
  if (nextStart < 0 || nextStart + band.height > nextRows.length) return -1
  let m = 0
  for (let y = 0; y < band.height; y++) {
    if (prevRows[band.start + y] === nextRows[nextStart + y]) m++
  }
  return m / band.height
}

function topCandidates(scores, n) {
  const idx = []
  for (let i = 0; i < scores.length; i++) idx.push(i)
  idx.sort((a, b) => scores[b] - scores[a])
  return idx.slice(0, n).map((i) => [i + 1, scores[i]])
}

// prev の帯が next のどこへ移ったかを探す。
//   shift = 0 … 動かなかった（いちばん下まで来た）
//   shift < 0 … 見つからなかった
// あわせて「逆向き（ページが上へ動いた）」も測って返す。
function findShift(prevRows, nextRows, height, expected) {
  const empty = {
    shift: -1, score: 0, zeroScore: 0, distinct: 0, bandStart: -1,
    upShift: -1, upScore: 0, top: [],
  }
  const band = pickBand(prevRows, height)
  if (!band) return empty

  const zeroScore = scoreOffset(prevRows, nextRows, band, band.start)

  const scores = new Array(band.start)
  let best = -1
  let bestScore = -1
  for (let s = 1; s <= band.start; s++) {
    const sc = scoreOffset(prevRows, nextRows, band, band.start - s)
    scores[s - 1] = sc
    const better = sc > bestScore + 1e-9
    const tie = Math.abs(sc - bestScore) <= 1e-9 && expected > 0
      && Math.abs(s - expected) < Math.abs(best - expected)
    if (better || tie) { bestScore = sc; best = s }
  }

  // ページが上へ動いた場合（ホイールの向きが逆など）
  let upShift = -1
  let upScore = 0
  const bandTop = pickBandTop(prevRows, height)
  if (bandTop && bandTop.distinct >= 4) {
    const maxUp = height - bandTop.start - bandTop.height
    for (let s = 1; s <= maxUp; s++) {
      const sc = scoreOffset(prevRows, nextRows, bandTop, bandTop.start + s)
      if (sc > upScore) { upScore = sc; upShift = s }
    }
  }

  const info = {
    zeroScore: Math.max(0, zeroScore),
    distinct: band.distinct,
    bandStart: band.start,
    upShift,
    upScore: Math.max(0, upScore),
    top: topCandidates(scores, 4),
  }

  // 帯の中の行がほとんど同じ（真っ白など）なら、どこでも一致してしまうので信用しない
  if (band.distinct < 4) return Object.assign({ shift: -1, score: 0 }, info)
  if (zeroScore >= 0.98 && bestScore <= zeroScore + 0.01) {
    return Object.assign({ shift: 0, score: zeroScore }, info)
  }
  if (bestScore >= 0.8) return Object.assign({ shift: best, score: bestScore }, info)
  return Object.assign({ shift: -1, score: Math.max(0, bestScore) }, info)
}

// frames: [{ buf, shift }]。1枚目の shift は使わない。
// 2枚目以降は「下から shift 行ぶん」だけが新しい中身なので、そこを継ぎ足す。
function compose(frames, width, height, stride) {
  let total = height
  for (let i = 1; i < frames.length; i++) total += Math.max(0, frames[i].shift)

  const outStride = width * 4
  const out = Buffer.alloc(outStride * total)
  for (let y = 0; y < height; y++) {
    frames[0].buf.copy(out, y * outStride, y * stride, y * stride + outStride)
  }
  let cursor = height
  for (let i = 1; i < frames.length; i++) {
    const s = Math.max(0, frames[i].shift)
    for (let y = 0; y < s; y++) {
      const src = (height - s + y) * stride
      frames[i].buf.copy(out, (cursor + y) * outStride, src, src + outStride)
    }
    cursor += s
  }
  return { buffer: out, width, height: total }
}

// 2つの絵がどれくらい同じか（0〜1）。スクロールの動きが止まったかの判定に使う
function sameRatio(a, b) {
  const n = Math.min(a.length, b.length)
  if (!n) return 0
  let same = 0
  for (let i = 0; i < n; i++) if (a[i] === b[i]) same++
  return same / n
}

module.exports = { rowHashes, pickBand, pickBandTop, findShift, compose, sameRatio }
