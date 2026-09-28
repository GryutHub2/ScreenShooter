'use strict'

// 文字の読み取り結果（tools/ocr.ps1 が返す JSON）から、個人情報・APIキーらしい所の四角を探す。
// Electron を使わないので node からそのままテストできる。
//
// 読み取りは語ごとの四角しか返さない（1文字ずつの位置は取れない）ので、当たった文字を含む語を丸ごと隠す。
// 多めに隠れるぶんには安全側。逆に機械の見落とし（小さい字・誤読・折り返し）は必ず残る。

// 読み取りの誤りでよく化ける文字。数字の並び（電話・カード）を探すときだけ、数字の隣にあれば数字として扱う
const DIGIT_LIKE = { O: '0', o: '0', D: '0', '€': '0', l: '1', I: '1', '|': '1', '!': '1', S: '5', B: '8' }

// 語どうしの間の空白を詰める文字。「taro.yamada@example . com」のように記号の前後で語が割れるため
const GLUE = /[.@\-_:\/\\=+%]/

const KEY_RULES = [
  /sk-ant-[A-Za-z0-9_\-]{8,}/g,
  /sk-(?:proj-|live-|test-|svcacct-)?[A-Za-z0-9_\-]{16,}/g,
  /gh[pousr]_[A-Za-z0-9]{12,}/g,
  /github_pat_[A-Za-z0-9_]{16,}/g,
  /(?:AKIA|ASIA)[A-Z0-9]{12,}/g,
  /xox[abposr]-[A-Za-z0-9\-]{8,}/g,
  /AIza[0-9A-Za-z_\-]{20,}/g,
  // API_KEY=… / token: … のような「名前＝値」の値。
  // 名前の終わりが KEY・token などで、すぐ後ろに = か : が来るものだけ（Keyboard: のような語で当たらないように）
  /[A-Za-z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|[Kk]ey|[Tt]oken|[Ss]ecret|[Pp]assword)\s*[=:]\s*["']?[^\s"']{8,}/g,
]

const EMAIL = /[A-Za-z0-9._%+\-]+@[A-Za-z0-9\-]+(?:\.[A-Za-z0-9\-]+)*\.[A-Za-z]{2,}/g
// 日本の電話番号。0 か +81 で始まり、区切りは空白・ハイフン・かっこ
const PHONE = /(?:\+81[\s\-]?|0)\d{1,4}[\s\-‐−ー()（）]{0,2}\d{1,4}[\s\-‐−ー()（）]{0,2}\d{3,4}(?!\d)/g
// カード番号の候補。数字の塊を空白・ハイフンでつないだ並び（中身は luhn で確かめる）
const DIGIT_RUN = /\d+(?:[ \-]\d+)*/g
const LONG_TOKEN = /[A-Za-z0-9_\-]{24,}/g
// 「強」のときだけ：8桁以上の数字の並び（お客様番号・注文番号など）
const LONG_DIGITS = /\d{8,}/g

// ぼかしの強さ。段階ごとに使う検出を決める（設定画面の説明文と合わせる）
//   low    : 登録した言葉・正規表現、メール、決まった形のAPIキー、カード番号、このPCのユーザー名
//   normal : ＋電話番号、「パスワード」などの見出しの後ろ、長いランダムな英数字
//   high   : ＋8桁以上の数字の並び
const LEVELS = ['low', 'normal', 'high']

function luhn(digits) {
  let sum = 0
  let dbl = false
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48
    if (dbl) { d *= 2; if (d > 9) d -= 9 }
    sum += d
    dbl = !dbl
  }
  return sum % 10 === 0
}

// 数字の塊の並びから、13〜19桁で luhn が通るひと続きを探す（前後に日付などが付いて全体では通らないことがあるため）。
// 塊をつなぐのは4桁以上どうしだけ（カードは 4-4-4-4 / 4-6-5）。2桁の塊（グラフの目盛り 26-05 26-06 …）は
// つなぐと1割ほどの確率で luhn が通ってしまい、カード番号と誤判定するため
function cardSpans(text, start) {
  const groups = []
  const re = /\d+/g
  let m
  while ((m = re.exec(text))) groups.push({ s: start + m.index, e: start + m.index + m[0].length, d: m[0] })
  let best = null
  for (let i = 0; i < groups.length; i++) {
    let digits = ''
    for (let j = i; j < groups.length; j++) {
      if (j > i && (groups[i].d.length < 4 || groups[j].d.length < 4)) break
      digits += groups[j].d
      if (digits.length > 19) break
      if (digits.length >= 13 && luhn(digits)) {
        if (!best || digits.length > best.len) best = { s: groups[i].s, e: groups[j].e, len: digits.length }
      }
    }
  }
  return best ? [{ s: best.s, e: best.e }] : []
}

// 長いランダムな英数字（トークン・ハッシュ）らしいか。
// ふつうの長い名前（ANTHROPIC_API_KEY_FOR_PROD など）は、文字の種類がほとんど入れ替わらないので外す
function looksRandom(s) {
  const t = s.replace(/[_\-]/g, '')
  if (t.length < 24) return false
  const up = /[A-Z]/.test(t), low = /[a-z]/.test(t), dig = (t.match(/\d/g) || []).length
  if ((up + low + (dig > 0)) < 2 || dig < 3) return false
  let flips = 0
  const kind = (c) => (/[A-Z]/.test(c) ? 1 : /[a-z]/.test(c) ? 2 : 3)
  for (let i = 1; i < t.length; i++) if (kind(t[i]) !== kind(t[i - 1])) flips++
  return flips >= t.length / 6
}

function normChar(c) {
  const n = c.normalize('NFKC')
  return n.length === 1 ? n : c
}

// 1行の語を1本の文字列につなぐ。map[i] は i 文字目がどの語か（語の間の空白は -1）
function joinWords(words, glueAll) {
  let text = ''
  const map = []
  for (let i = 0; i < words.length; i++) {
    const t = Array.from(String(words[i][0] || '')).map(normChar).join('')
    if (!t) continue
    if (text && !glueAll) {
      const prev = text[text.length - 1]
      if (!GLUE.test(prev) && !GLUE.test(t[0])) { text += ' '; map.push(-1) }
    }
    for (let k = 0; k < t.length; k++) { text += t[k]; map.push(i) }
  }
  return { text, map }
}

// 数字の隣にある「数字に化けやすい文字」を数字に置き換える（長さは変えない）
function digitish(text) {
  const a = Array.from(text)
  if (a.length !== text.length) return text
  const out = a.slice()
  for (let i = 0; i < a.length; i++) {
    const r = DIGIT_LIKE[a[i]]
    if (!r) continue
    const near = /\d/.test(a[i - 1] || '') || /\d/.test(a[i + 1] || '')
    if (near || a[i] === '€') out[i] = r
  }
  return out.join('')
}

// 正規表現の当たりが、英数字の並びの途中から始まったり途中で終わったりしていないか。
// そうしないと /PA\d{9}/ が PA1234567890（10桁）の頭9桁に当たる。
// 区切りは「英数字でない文字」のほかに「読み取りの語の変わり目」も認める（英語の読み取りは IL 1234567890 と英字と数字で語を割るため）
const ALNUM = /[A-Za-z0-9]/
function wholeToken(v, text, m) {
  const edge = (a, b) => a < 0 || b >= text.length || !ALNUM.test(text[a]) || !ALNUM.test(text[b]) || v.map[a] !== v.map[b]
  return edge(m.s - 1, m.s) && edge(m.e - 1, m.e)
}

function allMatches(re, text) {
  const out = []
  re.lastIndex = 0
  let m
  while ((m = re.exec(text))) {
    out.push({ s: m.index, e: m.index + m[0].length, t: m[0] })
    if (m[0].length === 0) re.lastIndex++
  }
  return out
}

function findAll(needle, hay) {
  const out = []
  if (!needle) return out
  const h = hay.toLowerCase()
  const n = needle.toLowerCase()
  let i = h.indexOf(n)
  while (i >= 0) { out.push({ s: i, e: i + n.length }); i = h.indexOf(n, i + 1) }
  return out
}

function spanWords(map, s, e) {
  let a = Infinity, b = -1
  for (let i = s; i < e; i++) {
    const w = map[i]
    if (w < 0 || w === undefined) continue
    if (w < a) a = w
    if (w > b) b = w
  }
  return b < 0 ? null : { from: a, to: b }
}

// 1行を調べて、当たった語の範囲（from..to）と種類を返す
function scanLine(words, opts) {
  const hits = []
  const add = (map, spans, kind) => {
    for (const sp of spans) {
      const r = spanWords(map, sp.s, sp.e)
      if (r) hits.push({ from: r.from, to: r.to, kind })
    }
  }
  const spaced = joinWords(words, false)
  const tight = joinWords(words, true)
  for (const v of [spaced, tight]) {
    add(v.map, allMatches(EMAIL, v.text), 'email')
    for (const re of KEY_RULES) add(v.map, allMatches(re, v.text), 'key')
    if (opts.userName) add(v.map, findAll(opts.userName, v.text), 'user')
    for (const w of opts.words) add(v.map, findAll(w, v.text), 'word')
  }
  // 正規表現は語を全部つないだほうで探す（PA 123456789 のように語が割れても当たるように）。
  // 数字が O や l に化けていても当たるよう、数字の隣の化けやすい文字を直したものでも探す
  const dt = digitish(tight.text)
  for (const re of opts.patterns) {
    add(tight.map, allMatches(re, tight.text).filter((m) => wholeToken(tight, tight.text, m)), 'word')
    if (dt !== tight.text) add(tight.map, allMatches(re, dt).filter((m) => wholeToken(tight, dt, m)), 'word')
  }
  // 数字の並びは、語を全部つなぐと別々の数字がくっついて誤検出が増えるので、空白を残したほうだけで探す
  const dg = digitish(spaced.text)
  for (const m of allMatches(DIGIT_RUN, dg)) add(spaced.map, cardSpans(m.t, m.s), 'card')
  if (opts.level === 'low') return hits
  add(spaced.map, allMatches(PHONE, dg).filter((m) => {
    const n = m.t.replace(/\D/g, '')
    return m.t.startsWith('+81') ? (n.length >= 11 && n.length <= 12) : (n.length === 10 || n.length === 11)
  }), 'phone')
  add(spaced.map, allMatches(LONG_TOKEN, spaced.text).filter((m) => looksRandom(m.t)), 'key')
  if (opts.level === 'high') add(spaced.map, allMatches(LONG_DIGITS, dg), 'digits')
  return hits
}

// 形では見分けられない短い値（暗証番号・セキュリティコード・名義人・ID など）は、手前の見出しで見つける。
// 日本語の見出しは1文字ずつ空白入りで読まれるので、語を全部つないだ文字列で探す。
// 「バスワード」は読み取りが「パ」を「バ」に読み違えたもの（実測でほとんどの画面で起きた）
const JA_LABELS = [
  '名義人', 'カード名義', '有効期限', 'セキュリティコード', 'セキュリティーコード', '暗証番号',
  'パスワード', 'バスワード','ユーザー名', 'ユーザーID', 'ログインID', '会員番号', 'お客様番号', '口座番号', '生年月日', 'マイナンバー',
]
// 英語の見出しは他の単語の一部に当たりやすい（PINK など）ので、語の区切りを見る
const EN_LABEL = /(?:^|[^A-Za-z])(PIN|CVV2?|CVC|Security\s?Code|Passcode|Password|User\s?(?:name|ID)|Login\s?ID)(?![A-Za-z])/gi
// 見出しの直後にこれが来たら文の一部（「パスワードを忘れた方」など）なので値とみなさない
const SENTENCE_NEXT = /^[のはをがにともでへやか]/
const LABEL_SEP = /^[\s:：=＝]*$/

// 1行の中の見出しを探す。値が同じ行にあれば { from, to }、見出しで行が終わっていれば { below: 見出しの語の範囲 }
function labelHits(words) {
  const out = []
  const tight = joinWords(words, true)
  const spaced = joinWords(words, false)
  const spans = []
  for (const l of JA_LABELS) for (const m of findAll(l, tight.text)) spans.push({ v: tight, s: m.s, e: m.e })
  for (const m of allMatches(EN_LABEL, spaced.text)) {
    const off = m.t.length - m.t.replace(/^[^A-Za-z]/, '').length
    spans.push({ v: spaced, s: m.s + off, e: m.e })
  }
  for (const sp of spans) {
    const rest = sp.v.text.slice(sp.e)
    if (SENTENCE_NEXT.test(rest)) continue
    const lab = spanWords(sp.v.map, sp.s, sp.e)
    if (!lab) continue
    // 見出しと値が1つの語に入っていることがある（PIN:7630 など）。そのときはその語ごと隠す
    const sameWord = sp.v.map[sp.e] === lab.to && !LABEL_SEP.test(String(words[lab.to][0]).slice(-1))
    let from = sameWord ? lab.to : lab.to + 1
    // 見出しの後ろの「：」だけの語は値ではないので飛ばす（見出しが読めるまま残るように）
    while (from < words.length && LABEL_SEP.test(String(words[from][0] || ''))) from++
    let to = words.length - 1
    // 値の後ろに別の見出しが続く行（「有効期限 03/32 セキュリティコード 534」）は、次の見出しの手前まで
    for (const o of spans) {
      if (o === sp) continue
      const r = spanWords(o.v.map, o.s, o.e)
      if (r && r.from > from && r.from - 1 < to) to = r.from - 1
    }
    const value = words.slice(from, to + 1).map((w) => String(w[0] || '')).join('')
    if (from <= to && !LABEL_SEP.test(value)) out.push({ from, to })
    else if (!rest.replace(/[\s:：=＝]/g, '')) out.push({ below: lab })
  }
  return out
}

// 見出しだけの行の真下にある行（値が次の行に書かれる画面。パスワード管理アプリなど）
function lineBelow(lines, li, lab) {
  const lr = lineRect(lines[li])
  const labX = wordRect(lines[li][lab.from]).x
  const h = Math.max(4, lr.h)
  let best = -1, bestY = Infinity
  for (let j = 0; j < lines.length; j++) {
    if (j === li) continue
    const r = lineRect(lines[j])
    const gap = r.y - (lr.y + lr.h)
    if (r.y <= lr.y + h * 0.5 || gap > h * 1.6) continue
    if (Math.abs(r.x - labX) > h * 3) continue
    if (r.y < bestY) { bestY = r.y; best = j }
  }
  return best
}

// 見出しだけの行と同じ高さで右にある、いちばん近い行（2列の表・グリッドで、値の列が別の行として読まれる画面）。
// 間の広さは字の大きさの何文字ぶんかで測る。実測で見出し列 120〜160px の表は 3.7〜8.7 文字ぶん、
// 左のメニューと同じ高さの本文は約 10 文字ぶん、空欄の右のボタンは 25 文字ぶん離れていたので、9 文字ぶんまでとする
const RIGHT_MAX_EM = 9
function lineRight(lines, li) {
  const lr = lineRect(lines[li])
  // 語の四角の高さは、漢字・かなは字の大きさの約 9 割、英数字は約 7 割（PIN が遠く見積もられないように分ける）
  const cjk = lines[li].some((w) => /[^\x00-\x7f]/.test(String(w[0] || '')))
  const em = Math.max(4, lr.h) / (cjk ? 0.9 : 0.7)
  let best = -1, bestX = Infinity
  for (let j = 0; j < lines.length; j++) {
    if (j === li) continue
    const r = lineRect(lines[j])
    const gap = r.x - (lr.x + lr.w)
    if (gap < 0 || gap > em * RIGHT_MAX_EM) continue
    // 縦の位置が半分以上重なり、見出しの倍より背が高くない（隣の段落などを拾わない）
    const ov = Math.min(r.y + r.h, lr.y + lr.h) - Math.max(r.y, lr.y)
    if (ov < Math.min(r.h, lr.h) * 0.5 || r.h > Math.max(4, lr.h) * 2) continue
    // 右にあるのが別の見出し（値の欄が空）なら値ではない
    if (labelHits(lines[j]).length) continue
    if (r.x < bestX) { bestX = r.x; best = j }
  }
  return best
}

function wordRect(w) { return { x: +w[1], y: +w[2], w: +w[3], h: +w[4] } }

function lineRect(words) {
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity
  for (const w of words) {
    const r = wordRect(w)
    x1 = Math.min(x1, r.x); y1 = Math.min(y1, r.y)
    x2 = Math.max(x2, r.x + r.w); y2 = Math.max(y2, r.y + r.h)
  }
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 }
}

// 行末まで続いたキーは、ターミナルで次の行へ折り返していることが多い。
// 2行目は sk- などで始まらず当たらないので、真下の行の先頭の語がキーの続きらしければ一緒に隠す
function wrappedTail(lines, li, maxRepeat) {
  const out = []
  let cur = li
  for (let n = 0; n < maxRepeat; n++) {
    const lr = lineRect(lines[cur])
    const h = Math.max(4, lr.h)
    let next = -1, bestY = Infinity
    for (let j = 0; j < lines.length; j++) {
      if (j === cur) continue
      const r = lineRect(lines[j])
      const gap = r.y - (lr.y + lr.h)
      if (r.y <= lr.y + h * 0.5 || gap > h * 1.2) continue
      if (r.y < bestY) { bestY = r.y; next = j }
    }
    if (next < 0) break
    const first = lines[next][0]
    const fr = wordRect(first)
    const t = String(first[0] || '')
    if (!/^[A-Za-z0-9_\-]{4,}$/.test(t)) break
    // 折り返した続きは、元の行より左（行の頭）から始まる
    const lastW = wordRect(lines[cur][lines[cur].length - 1])
    if (fr.x > lastW.x) break
    out.push({ line: next, from: 0, to: 0 })
    // さらに次の行まで続くのは、続きの語が行の右端まで届いている（そこでもまた折り返した）ときだけ
    if (lines[next].length !== 1 || fr.x + fr.w < lr.x + lr.w - h * 2) break
    cur = next
  }
  return out
}

function boxOf(words, from, to) {
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity
  for (let i = from; i <= to; i++) {
    const r = wordRect(words[i])
    x1 = Math.min(x1, r.x); y1 = Math.min(y1, r.y)
    x2 = Math.max(x2, r.x + r.w); y2 = Math.max(y2, r.y + r.h)
  }
  // 語の四角は字にぴったりなので、にじみや読み取りのずれのぶん少し広げる
  const pad = Math.max(2, Math.round((y2 - y1) * 0.2))
  return { x: x1 - pad, y: y1 - pad, w: x2 - x1 + pad * 2, h: y2 - y1 + pad * 2 }
}

function overlapArea(a, b) {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
  return w > 0 && h > 0 ? w * h : 0
}

// 同じ行の重なった四角（別のエンジン・倍率で同じ所を当てたもの）を1つにまとめる
function sameSpot(a, b) {
  const ov = overlapArea(a, b)
  if (!ov) return false
  const vy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
  if (vy >= Math.min(a.h, b.h) * 0.5) return true
  return ov >= Math.min(a.w * a.h, b.w * b.h) * 0.6
}

function mergeBoxes(list) {
  const out = list.map((b) => Object.assign({}, b, { kinds: b.kinds.slice() }))
  let changed = true
  while (changed) {
    changed = false
    for (let i = 0; i < out.length && !changed; i++) {
      for (let j = i + 1; j < out.length; j++) {
        if (!sameSpot(out[i], out[j])) continue
        const a = out[i], b = out[j]
        const x1 = Math.min(a.x, b.x), y1 = Math.min(a.y, b.y)
        const x2 = Math.max(a.x + a.w, b.x + b.w), y2 = Math.max(a.y + a.h, b.y + b.h)
        out[i] = { x: x1, y: y1, w: x2 - x1, h: y2 - y1, kinds: Array.from(new Set(a.kinds.concat(b.kinds))) }
        out.splice(j, 1)
        changed = true
        break
      }
    }
  }
  return out
}

// ユーザー名は「C:\Users\<名前>」の形では探さない（\ が E や ¥ や * に化けるため）。名前だけを部分一致で探す。
// 短すぎる名前や、Users そのものに含まれる名前（user など）は、関係ない所まで当たるので使わない
function usableUserName(name) {
  const n = String(name || '').trim()
  if (n.length < 3) return ''
  if ('users'.includes(n.toLowerCase())) return ''
  return n
}

// 登録した言葉のうち /…/ で囲んだ行は正規表現（/PA\d{9}/ など。後ろに i を付けると大文字小文字を区別しない）。
// 日本語の画面では \ が ¥ と表示されるので、¥・全角の ￥ で打たれても \ として読む
const REGEX_LINE = /^\/(.+)\/(i?)$/

// 正規表現として読めれば RegExp、/…/ の形でなければ null、形は合うが書き間違いなら false
function patternOf(line) {
  const m = REGEX_LINE.exec(String(line || '').normalize('NFKC').replace(/¥/g, '\\').trim())
  if (!m) return null
  try {
    const re = new RegExp(m[1], 'g' + m[2])
    return re.test('') ? false : re   // 空の文字にも当たる式は、どこでも当たってしまうので使わない
  } catch (_) {
    return false
  }
}

function cleanPatterns(list) {
  const out = []
  for (const w of Array.isArray(list) ? list : []) {
    const re = patternOf(w)
    if (re) out.push(re)
  }
  return out
}

function cleanWords(list) {
  const out = []
  for (const w of Array.isArray(list) ? list : []) {
    if (patternOf(w) !== null) continue
    const t = String(w || '').normalize('NFKC').replace(/\s+/g, '')
    if (t.length >= 2 && !out.includes(t)) out.push(t)
  }
  return out
}

// ocr: { width, height, passes: [{ lang, scale, lines: [[[text, x, y, w, h], ...], ...] }] }
// opts: { userName, words, level }（level は LEVELS のどれか。無ければ normal）
// 返り値: [{ x, y, w, h, kinds }]（元の絵の実ピクセル。絵の外にははみ出さない）
function findPrivateBoxes(ocr, opts) {
  if (!ocr || !Array.isArray(ocr.passes)) return []
  const o = {
    userName: usableUserName(opts && opts.userName),
    words: cleanWords(opts && opts.words),
    patterns: cleanPatterns(opts && opts.words),
    level: LEVELS.includes(opts && opts.level) ? opts.level : 'normal',
  }
  const raw = []
  for (const pass of ocr.passes) {
    const lines = (pass.lines || []).filter((l) => Array.isArray(l) && l.length)
    for (let li = 0; li < lines.length; li++) {
      const words = lines[li]
      for (const h of scanLine(words, o)) {
        raw.push(Object.assign(boxOf(words, h.from, h.to), { kinds: [h.kind] }))
        if (h.kind === 'key' && h.to === words.length - 1) {
          for (const t of wrappedTail(lines, li, 3)) {
            raw.push(Object.assign(boxOf(lines[t.line], t.from, t.to), { kinds: ['key'] }))
          }
        }
      }
      if (o.level === 'low') continue
      for (const h of labelHits(words)) {
        if (!h.below) { raw.push(Object.assign(boxOf(words, h.from, h.to), { kinds: ['label'] })); continue }
        // 同じ高さの右を先に見る（表では真下が次の見出しのことがあるため）
        let j = lineRight(lines, li)
        if (j < 0) j = lineBelow(lines, li, h.below)
        if (j >= 0) raw.push(Object.assign(boxOf(lines[j], 0, lines[j].length - 1), { kinds: ['label'] }))
      }
    }
  }
  const W = Number(ocr.width) || Infinity
  const H = Number(ocr.height) || Infinity
  return mergeBoxes(raw).map((b) => {
    const x1 = Math.max(0, Math.floor(b.x)), y1 = Math.max(0, Math.floor(b.y))
    const x2 = Math.min(W, Math.ceil(b.x + b.w)), y2 = Math.min(H, Math.ceil(b.y + b.h))
    return { x: x1, y: y1, w: x2 - x1, h: y2 - y1, kinds: b.kinds }
  }).filter((b) => b.w >= 2 && b.h >= 2)
}

module.exports = { findPrivateBoxes, scanLine, labelHits, luhn, looksRandom, joinWords, patternOf, LEVELS }
