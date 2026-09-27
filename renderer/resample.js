'use strict';   // 次の行が ( で始まるので、ここのセミコロンは消さない（消すと 'use strict'(…) と読まれて動かない）

// 絵の大きさを変える計算。編集画面（<script>）と、手元のテスト（Node の require）の両方から使う。
// canvas の drawImage で縮めると、Chromium は縮小のとき段階的にぼかして縮めるので文字がにじむ。
// ここでは Lanczos3（輪郭をくっきり残す定番の方式）を自前で掛ける。
// 拡大が 2倍・3倍… の整数倍のときだけは、点をそのまま大きくする（にじみが一切出ない）。
(function (root) {
  const LOBES = 3

  function lanczos(x) {
    if (x === 0) return 1
    if (x <= -LOBES || x >= LOBES) return 0
    const px = Math.PI * x
    return (LOBES * Math.sin(px) * Math.sin(px / LOBES)) / (px * px)
  }

  // 出力の1列（1行）ごとに、元のどの点をどれだけ混ぜるかを先に決めておく。
  // 縮めるときは元の点を多く拾う（フィルタの幅を 1/倍率 に広げる）。広げないと細い線が消えたりチラついたりする。
  // 絵の外にはみ出す分は捨てて、残りの重みで割り直す（端が暗くならないように）
  function weights(inSize, outSize, scale) {
    const fscale = Math.max(1, 1 / scale)
    const support = LOBES * fscale
    const start = new Int32Array(outSize)
    const count = new Int32Array(outSize)
    const maxTaps = Math.ceil(support * 2) + 2
    const w = new Float32Array(outSize * maxTaps)
    for (let i = 0; i < outSize; i++) {
      const center = (i + 0.5) / scale
      let lo = Math.max(0, Math.floor(center - support))
      const hi = Math.min(inSize - 1, Math.ceil(center + support))
      let sum = 0
      let n = 0
      const base = i * maxTaps
      for (let j = lo; j <= hi && n < maxTaps; j++) {
        const v = lanczos((j + 0.5 - center) / fscale)
        w[base + n] = v
        sum += v
        n++
      }
      if (sum !== 0) for (let k = 0; k < n; k++) w[base + k] /= sum
      start[i] = lo
      count[i] = n
    }
    return { start, count, w, maxTaps }
  }

  // 整数倍の拡大。元の1点を k×k の点にそのまま広げる
  function nearest(src, sw, sh, k, dw, dh) {
    const out = new Uint8ClampedArray(dw * dh * 4)
    const s32 = new Uint32Array(src.buffer, src.byteOffset, sw * sh)
    const d32 = new Uint32Array(out.buffer)
    for (let y = 0; y < dh; y++) {
      const sy = Math.min(sh - 1, Math.floor(y / k))
      for (let x = 0; x < dw; x++) d32[y * dw + x] = s32[sy * sw + Math.min(sw - 1, Math.floor(x / k))]
    }
    return out
  }

  // src: RGBA（透明度は掛けていない）。scale は縦横共通の倍率で、出力の大きさ dw×dh はほぼ src×scale。
  // 倍率を大きさから逆算せずに渡すのは、編集画面の図形の座標（元の座標×scale）と絵の位置をぴったり合わせるため
  function resample(src, sw, sh, scale, dw, dh) {
    if (scale === 1 && dw === sw && dh === sh) return new Uint8ClampedArray(src)
    const k = Math.round(scale)
    if (scale > 1 && Math.abs(scale - k) < 1e-9) return nearest(src, sw, sh, k, dw, dh)

    // 透ける点があるときだけ、色に透明度を掛けてから混ぜる（掛けないと透明の縁に黒いフチが出る）
    let opaque = true
    for (let i = 3; i < src.length; i += 4) if (src[i] !== 255) { opaque = false; break }
    let s = src
    if (!opaque) {
      s = new Float32Array(src.length)
      for (let i = 0; i < src.length; i += 4) {
        const a = src[i + 3] / 255
        s[i] = src[i] * a; s[i + 1] = src[i + 1] * a; s[i + 2] = src[i + 2] * a; s[i + 3] = src[i + 3]
      }
    }

    // 横 → 縦の順に2回に分けて掛ける（まとめて掛けるより桁違いに速い）
    const H = weights(sw, dw, scale)
    const tmp = new Float32Array(dw * sh * 4)
    for (let y = 0; y < sh; y++) {
      const row = y * sw * 4
      for (let x = 0; x < dw; x++) {
        const base = x * H.maxTaps
        let p = row + H.start[x] * 4
        let r = 0, g = 0, b = 0, a = 0
        for (let n = 0; n < H.count[x]; n++, p += 4) {
          const wt = H.w[base + n]
          r += s[p] * wt; g += s[p + 1] * wt; b += s[p + 2] * wt; a += s[p + 3] * wt
        }
        const o = (y * dw + x) * 4
        tmp[o] = r; tmp[o + 1] = g; tmp[o + 2] = b; tmp[o + 3] = a
      }
    }

    const V = weights(sh, dh, scale)
    const out = new Uint8ClampedArray(dw * dh * 4)
    const stride = dw * 4
    for (let y = 0; y < dh; y++) {
      const base = y * V.maxTaps
      const first = V.start[y] * stride
      const cnt = V.count[y]
      for (let x = 0; x < dw; x++) {
        let p = first + x * 4
        let r = 0, g = 0, b = 0, a = 0
        for (let n = 0; n < cnt; n++, p += stride) {
          const wt = V.w[base + n]
          r += tmp[p] * wt; g += tmp[p + 1] * wt; b += tmp[p + 2] * wt; a += tmp[p + 3] * wt
        }
        const o = (y * dw + x) * 4
        if (opaque) {
          out[o] = r; out[o + 1] = g; out[o + 2] = b; out[o + 3] = 255
        } else if (a <= 0.5) {
          out[o] = 0; out[o + 1] = 0; out[o + 2] = 0; out[o + 3] = 0
        } else {
          const k2 = 255 / a
          out[o] = r * k2; out[o + 1] = g * k2; out[o + 2] = b * k2; out[o + 3] = a
        }
      }
    }
    return out
  }

  const api = { resample }
  if (typeof module !== 'undefined' && module.exports) module.exports = api
  else root.Resample = api
})(typeof window !== 'undefined' ? window : this)
