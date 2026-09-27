'use strict'

// アイコンを作り直すスクリプト。`npm run icons` で assets/ に書き出す。
// 画像ライブラリを入れずに済ませるため、PNG と ICO をここで直接組み立てている。

const fs = require('fs')
const path = require('path')
const zlib = require('zlib')

const OUT = path.join(__dirname, '..', 'assets')
const RED = [232, 69, 60, 255]
const BG = [46, 51, 59, 255]

// ---------------------------------------------------------------- 絵を描く

function canvas(n) { return { n, data: Buffer.alloc(n * n * 4) } }

function setPx(c, x, y, col) {
  if (x < 0 || y < 0 || x >= c.n || y >= c.n) return
  const i = (y * c.n + x) * 4
  c.data[i] = col[0]; c.data[i + 1] = col[1]; c.data[i + 2] = col[2]; c.data[i + 3] = col[3]
}

function fillRect(c, x, y, w, h, col) {
  const x0 = Math.round(x), y0 = Math.round(y)
  const x1 = Math.round(x + w), y1 = Math.round(y + h)
  for (let py = y0; py < y1; py++) for (let px = x0; px < x1; px++) setPx(c, px, py, col)
}

function fillRoundRect(c, x, y, w, h, r, col) {
  const x1 = x + w, y1 = y + h
  for (let py = Math.floor(y); py < Math.ceil(y1); py++) {
    for (let px = Math.floor(x); px < Math.ceil(x1); px++) {
      const cx = px + 0.5, cy = py + 0.5
      if (cx < x || cx > x1 || cy < y || cy > y1) continue
      const dx = Math.max(x + r - cx, cx - (x1 - r), 0)
      const dy = Math.max(y + r - cy, cy - (y1 - r), 0)
      if (dx * dx + dy * dy <= r * r) setPx(c, px, py, col)
    }
  }
}

// 4隅の「かぎかっこ」＝範囲選択の印
function drawBrackets(c, size, inset, thick, arm, col) {
  const a = size * inset          // 左端・上端
  const b = size * (1 - inset)    // 右端・下端
  const t = size * thick
  const L = size * arm
  fillRect(c, a, a, L, t, col);         fillRect(c, a, a, t, L, col)          // 左上
  fillRect(c, b - L, a, L, t, col);     fillRect(c, b - t, a, t, L, col)      // 右上
  fillRect(c, a, b - t, L, t, col);     fillRect(c, a, b - L, t, L, col)      // 左下
  fillRect(c, b - L, b - t, L, t, col); fillRect(c, b - t, b - L, t, L, col)  // 右下
}

// 4倍で描いてから縮める（丸角と斜めのギザギザを消すため）
function render(size, withBackground) {
  const S = 4
  const big = canvas(size * S)
  const n = size * S
  if (withBackground) fillRoundRect(big, n * 0.02, n * 0.02, n * 0.96, n * 0.96, n * 0.22, BG)
  drawBrackets(big, n, withBackground ? 0.20 : 0.09, withBackground ? 0.085 : 0.105, withBackground ? 0.24 : 0.30, RED)

  const out = canvas(size)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0
      for (let sy = 0; sy < S; sy++) {
        for (let sx = 0; sx < S; sx++) {
          const i = ((y * S + sy) * n + (x * S + sx)) * 4
          const al = big.data[i + 3]
          r += big.data[i] * al; g += big.data[i + 1] * al; b += big.data[i + 2] * al
          a += al
        }
      }
      const i = (y * size + x) * 4
      if (a > 0) {
        out.data[i] = Math.round(r / a)
        out.data[i + 1] = Math.round(g / a)
        out.data[i + 2] = Math.round(b / a)
      }
      out.data[i + 3] = Math.round(a / (S * S))
    }
  }
  return out
}

// ---------------------------------------------------------------- PNG

let CRC_TABLE = null
function crc32(buf) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Int32Array(256)
    for (let i = 0; i < 256; i++) {
      let v = i
      for (let k = 0; k < 8; k++) v = (v & 1) ? (0xEDB88320 ^ (v >>> 1)) : (v >>> 1)
      CRC_TABLE[i] = v
    }
  }
  let c = 0xFFFFFFFF
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8)
  return (c ^ 0xFFFFFFFF) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body), 0)
  return Buffer.concat([len, body, crc])
}

function toPNG(c) {
  const stride = c.n * 4
  const raw = Buffer.alloc((stride + 1) * c.n)
  for (let y = 0; y < c.n; y++) {
    raw[y * (stride + 1)] = 0
    c.data.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(c.n, 0)
  ihdr.writeUInt32BE(c.n, 4)
  ihdr[8] = 8    // ビット深度
  ihdr[9] = 6    // RGBA
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

// ---------------------------------------------------------------- ICO

// Vista 以降は ICO の中身に PNG をそのまま入れられる
function toICO(pngs) {
  const head = Buffer.alloc(6)
  head.writeUInt16LE(0, 0)
  head.writeUInt16LE(1, 2)
  head.writeUInt16LE(pngs.length, 4)
  const dir = Buffer.alloc(16 * pngs.length)
  let offset = 6 + 16 * pngs.length
  pngs.forEach((p, i) => {
    const o = i * 16
    dir[o] = p.size >= 256 ? 0 : p.size
    dir[o + 1] = p.size >= 256 ? 0 : p.size
    dir[o + 2] = 0
    dir[o + 3] = 0
    dir.writeUInt16LE(1, o + 4)
    dir.writeUInt16LE(32, o + 6)
    dir.writeUInt32LE(p.buf.length, o + 8)
    dir.writeUInt32LE(offset, o + 12)
    offset += p.buf.length
  })
  return Buffer.concat([head, dir].concat(pngs.map((p) => p.buf)))
}

// ---------------------------------------------------------------- 書き出し

fs.mkdirSync(OUT, { recursive: true })

fs.writeFileSync(path.join(OUT, 'tray.png'), toPNG(render(32, false)))
fs.writeFileSync(path.join(OUT, 'tray@16.png'), toPNG(render(16, false)))
fs.writeFileSync(path.join(OUT, 'icon-256.png'), toPNG(render(256, true)))

const sizes = [16, 24, 32, 48, 64, 128, 256]
fs.writeFileSync(path.join(OUT, 'app.ico'), toICO(sizes.map((s) => ({ size: s, buf: toPNG(render(s, true)) }))))

console.log('assets/ にアイコンを書き出しました:', sizes.join(', '))
