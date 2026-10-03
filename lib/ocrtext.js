'use strict'

// 文字の読み取り（tools/ocr.ps1）の結果を、コピーできる文章に並べ直す。
// ocr: { width, height, passes: [{ lang, scale, lines: [[[text, x, y, w, h], ...], ...] }] }
// 読み取りは日本語・英語 × 1倍・2倍で何回か走るので、いちばん多く読めた1回だけを使う（混ぜると同じ行が二重になる）。
// 大きい絵はタイルに分けて読むので、重なった所の行は二重に出る。同じ文字で同じ高さの行は1つにまとめる

// 英数字どうしのあいだだけ空白を入れる（日本語は単語のあいだに空白を入れない）
function joinWords(words) {
  let out = ''
  for (const w of words) {
    const t = String(w[0] || '')
    if (!t) continue
    if (out && /[A-Za-z0-9.,:;!?)\]'"%]$/.test(out) && /^[A-Za-z0-9(\["'$#@]/.test(t)) out += ' '
    out += t
  }
  return out
}

function lineBox(words) {
  const x = Math.min(...words.map((w) => +w[1]))
  const y = Math.min(...words.map((w) => +w[2]))
  const y2 = Math.max(...words.map((w) => +w[2] + +w[4]))
  return { x, y, h: y2 - y }
}

function pickPass(ocr) {
  if (!ocr || !Array.isArray(ocr.passes) || !ocr.passes.length) return null
  const count = (p) => (p.lines || []).reduce((n, l) => n + l.reduce((m, w) => m + String(w[0] || '').length, 0), 0)
  // 同じくらい読めているなら日本語のほうを選ぶ（英語のエンジンは日本語を読めないが、日本語のエンジンは英語も読める）
  return ocr.passes.slice().sort((a, b) => (count(b) + (b.lang === 'ja' ? 5 : 0)) - (count(a) + (a.lang === 'ja' ? 5 : 0)))[0]
}

function ocrToText(ocr) {
  const pass = pickPass(ocr)
  if (!pass) return ''
  const rows = []
  for (const words of pass.lines || []) {
    if (!Array.isArray(words) || !words.length) continue
    const text = joinWords(words)
    if (!text) continue
    const b = lineBox(words)
    // タイルの重なりで二重に読んだ行を捨てる
    if (rows.some((r) => r.text === text && Math.abs(r.y - b.y) < Math.max(4, b.h / 2))) continue
    rows.push({ text, x: b.x, y: b.y, h: b.h })
  }
  // 上から順に。ほぼ同じ高さ（行の高さの半分以内）なら左から
  rows.sort((a, b) => (Math.abs(a.y - b.y) < Math.min(a.h, b.h) / 2 ? a.x - b.x : a.y - b.y))
  return rows.map((r) => r.text).join('\n')
}

module.exports = { ocrToText, joinWords }
