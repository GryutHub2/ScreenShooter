'use strict'

const strip = document.getElementById('strip')
const emptyEl = document.getElementById('empty')
const btnPin = document.getElementById('btnPin')
const countEl = document.getElementById('count')
const dkOpen = document.getElementById('dkOpen')
const searchEl = document.getElementById('search')

let items = []   // 本体から届いた順（新しい順）
let shown = []   // 画面に並べている順（設定の並び順）
let order = 'old'
let lastNewestId  // いちばん新しい履歴の ID。増えたときだけ一番下まで送るため
const selected = new Set()  // 選んでいるものの ID
let anchorId = null         // Shift+クリックの起点（最後にふつうに押したもの）
let heldId = null           // 押した時点では絞らず、離すまで待っているもの
let dragging = false

function timeLabel(ms) {
  if (!ms) return ''
  const d = new Date(ms)
  const p = (n) => String(n).padStart(2, '0')
  const today = new Date()
  const sameDay = d.getFullYear() === today.getFullYear()
    && d.getMonth() === today.getMonth() && d.getDate() === today.getDate()
  const hm = p(d.getHours()) + ':' + p(d.getMinutes())
  return sameDay ? hm : (d.getMonth() + 1) + '/' + d.getDate() + ' ' + hm
}

// ---------------------------------------------------------------- 外の画像を落とし込む

// 落とされた画像は、保存先フォルダにコピーしてから履歴に入れて開く（本体側の library:import）。
// 出しっぱなしにならないよう、案内は dragover が途切れたら必ず消す
const dropHint = document.getElementById('dropHint')
let dropTimer = null

function showDrop(on) {
  dropHint.hidden = !on
  clearTimeout(dropTimer)
  if (on) dropTimer = setTimeout(() => { dropHint.hidden = true }, 400)
}

function hasFiles(e) {
  return !!(e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files'))
}

window.addEventListener('dragover', (e) => {
  if (!hasFiles(e)) return
  e.preventDefault()
  e.dataTransfer.dropEffect = 'copy'
  showDrop(true)
})

window.addEventListener('drop', (e) => {
  if (!hasFiles(e)) return
  e.preventDefault()
  showDrop(false)
  const paths = []
  for (const f of e.dataTransfer.files) {
    const p = window.api.filePath(f)
    if (p) paths.push(p)
  }
  if (paths.length) window.api.send('library:import', paths)
})

// サムネイルの大きさは設定から来る。マス目の幅も同じ比率で広げる
function applyThumbHeight(h) {
  const px = Math.max(64, Math.min(240, Number(h) || 104))
  const root = document.documentElement
  root.style.setProperty('--thumb-h', px + 'px')
  root.style.setProperty('--cell-w', Math.round(px * 2.08) + 'px')
}

function lengthLabel(ms) {
  const s = Math.max(0, Math.round((ms || 0) / 1000))
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0')
}

// ---------------------------------------------------------------- 選ぶ（複数可）

// 本体へ渡す順は、クリックした順ではなく一覧に並んでいる順にそろえる。
// 落とし先のアプリでの並びが毎回変わらないようにするため
function orderedSelection() {
  return shown.filter((it) => selected.has(it.id)).map((it) => it.id)
}

// 並び順。'old' = 古い→新しい（Screenpresso と同じく最新が右下）／'new' = 新しい→古い（最新が左上）／'name' = 名前順
function sortFor(list, how) {
  if (how === 'new') return list.slice()
  if (how === 'name') {
    return list.slice().sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'ja', { numeric: true }))
  }
  return list.slice().reverse()
}

function paint() {
  for (const el of strip.querySelectorAll('.card')) el.classList.toggle('on', selected.has(el.dataset.id))
  syncDock()
}

function selectOnly(id) {
  selected.clear()
  if (id) selected.add(id)
  anchorId = id || null
  paint()
}

function toggleOne(id) {
  if (selected.has(id)) selected.delete(id)
  else selected.add(id)
  anchorId = id
  paint()
}

// 起点から押した所までをまとめて選ぶ。起点は動かさない（続けて Shift で伸び縮みさせられるように）
function selectRange(id) {
  const a = shown.findIndex((x) => x.id === (anchorId || id))
  const b = shown.findIndex((x) => x.id === id)
  if (a < 0 || b < 0) { selectOnly(id); return }
  selected.clear()
  for (let i = Math.min(a, b); i <= Math.max(a, b); i++) selected.add(shown[i].id)
  paint()
}

function selectAll() {
  selected.clear()
  for (const it of items) selected.add(it.id)
  if (!anchorId || !selected.has(anchorId)) anchorId = shown.length ? shown[0].id : null
  paint()
}

// 下のボタン列の「編集」は、選んだものが録画なら「再生」になる。
// 開けるのはちょうど1つ選んでいるときだけ（何枚も選んだまま押して編集画面がいくつも開かないように）。
// 消したあとは選択が残らないので、一覧に無い ID なら押せなくなる
function syncDock() {
  const n = selected.size
  const only = n === 1 ? items.find((x) => selected.has(x.id)) : null
  dkOpen.disabled = !only
  const isVideo = !!(only && only.kind === 'video')
  dkOpen.querySelector('.lab').textContent = isVideo ? '再生' : '編集'
  // SVG は el.hidden = true が効かない（HTMLElement のプロパティなので）。属性で切り替える
  dkOpen.querySelector('.icEdit').toggleAttribute('hidden', isVideo)
  dkOpen.querySelector('.icPlay').toggleAttribute('hidden', !isVideo)
  dkOpen.title = only
    ? (isVideo ? '選んだ録画を再生する' : '選んだ1枚を編集画面で開く')
    : (n > 1 ? '開けるのは1つずつ。まとめて渡すならドラッグ' : '開きたいものを1回押して選ぶ')
  countEl.hidden = n < 2
  countEl.textContent = n + '件えらび中'
}

function render(data) {
  items = (data && data.items) || []
  order = (data && data.order) || 'old'
  shown = sortFor(items, order)
  if (data && data.thumbHeight) applyThumbHeight(data.thumbHeight)
  btnPin.classList.toggle('on', !!(data && data.pinned))

  // 消えたものが選ばれたまま残ると、ドラッグで無いファイルを渡そうとすることになる
  const alive = new Set(items.map((x) => x.id))
  for (const id of Array.from(selected)) if (!alive.has(id)) selected.delete(id)
  if (anchorId && !alive.has(anchorId)) anchorId = null

  for (const el of Array.from(strip.querySelectorAll('.card'))) el.remove()
  emptyEl.hidden = items.length > 0
  emptyEl.textContent = searchEl.value.trim() ? '「' + searchEl.value.trim() + '」に当てはまるものはありません。' : emptyEl.dataset.text || emptyEl.textContent
  if (!emptyEl.dataset.text && !searchEl.value.trim()) emptyEl.dataset.text = emptyEl.textContent

  // 一覧は新しい順で届く。並べるのは設定の並び順（既定は古い順＝最新が右下）
  for (const it of shown) {
    const card = document.createElement('div')
    card.className = 'card' + (selected.has(it.id) ? ' on' : '')
    card.dataset.id = it.id
    card.draggable = true
    const isVideo = it.kind === 'video'
    card.title = (it.title ? it.title + '\n' : '') + (it.name ? it.name + '\n' : '')
      + (it.tags && it.tags.length ? 'タグ：' + it.tags.join('、') + '\n' : '')
      + it.width + ' × ' + it.height + ' px　' + timeLabel(it.createdAt)
      + (it.savedPath ? '\n' + it.savedPath : '')
      + '\nドラッグで他のアプリへ渡せる（原寸のファイル。何枚か選んでいればまとめて渡る）'
      + '\nCtrl+C でコピー（書き込みも入った絵）'
      + '\nCtrl+クリックで足し引き／Shift+クリックでそこまでまとめて選ぶ'

    if (isVideo) {
      card.title = '録画　' + lengthLabel(it.durationMs) + '　' + card.title
        + '\nダブルクリックで再生／右クリックで GIF・動画を保存'
    }

    const shot = document.createElement('span')
    shot.className = 'shot'
    const img = document.createElement('img')
    if (it.thumb) img.src = it.thumb
    img.alt = ''
    shot.appendChild(img)
    if (isVideo) {
      const play = document.createElement('span')
      play.className = 'play'
      shot.appendChild(play)
      const len = document.createElement('span')
      len.className = 'mark len'
      len.textContent = lengthLabel(it.durationMs)
      shot.appendChild(len)
    } else if (it.shapeCount > 0) {
      const mark = document.createElement('span')
      mark.className = 'mark'
      mark.textContent = '書き込み ' + it.shapeCount
      shot.appendChild(mark)
    }

    const cap = document.createElement('span')
    cap.className = 'cap'
    // タイトルを付けたものは、時刻の代わりにタイトルを出す
    cap.textContent = it.title ? it.title : timeLabel(it.createdAt)
    if (it.title) cap.classList.add('titled')

    card.appendChild(shot)
    card.appendChild(cap)
    strip.appendChild(card)
  }

  paint()
  // 新しいものが増えたときだけ最新まで送る。消した・名前を変えたなどでは、見ていた位置を動かさない
  const newest = items.length ? items[0].id : null
  if (newest !== lastNewestId) scrollToNewest()
  lastNewestId = newest
}

// 最新は、古い順なら一番下、新しい順なら一番上。名前順では最新の居場所が決まらないので動かさない
function scrollToNewest() {
  if (order === 'old') strip.scrollTop = strip.scrollHeight
  else if (order === 'new') strip.scrollTop = 0
}

// パネルを出し直したときも最新が見える位置から始める
document.addEventListener('visibilitychange', () => { if (!document.hidden) scrollToNewest() })

function cardIdFrom(target) {
  const card = target.closest ? target.closest('.card') : null
  return card ? card.dataset.id : null
}

// 選び直すのは click ではなく mousedown。ドラッグは押した時点で始まるので、
// click を待っていると「何枚か選んでからまとめてドラッグ」に間に合わない。
// ただし「すでに選んである中の1枚」を押したときだけは離すまで待つ。
// ここで1枚に絞ってしまうと、選んだ分をまとめてドラッグできなくなる
strip.addEventListener('mousedown', (e) => {
  const id = cardIdFrom(e.target)
  heldId = null
  dragging = false
  if (!id) {
    // 縦スクロールバーを掴んだだけのときに選択を消さない
    if (e.target === strip && e.offsetX >= strip.clientWidth) return
    if (e.button === 0 && !e.ctrlKey && !e.shiftKey) selectOnly(null)
    return
  }
  // 右クリックは、選んである中の1枚なら選択をそのまま残す（まとめて消すため）
  if (e.button === 2) {
    if (!selected.has(id)) selectOnly(id)
    return
  }
  if (e.button !== 0) return
  if (e.ctrlKey) { toggleOne(id); return }
  if (e.shiftKey) { selectRange(id); return }
  if (selected.has(id) && selected.size > 1) { heldId = id; return }
  selectOnly(id)
})

strip.addEventListener('mouseup', (e) => {
  if (e.button !== 0) return
  // ドラッグせずに離したなら、押した1枚だけに絞る
  if (heldId && !dragging) selectOnly(heldId)
  heldId = null
})

strip.addEventListener('dblclick', (e) => {
  const id = cardIdFrom(e.target)
  if (id) window.api.send('library:open', id)
})

// 外へドラッグしたときは、サムネイルではなく保存先の本物のファイルを渡す。
// ここで止めないと、Chromium が <img> の元（小さい thumb.png）を持っていってしまう
strip.addEventListener('dragstart', (e) => {
  e.preventDefault()
  const id = cardIdFrom(e.target)
  if (!id) return
  dragging = true
  heldId = null
  if (!selected.has(id)) selectOnly(id)
  window.api.send('library:drag', orderedSelection())
})

strip.addEventListener('contextmenu', (e) => {
  e.preventDefault()
  const id = cardIdFrom(e.target)
  if (!id) return
  if (!selected.has(id)) selectOnly(id)
  menuAt = { x: e.clientX, y: e.clientY }
  window.api.send('library:menu', orderedSelection())
})

window.addEventListener('keydown', (e) => {
  if (!ctxMenu.hidden) { menuKey(e); return }
  // 入力欄の中では、文字を打つ・消すのを邪魔しない
  if (!infoForm.hidden) {
    if (e.target === tagInput && tagKey(e)) return
    if (e.key === 'Escape') { e.preventDefault(); closeInfo() }
    else if (e.key === 'Enter') { e.preventDefault(); submitInfo() }
    return
  }
  if (e.target === searchEl) {
    if (e.key === 'Escape') { e.preventDefault(); searchEl.value = ''; sendQuery(); searchEl.blur() }
    return
  }
  if ((e.ctrlKey || e.metaKey) && (e.key === 'f' || e.key === 'F')) { e.preventDefault(); searchEl.focus(); searchEl.select(); return }
  if (e.key === 'F2') {
    e.preventDefault()
    const ids = orderedSelection()
    if (ids.length === 1) window.api.send('library:askInfo', { id: ids[0], what: 'rename' })
    return
  }
  if (e.key === 'Escape') { selectOnly(null); return }
  if ((e.ctrlKey || e.metaKey) && (e.key === 'a' || e.key === 'A')) {
    e.preventDefault()
    selectAll()
    return
  }
  // クリップボードの画像を一覧に足す（編集画面は開かない）
  if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === 'v' || e.key === 'V')) {
    e.preventDefault()
    if (!e.repeat) window.api.send('library:paste')
    return
  }
  // 押しっぱなしの連打は1回ぶんだけ（書き込み入りの絵は作るのに時間がかかるので、溜めない）
  if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === 'c' || e.key === 'C')) {
    e.preventDefault()
    if (!e.repeat) window.api.send('library:copy', orderedSelection())
  }
})

// コピーの結果など、本体から届く短いお知らせ
const toastEl = document.getElementById('toast')
let toastTimer = null

window.api.on('library:toast', (msg) => {
  toastEl.textContent = String(msg || '')
  toastEl.hidden = !msg
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { toastEl.hidden = true }, 2600)
})

btnPin.addEventListener('click', () => {
  const next = !btnPin.classList.contains('on')
  btnPin.classList.toggle('on', next)
  window.api.send('library:pin', next)
})

// 下のボタン列。撮影系は本体側でパネルを引っ込めてから始める（写り込まないように）
document.getElementById('dkRegion').addEventListener('click', () => window.api.send('library:action', 'region'))
document.getElementById('dkRepeat').addEventListener('click', () => window.api.send('library:action', 'repeat'))
document.getElementById('dkScroll').addEventListener('click', () => window.api.send('library:action', 'scroll'))
document.getElementById('dkRecord').addEventListener('click', () => window.api.send('library:action', 'record'))
document.getElementById('dkSettings').addEventListener('click', () => window.api.send('library:action', 'settings'))
dkOpen.addEventListener('click', () => {
  const ids = orderedSelection()
  if (ids.length === 1) window.api.send('library:open', ids[0])
})
document.getElementById('dkFolder').addEventListener('click', () => window.api.invoke('app:openFolder'))
document.getElementById('dkClose').addEventListener('click', () => window.api.send('app:closeWindow'))

// ---- 絞り込み。打つたびに本体へ送る（履歴全体から探して、当てはまるものを最大80件届けてくる）
let queryTimer = null
function sendQuery() {
  clearTimeout(queryTimer)
  window.api.send('library:query', searchEl.value)
}
searchEl.addEventListener('input', () => {
  clearTimeout(queryTimer)
  queryTimer = setTimeout(sendQuery, 200)
})

// ---- 名前を変える・タイトルとタグ
const infoForm = document.getElementById('infoForm')
const infoErr = document.getElementById('infoErr')
let infoFor = null   // { id, what }

function closeInfo() {
  infoForm.hidden = true
  infoFor = null
  hideSuggest()
}

// ---- タグの欄。付けたタグは札（×で外す）で並べ、打っている途中の文字で、付けてあるタグから候補を出す。
// 候補から選べば言い回しのばらつきでタグが増えない。候補に無い言葉は Enter・読点・空白でそのまま新しいタグになる
const tagInput = document.getElementById('infoTags')
const tagChips = document.getElementById('tagChips')
const tagSuggest = document.getElementById('tagSuggest')
const TAG_SEP = /[,、，\s]+/
let tagList = []
let allTags = []      // [{ tag, n }] 多く使われている順
let suggestions = []
let suggestOn = -1

function splitTags(s) {
  return String(s || '').split(TAG_SEP).map((t) => t.trim()).filter(Boolean)
}
function setTags(list) {
  tagList = []
  for (const t of list) if (t && !tagList.includes(t)) tagList.push(t)
  tagChips.textContent = ''
  for (const t of tagList) {
    const chip = document.createElement('span')
    chip.className = 'chip'
    chip.textContent = t
    const x = document.createElement('button')
    x.type = 'button'
    x.textContent = '×'
    x.title = 'このタグを外す'
    x.addEventListener('mousedown', (e) => e.preventDefault())   // 入力欄からフォーカスを奪わない
    x.addEventListener('click', () => { setTags(tagList.filter((v) => v !== t)); showSuggest() })
    chip.appendChild(x)
    tagChips.appendChild(chip)
  }
  tagInput.value = ''
}
function addTag(t) {
  t = String(t || '').trim().slice(0, 40)
  if (t) setTags(tagList.concat([t]))
  showSuggest()
}
async function loadAllTags() {
  try { allTags = (await window.api.invoke('library:allTags')) || [] } catch (_) { allTags = [] }
  if (document.activeElement === tagInput) showSuggest()
}
// 打った文字を含むタグ（頭から合うものを先に）。何も打っていなければ、よく使うものから
function showSuggest() {
  const q = tagInput.value.trim().toLowerCase()
  const left = allTags.filter((x) => !tagList.includes(x.tag))
  const hit = q ? left.filter((x) => x.tag.toLowerCase().includes(q)) : left
  if (q) hit.sort((a, b) => (b.tag.toLowerCase().startsWith(q) - a.tag.toLowerCase().startsWith(q)) || b.n - a.n)
  suggestions = hit.slice(0, 30)
  suggestOn = q && suggestions.length ? 0 : -1
  tagSuggest.textContent = ''
  for (const [k, x] of suggestions.entries()) {
    const row = document.createElement('div')
    row.className = 'sg' + (k === suggestOn ? ' on' : '')
    const name = document.createElement('span')
    const at = q ? x.tag.toLowerCase().indexOf(q) : -1
    if (at >= 0) {
      name.append(x.tag.slice(0, at))
      const b = document.createElement('b')
      b.textContent = x.tag.slice(at, at + q.length)
      name.append(b, x.tag.slice(at + q.length))
    } else name.textContent = x.tag
    const n = document.createElement('span')
    n.className = 'n'
    n.textContent = x.n + '件'
    row.append(name, n)
    row.addEventListener('mousedown', (e) => { e.preventDefault(); addTag(x.tag) })
    tagSuggest.appendChild(row)
  }
  tagSuggest.hidden = !suggestions.length || document.activeElement !== tagInput
}
function hideSuggest() { tagSuggest.hidden = true; suggestOn = -1 }
function moveSuggest(d) {
  if (!suggestions.length) return
  suggestOn = (suggestOn + d + suggestions.length) % suggestions.length
  tagSuggest.querySelectorAll('.sg').forEach((el, k) => el.classList.toggle('on', k === suggestOn))
  const el = tagSuggest.children[suggestOn]
  if (el) el.scrollIntoView({ block: 'nearest' })
}
// タグの欄で使ったキーは true を返す（ほかの処理に回さない）
function tagKey(e) {
  if (e.isComposing) return true   // 変換中の Enter は確定に使う
  const open = !tagSuggest.hidden
  if (e.key === 'ArrowDown') { e.preventDefault(); if (!open) showSuggest(); else moveSuggest(1); return true }
  if (e.key === 'ArrowUp' && open) { e.preventDefault(); moveSuggest(-1); return true }
  if (e.key === 'Escape' && open) { e.preventDefault(); hideSuggest(); return true }
  if (e.key === 'Enter' && (suggestOn >= 0 || tagInput.value.trim())) {
    e.preventDefault()
    addTag(suggestOn >= 0 ? suggestions[suggestOn].tag : tagInput.value)
    return true
  }
  if (e.key === 'Backspace' && !tagInput.value && tagList.length) {
    e.preventDefault()
    setTags(tagList.slice(0, -1))
    showSuggest()
    return true
  }
  return false
}
// 読点・空白・カンマを打ったら、その前までを1つのタグにする。日本語の変換中は区切らない（確定してから）
function splitTyped() {
  if (!TAG_SEP.test(tagInput.value)) return
  const parts = tagInput.value.split(TAG_SEP)
  const rest = parts.pop()
  setTags(tagList.concat(parts.map((t) => t.trim()).filter(Boolean)))
  tagInput.value = rest
}
tagInput.addEventListener('input', (e) => {
  if (!e.isComposing) splitTyped()
  showSuggest()
})
tagInput.addEventListener('compositionend', () => { splitTyped(); showSuggest() })
tagInput.addEventListener('focus', showSuggest)
tagInput.addEventListener('blur', hideSuggest)
document.getElementById('tagBox').addEventListener('mousedown', (e) => {
  if (e.target.id === 'tagBox' || e.target.id === 'tagChips') { e.preventDefault(); tagInput.focus() }
})

// ---- 右クリックメニュー。本体が送ってくる項目を、右クリックした所に出す（パネルからはみ出す分は内側へ寄せる）
const ctxMenu = document.getElementById('ctxMenu')
let menuAt = { x: 0, y: 0 }
let menuOn = -1

function closeMenu() { ctxMenu.hidden = true; menuOn = -1 }
function pickMenu(i) {
  closeMenu()
  window.api.send('library:menuPick', i)
}
function menuRows() { return Array.from(ctxMenu.querySelectorAll('.mi:not(.off)')) }
function menuKey(e) {
  e.preventDefault()
  const rows = menuRows()
  if (e.key === 'Escape') { closeMenu(); return }
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    if (!rows.length) return
    menuOn = (menuOn + (e.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length
    ctxMenu.querySelectorAll('.mi').forEach((el) => el.classList.toggle('on', el === rows[menuOn]))
    return
  }
  if (e.key === 'Enter' && rows[menuOn]) pickMenu(Number(rows[menuOn].dataset.i))
}
window.api.on('library:showMenu', (items) => {
  ctxMenu.textContent = ''
  for (const it of items || []) {
    if (it.sep) {
      const sep = document.createElement('div')
      sep.className = 'msep'
      ctxMenu.appendChild(sep)
      continue
    }
    const row = document.createElement('div')
    row.className = 'mi' + (it.enabled ? '' : ' off')
    row.dataset.i = it.i
    const label = document.createElement('span')
    label.textContent = it.label
    row.appendChild(label)
    if (it.accel) {
      const acc = document.createElement('span')
      acc.className = 'acc'
      acc.textContent = it.accel
      row.appendChild(acc)
    }
    if (it.enabled) row.addEventListener('click', () => pickMenu(it.i))
    row.addEventListener('mouseenter', () => { menuOn = -1; ctxMenu.querySelectorAll('.mi.on').forEach((el) => el.classList.remove('on')) })
    ctxMenu.appendChild(row)
  }
  ctxMenu.style.left = '0px'
  ctxMenu.style.top = '0px'
  ctxMenu.hidden = false
  const w = ctxMenu.offsetWidth, h = ctxMenu.offsetHeight
  const x = menuAt.x + w + 4 <= window.innerWidth ? menuAt.x : Math.max(4, menuAt.x - w)
  const y = menuAt.y + h + 4 <= window.innerHeight ? menuAt.y : Math.max(4, window.innerHeight - h - 4)
  ctxMenu.style.left = x + 'px'
  ctxMenu.style.top = y + 'px'
})
// メニューの外を押したら閉じる（押した所の操作は普段どおり通す）
window.addEventListener('mousedown', (e) => { if (!ctxMenu.hidden && !ctxMenu.contains(e.target)) closeMenu() }, true)
window.addEventListener('blur', closeMenu)

window.api.on('library:editInfo', (d) => {
  if (!d) return
  infoFor = { id: d.id, what: d.what }
  const rename = d.what === 'rename'
  document.getElementById('infoTitle').textContent = rename ? '名前を変える（保存先のファイルの名前も変わります）' : 'タイトル・タグを付ける（絞り込みで探せます）'
  document.getElementById('rowName').hidden = !rename
  document.getElementById('rowTitle').hidden = rename
  document.getElementById('rowTags').hidden = rename
  document.getElementById('infoName').value = d.name || ''
  document.getElementById('infoExt').textContent = d.ext || ''
  document.getElementById('infoTitleIn').value = d.title || ''
  setTags(Array.isArray(d.tags) ? d.tags : [])
  if (!rename) loadAllTags()
  infoErr.textContent = ''
  infoForm.hidden = false
  const first = document.getElementById(rename ? 'infoName' : 'infoTitleIn')
  first.focus()
  first.select()
})

async function submitInfo() {
  if (!infoFor) return
  let r = null
  if (infoFor.what === 'rename') {
    r = await window.api.invoke('library:rename', { id: infoFor.id, name: document.getElementById('infoName').value })
  } else {
    r = await window.api.invoke('library:saveInfo', {
      id: infoFor.id,
      title: document.getElementById('infoTitleIn').value,
      tags: tagList.concat(splitTags(tagInput.value)),
    })
  }
  if (r && r.ok) closeInfo()
  else infoErr.textContent = (r && r.error) || 'できませんでした'
}
document.getElementById('infoOk').addEventListener('click', submitInfo)
document.getElementById('infoCancel').addEventListener('click', closeInfo)

window.api.on('library:items', render)
window.api.invoke('library:list')
  .then((d) => { if (d) render(d) })
  .catch((err) => console.warn('履歴の読み込みに失敗:', err))
