'use strict'

const strip = document.getElementById('strip')
const emptyEl = document.getElementById('empty')
const btnPin = document.getElementById('btnPin')
const countEl = document.getElementById('count')
const dkOpen = document.getElementById('dkOpen')

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

  // 一覧は新しい順で届く。並べるのは設定の並び順（既定は古い順＝最新が右下）
  for (const it of shown) {
    const card = document.createElement('div')
    card.className = 'card' + (selected.has(it.id) ? ' on' : '')
    card.dataset.id = it.id
    card.draggable = true
    const isVideo = it.kind === 'video'
    card.title = (it.name ? it.name + '\n' : '')
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
    cap.textContent = timeLabel(it.createdAt)

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
  window.api.send('library:menu', orderedSelection())
})

window.addEventListener('keydown', (e) => {
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

window.api.on('library:items', render)
window.api.invoke('library:list')
  .then((d) => { if (d) render(d) })
  .catch((err) => console.warn('履歴の読み込みに失敗:', err))
