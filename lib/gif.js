'use strict'

// GIF(GIF89a)を組み立てる。Electron を使わないので、そのままテストできる。
//
// 使い方:
//   const gif = createGif(幅, 高さ, { colors, dither, tolerance })   // 省くと 256色・網掛けあり・許容差0
//   gif.addFrame(rgba, 表示ミリ秒)   // rgba は 幅×高さ×4 の Uint8ClampedArray
//   const bytes = gif.finish()       // Uint8Array
//
// 256 色の組はコマをまたいで使い回し、合わなくなったときだけ選び直す（毎回選び直すとチラつく）。
// 前のコマと変わった長方形だけを書き、その中でも変わっていない画素は透明にする（同じ値が続くので LZW がよく縮む）。
// tolerance を上げると、わずかな色の揺れも「変わっていない」と見なして、さらに小さくなる。

;(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory()
  else root.GifLib = factory()
})(typeof self !== 'undefined' ? self : this, function () {

  // ------------------------------------------------------------ バイト列を伸ばしながら書く

  function Writer(initial) {
    this.buf = new Uint8Array(Math.max(16, initial || 4096))
    this.len = 0
  }
  Writer.prototype.need = function (n) {
    if (this.len + n <= this.buf.length) return
    let size = this.buf.length * 2
    while (size < this.len + n) size *= 2
    const next = new Uint8Array(size)
    next.set(this.buf.subarray(0, this.len))
    this.buf = next
  }
  Writer.prototype.byte = function (b) { this.need(1); this.buf[this.len++] = b & 255 }
  Writer.prototype.bytes = function (arr) { this.need(arr.length); this.buf.set(arr, this.len); this.len += arr.length }
  Writer.prototype.u16 = function (v) { this.byte(v); this.byte(v >> 8) }
  Writer.prototype.done = function () { return this.buf.subarray(0, this.len) }

  // ------------------------------------------------------------ 色を 256 色に減らす
  //
  // 赤緑青を 32 段階ずつに丸めた 32768 個の入れ物に数え、中央値分割で 256 個の箱にまとめる。
  // 箱の代表色は入れ物に入った実際の色の平均なので、32 段階に丸めた色より正確になる。
  // 入れ物を 16 段階（4096個）にすると速いが、平らな色が最大 8 ずれる。画面の絵はここが目立つ。

  const HIST = 32768

  // 1コマごとに作り直すと 1MB を毎回捨てることになるので、使い回す
  let hcnt = null, hsr = null, hsg = null, hsb = null

  function histogram(rgba, width, rect) {
    if (!hcnt) {
      hcnt = new Float64Array(HIST); hsr = new Float64Array(HIST)
      hsg = new Float64Array(HIST); hsb = new Float64Array(HIST)
    }
    const cnt = hcnt, sr = hsr, sg = hsg, sb = hsb
    cnt.fill(0); sr.fill(0); sg.fill(0); sb.fill(0)
    for (let y = 0; y < rect.h; y++) {
      let p = ((rect.y + y) * width + rect.x) * 4
      for (let x = 0; x < rect.w; x++, p += 4) {
        const r = rgba[p], g = rgba[p + 1], b = rgba[p + 2]
        const k = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3)
        cnt[k]++; sr[k] += r; sg[k] += g; sb[k] += b
      }
    }
    const list = []
    for (let k = 0; k < HIST; k++) {
      if (!cnt[k]) continue
      list.push({ k, n: cnt[k], r: sr[k] / cnt[k], g: sg[k] / cnt[k], b: sb[k] / cnt[k] })
    }
    return list
  }

  function boxOf(items) {
    let n = 0
    let rlo = 255, rhi = 0, glo = 255, ghi = 0, blo = 255, bhi = 0
    for (const it of items) {
      n += it.n
      if (it.r < rlo) rlo = it.r
      if (it.r > rhi) rhi = it.r
      if (it.g < glo) glo = it.g
      if (it.g > ghi) ghi = it.g
      if (it.b < blo) blo = it.b
      if (it.b > bhi) bhi = it.b
    }
    // 目に効きやすい緑を少し重く、鈍い青を軽く見る
    const dr = rhi - rlo
    const dg = (ghi - glo) * 1.2
    const db = (bhi - blo) * 0.8
    let axis = 'r'
    let span = dr
    if (dg > span) { axis = 'g'; span = dg }
    if (db > span) { axis = 'b'; span = db }
    return { items, n, span, axis }
  }

  function splitBox(box) {
    const axis = box.axis
    const items = box.items.slice().sort((a, b) => a[axis] - b[axis])
    let half = 0
    let i = 0
    for (; i < items.length - 1; i++) {
      half += items[i].n
      if (half * 2 >= box.n) break
    }
    // 1色が半分より多いと（白い背景など）真ん中が見つからず、片方が空の箱になる。
    // 空の箱は分けられないので、そこから先ずっと箱が増えず、色が黒のまま残ってしまう。
    if (i > items.length - 2) i = items.length - 2
    return [boxOf(items.slice(0, i + 1)), boxOf(items.slice(i + 1))]
  }

  // palette(3バイトずつ)と、入れ物 → 色番号の対応表を返す。
  //   lut  … いちばん近い色
  //   lut2 … 2番目に近い色
  //   lutT … その2色をどれくらいの割合で混ぜたいか(0〜32)。0 なら混ぜない
  // 256色で足りない所だけ、この2色を市松に置いて中間色を作る（網掛け＝ディザ）。
  function quantize(list, maxColors) {
    const lut = new Int16Array(HIST)
    const lut2 = new Int16Array(HIST)
    const lutT = new Uint8Array(HIST)
    const filled = new Uint8Array(HIST)   // この入れ物はもう調べたか
    const err = new Float32Array(HIST)    // その入れ物の色が、選んだ色からどれだけ離れているか
    if (!list.length) return { palette: new Uint8Array(3), lut, lut2, lutT, filled, err }

    if (list.length <= maxColors) {
      const palette = new Uint8Array(list.length * 3)
      for (let i = 0; i < list.length; i++) {
        palette[i * 3] = Math.round(list[i].r)
        palette[i * 3 + 1] = Math.round(list[i].g)
        palette[i * 3 + 2] = Math.round(list[i].b)
        lut[list[i].k] = i
        filled[list[i].k] = 1
      }
      // 色がそのまま入っているので、混ぜる必要も濃くする必要もない（lutT は 0 のまま）
      const raw = new Float64Array(palette.length)
      for (let i = 0; i < palette.length; i++) raw[i] = palette[i]
      return { palette, raw, lut, lut2, lutT, filled, err }
    }

    const boxes = [boxOf(list)]
    while (boxes.length < maxColors) {
      // 大きくて色幅の広い箱から割っていく
      let best = -1
      let bestScore = 0
      for (let i = 0; i < boxes.length; i++) {
        const b = boxes[i]
        if (b.items.length < 2 || b.span <= 0) continue
        const score = b.n * (1 + b.span)
        if (score > bestScore) { bestScore = score; best = i }
      }
      if (best < 0) break
      const pair = splitBox(boxes[best])
      boxes.splice(best, 1, pair[0], pair[1])
    }

    const colors = boxes.length
    const pal = new Float64Array(colors * 3)
    for (let i = 0; i < colors; i++) {
      let n = 0, r = 0, g = 0, b = 0
      for (const it of boxes[i].items) { n += it.n; r += it.r * it.n; g += it.g * it.n; b += it.b * it.n }
      pal[i * 3] = r / n
      pal[i * 3 + 1] = g / n
      pal[i * 3 + 2] = b / n
    }

    // 箱の端にある色は、隣の箱の代表色のほうが近いことがある。
    // 出来上がった色から改めて一番近いものを選び直す（ここを省くと色が大きく外れる点が出る）
    const assign = (withSecond) => {
      for (const it of list) {
        let best = 0
        let bestD = Infinity
        let second = 0
        let secondD = Infinity
        for (let i = 0; i < colors; i++) {
          const dr = it.r - pal[i * 3]
          const dg = it.g - pal[i * 3 + 1]
          const db = it.b - pal[i * 3 + 2]
          const d = dr * dr + dg * dg + db * db
          if (d < bestD) { secondD = bestD; second = best; bestD = d; best = i }
          else if (d < secondD) { secondD = d; second = i }
        }
        lut[it.k] = best
        if (!withSecond) continue
        filled[it.k] = 1
        err[it.k] = Math.sqrt(bestD)

        // その色は「いちばん近い色」と「2番目」のあいだのどこにあるか。
        // その割合ぶんだけ2番目の色を混ぜると、平均して元の色に近づく。
        lut2[it.k] = second
        const dr = pal[second * 3] - pal[best * 3]
        const dg = pal[second * 3 + 1] - pal[best * 3 + 1]
        const db = pal[second * 3 + 2] - pal[best * 3 + 2]
        const den = dr * dr + dg * dg + db * db
        if (den <= 0) { lutT[it.k] = 0; continue }
        const t = ((it.r - pal[best * 3]) * dr + (it.g - pal[best * 3 + 1]) * dg
          + (it.b - pal[best * 3 + 2]) * db) / den
        lutT[it.k] = Math.max(0, Math.min(32, Math.round(t * 64)))
      }
    }
    assign(false)

    // 選び直した結果に合わせて代表色を取り直し、もう一度割り当てる（仕上げ1回）
    const sn = new Float64Array(colors)
    const sr = new Float64Array(colors)
    const sg = new Float64Array(colors)
    const sb = new Float64Array(colors)
    for (const it of list) {
      const c = lut[it.k]
      sn[c] += it.n; sr[c] += it.r * it.n; sg[c] += it.g * it.n; sb[c] += it.b * it.n
    }
    for (let i = 0; i < colors; i++) {
      if (!sn[i]) continue
      pal[i * 3] = sr[i] / sn[i]
      pal[i * 3 + 1] = sg[i] / sn[i]
      pal[i * 3 + 2] = sb[i] / sn[i]
    }
    assign(true)

    const palette = new Uint8Array(colors * 3)
    for (let i = 0; i < colors * 3; i++) palette[i] = Math.round(pal[i])
    return { palette, raw: pal, lut, lut2, lutT, filled, err }
  }

  // ------------------------------------------------------------ LZW（GIF の圧縮）

  let table = null   // (途中までの並び << 8 | 次の色) → コード。0 は空き

  function lzw(indices, minCodeSize) {
    if (!table) table = new Int32Array(4096 * 256)
    table.fill(0)

    const w = new Writer((indices.length >> 1) || 64)
    const clear = 1 << minCodeSize
    const eoi = clear + 1
    let next = clear + 2
    let size = minCodeSize + 1
    let bitBuf = 0
    let bitLen = 0

    const emit = (code) => {
      bitBuf |= code << bitLen
      bitLen += size
      while (bitLen >= 8) { w.byte(bitBuf); bitBuf >>>= 8; bitLen -= 8 }
    }

    emit(clear)
    if (indices.length) {
      let prefix = indices[0]
      for (let i = 1; i < indices.length; i++) {
        const k = indices[i]
        const key = prefix * 256 + k
        const found = table[key]
        if (found) { prefix = found - 1; continue }
        emit(prefix)
        if (next === 4096) {
          // 辞書がいっぱい。作り直しの合図を送ってやり直す
          emit(clear)
          table.fill(0)
          next = clear + 2
          size = minCodeSize + 1
        } else {
          // コードを出したあとに桁を増やす。読む側と足並みが揃わなくなるので順番が大事
          if (next >= (1 << size)) size++
          table[key] = next + 1
          next++
        }
        prefix = k
      }
      emit(prefix)
    }
    emit(eoi)
    if (bitLen > 0) w.byte(bitBuf)
    return w.done()
  }

  // 圧縮した中身は 255 バイトずつの小分けにして書く決まりになっている
  function subBlocks(data, minCodeSize) {
    const w = new Writer(data.length + (data.length >> 7) + 16)
    w.byte(minCodeSize)
    for (let i = 0; i < data.length; i += 255) {
      const n = Math.min(255, data.length - i)
      w.byte(n)
      w.bytes(data.subarray(i, i + n))
    }
    w.byte(0)
    return w.done()
  }

  // 色の組を決めたあとに出てきた色を、その場で一番近い色に当てはめる。
  // 色の組をコマ間で使い回すので、最初に無かった色はここで足りるようにする。
  function fillOne(q, it) {
    const pal = q.raw          // 濃くする前の色で測る（配り方を揃えるため）
    const colors = q.palette.length / 3
    let best = 0
    let bestD = Infinity
    let second = 0
    let secondD = Infinity
    for (let i = 0; i < colors; i++) {
      const dr = it.r - pal[i * 3]
      const dg = it.g - pal[i * 3 + 1]
      const db = it.b - pal[i * 3 + 2]
      const d = dr * dr + dg * dg + db * db
      if (d < bestD) { secondD = bestD; second = best; bestD = d; best = i }
      else if (d < secondD) { secondD = d; second = i }
    }
    q.lut[it.k] = best
    q.lut2[it.k] = second
    q.err[it.k] = Math.sqrt(bestD)
    q.filled[it.k] = 1
    const dr = pal[second * 3] - pal[best * 3]
    const dg = pal[second * 3 + 1] - pal[best * 3 + 1]
    const db = pal[second * 3 + 2] - pal[best * 3 + 2]
    const den = dr * dr + dg * dg + db * db
    if (den <= 0) { q.lutT[it.k] = 0; return }
    const t = ((it.r - pal[best * 3]) * dr + (it.g - pal[best * 3 + 1]) * dg
      + (it.b - pal[best * 3 + 2]) * db) / den
    q.lutT[it.k] = Math.max(0, Math.min(32, Math.round(t * 64)))
  }

  // 網掛けの並び順（8×8）。画面の位置で決まるので、同じ絵なら毎回まったく同じ網目になる。
  // ここを乱数や誤差拡散にすると、少し動いただけで網目が全面的にずれてチラチラする。
  const BAYER = new Uint8Array([
    0, 32, 8, 40, 2, 34, 10, 42,
    48, 16, 56, 24, 50, 18, 58, 26,
    12, 44, 4, 36, 14, 46, 6, 38,
    60, 28, 52, 20, 62, 30, 54, 22,
    3, 35, 11, 43, 1, 33, 9, 41,
    51, 19, 59, 27, 49, 17, 57, 25,
    15, 47, 7, 39, 13, 45, 5, 37,
    63, 31, 55, 23, 61, 29, 53, 21,
  ])

  // ------------------------------------------------------------ 前のコマとの差

  // 変わった所を囲む長方形。まったく同じなら null
  function diffRect(prev, cur, width, height) {
    const a = new Uint32Array(prev.buffer, prev.byteOffset, prev.length >> 2)
    const b = new Uint32Array(cur.buffer, cur.byteOffset, cur.length >> 2)
    let top = -1
    let bottom = -1
    for (let y = 0; y < height; y++) {
      const row = y * width
      for (let x = 0; x < width; x++) {
        if (a[row + x] !== b[row + x]) { if (top < 0) top = y; bottom = y; break }
      }
    }
    if (top < 0) return null

    let left = width
    let right = -1
    for (let y = top; y <= bottom; y++) {
      const row = y * width
      for (let x = 0; x < left; x++) if (a[row + x] !== b[row + x]) { left = x; break }
      for (let x = width - 1; x > right; x--) if (a[row + x] !== b[row + x]) { right = x; break }
    }
    return { x: left, y: top, w: right - left + 1, h: bottom - top + 1 }
  }

  // ------------------------------------------------------------ 組み立て

  // 色数は 2 の累乗でないと書けないので、足りないぶんを黒で埋める
  function padPalette(palette) {
    const n = palette.length / 3
    let size = 2
    let bits = 1
    while (size < n) { size *= 2; bits++ }
    const out = new Uint8Array(size * 3)
    out.set(palette)
    return { table: out, bits }
  }

  // 使い回している色の組がここまで合わなくなったら選び直す（0〜441 のうちの平均のずれ）
  const REBUILD_ERR = 9
  // 色が BAD_ERR より外れた画素が、書く範囲の BAD_SHARE を超えても選び直す
  const BAD_ERR = 24
  const BAD_SHARE = 0.02

  function createGif(width, height, opts) {
    const o = opts || {}
    const maxColors = Math.max(2, Math.min(256, o.colors || 256)) - 1   // 1色は透明に取っておく
    const dither = o.dither !== false
    const tol2 = (o.tolerance || 0) * (o.tolerance || 0)
    const chunks = []
    // いま画面に見えている絵（書いた画素だけ更新する）。許容差で書かなかった画素は古い色のまま残す。
    // 書いた絵そのものと比べないと、少しずつの変化が積もっても書き直されない。
    let prev = null
    let globalPal = null
    let lastGce = null
    let frames = 0
    let pal = null       // いま使っている色の組。コマをまたいで使い回す

    function delayCentis(ms) { return Math.max(2, Math.min(65535, Math.round(ms / 10))) }

    function makePalette(list) {
      const q = quantize(list, maxColors)
      // 色の組の直後の番号を透明に使う
      q.tIndex = q.palette.length / 3
      const withT = new Uint8Array(q.palette.length + 3)
      withT.set(q.palette)
      q.pad = padPalette(withT)
      return q
    }

    function addFrame(rgba, delayMs) {
      let rect = prev ? diffRect(prev, rgba, width, height) : { x: 0, y: 0, w: width, h: height }
      if (!rect) {
        // 何も動いていないコマ。新しく書かず、前のコマを長く見せるだけにする
        if (lastGce) {
          const cs = Math.min(65535, (lastGce[4] | (lastGce[5] << 8)) + delayCentis(delayMs))
          lastGce[4] = cs & 255
          lastGce[5] = (cs >> 8) & 255
        }
        return false
      }

      // 色の組はコマをまたいで使い回す。コマごとに選び直すと、動いていない所まで
      // 別の色に振り替わって画面全体がチラチラする（実測でちらつきが 1.7 → 0 になった）。
      let rebuilt = false
      const hist = histogram(rgba, width, rect)
      if (!pal) {
        pal = makePalette(hist)
      } else {
        let sum = 0
        let total = 0
        let bad = 0
        for (const it of hist) {
          if (!pal.filled[it.k]) fillOne(pal, it)
          sum += pal.err[it.k] * it.n
          total += it.n
          if (pal.err[it.k] > BAD_ERR) bad += it.n
        }
        // 映っているものが入れ替わって色が合わなくなったら、絵ぜんぶから選び直す。
        // このときは絵ぜんぶを書き直す。一部だけだと、古い色のままの所と混ざって継ぎはぎになる。
        // 白い背景が多いと平均は小さいまま、新しく出てきた絵だけ色が大きく外れる（金髪が桃色になる等）。
        // 外れた画素の割合でも見る
        if (total > 0 && (sum / total > REBUILD_ERR || bad / total > BAD_SHARE)) {
          rect = { x: 0, y: 0, w: width, h: height }
          pal = makePalette(histogram(rgba, width, rect))
          rebuilt = true
        }
      }
      const pad = pal.pad
      const lut = pal.lut
      const lut2 = pal.lut2
      const lutT = pal.lutT
      const tIndex = pal.tIndex

      // 最初のコマと色の組を選び直したコマは全部書く（透明にすると古い色の組の画素が残る）
      const first = !prev
      if (first) prev = new Uint8Array(rgba)
      const useT = !first && !rebuilt
      const indices = new Uint8Array(rect.w * rect.h)
      for (let y = 0; y < rect.h; y++) {
        const row = ((rect.y + y) & 7) * 8
        let p = ((rect.y + y) * width + rect.x) * 4
        let d = y * rect.w
        for (let x = 0; x < rect.w; x++, p += 4, d++) {
          if (useT) {
            const dr = rgba[p] - prev[p]
            const dg = rgba[p + 1] - prev[p + 1]
            const db = rgba[p + 2] - prev[p + 2]
            if (dr * dr + dg * dg + db * db <= tol2) { indices[d] = tIndex; continue }
          }
          const k = ((rgba[p] >> 3) << 10) | ((rgba[p + 1] >> 3) << 5) | (rgba[p + 2] >> 3)
          const t = dither ? lutT[k] : 0
          // 網目は絵の中の位置で決める（切り抜いた場所ではなく）。
          // そうしないと、動いた所だけ網目がずれて継ぎ目が見える。
          indices[d] = (t > BAYER[row + ((rect.x + x) & 7)]) ? lut2[k] : lut[k]
          prev[p] = rgba[p]; prev[p + 1] = rgba[p + 1]; prev[p + 2] = rgba[p + 2]; prev[p + 3] = rgba[p + 3]
        }
      }

      if (frames === 0) {
        const h = new Writer(1024)
        h.bytes([0x47, 0x49, 0x46, 0x38, 0x39, 0x61])          // "GIF89a"
        h.u16(width); h.u16(height)
        h.byte(0xF0 | (pad.bits - 1))                          // 全体のカラーテーブルあり
        h.byte(0); h.byte(0)
        h.bytes(pad.table)
        globalPal = pal
        h.bytes([0x21, 0xFF, 0x0B])                            // ずっと繰り返す指定
        h.bytes([0x4E, 0x45, 0x54, 0x53, 0x43, 0x41, 0x50, 0x45, 0x32, 0x2E, 0x30])
        h.bytes([0x03, 0x01, 0x00, 0x00, 0x00])
        chunks.push(h.done())
      }

      const cs = delayCentis(delayMs)
      // 0x04 = 前のコマを消さずに上に重ねる。0x01 = tIndex の画素は透明（前のコマが見える）
      const gce = new Uint8Array([0x21, 0xF9, 0x04, useT ? 0x05 : 0x04, cs & 255, (cs >> 8) & 255, useT ? tIndex : 0, 0])
      chunks.push(gce)
      lastGce = gce

      const idw = new Writer(16)
      idw.byte(0x2C)
      idw.u16(rect.x); idw.u16(rect.y); idw.u16(rect.w); idw.u16(rect.h)
      // 色の組が最初のコマと同じなら全体のを使う。違うときだけこのコマ専用の色表を付ける
      const local = pal !== globalPal
      idw.byte(local ? 0x80 | (pad.bits - 1) : 0)
      chunks.push(idw.done())
      if (local) chunks.push(pad.table)

      const minCodeSize = Math.max(2, pad.bits)
      chunks.push(subBlocks(lzw(indices, minCodeSize), minCodeSize))

      frames++
      return true
    }

    function size() {
      let total = 1
      for (const c of chunks) total += c.length
      return total
    }

    function finish() {
      const out = new Uint8Array(size())
      let at = 0
      for (const c of chunks) { out.set(c, at); at += c.length }
      out[at] = 0x3B
      return out
    }

    return {
      addFrame,
      finish,
      size,
      get frames() { return frames },
    }
  }

  return { createGif, quantize, histogram, diffRect, lzw, subBlocks, padPalette }
})
