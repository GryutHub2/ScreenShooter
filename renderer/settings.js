'use strict'

const fieldRegion = document.getElementById('keyRegion')
const fieldFull = document.getElementById('keyFull')
const fieldRepeat = document.getElementById('keyRepeat')
const fieldScroll = document.getElementById('keyScroll')
const fieldRecord = document.getElementById('keyRecord')
const fieldDelay = document.getElementById('keyDelay')
const fieldOcr = document.getElementById('keyOcr')
const fieldColor = document.getElementById('keyColor')
const captureCursorEl = document.getElementById('captureCursor')
const recCountdownEl = document.getElementById('recCountdown')
const claudeTranslateEl = document.getElementById('claudeTranslate')
const recAutoBlurEl = document.getElementById('recAutoBlur')
const embedEditsEl = document.getElementById('embedEdits')
const delaySecondsEl = document.getElementById('delaySeconds')
const afterCaptureEl = document.getElementById('afterCapture')
const captureClipboardEl = document.getElementById('captureClipboard')
const exportFinishEl = document.getElementById('exportFinish')
const libOrderEl = document.getElementById('libOrder')
const autoStartEl = document.getElementById('autoStart')
const saveDirEl = document.getElementById('saveDir')
const sendToEl = document.getElementById('sendToMenu')
const snapEl = document.getElementById('snapWindows')
const libLimitEl = document.getElementById('libLimit')
const libThumbEl = document.getElementById('libThumb')
const libThumbVal = document.getElementById('libThumbVal')
const recFpsEl = document.getElementById('recFps')
const gifFpsEl = document.getElementById('gifFps')
const gifWidthEl = document.getElementById('gifWidth')
const recAudioEl = document.getElementById('recAudio')
const autoBlurEl = document.getElementById('autoBlur')
const autoBlurWordsEl = document.getElementById('autoBlurWords')
const autoBlurLabelsEl = document.getElementById('autoBlurLabels')
const autoBlurLevelEl = document.getElementById('autoBlurLevel')
const autoBlurBadEl = document.getElementById('autoBlurBad')
const warnEl = document.getElementById('warn')
const statusEl = document.getElementById('status')

const current = {
  hotkeyRegion: '', hotkeyFull: '', hotkeyScroll: '', hotkeyRecord: '', hotkeyRepeat: '', hotkeyDelay: '', saveDir: '',
  hotkeyOcr: '', hotkeyColor: '', captureCursor: false, recordCountdown: 0, claudeTranslate: false,
  recordAutoBlur: true, embedEdits: true,
  delaySeconds: 5, afterCapture: 'editor', captureClipboard: 'image', exportFinish: 'none', libraryOrder: 'old',
  autoStart: false,
  sendToMenu: false,
  libraryLimit: 300, snapWindows: true, libraryThumbHeight: 104,
  recordFps: 15, gifFps: 10, gifMaxWidth: 0, recordAudio: true,
  autoBlur: true, autoBlurWords: [], autoBlurLabels: [], autoBlurLevel: 'normal',
}

// 欄と、その欄が持っている設定名の対応
const FIELDS = {
  region: { el: fieldRegion, prop: 'hotkeyRegion' },
  repeat: { el: fieldRepeat, prop: 'hotkeyRepeat' },
  full: { el: fieldFull, prop: 'hotkeyFull' },
  scroll: { el: fieldScroll, prop: 'hotkeyScroll' },
  record: { el: fieldRecord, prop: 'hotkeyRecord' },
  delay: { el: fieldDelay, prop: 'hotkeyDelay' },
  ocr: { el: fieldOcr, prop: 'hotkeyOcr' },
  color: { el: fieldColor, prop: 'hotkeyColor' },
}
// 自動起動は、開いたときの状態から切り替えたときだけ本体に頼む（保存のたびにショートカットを作り直さない）
let autoStartLoaded = false
let listening = null   // FIELDS のキー、または null

// ---------------------------------------------------------------- キーの名前

// キーの位置(e.code)から Electron のアクセラレータ名を作る。
// e.key だと IME やキーボード配列で文字が変わってしまうため。
function keyName(e) {
  const c = e.code
  if (/^Key[A-Z]$/.test(c)) return c.slice(3)
  if (/^Digit[0-9]$/.test(c)) return c.slice(5)
  if (/^Numpad[0-9]$/.test(c)) return 'num' + c.slice(6)
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(c)) return c
  const map = {
    Space: 'Space', Tab: 'Tab', Enter: 'Return', Backspace: 'Backspace',
    Insert: 'Insert', Delete: 'Delete', Home: 'Home', End: 'End',
    PageUp: 'PageUp', PageDown: 'PageDown',
    ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
    PrintScreen: 'PrintScreen', Pause: 'Pause',
    Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']',
    Backslash: '\\', Semicolon: ';', Quote: "'",
    Comma: ',', Period: '.', Slash: '/', Backquote: '`',
    NumpadAdd: 'numadd', NumpadSubtract: 'numsub',
    NumpadMultiply: 'nummult', NumpadDivide: 'numdiv', NumpadDecimal: 'numdec',
  }
  return map[c] || null
}

function accelFromEvent(e) {
  const k = keyName(e)
  if (!k) return null
  const parts = []
  if (e.ctrlKey) parts.push('Ctrl')
  if (e.altKey) parts.push('Alt')
  if (e.shiftKey) parts.push('Shift')
  if (e.metaKey) parts.push('Super')
  // 修飾キー無しで割り当てられるのはファンクションキーと PrintScreen だけ。
  // 単独の文字キーを奪うと、どのアプリでも文字が打てなくなるため。
  const standalone = /^F([1-9]|1[0-9]|2[0-4])$/.test(k) || k === 'PrintScreen' || k === 'Pause'
  if (!parts.length && !standalone) return null
  parts.push(k)
  return parts.join('+')
}

// ---------------------------------------------------------------- 表示

function label(accel) { return accel ? accel : '（なし）' }

function render() {
  for (const name of Object.keys(FIELDS)) {
    const f = FIELDS[name]
    f.el.textContent = listening === name ? 'キーを押してください…' : label(current[f.prop])
    f.el.classList.toggle('listening', listening === name)
  }
  saveDirEl.value = current.saveDir
  sendToEl.checked = !!current.sendToMenu
  snapEl.checked = !!current.snapWindows
  libLimitEl.value = current.libraryLimit
  libThumbEl.value = current.libraryThumbHeight
  libThumbVal.textContent = current.libraryThumbHeight + " px"
  recFpsEl.value = String(current.recordFps)
  gifFpsEl.value = String(current.gifFps)
  gifWidthEl.value = String(current.gifMaxWidth)
  recAudioEl.checked = !!current.recordAudio
  autoBlurEl.checked = !!current.autoBlur
  autoBlurLevelEl.value = current.autoBlurLevel
  delaySecondsEl.value = current.delaySeconds
  afterCaptureEl.value = current.afterCapture
  captureClipboardEl.value = current.captureClipboard
  exportFinishEl.value = current.exportFinish
  libOrderEl.value = current.libraryOrder
  autoStartEl.checked = !!current.autoStart
  captureCursorEl.checked = !!current.captureCursor
  recCountdownEl.value = String(current.recordCountdown)
  claudeTranslateEl.checked = !!current.claudeTranslate
  recAutoBlurEl.checked = !!current.recordAutoBlur
  embedEditsEl.checked = !!current.embedEdits
  showBadPatterns()
  // 打っている途中の空行や前後の空白を消さないよう、中身が同じなら書き戻さない
  if (wordsOf(autoBlurWordsEl.value).join('\n') !== current.autoBlurWords.join('\n')) {
    autoBlurWordsEl.value = current.autoBlurWords.join('\n')
  }
  if (wordsOf(autoBlurLabelsEl.value).join('\n') !== current.autoBlurLabels.join('\n')) {
    autoBlurLabelsEl.value = current.autoBlurLabels.join('\n')
  }
}

// 自動でぼかす言葉は1行に1つ。空の行は捨てる
function wordsOf(text) {
  return String(text || '').split(/\r?\n/).map((t) => t.trim()).filter(Boolean)
}

// /…/ で囲んだ行のうち、正規表現として読めないものを知らせる（黙って無視されると効いていると思い込むため）。
// 判定は lib/pii.js の patternOf と同じ
function showBadPatterns() {
  const bad = wordsOf(autoBlurWordsEl.value).filter((line) => {
    const m = /^\/(.+)\/(i?)$/.exec(line.normalize('NFKC').replace(/¥/g, '\\'))
    if (!m) return false
    try { return new RegExp(m[1], m[2]).test('') } catch (_) { return true }
  })
  autoBlurBadEl.hidden = !bad.length
  autoBlurBadEl.textContent = bad.length ? '次の行は正規表現として読めないため使われません： ' + bad.join('　') : ''
}

function startListen(which) {
  listening = which
  statusEl.textContent = 'Esc でやめる'
  render()
}

function stopListen() {
  listening = null
  statusEl.textContent = ''
  render()
}

const CLEAR_BUTTONS = { region: 'clearRegion', repeat: 'clearRepeat', full: 'clearFull', scroll: 'clearScroll', record: 'clearRecord', delay: 'clearDelay', ocr: 'clearOcr', color: 'clearColor' }
for (const name of Object.keys(FIELDS)) {
  FIELDS[name].el.addEventListener('click', () => startListen(name))
  document.getElementById(CLEAR_BUTTONS[name]).addEventListener('click', () => {
    stopListen()
    current[FIELDS[name].prop] = ''
    render()
  })
}

function assign(accel) {
  current[FIELDS[listening].prop] = accel
  stopListen()
}

window.addEventListener('keydown', (e) => {
  if (!listening) return
  e.preventDefault()
  if (e.key === 'Escape') { stopListen(); return }
  const accel = accelFromEvent(e)
  if (!accel) return   // 修飾キーだけを押している間は待ち続ける
  assign(accel)
})

// PrintScreen は Windows では keydown が来ないことがあるので keyup でも拾う
window.addEventListener('keyup', (e) => {
  if (!listening || e.code !== 'PrintScreen') return
  e.preventDefault()
  assign(accelFromEvent(e) || 'PrintScreen')
})

// ---------------------------------------------------------------- 保存先

document.getElementById('pickDir').addEventListener('click', async () => {
  const dir = await window.api.invoke('settings:pickFolder')
  if (dir) { current.saveDir = dir; render() }
})
document.getElementById('openDir').addEventListener('click', () => {
  window.api.invoke('app:openFolder')
})

// ---------------------------------------------------------------- 保存

document.getElementById('btnSave').addEventListener('click', async () => {
  stopListen()
  current.sendToMenu = sendToEl.checked
  current.snapWindows = snapEl.checked
  current.libraryLimit = Math.max(10, Math.min(5000, Number(libLimitEl.value) || 300))
  current.libraryThumbHeight = Math.max(64, Math.min(240, Number(libThumbEl.value) || 104))
  current.recordFps = Number(recFpsEl.value) || 15
  current.gifFps = Number(gifFpsEl.value) || 10
  current.gifMaxWidth = Math.max(0, Number(gifWidthEl.value) || 0)
  current.recordAudio = recAudioEl.checked
  current.autoBlur = autoBlurEl.checked
  current.autoBlurWords = wordsOf(autoBlurWordsEl.value)
  current.autoBlurLabels = wordsOf(autoBlurLabelsEl.value)
  current.autoBlurLevel = autoBlurLevelEl.value
  current.delaySeconds = Math.max(1, Math.min(60, Math.round(Number(delaySecondsEl.value) || 5)))
  current.afterCapture = afterCaptureEl.value
  current.captureClipboard = captureClipboardEl.value
  current.exportFinish = exportFinishEl.value
  current.libraryOrder = libOrderEl.value
  current.autoStart = autoStartEl.checked
  current.captureCursor = captureCursorEl.checked
  current.recordCountdown = Number(recCountdownEl.value) || 0
  current.claudeTranslate = claudeTranslateEl.checked
  current.recordAutoBlur = recAutoBlurEl.checked
  current.embedEdits = embedEditsEl.checked
  const r = await window.api.invoke('settings:save', Object.assign({}, current, { autoStartChanged: current.autoStart !== autoStartLoaded }))
  if (r && typeof r.autoStartNow === 'boolean') {
    autoStartLoaded = r.autoStartNow
    current.autoStart = r.autoStartNow
    autoStartEl.checked = r.autoStartNow
  }
  if (r && r.autoStart && !r.autoStart.ok) {
    warnEl.hidden = false
    warnEl.textContent = '自動起動の設定を変えられませんでした： ' + (r.autoStart.error || '')
    statusEl.textContent = ''
  } else if (r && r.failed && r.failed.length) {
    warnEl.hidden = false
    warnEl.textContent = 'このキーは他のアプリが使っているため登録できませんでした： '
      + r.failed.map((f) => f.accel).join(' / ')
      + '。ScreenPresso など、同じキーを使うソフトを終了するか、別のキーを選んでください。'
    statusEl.textContent = ''
  } else {
    warnEl.hidden = true
    statusEl.textContent = '保存しました'
    setTimeout(() => { statusEl.textContent = '' }, 2500)
  }
})

// つまみを動かしたら数字だけ先に更新する（保存は「保存する」を押したとき）
libThumbEl.addEventListener('input', () => {
  current.libraryThumbHeight = Number(libThumbEl.value) || 104
  libThumbVal.textContent = current.libraryThumbHeight + ' px'
})

// チェックや選択は、触った時点で覚えておく。
// そうしないと、そのあとキーの欄を押したときの描き直しで元に戻ってしまう。
const LIVE = [
  [sendToEl, 'sendToMenu', (el) => el.checked],
  [snapEl, 'snapWindows', (el) => el.checked],
  [libLimitEl, 'libraryLimit', (el) => Math.max(10, Math.min(5000, Number(el.value) || 300))],
  [recFpsEl, 'recordFps', (el) => Number(el.value) || 15],
  [gifFpsEl, 'gifFps', (el) => Number(el.value) || 10],
  [gifWidthEl, 'gifMaxWidth', (el) => Math.max(0, Number(el.value) || 0)],
  [recAudioEl, 'recordAudio', (el) => el.checked],
  [autoBlurEl, 'autoBlur', (el) => el.checked],
  [autoBlurLevelEl, 'autoBlurLevel', (el) => el.value],
  [delaySecondsEl, 'delaySeconds', (el) => Math.max(1, Math.min(60, Math.round(Number(el.value) || 5)))],
  [afterCaptureEl, 'afterCapture', (el) => el.value],
  [captureClipboardEl, 'captureClipboard', (el) => el.value],
  [exportFinishEl, 'exportFinish', (el) => el.value],
  [libOrderEl, 'libraryOrder', (el) => el.value],
  [autoStartEl, 'autoStart', (el) => el.checked],
  [captureCursorEl, 'captureCursor', (el) => el.checked],
  [recCountdownEl, 'recordCountdown', (el) => Number(el.value) || 0],
  [claudeTranslateEl, 'claudeTranslate', (el) => el.checked],
  [recAutoBlurEl, 'recordAutoBlur', (el) => el.checked],
  [embedEditsEl, 'embedEdits', (el) => el.checked],
]
for (const item of LIVE) {
  item[0].addEventListener('change', () => { current[item[1]] = item[2](item[0]) })
}
autoBlurWordsEl.addEventListener('input', () => {
  current.autoBlurWords = wordsOf(autoBlurWordsEl.value)
  showBadPatterns()
})
autoBlurLabelsEl.addEventListener('input', () => {
  current.autoBlurLabels = wordsOf(autoBlurLabelsEl.value)
})

document.getElementById('btnClose').addEventListener('click', () => {
  window.api.send('app:closeWindow')
})

// ---------------------------------------------------------------- 起動

window.api.invoke('settings:get').then((s) => {
  if (!s) return
  current.hotkeyRegion = s.hotkeyRegion || ''
  current.hotkeyFull = s.hotkeyFull || ''
  current.hotkeyScroll = s.hotkeyScroll || ''
  current.hotkeyRecord = s.hotkeyRecord || ''
  current.hotkeyRepeat = s.hotkeyRepeat || ''
  current.hotkeyDelay = s.hotkeyDelay || ''
  current.hotkeyOcr = s.hotkeyOcr || ''
  current.hotkeyColor = s.hotkeyColor || ''
  current.captureCursor = !!s.captureCursor
  current.recordCountdown = [0, 3, 5].includes(Number(s.recordCountdown)) ? Number(s.recordCountdown) : 0
  current.claudeTranslate = !!s.claudeTranslate
  current.recordAutoBlur = s.recordAutoBlur !== false
  current.embedEdits = s.embedEdits !== false
  current.delaySeconds = Number(s.delaySeconds) || 5
  current.afterCapture = s.afterCapture === 'library' ? 'library' : 'editor'
  current.captureClipboard = ['off', 'image', 'imagePath', 'path'].includes(s.captureClipboard) ? s.captureClipboard : 'image'
  current.exportFinish = ['none', 'border', 'round', 'shadow', 'backdrop'].includes(s.exportFinish) ? s.exportFinish : 'none'
  current.libraryOrder = ['old', 'new', 'name'].includes(s.libraryOrder) ? s.libraryOrder : 'old'
  current.autoStart = !!s.autoStart
  autoStartLoaded = current.autoStart
  current.saveDir = s.saveDir || ''
  current.sendToMenu = !!s.sendToMenu
  current.snapWindows = s.snapWindows !== false
  current.libraryLimit = Number(s.libraryLimit) || 300
  current.libraryThumbHeight = Number(s.libraryThumbHeight) || 104
  current.recordFps = Number(s.recordFps) || 15
  current.gifFps = Number(s.gifFps) || 10
  current.gifMaxWidth = Number.isFinite(Number(s.gifMaxWidth)) ? Number(s.gifMaxWidth) : 0
  current.recordAudio = s.recordAudio !== false
  current.autoBlur = s.autoBlur !== false
  current.autoBlurWords = Array.isArray(s.autoBlurWords) ? s.autoBlurWords.filter((w) => typeof w === 'string') : []
  current.autoBlurLabels = Array.isArray(s.autoBlurLabels) ? s.autoBlurLabels.filter((w) => typeof w === 'string') : []
  current.autoBlurLevel = ['low', 'normal', 'high'].includes(s.autoBlurLevel) ? s.autoBlurLevel : 'normal'
  render()
})
