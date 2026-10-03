'use strict'

// PNG の中に、ScreenShooter の編集の情報（元の絵と図形の位置）を入れる・読む。
// 書き込み版（_書き込み.png）に入れておくと、ふつうの人には書き込み入りの絵に見え、
// ScreenShooter に落とした人には「元の絵＋動かせる図形」として開ける（チームで渡し合うため）。
// 置き場は PNG の「おまけの欄」（チャンク）。種類の名前 ssEd は、小文字で始まる＝無くても絵は読める、
// 2文字目が小文字＝私用、3文字目は大文字の決まり、4文字目が小文字＝絵を書き換えても写してよい、の意味
const zlib = require('zlib')

const TYPE = 'ssEd'
const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

let crcTable = null
function crc32(buf) {
  if (!crcTable) {
    crcTable = new Int32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      crcTable[n] = c
    }
  }
  let c = -1
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

function isPng(buf) { return Buffer.isBuffer(buf) && buf.length > 8 && buf.subarray(0, 8).equals(SIG) }

// チャンクを順に見る。fn が true を返したら止める
function eachChunk(buf, fn) {
  let p = 8
  while (p + 12 <= buf.length) {
    const len = buf.readUInt32BE(p)
    const type = buf.toString('latin1', p + 4, p + 8)
    if (p + 12 + len > buf.length) return
    if (fn(type, p, len)) return
    p += 12 + len
  }
}

// 同じ種類の古い欄を除いてから、IEND（絵の終わり）の手前に入れる
function embed(png, payload) {
  if (!isPng(png)) return png
  const data = zlib.deflateSync(Buffer.from(JSON.stringify(payload), 'utf8'))
  const parts = [png.subarray(0, 8)]
  let iend = -1
  eachChunk(png, (type, p, len) => {
    if (type === 'IEND') { iend = p; return true }
    if (type !== TYPE) parts.push(png.subarray(p, p + 12 + len))
    return false
  })
  if (iend < 0) return png
  const head = Buffer.alloc(8)
  head.writeUInt32BE(data.length, 0)
  head.write(TYPE, 4, 'latin1')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0)
  parts.push(head, data, crc, png.subarray(iend))
  return Buffer.concat(parts)
}

// 入っていなければ null。壊れていても null（ふつうの絵として開ければよい）
function extract(png) {
  if (!isPng(png)) return null
  let out = null
  eachChunk(png, (type, p, len) => {
    if (type !== TYPE) return false
    try {
      out = JSON.parse(zlib.inflateSync(png.subarray(p + 8, p + 8 + len)).toString('utf8'))
    } catch (_) { out = null }
    return true
  })
  return out && out.app === 'ScreenShooter' ? out : null
}

module.exports = { embed, extract, crc32 }
