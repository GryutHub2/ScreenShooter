'use strict'

// 画面を録って、動画(MP4)と GIF を同時に作る。
//
// 取り込みは画面まるごと来るので、選んだ範囲だけを canvas に描き直して切り抜く。
// その canvas から動画を録り、同じ絵を GIF にも足していく（既定では縮めない）。
// GIF は 1コマ数ミリ秒で作れるので、録りながら作っても間に合う（録り終わった時点で完成している）。

const barEl = document.getElementById('bar')
const doneEl = document.getElementById('done')
const dotEl = document.getElementById('dot')
const timeEl = document.getElementById('time')
const noteEl = document.getElementById('note')
const statEl = document.getElementById('stat')
const msgEl = document.getElementById('msg')
const prevEl = document.getElementById('prev')
const srcEl = document.getElementById('src')
const cv = document.getElementById('cv')
const gcv = document.getElementById('gcv')
const tcv = document.getElementById('tcv')

const ctx = cv.getContext('2d', { alpha: false })
const gctx = gcv.getContext('2d', { alpha: false, willReadFrequently: true })

// 上から順に試して、この PC が録れる形式を使う。
// MP4(H.264) は Windows のプレイヤーや PowerPoint でそのまま開けるので最優先。
const MIMES_AV = [
  'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
  'video/mp4',
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
]
const MIMES_V = [
  'video/mp4;codecs=avc1.42E01E',
  'video/mp4',
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
]

const GIF_MAX_BYTES = 300 * 1024 * 1024

// 「容量優先」の GIF。絵が大きく入れ替わる録画でも MP4 の 1/4 ほどになる（4K 全画面 34 秒で MP4 22MB → GIF 約5MB）。
// 横幅・コマ数は設定の値とこちらの小さいほうを使う。網掛けは消す（細かい模様が LZW でほとんど縮まないため）
const GIF_SMALL = { width: 800, fps: 5, colors: 128, dither: false, tolerance: 6 }

let cfg = null
let stream = null
let recorder = null
let chunks = []
let mime = ''
let drawTimer = null
let gifTimer = null
let tickTimer = null
let gif = null
let gifFull = false
let startAt = 0
let lastGifAt = 0
let durationMs = 0
let videoBlob = null
let gifBytes = null
let entryId = null
let savedPaths = { video: null, gif: null }   // 録り終わった時点で保存先に置いたファイル
let phase = 'prep'   // prep → rec → done
let srcRect = null
let outW = 0
let outH = 0
let gifW = 0
let gifFps = 10
let gifH = 0
let hasAudio = false
let paused = false
let blurBoxes = []     // 録画中の自動ぼかし。録る範囲の実ピクセルの四角（本体が読み取るたびに届く）
const pcv = document.createElement('canvas')
let pausedAt = 0       // 一時停止した時刻
let pausedTotal = 0    // 止めていた時間の合計（経過時間と長さから引く）
const btnPause = document.getElementById('btnPause')

// ---------------------------------------------------------------- 表示

function mmss(ms) {
  const s = Math.floor(ms / 1000)
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0')
}

function sizeLabel(bytes) {
  if (!bytes) return '0'
  if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' KB'
  return (bytes / 1024 / 1024).toFixed(1) + ' MB'
}

function fail(text, detail) {
  phase = 'done'
  window.api.send('record:error', { message: text, detail: detail || '' })
}

// ---------------------------------------------------------------- 録画

window.api.on('record:init', (d) => {
  cfg = d
  blurBoxes = Array.isArray(d.blurBoxes) ? d.blurBoxes : []
  start().catch((err) => fail('録画を始められませんでした', String(err && err.message ? err.message : err)))
})

window.api.on('record:stop', () => { if (phase === 'rec') stop() })
window.api.on('record:pause', () => togglePause())
window.api.on('record:blur', (boxes) => { blurBoxes = Array.isArray(boxes) ? boxes : [] })

// 一時停止。録画機を止め、絵の描き直しと GIF のコマ足しも止める（止めている間の絵は動画にも GIF にも入らない）
function togglePause() {
  if (phase !== 'rec' || !recorder) return
  const now = performance.now()
  if (!paused) {
    paused = true
    pausedAt = now
    try { recorder.pause() } catch (_) {}
    clearInterval(drawTimer); clearInterval(gifTimer)
    dotEl.classList.add('off')
    noteEl.textContent = '一時停止中'
    btnPause.textContent = '再開'
  } else {
    paused = false
    pausedTotal += now - pausedAt
    // 再開した瞬間のコマが、止めていた時間ぶん長く表示されないようにする
    lastGifAt = now
    draw()
    try { recorder.resume() } catch (_) {}
    drawTimer = setInterval(draw, Math.max(16, Math.round(1000 / cfg.fps)))
    gifTimer = setInterval(addGifFrame, Math.max(40, Math.round(1000 / gifFps)))
    dotEl.classList.remove('off')
    noteEl.textContent = hasAudio ? '録画中（音あり）' : '録画中（音なし）'
    btnPause.textContent = '一時停止'
  }
  window.api.send('record:state', { recording: true, paused })
}

// 止めていた時間を除いた、録れている長さ
function elapsed() {
  const now = paused ? pausedAt : performance.now()
  return now - startAt - pausedTotal
}

async function start() {
  // 音は「パソコンで鳴っている音」。取り込めない環境もあるので、駄目なら映像だけで続ける
  const wantAudio = cfg.audio !== false
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: { ideal: cfg.fps } },
      audio: wantAudio,
    })
  } catch (err) {
    if (!wantAudio) throw err
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: { ideal: cfg.fps } },
      audio: false,
    })
  }
  hasAudio = stream.getAudioTracks().length > 0
  srcEl.srcObject = stream
  await srcEl.play()

  // 取り込んだ映像が画面の実ピクセルと同じ大きさとは限らないので、実測の比で換算する
  const k = srcEl.videoWidth / cfg.displayW
  srcRect = {
    x: Math.round(cfg.crop.x * k),
    y: Math.round(cfg.crop.y * k),
    w: Math.round(cfg.crop.width * k),
    h: Math.round(cfg.crop.height * k),
  }
  // H.264 は縦横が偶数でないと録れない
  outW = Math.max(2, srcRect.w - (srcRect.w % 2))
  outH = Math.max(2, srcRect.h - (srcRect.h % 2))
  cv.width = outW
  cv.height = outH

  // 0 は「縮めない」。容量優先のときは GIF_SMALL.width より大きくしない
  const small = cfg.gifSize !== 'quality'
  let gifLimit = Number(cfg.gifMaxWidth) > 0 ? Number(cfg.gifMaxWidth) : outW
  if (small) gifLimit = Math.min(gifLimit, GIF_SMALL.width)
  gifFps = small ? Math.min(cfg.gifFps || 10, GIF_SMALL.fps) : (cfg.gifFps || 10)
  gifW = Math.max(2, Math.min(gifLimit, outW))
  gifH = Math.max(2, Math.round(outH * gifW / outW))
  gcv.width = gifW
  gcv.height = gifH
  gctx.imageSmoothingEnabled = true
  gctx.imageSmoothingQuality = 'high'
  gif = GifLib.createGif(gifW, gifH, small ? GIF_SMALL : undefined)

  mime = (hasAudio ? MIMES_AV : MIMES_V).find((m) => MediaRecorder.isTypeSupported(m)) || ''
  if (!mime) { fail('この PC では録画の形式が見つかりませんでした'); return }

  // 録るのは「切り抜いた canvas の絵」＋「パソコンの音」。取り込んだ映像そのものではない
  const tracks = cv.captureStream(cfg.fps).getVideoTracks()
  if (hasAudio) tracks.push(stream.getAudioTracks()[0])

  // 画面の絵は情報量が多いので、面積とコマ数から必要なぶんだけ割り当てる
  const bps = Math.min(20000000, Math.max(1500000, Math.round(outW * outH * cfg.fps * 0.16)))
  recorder = new MediaRecorder(new MediaStream(tracks), {
    mimeType: mime, videoBitsPerSecond: bps, audioBitsPerSecond: 128000,
  })
  recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data) }
  recorder.start(1000)

  draw()
  startAt = performance.now()
  lastGifAt = startAt
  phase = 'rec'
  noteEl.textContent = (hasAudio ? '録画中（音あり）' : '録画中（音なし）') + (cfg.autoBlur ? '・自動ぼかし' : '')
  drawTimer = setInterval(draw, Math.max(16, Math.round(1000 / cfg.fps)))
  gifTimer = setInterval(addGifFrame, Math.max(40, Math.round(1000 / gifFps)))
  tickTimer = setInterval(tick, 200)
}

function draw() {
  if (srcEl.readyState < 2) return
  ctx.drawImage(srcEl, srcRect.x, srcRect.y, srcRect.w, srcRect.h, 0, 0, outW, outH)
  if (blurBoxes.length) pixelate()
}

// 届いている四角に、少し広げてモザイクをかける（読み取りの間に少しずれても隠れるように）。
// 動画も GIF もこの canvas から作るので、両方にかかる
function pixelate() {
  const k = outW / cfg.crop.width
  ctx.imageSmoothingEnabled = false
  for (const b of blurBoxes) {
    const m = Math.max(4, b.h * 0.3) * k
    const x = Math.max(0, Math.floor(b.x * k - m))
    const y = Math.max(0, Math.floor(b.y * k - m))
    const w = Math.min(outW - x, Math.ceil(b.w * k + m * 2))
    const h = Math.min(outH - y, Math.ceil(b.h * k + m * 2))
    if (w < 2 || h < 2) continue
    const block = Math.max(8, Math.round(h / 2.5))
    pcv.width = Math.max(1, Math.round(w / block))
    pcv.height = Math.max(1, Math.round(h / block))
    const p = pcv.getContext('2d')
    p.imageSmoothingEnabled = true
    p.drawImage(cv, x, y, w, h, 0, 0, pcv.width, pcv.height)
    ctx.drawImage(pcv, 0, 0, pcv.width, pcv.height, x, y, w, h)
  }
  ctx.imageSmoothingEnabled = true
}

function addGifFrame() {
  if (gifFull || phase !== 'rec') return
  const now = performance.now()
  gctx.drawImage(cv, 0, 0, gifW, gifH)
  try {
    gif.addFrame(gctx.getImageData(0, 0, gifW, gifH).data, now - lastGifAt)
  } catch (_) {
    gifFull = true
    return
  }
  lastGifAt = now
  if (gif.size() > GIF_MAX_BYTES) { gifFull = true; noteEl.textContent = '録画中（GIF はここまで）' }
}

function tick() {
  const ms = elapsed()
  timeEl.textContent = mmss(ms)
  if (ms >= cfg.maxSec * 1000) {
    noteEl.textContent = '上限に達したので止めます'
    stop()
  }
}

async function stop() {
  if (phase !== 'rec') return
  durationMs = elapsed()
  if (paused) { paused = false; try { recorder.resume() } catch (_) {} }
  phase = 'done'
  clearInterval(drawTimer); clearInterval(gifTimer); clearInterval(tickTimer)
  dotEl.classList.add('off')
  noteEl.textContent = 'まとめています…'
  window.api.send('record:state', { recording: false })

  try {
    await new Promise((resolve) => {
      recorder.onstop = resolve
      if (recorder.state !== 'inactive') recorder.stop()
      else resolve()
    })
  } catch (_) { /* 途中で壊れていても、そこまでのぶんは使う */ }
  try { stream.getTracks().forEach((t) => t.stop()) } catch (_) {}

  videoBlob = new Blob(chunks, { type: mime })
  gifBytes = gif.finish()

  // 一覧に出す絵は、最後に写っていた1コマから作る
  const th = Math.min(264, outH)
  tcv.width = Math.max(1, Math.round(outW * th / outH))
  tcv.height = th
  tcv.getContext('2d').drawImage(cv, 0, 0, tcv.width, tcv.height)

  const r = await window.api.invoke('record:store', {
    video: new Uint8Array(await videoBlob.arrayBuffer()),
    ext: mime.indexOf('mp4') >= 0 ? 'mp4' : 'webm',
    gif: gifBytes,
    thumbDataUrl: tcv.toDataURL('image/png'),
    durationMs: Math.round(durationMs),
    width: outW,
    height: outH,
  })
  entryId = (r && r.ok) ? r.id : null
  savedPaths = { video: (r && r.videoPath) || null, gif: (r && r.gifPath) || null }

  showDone()
}

// ---------------------------------------------------------------- 止めたあと

function showDone() {
  barEl.hidden = true
  doneEl.hidden = false
  window.api.send('record:resize', { width: 660, height: 560 })

  prevEl.src = URL.createObjectURL(videoBlob)
  statEl.innerHTML = ''
  const line1 = document.createElement('span')
  line1.textContent = mmss(durationMs) + '（' + (durationMs / 1000).toFixed(1) + '秒）　'
    + outW + ' × ' + outH + ' px'
  const br = document.createElement('br')
  const line2 = document.createElement('span')
  line2.textContent = '動画 ' + sizeLabel(videoBlob.size)
    + '（' + (mime.indexOf('mp4') >= 0 ? 'MP4' : 'WebM') + (hasAudio ? '・音あり' : '・音なし') + '）'
    + '　／　GIF ' + sizeLabel(gifBytes.length) + '（' + gifW + ' × ' + gifH + ' px・' + gif.frames + 'コマ'
    + (gifFull ? '・途中まで' : '') + '）'
  statEl.appendChild(line1)
  statEl.appendChild(br)
  statEl.appendChild(line2)

  if (savedPaths.video || savedPaths.gif) note('保存しました： ' + fileName(savedPaths.video || savedPaths.gif))
  else note('保存できませんでした（保存先フォルダに書けません）', true)
}

function note(text, isError) {
  msgEl.textContent = text
  msgEl.classList.toggle('err', !!isError)
}

function fileName(p) { return String(p || '').split('\\').pop().split('/').pop() }

// 録り終わった時点でもう保存先に置いてある。ここは名前を付け直したいときだけ。
// コピーではなく同じ1個を動かすので、ファイルは増えない。
async function save(kind) {
  if (!entryId) { note('名前を付けられませんでした', true); return }
  const r = await window.api.invoke('record:save', { id: entryId, kind })
  if (!r || r.canceled) return
  if (r.ok) { savedPaths[kind] = r.path; note('保存しました： ' + fileName(r.path)) }
  else note('保存できませんでした' + (r && r.error ? '（' + r.error + '）' : ''), true)
}

document.getElementById('btnStop').addEventListener('click', () => stop())
btnPause.addEventListener('click', () => togglePause())
document.getElementById('btnCancel').addEventListener('click', () => window.api.send('record:cancel'))
document.getElementById('btnVideo').addEventListener('click', () => save('video'))
document.getElementById('btnGif').addEventListener('click', () => save('gif'))
document.getElementById('btnFolder').addEventListener('click', () => window.api.invoke('app:openFolder'))
document.getElementById('btnClose').addEventListener('click', () => window.api.send('app:closeWindow'))

window.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return
  e.preventDefault()
  if (phase === 'rec') stop()
  else window.api.send('app:closeWindow')
})
