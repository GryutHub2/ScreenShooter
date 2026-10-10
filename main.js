'use strict'

const {
  app, BrowserWindow, Tray, Menu, globalShortcut, ipcMain,
  screen, desktopCapturer, nativeImage, clipboard, dialog, shell, session,
} = require('electron')
const path = require('path')
const os = require('os')
const fs = require('fs')
const url = require('url')
const { execFile, spawn } = require('child_process')
const { createStore } = require('./lib/store')
const { mapMonitors, convertRects } = require('./lib/snap')
const { rowHashes, findShift, compose, sameRatio } = require('./lib/stitch')
const { findDiffBoxes } = require('./lib/diff')
const { findPrivateBoxes, LEVELS: BLUR_LEVELS } = require('./lib/pii')
const { migrateFromOldName, OLD_NAME } = require('./lib/migrate')
const { ocrToText } = require('./lib/ocrtext')
const pngmeta = require('./lib/pngmeta')
const claude = require('./lib/claude')

const ROOT = __dirname
const ASSETS = path.join(ROOT, 'assets')
const RENDERER = path.join(ROOT, 'renderer')
const PRELOAD = path.join(ROOT, 'preload.js')

// ---------------------------------------------------------------- 設定

function defaultSettings() {
  return {
    hotkeyRegion: 'Ctrl+Shift+S',   // 範囲を選んで撮る
    hotkeyFull: '',                 // 画面全体を撮る（空 = 割り当てなし）
    hotkeyScroll: '',               // スクロールして長いページを撮る（空 = 割り当てなし）
    hotkeyRecord: '',               // 録画する（空 = 割り当てなし）
    hotkeyRepeat: '',               // 前回と同じ範囲で撮る（空 = 割り当てなし。他アプリとの衝突を避けるため既定は空）
    hotkeyDelay: '',                // 時間差で撮る（delaySeconds 秒後に範囲選択。空 = 割り当てなし）
    delaySeconds: 5,                // 時間差で撮るまでの秒数（キーと、トレイの「◯秒後（設定の秒数）」で使う）
    hotkeyOcr: '',                  // 範囲の文字を読み取ってコピー（空 = 割り当てなし）
    hotkeyColor: '',                // 画面の色を拾ってコピー（空 = 割り当てなし）
    captureCursor: false,           // マウスカーソルも写す（撮った絵の上に、動かせる・消せる画像として置く）
    claudeTranslate: false,         // 読み取った文字を Claude で翻訳するボタンを出す（文字を外へ送るので既定はオフ）
    recordCountdown: 0,             // 録画を始める前のカウントダウン（秒。0 = すぐ始める）
    recordAutoBlur: true,           // 録画中も2〜3秒ごとに画面の文字を読み、個人情報らしい所にモザイクをかけたまま録る
    embedEdits: true,               // 書き込み版（_書き込み.png）に「元の絵＋図形」を入れる（ScreenShooter に落とすと図形を動かせる）
    lastRegion: null,               // 前回、範囲選択で撮った場所（rememberRegion が書く）
    // 撮った直後
    afterCapture: 'editor',         // 'editor' = 編集画面を開く / 'library' = 開かずに履歴パネルを出す
    quickClipboard: false,          // true = 何も開かずにコピーだけして、1秒のお知らせを出す（afterCapture / captureClipboard より優先）
    captureClipboard: 'image',      // 撮った直後にクリップボードへ（CAPTURE_CLIPBOARDS）。自動ぼかしが済んでから入れる
    saveDir: path.join(app.getPath('pictures'), 'ScreenShooter'),
    sendToMenu: false,              // 右クリックの「送る」に「ScreenShooterで開く」を出す
    snapWindows: true,              // カーソルの下のウィンドウに枠を吸い付かせる
    autoBlur: true,                 // 撮ったあと、個人情報・APIキーらしい所に自動でぼかしを置く（録画は対象外）
    autoBlurWords: [],              // 自動でぼかす言葉（設定画面で1行1語。/…/ で囲んだ行は正規表現）
    autoBlurLabels: [],             // 見出しとして探す言葉（この右か下の値をぼかす。lib/pii.js の JA_LABELS に足される）
    autoBlurLevel: 'normal',        // ぼかしの強さ（lib/pii.js の LEVELS）
    // 撮影履歴
    libraryLimit: 300,              // これを超えたら古いものから消す
    libraryPinned: false,           // ピン留め（出しっぱなし）
    libraryBounds: null,            // パネルの大きさと位置（動かしたら覚える）
    libraryThumbHeight: 104,        // 一覧のサムネイルの高さ(px)
    libraryOrder: 'old',            // 並び順。'old' = 古い→新しい（最新が右下）/ 'new' = 新しい→古い / 'name' = 名前順
    // 録画
    recordFps: 15,                  // 動画のなめらかさ（1秒あたりのコマ数）
    gifFps: 10,                     // GIF のなめらかさ
    gifMaxWidth: 0,                 // GIF の横幅の上限。0 = 縮めない（録った大きさのまま）
    recordAudio: true,              // パソコンで鳴っている音も一緒に録る
    // 編集画面で最後に使った見た目。次に撮ったときも同じ状態で始める
    color: '#e8453c',
    lineWidth: 4,
    markerWidth: 24,                // 蛍光ペンの太さ（editor.js の MARKER_WIDTHS）
    markerColor: '#f5b400',         // 蛍光ペンの色（ほかの道具の color とは別）
    fontSize: 28,
    textDeco: 'auto',               // 文字の飾り（縁取り・影）。中身は editor.js の DECOS
    textHalo: 0.09,                 // フチの厚み。文字の大きさに対する比（editor.js の HALOS）
    exportFinish: 'none',           // コピー・書き出しの仕上げ（EXPORT_FINISHES）。最後に選んだものを覚える
    stylePresets: defaultStylePresets(),  // 書き方のお気に入り4つ（編集画面の下の帯・数字キー 1〜4）
    resizeLast: null,               // 大きさを変えるダイアログで前回 OK した値。次に開いたとき最初に入れるだけ（勝手に縮めない）
    padLast: null,                  // 前回付けた余白。次にダイアログを開いたとき最初に入れるだけ
    lineDash: 'solid',              // 線の種類（LINE_DASHES）
    rectRadius: 0,                  // 四角の角の丸み（RECT_RADII）
    zoomK: 2,                       // 拡大鏡の倍率（ZOOM_FACTORS）
  }
}

// 撮った直後に入れるもの。'off' = 入れない / 'image' = 絵 / 'imagePath' = 絵とファイルの場所 / 'path' = ファイルの場所だけ
const CAPTURE_CLIPBOARDS = ['off', 'image', 'imagePath', 'path']
const AFTER_CAPTURES = ['editor', 'library']
const LIBRARY_ORDERS = ['old', 'new', 'name']

// 絵の大きさ（撮ったときに対する倍率。editor.js の SCALE_MIN / SCALE_MAX と同じ範囲）。
// 履歴の meta.scale にあるとき、meta.shapes と meta.crop はその大きさの座標
function validScale(s) { return Number.isFinite(s) && s >= 0.02 && s <= 8 }
function entryScale(meta) { return meta && validScale(meta.scale) ? meta.scale : 1 }

// 省略で抜いた横の帯（撮ったときの絵の座標 [{ y1, y2 }]）。meta.cuts があるとき、meta.shapes と meta.crop は抜いたあとの絵の座標
function validCuts(list) {
  if (!Array.isArray(list)) return []
  return list.filter((c) => c && Number.isFinite(c.y1) && Number.isFinite(c.y2) && c.y2 > c.y1)
    .map((c) => ({ y1: c.y1, y2: c.y2 }))
}
function entryCuts(meta) { return meta ? validCuts(meta.cuts) : [] }

// 抜いた帯の高さの合計（撮ったときの絵の px）。窓の大きさの見積もりに使うだけなので、重なりは気にしない
function cutsHeight(cuts, h) {
  return cuts.reduce((n, c) => n + Math.max(0, Math.min(h, c.y2) - Math.max(0, c.y1)), 0)
}

// 書き方のお気に入りの初期値。大きな青・赤の白フチ文字と、赤い枠・矢印をよく使うので、それを最初から入れておく。
// 1つ = { tool, color, lineWidth, fontSize, deco, halo }。使わない項目も持たせておく（登録し直しで道具が変わるため）
function defaultStylePresets() {
  return [
    { tool: 'text', color: '#2e7dd7', lineWidth: 4, fontSize: 48, deco: 'white', halo: 0.26 },
    { tool: 'text', color: '#e8453c', lineWidth: 4, fontSize: 48, deco: 'white', halo: 0.26 },
    { tool: 'rect', color: '#e8453c', lineWidth: 4, fontSize: 28, deco: 'auto', halo: 0.09 },
    { tool: 'arrow', color: '#e8453c', lineWidth: 7, fontSize: 28, deco: 'auto', halo: 0.09 },
  ]
}

let settings = defaultSettings()

function settingsFile() {
  return path.join(app.getPath('userData'), 'settings.json')
}

function loadSettings() {
  settings = defaultSettings()
  try {
    Object.assign(settings, JSON.parse(fs.readFileSync(settingsFile(), 'utf8')))
  } catch (_) { /* 初回起動・壊れている場合は既定値のまま */ }
  return settings
}

function saveSettings(patch) {
  if (patch) Object.assign(settings, patch)
  try {
    fs.mkdirSync(path.dirname(settingsFile()), { recursive: true })
    fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 2), 'utf8')
  } catch (err) {
    console.error('設定の保存に失敗:', err)
  }
}

// ---------------------------------------------------------------- 撮影履歴（ライブラリ）
//
// 1件 = 1フォルダ。%APPDATA%\ScreenShooter\library\<id>\ に
//   original.png … 書き込む前の元画像
//   thumb.png    … 一覧用の小さい絵（書き込み後の見た目）
//   meta.json    … 図形・切り抜き・保存先
// を置く。書き込んだ図形を「焼かずに」持っておくので、あとから動かし直せる。

// 読み書きと削除の実体は lib/store.js（Electron を使わないのでそのままテストできる）
let store = null
function lib() {
  if (!store) store = createStore(path.join(app.getPath('userData'), 'library'))
  return store
}

function readEntry(id) { return lib().read(id) }
function writeMeta(meta) { return lib().write(meta) }
function entryDir(id) { return lib().entryDir(id) }
function deleteEntry(id) { return lib().remove(id) }
function pruneLibrary() { return lib().prune(settings.libraryLimit) }

// 一覧のサムネイルは設定で 64〜240px まで大きくできる。
// 実物はその倍まで作っておく（大きく表示したときにぼやけないため）。
const THUMB_STORE_H = 264
const THUMB_STORE_W = 700

function makeThumb(image) {
  const s = image.getSize()
  // 横長すぎる絵は高さ基準だと帯になるので、その場合は幅で縮める
  return (s.height > 0 && s.width / s.height > 3.2)
    ? image.resize({ width: THUMB_STORE_W, quality: 'good' })
    : image.resize({ height: THUMB_STORE_H, quality: 'good' })
}

// 撮った絵は、その場で保存先フォルダ（既定は ピクチャ\ScreenShooter）に置く。
// 履歴はそのファイルを指すだけで、原寸のコピーは持たない（同じ絵を2箇所に置かないため）。
// 保存先に書けなかったときだけ、履歴の中の original.png に逃がす。
// region は範囲選択で撮ったときだけ付く（同じ範囲で撮った2枚を見分けるため）
function addToLibrary(image, region) {
  const id = lib().newId()
  const dir = entryDir(id)
  const size = image.getSize()
  const png = image.toPNG()
  const createdAt = Date.now()

  let file = null
  try {
    fs.mkdirSync(settings.saveDir, { recursive: true })
    file = uniquePath(settings.saveDir, timestampFrom(createdAt), '.png')
    fs.writeFileSync(file, png)
  } catch (err) {
    console.error('保存先への書き出しに失敗:', err)
    file = null
  }

  try {
    fs.mkdirSync(dir, { recursive: true })
    if (!file) fs.writeFileSync(path.join(dir, 'original.png'), png)
    fs.writeFileSync(path.join(dir, 'thumb.png'), makeThumb(image).toPNG())
  } catch (err) {
    console.error('履歴への追加に失敗:', err)
    if (!file) return null
  }

  const meta = {
    id, createdAt,
    width: size.width, height: size.height,
    file,                 // 原本のフルパス。null = 保存先に書けず履歴の original.png にある
    editedPath: null,     // 書き込み版を出したときのパス
    shapes: [], crop: null,
  }
  if (region) meta.region = region
  writeMeta(meta)
  pruneLibrary()
  return meta
}

// 撮影ではなく、既にあるファイルを履歴に登録する。絵は書き出さず、そのファイルを指すだけ
function addFileToLibrary(file, image, source) {
  const id = lib().newId()
  const dir = entryDir(id)
  const size = image.getSize()
  try {
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'thumb.png'), makeThumb(image).toPNG())
  } catch (err) {
    console.error('履歴への追加に失敗:', err)
    return null
  }
  const meta = {
    id, createdAt: Date.now(),
    width: size.width, height: size.height,
    file,
    source: source || null,   // どこから取り込んだか。同じ絵を何度も取り込まないための目印
    editedPath: null,
    shapes: [], crop: null,
  }
  writeMeta(meta)
  pruneLibrary()
  return meta
}

// 外から渡された画像（右クリックの「送る」・履歴パネルへのドロップ）を取り込む。
// 保存先フォルダへコピーしてから履歴に入れる。渡された側のファイルは動かさない
const IMPORT_EXTS = ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp']

function samePath(a, b) {
  if (!a || !b) return false
  return path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase()
}

function importImage(src) {
  const ext = path.extname(src || '').toLowerCase()
  if (!IMPORT_EXTS.includes(ext)) return null
  const img = nativeImage.createFromPath(src)
  if (img.isEmpty()) return null   // 中身が読めないものは入れない（壊れたファイル・別物の拡張子）

  // 前に同じファイルを取り込んでいれば、それを開き直す。
  // コピーも履歴も増やさないため。ただし取り込んだ側が消えていたら入れ直す
  const found = lib().list().find((m) => samePath(m.source, src) || samePath(m.file, src))
  if (found && originalPath(found)) return found

  // 書き込み版（編集の情報入り）なら、元の絵と図形に戻して取り込む。
  // 保存先の中にある自分の書き込み版は対象にしない（元の絵がもう保存先にあり、同じ絵が2つになるため）
  if (ext === '.png' && !samePath(path.dirname(src), settings.saveDir)) {
    const withEdits = importWithEdits(src)
    if (withEdits) return withEdits
  }

  // 保存先フォルダの中にある絵は、コピーを作らずそのまま指す（同じ絵を2個に増やさないため）
  let file = src
  if (!samePath(path.dirname(src), settings.saveDir)) {
    try {
      fs.mkdirSync(settings.saveDir, { recursive: true })
      file = uniquePath(settings.saveDir, path.basename(src, ext), ext)
      fs.copyFileSync(src, file)
    } catch (err) {
      console.error('保存先へのコピーに失敗:', err)
      file = src                   // コピーできなくても、元のファイルを指せば開ける
    }
  }
  return addFileToLibrary(file, img, src)
}

// 起動時の引数から画像のパスだけを拾う。オプション（-で始まるもの）とアプリのフォルダは除く
function imagePathsFrom(argv, cwd) {
  const out = []
  for (const a of argv || []) {
    if (!a || a.startsWith('-')) continue
    const p = path.isAbsolute(a) ? a : path.resolve(cwd || process.cwd(), a)
    if (!IMPORT_EXTS.includes(path.extname(p).toLowerCase())) continue
    if (!fs.existsSync(p)) continue
    out.push(p)
  }
  return out
}

// 取り込んで、1枚だけのときはそのまま編集画面を開く。
// 何枚も渡されたときは履歴に入れるだけにする（窓が何枚も開くのを防ぐため）
function openImageFiles(paths) {
  if (!Array.isArray(paths) || !paths.length) return 0
  const metas = []
  for (const p of paths) {
    const meta = importImage(p)
    if (meta) metas.push(meta)
  }
  if (!metas.length) {
    showError('この画像は取り込めませんでした', paths[0])
    return 0
  }
  notifyLibraryChanged()
  if (metas.length === 1) {
    const img = originalImage(metas[0])
    if (img) openEditor(img, metas[0])
  }
  return metas.length
}

// クリップボードの画像を、撮ったものと同じように保存先へ書いて履歴に入れる。
// open = トレイから（編集画面で開く）。履歴パネルの Ctrl+V では一覧に足すだけにする（Screenpresso の貼り付けと同じ）。
// エクスプローラーでコピーした画像ファイルは、絵ではなくファイルの場所が入っているので、取り込みとして扱う
function openClipboardImage(open) {
  const img = clipboard.readImage()
  if (img.isEmpty()) {
    const files = clipboardFilePaths().filter((p) => IMPORT_EXTS.includes(path.extname(p).toLowerCase()))
    if (files.length) {
      if (open) openImageFiles(files)
      else { for (const f of files) importImage(f); notifyLibraryChanged() }
      return true
    }
    if (open) showError('クリップボードに画像がありません', '画像をコピーしてから、もう一度押してください。')
    else libraryToast('クリップボードに画像がありません')
    return false
  }
  const meta = addToLibrary(img, null)
  if (!meta) { libraryToast('保存先に書けませんでした'); return false }
  notifyLibraryChanged()
  const autoBlur = settings.autoBlur !== false
  if (open) openEditor(img, meta, { autoBlur })
  else {
    libraryToast('クリップボードの画像を足しました')
    if (autoBlur) runBackgroundEditor(img, meta, { autoBlur, copyMode: 'off' })
  }
  return true
}

// エクスプローラーでコピーしたファイルの場所。Windows はファイル名を UTF-16 の並び（FileNameW）で持つ
function clipboardFilePaths() {
  try {
    const buf = clipboard.readBuffer('FileNameW')
    if (!buf || !buf.length) return []
    return buf.toString('utf16le').split('\0').map((s) => s.trim()).filter((s) => s && fs.existsSync(s))
  } catch (_) {
    return []
  }
}

// 保存先に同じ名前があったら「-2」「-3」と後ろに足す。既にあるファイルを潰さないため
function uniquePath(dir, base, ext) {
  let p = path.join(dir, base + ext)
  for (let n = 2; fs.existsSync(p) && n < 1000; n++) p = path.join(dir, base + '-' + n + ext)
  return p
}

// 同じ1個を動かす。別ドライブへは rename が通らないので、その時だけコピーしてから消す
function moveFile(src, dst) {
  try { fs.renameSync(src, dst) } catch (_) {
    fs.copyFileSync(src, dst)
    try { fs.rmSync(src, { force: true }) } catch (_) {}
  }
}

// 書き込み前の絵。保存先フォルダのファイルが正典で、
// 古い履歴と書き出しに失敗した分だけ履歴の original.png を使う。
function originalPath(meta) {
  const tries = [meta.file, path.join(entryDir(meta.id), 'original.png')]
  for (const p of tries) {
    if (!p || !fs.existsSync(p)) continue
    const img = nativeImage.createFromPath(p)
    if (!img.isEmpty()) return p
  }
  return null
}

function originalImage(meta) {
  const p = originalPath(meta)
  return p ? nativeImage.createFromPath(p) : null
}

// 書き込み版のファイル名。原本の隣に「_書き込み」を足した名前で置く
function editedPathFor(meta) {
  const src = (meta && meta.file) ? meta.file : path.join(settings.saveDir, timestampBase() + '.png')
  const dir = path.dirname(src)
  return uniquePath(dir, path.basename(src, path.extname(src)) + '_書き込み', '.png')
}

// 「場所を開く」で指すファイル。無くなっていたら null。
// 古い履歴は録画を自分のフォルダに持っているので、そこも見る
function fileOf(meta) {
  const tries = [meta.editedPath, meta.file, meta.videoFile, meta.gifFile, meta.savedPath]
  if (meta.kind === 'video') tries.push(path.join(entryDir(meta.id), 'movie.' + (meta.videoExt || 'mp4')))
  for (const p of tries) {
    if (p && fs.existsSync(p)) return p
  }
  return null
}

// 履歴パネル・タイトルバーに出す、ユーザーから見えるファイル名
function displayName(meta) {
  const p = meta ? (meta.file || meta.videoFile || meta.editedPath || meta.savedPath) : null
  return p ? path.basename(p) : ''
}

// サムネイルの file:// URL。日本語のパスでも壊れないよう url 経由で作る
function thumbUrl(id) {
  const p = path.join(entryDir(id), 'thumb.png')
  if (!fs.existsSync(p)) return null
  // 更新しても古い絵が残らないよう、更新時刻を付けてキャッシュを外す
  let stamp = 0
  try { stamp = fs.statSync(p).mtimeMs } catch (_) {}
  return url.pathToFileURL(p).href + '?t=' + Math.round(stamp)
}

// 履歴パネルの絞り込みの言葉（パネルの検索欄から届く）。空なら全部
let libraryQuery = ''

// 絞り込み。ファイル名・タイトル・タグ・撮った日（2026-10-03 / 10/03）のどこかに、空白で区切った言葉が全部入っているもの
function matchesQuery(m, q) {
  if (!q) return true
  const d = new Date(m.createdAt || 0)
  const p = (n) => String(n).padStart(2, '0')
  const hay = [displayName(m), m.title || '', (m.tags || []).join(' '),
    d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()), (d.getMonth() + 1) + '/' + d.getDate(),
    m.kind === 'video' ? '録画 動画 gif' : ''].join(' ').toLowerCase()
  return q.toLowerCase().split(/\s+/).filter(Boolean).every((w) => hay.includes(w))
}

function libraryItems(limit) {
  return lib().list().filter((m) => matchesQuery(m, libraryQuery)).slice(0, limit || 80).map((m) => ({
    id: m.id,
    createdAt: m.createdAt,
    width: m.width,
    height: m.height,
    shapeCount: (m.shapes || []).length,
    savedPath: m.editedPath || m.file || m.videoFile || m.savedPath || null,
    name: displayName(m),
    thumb: thumbUrl(m.id),
    kind: m.kind || 'image',
    durationMs: m.durationMs || 0,
    title: m.title || '',
    tags: Array.isArray(m.tags) ? m.tags : [],
  }))
}

// ---- 名前を変える・タイトルとタグ（履歴パネルの右クリック・F2）
// 名前は保存先のファイルそのものを変える。書き込み版（_書き込み.png）と、録画の動画と GIF も同じ名前にそろえる。
// 拡張子は変えない（形式を変えると、履歴が覚えている絵の種類と食い違うため）
function cleanFileBase(s) {
  return String(s || '').replace(/[\\/:*?"<>|\r\n\t]/g, '').replace(/\.+$/, '').trim().slice(0, 120)
}

function renameEntry(id, newBase) {
  const meta = readEntry(id)
  if (!meta) return { ok: false, error: '履歴が見つかりません' }
  const base = cleanFileBase(newBase)
  if (!base) return { ok: false, error: '名前を入れてください（\\ / : * ? " < > | は使えません）' }
  const main = meta.kind === 'video' ? (meta.videoFile || meta.gifFile) : meta.file
  if (!main || !fs.existsSync(main)) return { ok: false, error: '保存先にファイルが見つかりません' }
  const oldBase = path.basename(main, path.extname(main))
  if (base === oldBase) return { ok: true }
  // 動かすものの一覧（元 → 先）。ひとつでも先に同じ名前があれば、何も動かさずにやめる
  const moves = []
  const plan = (key, suffix) => {
    const p = meta[key]
    if (!p || !fs.existsSync(p)) return
    const dir = path.dirname(p)
    const ext = path.extname(p)
    const name = path.basename(p, ext)
    const tail = name.startsWith(oldBase) ? name.slice(oldBase.length) : (suffix || '')
    moves.push({ key, from: p, to: path.join(dir, base + tail + ext) })
  }
  if (meta.kind === 'video') { plan('videoFile'); plan('gifFile') } else { plan('file'); plan('editedPath', '_書き込み') }
  for (const mv of moves) {
    if (!samePath(mv.from, mv.to) && fs.existsSync(mv.to)) return { ok: false, error: '同じ名前のファイルがもうあります：' + path.basename(mv.to) }
  }
  try {
    for (const mv of moves) { fs.renameSync(mv.from, mv.to); meta[mv.key] = mv.to }
  } catch (err) {
    writeMeta(meta)   // 途中まで動いた分は、動いた先を覚えておく
    return { ok: false, error: String(err) }
  }
  writeMeta(meta)
  refreshEditorTitle(meta.id)
  notifyLibraryChanged()
  return { ok: true }
}

ipcMain.handle('library:rename', (e, d) => (d && typeof d.id === 'string' ? renameEntry(d.id, d.name) : { ok: false }))

ipcMain.handle('library:saveInfo', (e, d) => {
  const meta = d && typeof d.id === 'string' ? readEntry(d.id) : null
  if (!meta) return { ok: false }
  const title = String(d.title || '').trim().slice(0, 200)
  const tags = []
  // 画面からは配列で届く（タグの中の空白を保つため）。文字列なら区切りで分ける
  const raw = Array.isArray(d.tags) ? d.tags.map(String) : String(d.tags || '').split(/[,、，\s]+/)
  for (const t of raw) {
    const v = t.trim().slice(0, 40)
    if (v && !tags.includes(v)) tags.push(v)
  }
  if (title) meta.title = title; else delete meta.title
  if (tags.length) meta.tags = tags.slice(0, 30); else delete meta.tags
  writeMeta(meta)
  notifyLibraryChanged()
  return { ok: true }
})

// 付けてあるタグの一覧（多く使われている順）。タグの欄の候補に出して、言い回しの違うタグが増えるのを防ぐ
ipcMain.handle('library:allTags', () => {
  const count = new Map()
  for (const m of lib().list()) for (const t of (Array.isArray(m.tags) ? m.tags : [])) count.set(t, (count.get(t) || 0) + 1)
  return [...count].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ja')).map(([tag, n]) => ({ tag, n }))
})

ipcMain.on('library:query', (e, q) => {
  libraryQuery = String(q || '').trim().slice(0, 200)
  notifyLibraryChanged()
})

// 右クリック・F2 から、パネルの中に入力欄を出させる
function askLibraryInfo(id, what) {
  const meta = readEntry(id)
  if (!meta || !libraryWin || libraryWin.isDestroyed()) return
  const main = meta.kind === 'video' ? (meta.videoFile || meta.gifFile) : meta.file
  libraryWin.webContents.send('library:editInfo', {
    id, what,
    name: main ? path.basename(main, path.extname(main)) : '',
    ext: main ? path.extname(main) : '',
    title: meta.title || '',
    tags: Array.isArray(meta.tags) ? meta.tags : [],
  })
}
ipcMain.on('library:askInfo', (e, d) => { if (d && typeof d.id === 'string') askLibraryInfo(d.id, d.what === 'rename' ? 'rename' : 'info') })

// ---------------------------------------------------------------- 画面の取り込み

// desktopCapturer は thumbnailSize を全ソース共通でしか指定できない。
// 解像度の違う画面が混ざると小さいほうが引き伸ばされて甘くなるので、実ピクセル数ごとに分けて呼ぶ。
async function grabAllDisplays() {
  const displays = screen.getAllDisplays()
  const groups = new Map()
  for (const d of displays) {
    const w = Math.round(d.bounds.width * d.scaleFactor)
    const h = Math.round(d.bounds.height * d.scaleFactor)
    const key = w + 'x' + h
    if (!groups.has(key)) groups.set(key, { w, h, list: [] })
    groups.get(key).list.push(d)
  }

  const shots = []
  for (const g of groups.values()) {
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: g.w, height: g.h },
      fetchWindowIcons: false,
    })
    for (const d of g.list) {
      let src = sources.find((s) => String(s.display_id) === String(d.id))
      if (!src) src = sources[displays.indexOf(d)] || sources[0]
      if (!src || !src.thumbnail || src.thumbnail.isEmpty()) continue
      shots.push({ display: d, image: src.thumbnail })
    }
  }
  return shots
}

// ---------------------------------------------------------------- ウィンドウの位置しらべ
//
// Electron からは他のアプリのウィンドウ位置が取れないので、PowerShell 経由で Windows に聞く。
// 返ってくるのは位置と大きさだけ（タイトルや中身は読まない）。1回あたり 0.2〜0.3 秒なので、
// 画面の取り込みと並行して走らせ、間に合ったぶんだけオーバーレイに渡す。

function powershellPath() {
  const root = process.env.SystemRoot || 'C:\\Windows'
  return path.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
}

// スクロール撮影のあいだだけ PowerShell を常駐させ、1行送って1行返す形で使う。
// 毎回起動すると1回 0.25 秒かかり、十数回スクロールすると待ち時間が積み上がるため。
let helper = null

function startHelper() {
  if (helper && helper.child && !helper.child.killed) return helper
  const script = path.join(ROOT, 'tools', 'win-rects.ps1')
  const child = spawn(powershellPath(), [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-File', script, '-Serve', '-SkipPid', String(process.pid),
  ], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] })

  const h = { child, queue: [], buf: '' }
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (chunk) => {
    h.buf += chunk
    let i = h.buf.indexOf('\n')
    while (i >= 0) {
      const line = h.buf.slice(0, i).replace(/\r$/, '')
      h.buf = h.buf.slice(i + 1)
      const cb = h.queue.shift()
      if (cb) cb(line)
      i = h.buf.indexOf('\n')
    }
  })
  const die = () => {
    if (helper === h) helper = null
    for (const cb of h.queue) cb(null)
    h.queue = []
  }
  child.on('exit', die)
  child.on('error', die)
  helper = h
  return h
}

function stopHelper() {
  const h = helper
  helper = null
  if (!h || !h.child) return
  try { h.child.stdin.write('quit\n') } catch (_) {}
  setTimeout(() => { try { h.child.kill() } catch (_) {} }, 400)
}

// 返事が来ないときは null。待たせすぎないよう、返事待ちが崩れたら常駐ごとやめる
function helperCmd(cmd, timeoutMs) {
  const h = startHelper()
  return new Promise((resolve) => {
    let done = false
    const timer = setTimeout(() => {
      if (done) return
      done = true
      stopHelper()
      resolve(null)
    }, timeoutMs || 5000)
    h.queue.push((line) => {
      if (done) return
      done = true
      clearTimeout(timer)
      resolve(line)
    })
    try { h.child.stdin.write(cmd + '\n') } catch (_) {
      if (!done) { done = true; clearTimeout(timer); resolve(null) }
    }
  })
}

function scanWindowRects() {
  return new Promise((resolve) => {
    const script = path.join(ROOT, 'tools', 'win-rects.ps1')
    if (!fs.existsSync(script)) { resolve(null); return }
    const child = execFile(
      powershellPath(),
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script,
        '-SkipPid', String(process.pid)],
      { timeout: 4000, windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
      (err, stdout) => {
        if (err) { resolve(null); return }
        try {
          const data = JSON.parse(String(stdout).trim())
          resolve(data && Array.isArray(data.windows) && Array.isArray(data.monitors) ? data : null)
        } catch (_) { resolve(null) }
      },
    )
    child.on('error', () => resolve(null))
  })
}

// 物理ピクセルの矩形を、その画面のオーバーレイの CSS ピクセルに直して送る。
// 換算の中身は lib/snap.js（Electron を使わないのでそのままテストできる）
function pushRectsTo(win) {
  if (!win || win.isDestroyed() || !win.overlayReady || !overlayRects) return
  const shot = overlayShots.find((s) => s.display.id === win.displayId)
  if (!shot) return
  const map = mapMonitors(overlayShots.map((s) => s.display), overlayRects.monitors)
  if (!map) return
  const mon = map.get(shot.display.id)
  if (!mon) return

  const windows = convertRects(shot.display.bounds, shot.image.getSize(), mon, overlayRects.windows)
  win.webContents.send('overlay:rects', { windows })
}

// ---------------------------------------------------------------- 窓の中身が出ないときの立ち直り

// Electron は窓1枚ごとに electron.exe を子プロセスとして起動し直し、そこで中身を描く。
// このPCは Smart App Control が有効で、無署名の electron.exe は「評判」だけで判定されるため、
// この子プロセスの起動がときどき弾かれる（イベントログ Microsoft-Windows-CodeIntegrity/Operational の
// Id 3077、ポリシー名 VerifiedAndReputableDesktop）。弾かれると枠だけの真っ白な窓が残るので、
// 黙って読み込み直し、それでも駄目なら案内を出す。

const LOAD_WAIT_MS = 12000    // これだけ待っても読み込みが終わらなければ失敗とみなす
const RELOAD_MAX = 3          // 1つの窓で読み込み直す上限。増やさない（堂々巡りになる）
const NOTICE_GAP_MS = 30000   // 案内を出す間隔。窓が何枚も同時に死んでも1回にまとめる

let lastBlockNotice = 0

// 窓の読み込みを見張りながら開く。読み込めるたびに onReady を呼ぶ。
// IMPORTANT: 初期データは once('did-finish-load') ではなく必ず onReady から渡すこと。
// once だと読み込み直した2回目に届かず、立ち直っても中身が空のままになる。
//   onReady  読み込めた（やり直した場合も呼ぶ）
//   onGiveUp 諦めるとき。中途半端な窓を自分で片付ける
//   once     一度読み込めた後に死んだら、やり直さず諦める（録画のようにやり直しが無意味なもの）
//   quiet    諦めるときに案内を出さず黙って消す（ただの飾りの窓）
function loadGuarded(win, file, label, opts) {
  const o = opts || {}
  const wc = win.webContents
  let timer = null
  let reloads = 0
  let loadedOnce = false

  const disarm = () => { clearTimeout(timer); timer = null }

  const arm = () => {
    disarm()
    timer = setTimeout(() => fail('読み込みが' + Math.round(LOAD_WAIT_MS / 1000) + '秒たっても終わらない'), LOAD_WAIT_MS)
    win.loadFile(file).catch(() => {})   // 失敗は下のイベントで拾うので、ここでは黙らせる
  }

  const fail = (why) => {
    disarm()
    if (win.isDestroyed()) return
    if (!(o.once && loadedOnce) && reloads++ < RELOAD_MAX) { arm(); return }
    if (o.onGiveUp) o.onGiveUp()
    if (o.quiet) { if (!win.isDestroyed()) win.destroy(); return }
    noticeBlocked(label, why)
  }

  wc.on('did-finish-load', () => {
    disarm()
    loadedOnce = true
    if (o.onReady && !win.isDestroyed()) o.onReady()
  })
  // clean-exit は窓を普通に閉じたときにも来るので数えない
  wc.on('render-process-gone', (_e, d) => {
    const reason = (d && d.reason) || 'unknown'
    if (reason === 'clean-exit') return
    fail('中身を描く担当が落ちた（' + reason + '）')
  })
  // -3 は「別の場所へ移った」ときに出るだけ。中の小窓(iframe)の失敗も数えない
  wc.on('did-fail-load', (_e, code, desc, _url, isMainFrame) => {
    if (code === -3 || isMainFrame === false) return
    fail('開けなかった（' + desc + '）')
  })
  win.on('closed', disarm)

  arm()
}

// 同期版（showMessageBoxSync）は使わない。押されるまで本体が丸ごと止まり、
// トレイもホットキーも効かなくなる
function noticeBlocked(label, why) {
  const now = Date.now()
  if (now - lastBlockNotice < NOTICE_GAP_MS) return
  lastBlockNotice = now
  dialog.showMessageBox({
    type: 'warning',
    title: 'ScreenShooter',
    message: label + 'を開けませんでした',
    detail: '窓の枠は出たのに中身が真っ白なときは、Windows の保護機能'
      + '「スマート アプリ コントロール」が、このアプリの中身を描く部分の起動を止めたのが原因です。'
      + '時間をおくとまた通るようになります。\n\n'
      + 'アプリを起動し直すと、たいてい直ります。\n\n'
      + '（記録：' + label + ' — ' + why + '）',
    buttons: ['アプリを起動し直す', 'このままにする'],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  }).then((r) => { if (r.response === 0) restartApp() })
}

// 二重起動とは競合しない（再起動した側がロックを取れることを実測ずみ）。
// spawn で自前に起動し直すと、古い方が終わる前に2つ目が立って撮影が始まってしまう
function restartApp() {
  app.relaunch()
  app.exit(0)
}

// ---------------------------------------------------------------- 範囲選択オーバーレイ

let overlayWins = []
let overlayShots = []
let overlayRects = null
let scanSeq = 0
let capturing = false
let captureMode = 'region'   // 'region' | 'scroll' | 'record'

function closeOverlays() {
  for (const w of overlayWins) {
    if (w && !w.isDestroyed()) w.destroy()
  }
  overlayWins = []
  overlayShots = []
  overlayRects = null
  capturing = false
  raisePins()
}

function pointInBounds(p, b) {
  return p.x >= b.x && p.x < b.x + b.width && p.y >= b.y && p.y < b.y + b.height
}

// 範囲選択の使い方。region = ふつうに撮る / scroll = 長いページ / record = 録画 / ocr = 文字を読み取る /
// color = 色を拾う（点を押すだけ）/ replace = 編集画面の「下の絵を差し替え」用に撮る
const CAPTURE_MODES = ['region', 'scroll', 'record', 'ocr', 'color', 'replace']
let replaceWin = null      // 差し替え用に撮るときの編集画面（撮るあいだは隠している）
let cursorPending = null   // 撮り始めた瞬間のカーソル（{ point, displayId, image: Promise }）

async function startRegionCapture(mode, opts) {
  if (capturing || scrollBusy) return
  if (mode === 'record' && recording) return
  capturing = true
  captureMode = CAPTURE_MODES.includes(mode) ? mode : 'region'
  replaceWin = (opts && opts.win) || null
  // カーソルは撮り始めた瞬間の位置と形を覚える（選んでいるあいだに動くため）。M キーで写す・写さないを切り替えられるよう、ふつうに撮るときは毎回取っておく
  cursorPending = (captureMode === 'region' || captureMode === 'replace') ? startCursorShot() : null
  overlayRects = null

  // 画面の取り込みと同時に走らせる（待たない）。間に合ったら吸い付きが有効になる
  const seq = ++scanSeq
  if (settings.snapWindows) {
    scanWindowRects().then((data) => {
      if (seq !== scanSeq || !capturing || !data) return
      overlayRects = data
      for (const w of overlayWins) pushRectsTo(w)
    })
  }

  let shots
  try {
    shots = await grabAllDisplays()
  } catch (err) {
    capturing = false
    showError('画面の取り込みに失敗しました', String(err))
    return
  }
  if (!shots.length) { capturing = false; return }

  overlayShots = shots
  const cursor = screen.getCursorScreenPoint()

  for (const shot of shots) {
    const b = shot.display.bounds
    const win = new BrowserWindow({
      x: b.x, y: b.y, width: b.width, height: b.height,
      show: false,
      frame: false,
      transparent: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      hasShadow: false,
      enableLargerThanScreen: true,
      backgroundColor: '#101010',
      webPreferences: {
        preload: PRELOAD,
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false,
      },
    })
    win.displayId = shot.display.id
    win.overlayReady = false
    win.setMenu(null)
    // 諦めるときは暗幕を全部たたむ。残すと真っ暗なまま画面を覆い続ける
    loadGuarded(win, path.join(RENDERER, 'overlay.html'), '範囲選択の画面', {
      onGiveUp: closeOverlays,
      onReady: () => {
        win.webContents.send('overlay:init', {
          displayId: shot.display.id,
          dataUrl: shot.image.toDataURL(),
          isCursorHere: pointInBounds(cursor, b),
          mode: captureMode,
          cursorOn: !!settings.captureCursor,
        })
      },
    })
    overlayWins.push(win)
  }
}

// 撮った画面を貼り終えた合図。ここで初めて表示する（白い画面が一瞬出るのを防ぐ）
ipcMain.on('overlay:ready', (e, data) => {
  const win = BrowserWindow.fromWebContents(e.sender)
  if (!win || win.isDestroyed()) return
  const shot = overlayShots.find((s) => s.display.id === data.displayId)
  if (shot) win.setBounds(shot.display.bounds)
  win.setAlwaysOnTop(true, 'screen-saver')
  win.show()
  if (data.focus) { win.moveTop(); win.focus() }
  win.overlayReady = true
  pushRectsTo(win)   // 先にウィンドウ位置が届いていた場合はここで渡す
})

ipcMain.on('overlay:cancel', () => {
  closeOverlays()
  // 差し替えをやめたときは、隠しておいた編集画面を戻す
  if (replaceWin && !replaceWin.isDestroyed()) replaceWin.show()
  replaceWin = null
})

// 色を拾った。押した点の色をクリップボードへ入れ、トレイのお知らせで値を見せる
ipcMain.on('overlay:color', (e, d) => {
  closeOverlays()
  if (!d || typeof d.hex !== 'string') return
  clipboard.writeText(String(d.text || d.hex))
  if (tray) tray.displayBalloon({ title: '色をコピーしました', content: d.hex + '（RGB ' + d.rgb + '）', iconType: 'info' })
})

ipcMain.on('overlay:select', (e, data) => {
  const shot = overlayShots.find((s) => s.display.id === data.displayId)
  closeOverlays()
  if (!shot) return

  // オーバーレイの座標は CSS ピクセル。実画像は物理ピクセルなので実測比で換算する
  // （画面の拡大率 150% などをここで吸収する）
  const size = shot.image.getSize()
  const b = shot.display.bounds
  const sx = size.width / b.width
  const sy = size.height / b.height

  const x = Math.max(0, Math.round(data.rect.x * sx))
  const y = Math.max(0, Math.round(data.rect.y * sy))
  const w = Math.min(size.width - x, Math.round(data.rect.w * sx))
  const h = Math.min(size.height - y, Math.round(data.rect.h * sy))
  if (w < 1 || h < 1) return
  const region = regionOf(shot, x, y, w, h)

  if (captureMode === 'scroll') {
    if (h < 160 || w < 80) {
      showError('スクロール撮影には、もう少し大きい範囲が必要です',
        '縦 160 ピクセル以上（実サイズ）を選んでください。いまは ' + w + ' × ' + h + ' px です。')
      return
    }
    runScrollCapture(shot.display, { x, y, width: w, height: h })
    return
  }

  if (captureMode === 'record') {
    if (w < 64 || h < 64) {
      showError('録画には、もう少し大きい範囲が必要です',
        '縦横 64 ピクセル以上（実サイズ）を選んでください。いまは ' + w + ' × ' + h + ' px です。')
      return
    }
    rememberRegion(region)
    // 選んだ時点の絵は、録画の自動ぼかしの1回目の読み取りに使う（録り始めからぼかしが効くように）
    startRecording(shot.display, { x, y, width: w, height: h }, shot.image.crop({ x, y, width: w, height: h }))
    return
  }

  if (captureMode === 'ocr') {
    runOcr(shot.image.crop({ x, y, width: w, height: h }))
    return
  }

  if (captureMode === 'replace') {
    const win = replaceWin
    replaceWin = null
    replaceBaseImage(win, shot.image.crop({ x, y, width: w, height: h }), region)
    return
  }

  rememberRegion(region)
  const pending = cursorPending
  cursorPending = null
  const image = shot.image.crop({ x, y, width: w, height: h })
  // 範囲選択の画面で M キーを押すと、写す・写さないが設定と逆になる（data.cursor）
  const want = typeof data.cursor === 'boolean' ? data.cursor : !!settings.captureCursor
  cursorShapeFor(want ? pending : null, shot, x, y, w, h)
    .then((shape) => captureDone(image, region, Object.assign({ swap: data.ctrl === true }, shape ? { shapes: [shape] } : {})))
})

// ---------------------------------------------------------------- 前回と同じ範囲で撮る
//
// 範囲選択で撮った場所を、画面の情報ごと覚えておく（スクロール撮影の範囲は覚えない）。
// 使うときは画面の番号・位置・拡大率・絵の大きさが全部そろったときだけ。1つでも違えば
// 推測で撮らず、ふつうの範囲選択を出す（lib/snap.js と同じく、違う所を撮るくらいなら選び直してもらう）

function regionOf(shot, x, y, w, h) {
  const d = shot.display
  const size = shot.image.getSize()
  return {
    displayId: d.id,
    bounds: { x: d.bounds.x, y: d.bounds.y, width: d.bounds.width, height: d.bounds.height },
    scaleFactor: d.scaleFactor,
    imageW: size.width, imageH: size.height,
    x, y, w, h,
  }
}

function rememberRegion(region) {
  saveSettings({ lastRegion: region })
}

function validRegion(r) {
  if (!r || typeof r !== 'object' || !r.bounds) return false
  const nums = [r.x, r.y, r.w, r.h, r.imageW, r.imageH, r.scaleFactor]
  if (!nums.every(Number.isFinite)) return false
  return r.w >= 1 && r.h >= 1 && r.x >= 0 && r.y >= 0 && r.x + r.w <= r.imageW && r.y + r.h <= r.imageH
}

// 覚えたときと同じ画面が、同じ位置・同じ拡大率で今もあるか
function regionDisplay(r) {
  if (!validRegion(r)) return null
  const b = r.bounds
  return screen.getAllDisplays().find((d) => String(d.id) === String(r.displayId)
    && d.bounds.x === b.x && d.bounds.y === b.y
    && d.bounds.width === b.width && d.bounds.height === b.height
    && d.scaleFactor === r.scaleFactor) || null
}

// 範囲を画面上の位置（DIP）に直す。撮り直しの前に、そこに重なる自分の窓を隠すのに使う
function regionRectDip(r, display) {
  const sx = r.imageW / display.bounds.width
  const sy = r.imageH / display.bounds.height
  return {
    x: display.bounds.x + r.x / sx, y: display.bounds.y + r.y / sy,
    width: r.w / sx, height: r.h / sy,
  }
}

function rectsOverlap(a, b) {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
}

// 暗幕を出さずに、その範囲をすぐ撮る。ふつうの撮影と同じく保存先・履歴・編集画面へ流す。
// 合わないときの範囲選択も await で待つ（呼び出し側が隠した窓を戻すのは、取り込みが済んでから）
// 前と同じ範囲を撮るだけ（開かない）。画面の構成が変わって同じ範囲が使えないときは null
async function grabRegionShot(region) {
  if (capturing || scrollBusy) return null
  const display = regionDisplay(region)
  if (!display) return null
  capturing = true
  let shots
  try {
    shots = await grabAllDisplays()
  } catch (err) {
    capturing = false
    showError('画面の取り込みに失敗しました', String(err))
    return null
  }
  capturing = false
  const shot = shots.find((s) => s.display.id === display.id)
  const size = shot ? shot.image.getSize() : null
  if (!size || size.width !== region.imageW || size.height !== region.imageH) return null
  return { shot, image: shot.image.crop({ x: region.x, y: region.y, width: region.w, height: region.h }) }
}

async function grabRegionImage(region) {
  const g = await grabRegionShot(region)
  return g ? g.image : null
}

async function captureRegion(region, opts) {
  if (capturing || scrollBusy) return
  const pending = settings.captureCursor ? startCursorShot() : null
  const g = await grabRegionShot(region)
  if (!g) { await startRegionCapture('region'); return }
  const r = Object.assign({}, region)
  rememberRegion(r)
  const shape = await cursorShapeFor(pending, g.shot, r.x, r.y, r.w, r.h)
  captureDone(g.image, r, Object.assign({}, opts || {}, shape ? { shapes: [shape] } : {}))
}

function captureLastRegion() {
  return captureRegion(settings.lastRegion)
}

// 録画も同じ範囲で。撮影中・スクロール撮影中・録画中は重ねて動かさない
function recordLastRegion() {
  if (recording || capturing || scrollBusy || (recordWin && !recordWin.isDestroyed())) return
  const r = settings.lastRegion
  const display = regionDisplay(r)
  const W = display ? Math.round(display.bounds.width * display.scaleFactor) : 0
  const H = display ? Math.round(display.bounds.height * display.scaleFactor) : 0
  if (!display || W !== r.imageW || H !== r.imageH) { startRegionCapture('record'); return }
  if (r.w < 64 || r.h < 64) {
    showError('録画には、もう少し大きい範囲が必要です',
      '前回の範囲は ' + r.w + ' × ' + r.h + ' px です。縦横 64 ピクセル以上の範囲を選び直してください。')
    return
  }
  startRecording(display, { x: r.x, y: r.y, width: r.w, height: r.h })
}

// 編集画面の「撮り直す」。その絵を撮った範囲をもう一度撮り、新しい履歴として開く（元の絵は上書きしない）。
// 呼んだ編集画面と、範囲に重なる別の編集画面・出ている履歴パネルは、写り込まないよう隠してから撮る
ipcMain.on('editor:retake', async (e) => {
  const win = BrowserWindow.fromWebContents(e.sender)
  if (!win || win.isDestroyed() || capturing || scrollBusy) return
  const meta = win.libraryId ? readEntry(win.libraryId) : null
  const region = meta && meta.region
  if (!validRegion(region)) return
  const display = regionDisplay(region)
  const rect = display ? regionRectDip(region, display) : null

  const hidden = []
  for (const w of editorWins) {
    if (w.isDestroyed() || !w.isVisible() || w.isMinimized()) continue
    if (w === win || !rect || rectsOverlap(w.getBounds(), rect)) { w.hide(); hidden.push(w) }
  }
  const libWasPinned = !!(libraryWin && !libraryWin.isDestroyed() && libraryWin.isVisible() && settings.libraryPinned)
  await hideLibraryForCapture()
  // hide() の直後はまだ画面に残っていることがあるので、取り込みまで少し待つ
  await delay(220)
  try {
    await captureRegion(region, { editor: true })
  } finally {
    for (const w of hidden) if (!w.isDestroyed()) w.showInactive()
    // ピン留めのパネルだけ戻す。ピン留めでないパネルは、履歴パネルのボタンから撮ったときと同じく引っ込めたまま
    if (libWasPinned) showLibrary(true)
  }
})

async function captureFullScreen() {
  if (capturing) return
  const pending = settings.captureCursor ? startCursorShot() : null
  const target = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  let shots
  try {
    shots = await grabAllDisplays()
  } catch (err) {
    showError('画面の取り込みに失敗しました', String(err))
    return
  }
  const shot = shots.find((s) => s.display.id === target.id) || shots[0]
  if (!shot) return
  const size = shot.image.getSize()
  const shape = await cursorShapeFor(pending, shot, 0, 0, size.width, size.height)
  captureDone(shot.image, undefined, shape ? { shapes: [shape] } : undefined)
}

// ---------------------------------------------------------------- スクロール撮影
//
// 選んだ範囲を撮る → ホイールを送ってスクロール → また撮る、を繰り返し、
// 前後の絵の重なりを見つけて縦につなぐ。継ぎ目の計算は lib/stitch.js。

const SCROLL_MAX_FRAMES = 60
const SCROLL_MAX_HEIGHT = 20000

let scrollBusy = false
let scrollCancel = false

function delay(ms) { return new Promise((r) => setTimeout(r, ms)) }

async function grabDisplay(display) {
  const w = Math.round(display.bounds.width * display.scaleFactor)
  const h = Math.round(display.bounds.height * display.scaleFactor)
  const sources = await desktopCapturer.getSources({
    types: ['screen'], thumbnailSize: { width: w, height: h }, fetchWindowIcons: false,
  })
  let src = sources.find((s) => String(s.display_id) === String(display.id))
  if (!src) src = sources[0]
  return (src && src.thumbnail && !src.thumbnail.isEmpty()) ? src.thumbnail : null
}

// マウスを動かすには「画面ぜんぶを通した物理座標」が要る。
// モニタ一覧から求め、取れなければ拡大率から概算する（1画面ならこれで合う）。
async function physicalOrigin(display) {
  try {
    const line = await helperCmd('scan', 8000)
    const data = line ? JSON.parse(line) : null
    if (data && Array.isArray(data.monitors)) {
      const map = mapMonitors(screen.getAllDisplays(), data.monitors)
      const m = map && map.get(display.id)
      if (m) return { x: m[0], y: m[1] }
    }
  } catch (_) { /* 概算に落とす */ }
  return {
    x: Math.round(display.bounds.x * display.scaleFactor),
    y: Math.round(display.bounds.y * display.scaleFactor),
  }
}

// なめらかスクロールの途中で撮ると継ぎ目がずれるので、動きが止まってから撮る。
// 点滅するカーソルや動く広告で永久に止まらないことがあるため、待ち時間で打ち切る。
async function captureStable(display, crop, stride, maxMs) {
  const t0 = Date.now()
  let prevRows = null
  let last = null
  for (let n = 0; n < 12; n++) {
    const shot = await grabDisplay(display)
    if (!shot) return last
    const buf = shot.crop(crop).toBitmap()
    const rows = rowHashes(buf, crop.width, crop.height, stride)
    last = { buf, rows, waited: Date.now() - t0 }
    if (prevRows && sameRatio(prevRows, rows) >= 0.985) return last
    prevRows = rows
    if (Date.now() - t0 >= maxMs) return last
    await delay(80)
  }
  return last
}

async function runScrollCapture(display, crop) {
  if (scrollBusy) return
  scrollBusy = true
  scrollCancel = false
  scrollLog = []

  const stride = crop.width * 4
  const frames = []
  let savedCursor = null
  let stoppedBecause = ''

  slog('=== スクロール撮影 ' + new Date().toLocaleString('ja-JP') + ' ===')
  slog('範囲: 左上(' + crop.x + ',' + crop.y + ') 大きさ ' + crop.width + ' x ' + crop.height
    + ' px（実ピクセル）/ 見つけられるずれの上限: ' + Math.floor(crop.height * 0.72) + ' px')

  // 浮かせた絵が範囲に重なっていると、ホイールがそちらに吸われて大きさが変わるだけになる
  const pinsHidden = hidePinsForScroll()
  showProgress('準備しています…', display, crop)
  globalShortcut.unregisterAll()
  try { globalShortcut.register('Escape', () => { scrollCancel = true }) } catch (_) {}

  try {
    const origin = await physicalOrigin(display)
    const cx = Math.round(origin.x + crop.x + crop.width / 2)
    const cy = Math.round(origin.y + crop.y + crop.height * 0.55)
    slog('カーソルを ' + cx + ', ' + cy + ' へ移動')

    savedCursor = await helperCmd('cursor', 4000)
    const moved = await helperCmd('move ' + cx + ' ' + cy, 3000)
    if (moved !== 'ok') slog('注意: カーソルを動かせませんでした（返事: ' + moved + '）')
    await delay(250)

    const first = await captureStable(display, crop, stride, 500)
    if (!first) throw new Error('画面を取り込めませんでした')
    frames.push({ buf: first.buf, shift: 0 })
    let prevRows = first.rows
    let prevBuf = first.buf

    // 1目盛りから始める。いきなり大きく送ると重なりが無くなって継ぎ目を見失うため、
    // 1回目で「1目盛り＝何ピクセル動くか」を測ってから歩幅を決める。
    let notches = 1
    let pxPerNotch = 0
    let totalH = crop.height
    let lostRetries = 0
    let zeroRetries = 0
    let step = 0
    let wheelDir = -1        // -1 = 下へスクロール。逆向きの環境だと +1 に変わる
    let flipped = false

    while (frames.length < SCROLL_MAX_FRAMES && step < SCROLL_MAX_FRAMES * 2) {
      if (scrollCancel) { stoppedBecause = 'cancel'; break }
      step++

      await helperCmd('wheel ' + cx + ' ' + cy + ' ' + (wheelDir * 120 * notches), 3000)
      await delay(120)
      const shot = await captureStable(display, crop, stride, 900)
      if (!shot) { stoppedBecause = 'grab'; break }

      const expected = pxPerNotch > 0 ? Math.round(pxPerNotch * notches) : -1
      let found = findShift(prevRows, shot.rows, crop.height, expected)
      slog('step ' + step + ': 目盛り=' + notches + '(' + (wheelDir < 0 ? '下' : '上') + ')'
        + ' → ずれ=' + found.shift + ' 一致度=' + found.score.toFixed(2)
        + ' / 動いていないと仮定=' + found.zeroScore.toFixed(2)
        + ' / 逆向き=' + found.upShift + '(' + found.upScore.toFixed(2) + ')'
        + ' / 絵の同じ割合=' + sameRatio(prevRows, shot.rows).toFixed(2)
        + ' 手がかり=' + found.distinct + ' 帯=' + found.bandStart
        + ' 上位=' + found.top.map((t) => t[0] + ':' + t[1].toFixed(2)).join(' ')
        + ' 落ち着くまで=' + shot.waited + 'ms')

      // 端に動く広告やサイドバーがあると、行ぜんたいでは毎回変わってしまう。真ん中だけで測り直す
      if (found.shift < 0) {
        const x0 = Math.floor(crop.width * 0.25)
        const x1 = Math.floor(crop.width * 0.75)
        const alt = findShift(
          rowHashes(prevBuf, crop.width, crop.height, stride, x0, x1),
          rowHashes(shot.buf, crop.width, crop.height, stride, x0, x1),
          crop.height, expected,
        )
        slog('  → 真ん中だけで測り直し: ずれ=' + alt.shift + ' 一致度=' + alt.score.toFixed(2)
          + ' / 動いていないと仮定=' + alt.zeroScore.toFixed(2))
        if (alt.shift > 0) found = alt
      }

      // ページが逆向き（上）に動いていたら、ホイールの向きが逆の環境。1度だけ直して続ける
      if (found.shift < 0 && !flipped && found.upScore >= 0.8 && found.upShift > 0) {
        flipped = true
        wheelDir = -wheelDir
        slog('  → ページが上に動いた。ホイールの向きを反転してやり直す')
        continue
      }

      // 1回目でつまずいたら、そのときの2枚を残す（あとで目で見て原因を確かめるため）
      if (found.shift < 0 && frames.length === 1) {
        const dir = dumpFrames(crop, frames[0].buf, shot.buf)
        if (dir) slog('  → 比べた2枚を ' + dir + ' に保存しました')
      }

      if (found.shift === 0) {
        // ほんとうに一番下なのか、送りが小さすぎただけなのかを1度だけ確かめる
        if (zeroRetries < 1) {
          zeroRetries++
          notches = Math.min(20, Math.max(3, notches * 3))
          slog('  → 動かなかったので目盛りを ' + notches + ' に増やして再挑戦')
          continue
        }
        stoppedBecause = 'bottom'
        break
      }
      if (found.shift < 0) {
        // 送りすぎて重なりが無くなった可能性。同じだけ戻して歩幅を半分にする
        if (lostRetries < 2 && notches > 1) {
          lostRetries++
          await helperCmd('wheel ' + cx + ' ' + cy + ' ' + (-wheelDir * 120 * notches), 3000)
          await delay(200)
          await captureStable(display, crop, stride, 600)
          notches = Math.max(1, Math.floor(notches / 2))
          slog('  → 継ぎ目を見失ったので戻して、目盛り ' + notches + ' で再挑戦')
          continue
        }
        stoppedBecause = 'lost'
        break
      }

      zeroRetries = 0
      lostRetries = 0
      frames.push({ buf: shot.buf, shift: found.shift })
      totalH += found.shift
      prevRows = shot.rows
      prevBuf = shot.buf
      pxPerNotch = found.shift / notches
      // 次は範囲の 45% ぶんだけ進める（重なりを必ず残すため）
      notches = Math.max(1, Math.min(20, Math.round((crop.height * 0.45) / Math.max(1, pxPerNotch))))
      setProgress('つないでいます… ' + frames.length + '枚目（縦 ' + totalH + 'px）　Esc で中止')
      if (totalH >= SCROLL_MAX_HEIGHT) { stoppedBecause = 'limit'; break }
    }
  } catch (err) {
    stoppedBecause = 'error'
    slog('エラー: ' + String((err && err.stack) || err))
    console.error('スクロール撮影に失敗:', err)
  } finally {
    if (savedCursor && /^-?\d+,-?\d+$/.test(savedCursor)) {
      const p = savedCursor.split(',')
      await helperCmd('move ' + p[0] + ' ' + p[1], 2000)
    }
    try { globalShortcut.unregister('Escape') } catch (_) {}
    applyHotkeys()
    hideProgress()
    stopHelper()
    scrollBusy = false
    for (const w of pinsHidden) if (!w.isDestroyed()) w.showInactive()
    raisePins()
  }

  slog('終了: ' + (stoppedBecause || '上限') + ' / ' + frames.length + '枚')
  writeScrollLog()

  if (!frames.length) {
    showError('スクロール撮影に失敗しました', '画面を取り込めませんでした。')
    return
  }

  const composed = compose(frames, crop.width, crop.height, stride)
  const image = nativeImage.createFromBitmap(composed.buffer, {
    width: composed.width, height: composed.height,
  })
  captureDone(image)

  if (frames.length === 1 && stoppedBecause !== 'cancel') {
    scrollNotice('スクロールできませんでした',
      '1回目のスクロールで、前後の絵がつながりませんでした。\n\n'
      + '・撮影中はマウスに触らないでください（ホイールが別の窓に飛びます）\n'
      + '・ページ本体（文章が並んでいるところ）の上に範囲を取り直してください\n'
      + '・動画や動く広告が入っていると、うまくいかないことがあります\n\n'
      + '「比べた2枚を見る」を押すと、実際に比べた2枚の絵が出ます。\n'
      + '2枚目がスクロールした絵になっていなければ、ホイールが届いていません。',
      true)
  } else if (stoppedBecause === 'lost') {
    scrollNotice('途中までつなぎました',
      '継ぎ目が分からなくなったので、そこで止めて ' + frames.length + '枚ぶんをつなぎました。\n\n'
      + '動く広告や、読み込みで中身が入れ替わるページで起きやすいです。\n'
      + '範囲を狭める（本文だけにする）と通ることがあります。')
  }
}

// 何が起きたかを後から追えるようにする（原因が「送りすぎ」か「動かない」かで対処が違うため）
let scrollLog = []

function scrollLogPath() { return path.join(app.getPath('userData'), 'scroll-log.txt') }
function scrollDebugDir() { return path.join(app.getPath('userData'), 'scroll-debug') }

// つまずいたときに、比べていた2枚をそのまま残す。
// 「2枚目がスクロールした絵になっているか」を目で見れば原因が一発で分かる。
function dumpFrames(crop, before, after) {
  try {
    const dir = scrollDebugDir()
    fs.mkdirSync(dir, { recursive: true })
    const toPng = (buf) => nativeImage
      .createFromBitmap(buf, { width: crop.width, height: crop.height }).toPNG()
    fs.writeFileSync(path.join(dir, '1-スクロール前.png'), toPng(before))
    fs.writeFileSync(path.join(dir, '2-スクロール後.png'), toPng(after))
    return dir
  } catch (err) {
    slog('  → 2枚の保存に失敗: ' + String(err))
    return null
  }
}

function slog(line) {
  scrollLog.push(line)
  if (scrollLog.length > 400) scrollLog.shift()
}

function writeScrollLog() {
  try { fs.writeFileSync(scrollLogPath(), scrollLog.join('\r\n') + '\r\n', 'utf8') } catch (_) {}
}

function scrollNotice(message, detail, withFrames) {
  const buttons = withFrames
    ? ['OK', '詳しい記録を開く', '比べた2枚を見る']
    : ['OK', '詳しい記録を開く']
  dialog.showMessageBox({
    type: 'info',
    title: 'ScreenShooter',
    message,
    detail,
    buttons,
    defaultId: 0,
    cancelId: 0,
  }).then((r) => {
    if (r.response === 1) shell.openPath(scrollLogPath())
    else if (r.response === 2) shell.openPath(scrollDebugDir())
  })
}

// ---------------------------------------------------------------- 進行状況の窓

let progressWin = null

// 撮る範囲に重ならない置き場所を探す（重なると写り込んでしまうため）。
// 四隅のどこにも置けないときは null。
function spotOutside(display, crop, W, H) {
  const k = display.scaleFactor || 1
  const wa = display.workArea
  const rx = display.bounds.x + crop.x / k
  const ry = display.bounds.y + crop.y / k
  const rw = crop.width / k
  const rh = crop.height / k
  const spots = [
    { x: wa.x + 14, y: wa.y + wa.height - H - 14 },
    { x: wa.x + 14, y: wa.y + 14 },
    { x: wa.x + wa.width - W - 14, y: wa.y + wa.height - H - 14 },
    { x: wa.x + wa.width - W - 14, y: wa.y + 14 },
  ]
  for (const s of spots) {
    const clear = s.x + W < rx || s.x > rx + rw || s.y + H < ry || s.y > ry + rh
    if (clear) return { x: Math.round(s.x), y: Math.round(s.y), width: W, height: H }
  }
  return null
}

// 進行状況の窓は、置けないときは出さずトレイの説明文だけで知らせる
function progressSpot(display, crop) { return spotOutside(display, crop, 330, 46) }

function showProgress(text, display, crop) {
  setProgress(text)
  const spot = progressSpot(display, crop)
  if (!spot) return
  if (progressWin && !progressWin.isDestroyed()) { progressWin.setBounds(spot); progressWin.showInactive(); return }
  progressWin = new BrowserWindow({
    x: spot.x, y: spot.y, width: spot.width, height: spot.height,
    show: false, frame: false, resizable: false, movable: false,
    minimizable: false, maximizable: false, fullscreenable: false,
    skipTaskbar: true, alwaysOnTop: true, backgroundColor: '#23262b',
    title: 'ScreenShooter — 実行中',
    webPreferences: { preload: PRELOAD, contextIsolation: true, nodeIntegration: false },
  })
  progressWin.setMenu(null)
  // ただの案内窓なので、開けなければ黙って消す（撮影そのものは止めない）
  loadGuarded(progressWin, path.join(RENDERER, 'progress.html'), '進行状況の窓', { quiet: true })
  progressWin.once('ready-to-show', () => {
    if (!progressWin || progressWin.isDestroyed()) return
    progressWin.setAlwaysOnTop(true, 'screen-saver')
    progressWin.showInactive()
    setProgress(progressText)
  })
  progressWin.on('closed', () => { progressWin = null })
}

let progressText = ''

function setProgress(text) {
  progressText = text
  if (tray) tray.setToolTip('ScreenShooter — ' + text)
  if (progressWin && !progressWin.isDestroyed()) progressWin.webContents.send('progress:text', text)
}

function hideProgress() {
  if (progressWin && !progressWin.isDestroyed()) progressWin.destroy()
  progressWin = null
  if (tray) tray.setToolTip(trayTooltip())
}

ipcMain.on('progress:cancel', () => { scrollCancel = true })

// ---------------------------------------------------------------- 時間差で撮る

let delayTimer = null
let countdownWin = null

// 残り秒数は、カーソルのある画面の真ん中に大きく出す。
// 待っている間にメニューを開いておく使い方なので、この窓はクリックを素通しし、キーの行き先も奪わない
// （手前に出てフォーカスを取ると、開いておいたメニューが閉じてしまう）
function showCountdown(n) {
  if (!countdownWin || countdownWin.isDestroyed()) {
    const wa = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea
    const W = 220, H = 230
    countdownWin = new BrowserWindow({
      width: W, height: H,
      x: Math.round(wa.x + (wa.width - W) / 2), y: Math.round(wa.y + (wa.height - H) / 2),
      show: false, frame: false, transparent: true, resizable: false, movable: false,
      focusable: false, skipTaskbar: true, alwaysOnTop: true, hasShadow: false,
      title: 'ScreenShooter — 時間差',
      webPreferences: { preload: PRELOAD, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
    })
    countdownWin.setIgnoreMouseEvents(true)
    countdownWin.setAlwaysOnTop(true, 'screen-saver')
    countdownWin.on('closed', () => { countdownWin = null })
    const win = countdownWin
    loadGuarded(win, path.join(RENDERER, 'countdown.html'), 'カウントダウン', {
      quiet: true,
      onReady: () => {
        if (win.isDestroyed()) return
        win.webContents.send('countdown:tick', win.lastTick || n)
        win.showInactive()
      },
    })
  }
  countdownWin.lastTick = n
  countdownWin.webContents.send('countdown:tick', n)
}

function hideCountdown() {
  if (countdownWin && !countdownWin.isDestroyed()) countdownWin.destroy()
  countdownWin = null
}

function cancelDelayedCapture() {
  if (delayTimer) clearInterval(delayTimer)
  delayTimer = null
  hideCountdown()
  if (tray) tray.setToolTip(trayTooltip())
}

function startDelayedCapture(seconds) {
  if (delayTimer) clearInterval(delayTimer)
  let left = Math.max(1, Math.min(60, Math.round(seconds) || 5))
  const tick = () => {
    if (left <= 0) {
      clearInterval(delayTimer)
      delayTimer = null
      hideCountdown()
      if (tray) tray.setToolTip(trayTooltip())
      // カウントダウンの窓が画面から消えきってから撮る（写り込まないように）
      setTimeout(() => startRegionCapture('region'), 160)
      return
    }
    showCountdown(left)
    if (tray) tray.setToolTip('ScreenShooter — あと ' + left + ' 秒で撮ります')
    left--
  }
  tick()
  delayTimer = setInterval(tick, 1000)
}

// 設定の秒数（delaySeconds）。壊れていたら 5 秒
function delaySeconds() {
  const n = Math.round(Number(settings.delaySeconds))
  return n >= 1 && n <= 60 ? n : 5
}

// 撮れたら履歴に入れてから、設定の「撮った直後」に従って編集画面を開くか、履歴パネルを出す。
// 編集画面を開くときは履歴パネルを出さない（二重に出てきて邪魔になるため）。
// 自動ぼかし・クリップボードへのコピーは、どちらの場合も編集画面（出さないときは見えない窓）がやる
// （描き方を main 側に真似て書くと、編集画面と見た目が食い違うため）。
// opts.editor は「同じ範囲で撮り直す」から来たとき。編集画面から押したので、設定にかかわらず編集画面で開く
// opts.swap は範囲選択で Ctrl を押しながら確定したとき。ふだん編集画面が出るなら自動コピーに、そうでなければ編集画面にする
function captureDone(image, region, opts) {
  const meta = addToLibrary(image, region)
  // 撮った時点で置く図形（写したカーソル）。ふつうの図形なので、編集画面で動かす・消すができる
  if (meta && opts && Array.isArray(opts.shapes) && opts.shapes.length) {
    meta.shapes = opts.shapes
    writeMeta(meta)
  }
  const opensEditor = settings.quickClipboard !== true && settings.afterCapture !== 'library'
  const swap = !!(opts && opts.swap)
  const editor = !!(opts && opts.editor) || (swap && !opensEditor)
  const quick = !editor && (settings.quickClipboard === true || swap)
  const clip = quick ? 'image' : (CAPTURE_CLIPBOARDS.includes(settings.captureClipboard) ? settings.captureClipboard : 'image')
  const autoBlur = settings.autoBlur !== false
  // ファイルの場所だけなら絵を作る必要がないので、ここで入れてしまう
  if (clip === 'path' && meta && meta.file) clipboard.writeText(meta.file)
  const tasks = { autoBlur, copyMode: clip }
  if (quick && meta) {
    tasks.noticeDisplay = regionDisplay(region) || screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
    runBackgroundEditor(image, meta, tasks)
  } else if (editor || settings.afterCapture !== 'library' || !meta) {
    openEditor(image, meta, tasks)
  } else {
    showLibrary(true)
    if (autoBlur || clip === 'image' || clip === 'imagePath') runBackgroundEditor(image, meta, tasks)
  }
  notifyLibraryChanged()
}

// ---------------------------------------------------------------- マウスカーソルを写す
//
// desktopCapturer の絵にはカーソルが写らないので、撮り始めた瞬間のカーソルの形を tools\cursor.ps1 に聞き、
// 撮った絵の上に「画像」の図形として置く（焼き込まないので、編集画面で動かす・消すができる）。
// 位置は Electron の DIP のカーソル位置を、範囲選択と同じ「絵の大きさ ÷ 画面の幅」の実測比で絵の px に直す
const CURSOR_WAIT_MS = 5000

function readCursorImage() {
  return new Promise((resolve) => {
    const script = path.join(ROOT, 'tools', 'cursor.ps1')
    try {
      execFile(powershellPath(), ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script],
        { timeout: CURSOR_WAIT_MS, windowsHide: true, maxBuffer: 4 * 1024 * 1024, encoding: 'utf8' },
        (err, stdout) => {
          if (err) { resolve(null); return }
          try {
            const d = JSON.parse(String(stdout).trim())
            resolve(d && d.png ? d : null)
          } catch (_) { resolve(null) }
        })
    } catch (_) { resolve(null) }
  })
}

function startCursorShot() {
  const point = screen.getCursorScreenPoint()
  return { point, displayId: screen.getDisplayNearestPoint(point).id, image: readCursorImage() }
}

// 撮った範囲（絵の px で x, y, w, h）に掛かっていれば、カーソルの図形を返す
async function cursorShapeFor(pending, shot, x, y, w, h) {
  if (!pending || !shot || pending.displayId !== shot.display.id) return null
  const cur = await pending.image
  if (!cur) return null
  const size = shot.image.getSize()
  const b = shot.display.bounds
  const px = (pending.point.x - b.x) * (size.width / b.width) - x - (cur.hx || 0)
  const py = (pending.point.y - b.y) * (size.height / b.height) - y - (cur.hy || 0)
  if (px + cur.w <= 0 || py + cur.h <= 0 || px >= w || py >= h) return null
  return {
    id: 1, type: 'image', color: '#000000', width: 0, fontSize: 28, cursor: true,
    src: 'data:image/png;base64,' + cur.png,
    x1: Math.round(px), y1: Math.round(py), x2: Math.round(px) + cur.w, y2: Math.round(py) + cur.h,
  }
}

// ---------------------------------------------------------------- 文字を読み取ってコピー
//
// 選んだ範囲を一時ファイルにして tools\ocr.ps1（Windows の文字読み取り。このパソコンの中だけで完結）で読み、
// 行の順に並べ直した文章を小さな窓に出す。直してからコピーできる。一時ファイルは読み終えたら消す
function runOcr(image) {
  const tmp = path.join(os.tmpdir(), 'screenshooter-ocr-' + process.pid + '-' + Date.now() + '.png')
  const textP = (async () => {
    try { fs.writeFileSync(tmp, image.toPNG()) } catch (_) { return { text: '', empty: true } }
    const ocr = await readTextPositions(tmp)
    try { fs.rmSync(tmp, { force: true }) } catch (_) {}
    const text = ocr ? ocrToText(ocr) : ''
    return { text, empty: !text, translate: !!settings.claudeTranslate }
  })()
  const win = new BrowserWindow({
    width: 700, height: 480, minWidth: 420, minHeight: 260, show: false,
    backgroundColor: '#23262b', title: 'ScreenShooter — 読み取った文字', icon: path.join(ASSETS, 'app.ico'),
    webPreferences: { preload: PRELOAD, contextIsolation: true, nodeIntegration: false },
  })
  win.setMenu(null)
  loadGuarded(win, path.join(RENDERER, 'ocr.html'), '読み取った文字', {
    onReady: async () => {
      const d = await textP
      if (!win.isDestroyed()) win.webContents.send('ocr:init', d)
    },
  })
  win.once('ready-to-show', () => { win.show(); win.focus() })
}

// 翻訳は設定でオンにしたときだけ（文字を外へ送るため）。送るのは文字だけ
ipcMain.handle('ocr:translate', async (e, d) => {
  if (!settings.claudeTranslate) return { ok: false, error: '設定の「AI（Claude）」がオフです' }
  const text = String((d && d.text) || '').slice(0, 20000)
  if (!text.trim()) return { ok: false, error: '翻訳する文字がありません' }
  return claude.translate(text, d && d.to === '英語' ? '英語' : '日本語')
})

ipcMain.on('ocr:copy', (e, text) => {
  clipboard.writeText(String(text || ''))
  const win = BrowserWindow.fromWebContents(e.sender)
  if (win && !win.isDestroyed()) win.close()
})

// ---------------------------------------------------------------- 下の絵を差し替える
//
// 書き込み（図形）はそのままに、下の絵だけを別の絵にする（画面が直ったあと、同じ説明を付け直さずに済むように）。
// 新しい絵は撮ったものと同じく保存先へ新しいファイルとして書き、履歴が指す元の絵をそれに付け替える。
// 前の絵のファイルは消さない（保存先に残るので、戻したいときはそれを開けばよい）。
// 大きさが違う絵にしたときは、切り抜き・省略は合わなくなるので外す（図形と大きさ・余白は残す）
function replaceBaseImage(win, image, region) {
  if (!win || win.isDestroyed() || !image || image.isEmpty()) return
  const meta = win.libraryId ? readEntry(win.libraryId) : null
  if (!meta) { win.show(); return }
  let file
  try {
    fs.mkdirSync(settings.saveDir, { recursive: true })
    file = uniquePath(settings.saveDir, timestampFrom(Date.now()), '.png')
    fs.writeFileSync(file, image.toPNG())
  } catch (err) {
    win.show()
    showError('差し替える絵を保存できませんでした', String(err))
    return
  }
  const size = image.getSize()
  if (size.width !== meta.width || size.height !== meta.height) {
    meta.crop = null
    delete meta.cuts
  }
  meta.previousFiles = (Array.isArray(meta.previousFiles) ? meta.previousFiles : []).concat(meta.file ? [meta.file] : []).slice(-20)
  meta.file = file
  meta.width = size.width
  meta.height = size.height
  if (region) meta.region = region
  else delete meta.region
  writeMeta(meta)
  notifyLibraryChanged()
  // 編集画面は同じ履歴で開き直す（絵が変わると、画面側の大きさ・切り抜きの前提がすべて変わるため）
  const bounds = win.getBounds()
  win.allowClose = true
  win.close()
  openEditor(image, meta, { from: bounds, replaced: true })
}

// 編集画面の「撮り直し・差し替え」のメニューから。画面側は先に書き込みを履歴へ流してから頼んでくる
ipcMain.on('editor:replace', async (e, how) => {
  const win = BrowserWindow.fromWebContents(e.sender)
  if (!win || win.isDestroyed() || capturing || scrollBusy) return
  const meta = win.libraryId ? readEntry(win.libraryId) : null
  if (!meta) return
  if (how === 'clipboard') {
    const img = clipboard.readImage()
    if (img.isEmpty()) { win.webContents.send('editor:toast', 'クリップボードに画像がありません'); return }
    replaceBaseImage(win, img, null)
    return
  }
  if (how === 'file') {
    const r = await dialog.showOpenDialog(win, {
      title: '差し替える絵を選ぶ',
      defaultPath: settings.saveDir,
      properties: ['openFile'],
      filters: [{ name: '画像', extensions: IMPORT_EXTS.map((x) => x.slice(1)) }],
    })
    if (r.canceled || !r.filePaths.length) return
    const img = nativeImage.createFromPath(r.filePaths[0])
    if (img.isEmpty()) { win.webContents.send('editor:toast', 'この画像は読めませんでした'); return }
    replaceBaseImage(win, img, null)
    return
  }
  // 撮って差し替える。撮る前に編集画面を隠す（写り込まないように）
  win.hide()
  await hideLibraryForCapture()
  await delay(220)
  if (how === 'sameRegion' && validRegion(meta.region)) {
    const img = await grabRegionImage(meta.region)
    if (img) { replaceBaseImage(win, img, meta.region); return }
  }
  // 前と同じ範囲が使えないとき（画面の構成が変わった）も、選び直してもらう
  startRegionCapture('replace', { win })
})

// 撮った直後に編集画面を出さない設定のとき、自動ぼかし・コピーを見えない編集画面にやらせる。
// 終わるまでに同じ履歴を開こうとしたら、終わるのを待ってから開く（両方が履歴へ書いて上書きし合わないように）
const BACKGROUND_WAIT_MS = 60000
const backgroundJobs = new Map()   // 履歴の ID → 終わったら解ける Promise
const backgroundDone = new Map()   // 見えない窓の webContents.id → 終わりを受け取る関数

function runBackgroundEditor(image, meta, tasks) {
  const job = new Promise((resolve) => {
    const win = new BrowserWindow({
      show: false, width: 1230, height: 800, skipTaskbar: true,
      webPreferences: { preload: PRELOAD, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
    })
    // 自動ぼかしの読み取り（editor:findPrivate）は、窓が持つ履歴の ID で絵を決める
    win.libraryId = meta.id
    win.captureNoticeDisplay = tasks.noticeDisplay
    const wcId = win.webContents.id
    let done = false
    const finish = (d) => {
      if (done) return
      done = true
      clearTimeout(timer)
      backgroundDone.delete(wcId)
      backgroundJobs.delete(meta.id)
      if (!win.isDestroyed()) win.destroy()
      notifyLibraryChanged()
      if (d && d.blurred > 0) libraryToast('個人情報らしき所を ' + d.blurred + ' か所ぼかしました。必ず自分の目でも確認してください')
      resolve()
    }
    const timer = setTimeout(() => finish(null), BACKGROUND_WAIT_MS)
    backgroundDone.set(wcId, finish)
    win.on('closed', () => finish(null))
    loadGuarded(win, path.join(RENDERER, 'editor.html'), '撮った直後の処理', {
      quiet: true,
      onGiveUp: () => finish(null),
      onReady: () => win.webContents.send('editor:init', Object.assign(editorInitData(image, meta), { autoBlur: tasks.autoBlur, copyMode: tasks.copyMode, background: true })),
    })
  })
  backgroundJobs.set(meta.id, job)
  return job
}

ipcMain.on('editor:backgroundDone', (e, d) => {
  const finish = backgroundDone.get(e.sender.id)
  if (finish) finish(d || null)
})

let captureNoticeWin = null

// コピーが成功してから、操作の邪魔をしない窓を1秒だけ出す。
function showCaptureNotice(display) {
  if (captureNoticeWin && !captureNoticeWin.isDestroyed()) captureNoticeWin.destroy()
  const area = display.workArea
  const width = Math.min(380, area.width)
  const height = 58
  const win = new BrowserWindow({
    x: Math.round(area.x + (area.width - width) / 2),
    y: Math.round(area.y + area.height * 0.8 - height / 2),
    width, height, frame: false, resizable: false, show: false,
    focusable: false, skipTaskbar: true, alwaysOnTop: true,
    backgroundColor: '#23262b',
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  })
  captureNoticeWin = win
  win.setIgnoreMouseEvents(true)
  win.setContentProtection(true)
  let timer = null
  let shown = false
  win.on('closed', () => {
    clearTimeout(timer)
    if (captureNoticeWin === win) captureNoticeWin = null
  })
  loadGuarded(win, path.join(RENDERER, 'capture-notice.html'), 'コピー完了の通知', {
    quiet: true,
    onGiveUp: () => { if (!win.isDestroyed()) win.destroy() },
    onReady: () => {
      if (shown || win.isDestroyed()) return
      shown = true
      win.setAlwaysOnTop(true, 'screen-saver')
      win.showInactive()
      timer = setTimeout(() => { if (!win.isDestroyed()) win.destroy() }, 1000)
    },
  })
}

// 撮った直後のコピー。絵（と、選んでいればファイルの場所の文字）を一度に入れる
ipcMain.handle('app:copyCaptured', (e, d) => {
  if (!d || typeof d.dataUrl !== 'string') return { ok: false }
  try {
    const img = nativeImage.createFromDataURL(d.dataUrl)
    if (img.isEmpty()) return { ok: false }
    if (d.mode === 'imagePath' && typeof d.path === 'string' && d.path) clipboard.write({ image: img, text: d.path })
    else clipboard.writeImage(img)
    const win = BrowserWindow.fromWebContents(e.sender)
    if (win && win.captureNoticeDisplay) showCaptureNotice(win.captureNoticeDisplay)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
})

// ---------------------------------------------------------------- 録画（GIF・動画）
//
// 選んだ範囲を録って、動画(MP4)と GIF を同時に作る。作るところは renderer/record.js。
// 操作バーは撮る範囲の外に置き、さらに「録画に写らない窓」にしてある。

const RECORD_MAX_SEC = 600
const RECORD_BAR = { width: 380, height: 54 }
// 確認画面を最前面のままにしておく長さ。持ち上げ終わるのを待つだけなので短くてよい
const RECORD_FRONT_MS = 600

let recordWin = null
let recordDisplayId = null
let recording = false

function startRecording(display, crop, firstImage) {
  if (recording || (recordWin && !recordWin.isDestroyed())) return
  recording = true
  recordPaused = false
  recordDisplayId = display.id

  const wa = display.workArea
  const at = spotOutside(display, crop, RECORD_BAR.width, RECORD_BAR.height) || {
    x: Math.round(wa.x + (wa.width - RECORD_BAR.width) / 2),
    y: wa.y + 8,
    width: RECORD_BAR.width,
    height: RECORD_BAR.height,
  }

  recordWin = new BrowserWindow({
    x: at.x, y: at.y, width: at.width, height: at.height,
    show: false, frame: false, resizable: false,
    minimizable: false, maximizable: false, fullscreenable: false,
    skipTaskbar: true, alwaysOnTop: true, backgroundColor: '#23262b',
    title: 'ScreenShooter — 録画',
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  })
  recordWin.setMenu(null)
  // 操作バー自身が録画に写り込まないようにする（Windows 10 2004 以降で効く）
  try { recordWin.setContentProtection(true) } catch (_) {}
  // once: 録り始めたあとに死んだら、やり直さず諦める。
  // 読み込み直すと record:init をもう一度送ることになり、黙って録り直しが始まってしまう
  loadGuarded(recordWin, path.join(RENDERER, 'record.html'), '録画の操作バー', {
    once: true,
    onGiveUp: closeRecordWindow,
    onReady: () => {
      // 設定で決めた秒数だけ、画面の真ん中に大きくカウントダウンしてから録る。
      // カウントダウンの窓は録り始める前に消す（写り込まないように）
      const count = [3, 5].includes(settings.recordCountdown) ? settings.recordCountdown : 0
      // 自動ぼかしは、録り始める前に1回読んでおく（カウントダウンと並行して）
      if (settings.recordAutoBlur !== false) recordBlurScan(display, crop, firstImage)
      if (count) {
        let left = count
        showCountdown(left)
        const t = setInterval(() => {
          left--
          if (!recordWin || recordWin.isDestroyed()) { clearInterval(t); hideCountdown(); return }
          if (left > 0) { showCountdown(left); return }
          clearInterval(t)
          hideCountdown()
          beginRecord()
        }, 1000)
        return
      }
      beginRecord()
    },
  })
  // 範囲選択の暗幕が消えきってから録り始める（消える途中が写り込まないように）
  function beginRecord() {
      if (settings.recordAutoBlur !== false) {
        clearInterval(recordBlurTimer)
        recordBlurTimer = setInterval(() => recordBlurScan(display, crop, null), RECORD_BLUR_MS)
      }
      setTimeout(() => {
        if (!recordWin || recordWin.isDestroyed()) return
        recordWin.webContents.send('record:init', {
          crop,
          displayW: Math.round(display.bounds.width * display.scaleFactor),
          displayH: Math.round(display.bounds.height * display.scaleFactor),
          fps: settings.recordFps || 15,
          gifFps: settings.gifFps || 10,
          gifMaxWidth: Number.isFinite(settings.gifMaxWidth) ? settings.gifMaxWidth : 0,
          audio: settings.recordAudio !== false,
          maxSec: RECORD_MAX_SEC,
          autoBlur: settings.recordAutoBlur !== false,
          blurBoxes: recordBlurBoxes,
        })
      }, 250)
  }
  recordWin.once('ready-to-show', () => {
    if (!recordWin || recordWin.isDestroyed()) return
    recordWin.setAlwaysOnTop(true, 'screen-saver')
    recordWin.showInactive()
  })
  recordWin.on('closed', () => {
    stopRecordBlur()
    recordWin = null
    recording = false
    refreshTrayMenu()
  })
  refreshTrayMenu()
}

// ---- 録画中の自動ぼかし
// 録画中も RECORD_BLUR_MS ごとに録る範囲の文字を読み、個人情報らしい所の四角を録画の画面へ送る。
// 画面側は、次に届くまでその四角にモザイクをかけたまま録る（読むあいだにスクロールした所は見落とすことがある）
const RECORD_BLUR_MS = 2500
let recordBlurTimer = null
let recordBlurBusy = false
let recordBlurBoxes = []

async function recordBlurScan(display, crop, image) {
  if (recordBlurBusy) return
  recordBlurBusy = true
  const tmp = path.join(os.tmpdir(), 'screenshooter-recblur-' + process.pid + '.png')
  try {
    let img = image
    if (!img) {
      const full = await grabDisplay(display)
      if (!full) return
      img = full.crop({ x: crop.x, y: crop.y, width: crop.width, height: crop.height })
    }
    fs.writeFileSync(tmp, img.toPNG())
    const ocr = await readTextPositions(tmp)
    if (!ocr) return
    let userName = ''
    try { userName = os.userInfo().username } catch (_) {}
    const boxes = findPrivateBoxes(ocr, { userName, words: settings.autoBlurWords, labels: settings.autoBlurLabels, level: settings.autoBlurLevel })
    recordBlurBoxes = boxes.map((b) => ({ x: b.x, y: b.y, w: b.w, h: b.h }))
    if (recordWin && !recordWin.isDestroyed()) recordWin.webContents.send('record:blur', recordBlurBoxes)
  } catch (err) {
    console.error('録画の自動ぼかしの読み取りに失敗:', err)
  } finally {
    try { fs.rmSync(tmp, { force: true }) } catch (_) {}
    recordBlurBusy = false
  }
}

function stopRecordBlur() {
  clearInterval(recordBlurTimer)
  recordBlurTimer = null
  recordBlurBoxes = []
}

function stopRecording() {
  if (!recordWin || recordWin.isDestroyed()) return
  recordWin.webContents.send('record:stop')
}

let recordPaused = false
function pauseRecording() {
  if (!recordWin || recordWin.isDestroyed() || !recording) return
  recordWin.webContents.send('record:pause')
}

function closeRecordWindow() {
  if (recordWin && !recordWin.isDestroyed()) { recordWin.allowClose = true; recordWin.destroy() }
  recordWin = null
  recording = false
  refreshTrayMenu()
}

ipcMain.on('record:cancel', () => closeRecordWindow())

ipcMain.on('record:state', (e, d) => {
  recording = !!(d && d.recording)
  recordPaused = !!(d && d.paused)
  if (!recording) stopRecordBlur()
  refreshTrayMenu()
})

ipcMain.on('record:error', (e, d) => {
  closeRecordWindow()
  showError((d && d.message) ? d.message : '録画できませんでした', d ? d.detail : '')
})

// 止めたあとは確認と保存の画面になるので、窓を大きくして画面の真ん中に置き直す
ipcMain.on('record:resize', (e, d) => {
  const win = BrowserWindow.fromWebContents(e.sender)
  if (!win || win.isDestroyed()) return
  const wa = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea
  const w = Math.min(Math.round(d.width) || 660, wa.width - 40)
  const h = Math.min(Math.round(d.height) || 560, wa.height - 40)
  try { win.setContentProtection(false) } catch (_) {}
  win.setResizable(true)
  win.setMinimumSize(420, 320)
  win.setBounds({
    x: Math.round(wa.x + (wa.width - w) / 2),
    y: Math.round(wa.y + (wa.height - h) / 2),
    width: w, height: h,
  })
  // 「保存する？」を聞く窓なので、出た瞬間に1回だけ手前へ持ち上げる。
  // Windows は裏で動いているアプリからの focus() を無視するので、いったん最前面に
  // 上げてから普通の窓に戻す（出しっぱなしだと他の作業のじゃまになる）。
  // 後ろに回り込んでもタスクバーから戻せるよう skipTaskbar は外したままにする。
  win.setSkipTaskbar(false)   // タスクバーと Alt+Tab にも出す
  win.setAlwaysOnTop(true, 'floating')
  win.show()
  win.moveTop()
  win.focus()
  try { app.focus({ steal: true }) } catch (_) {}
  try { win.flashFrame(true) } catch (_) {}
  setTimeout(() => {
    if (win.isDestroyed()) return
    win.setAlwaysOnTop(false)   // ここから先は普通の窓。他を触れば後ろに回ってよい
  }, RECORD_FRONT_MS)
})

// 録れたものは、その場で保存先フォルダに動画と GIF を置く。
// 履歴にはサムネイルだけを持たせ、同じ動画を2箇所に置かない。
function addRecordingToLibrary(d) {
  const id = lib().newId()
  const dir = entryDir(id)
  const ext = (typeof d.ext === 'string' && /^[a-z0-9]{2,5}$/.test(d.ext)) ? d.ext : 'mp4'
  const createdAt = Date.now()
  let videoFile = null
  let gifFile = null
  let videoBytes = 0
  let gifBytes = 0

  try {
    fs.mkdirSync(settings.saveDir, { recursive: true })
    // 動画と GIF は同じ名前で拡張子だけ変える。1回の録画だと分かるようにするため
    const base = path.basename(uniquePath(settings.saveDir, timestampFrom(createdAt), '.' + ext), '.' + ext)
    if (d.video && d.video.length) {
      videoFile = path.join(settings.saveDir, base + '.' + ext)
      fs.writeFileSync(videoFile, Buffer.from(d.video))
      videoBytes = d.video.length
    }
    if (d.gif && d.gif.length) {
      gifFile = path.join(settings.saveDir, base + '.gif')
      fs.writeFileSync(gifFile, Buffer.from(d.gif))
      gifBytes = d.gif.length
    }
  } catch (err) {
    console.error('録画の保存に失敗:', err)
    return { ok: false, error: String(err) }
  }

  try {
    fs.mkdirSync(dir, { recursive: true })
    if (d.thumbDataUrl) {
      const img = nativeImage.createFromDataURL(d.thumbDataUrl)
      if (!img.isEmpty()) fs.writeFileSync(path.join(dir, 'thumb.png'), img.toPNG())
    }
  } catch (err) {
    console.error('履歴への追加に失敗:', err)
  }

  const meta = {
    id,
    createdAt,
    kind: 'video',
    width: d.width,
    height: d.height,
    durationMs: Math.round(d.durationMs) || 0,
    videoExt: ext,
    videoFile,
    gifFile,
    videoBytes,
    gifBytes,
    shapes: [], crop: null,
  }
  writeMeta(meta)
  pruneLibrary()
  notifyLibraryChanged()
  return { ok: true, id, videoPath: videoFile, gifPath: gifFile }
}

ipcMain.handle('record:store', (e, d) => addRecordingToLibrary(d))

// 古い履歴は録画を自分のフォルダに持っているので、そちらも見る
function recordingFile(meta, kind) {
  const saved = kind === 'gif' ? meta.gifFile : meta.videoFile
  if (saved && fs.existsSync(saved)) return saved
  return path.join(entryDir(meta.id), kind === 'gif' ? 'movie.gif' : 'movie.' + (meta.videoExt || 'mp4'))
}

// 録画も撮った時点で保存済み。ここは名前を付け直したいときだけ通る（同じ1個を動かす）
ipcMain.handle('record:save', async (e, d) => {
  const win = BrowserWindow.fromWebContents(e.sender)
  const meta = readEntry(d.id)
  if (!meta) return { ok: false, error: '履歴に見つかりません' }
  const src = recordingFile(meta, d.kind)
  if (!fs.existsSync(src)) return { ok: false, error: 'ファイルがありません' }
  const ext = d.kind === 'gif' ? 'gif' : (meta.videoExt || 'mp4')

  const r = await dialog.showSaveDialog(win, {
    title: '名前を付けて保存',
    defaultPath: src,
    filters: [{ name: d.kind === 'gif' ? 'GIF 動画' : '動画', extensions: [ext] }],
  })
  if (r.canceled || !r.filePath) return { ok: false, canceled: true }
  if (r.filePath === src) return { ok: true, path: src }

  try {
    fs.mkdirSync(path.dirname(r.filePath), { recursive: true })
    moveFile(src, r.filePath)
  } catch (err) {
    return { ok: false, error: String(err) }
  }
  if (d.kind === 'gif') meta.gifFile = r.filePath
  else meta.videoFile = r.filePath
  writeMeta(meta)
  notifyLibraryChanged()
  return { ok: true, path: r.filePath, moved: true }
})

function openRecording(id, kind) {
  const meta = readEntry(id)
  if (!meta) return
  const p = recordingFile(meta, kind)
  if (fs.existsSync(p)) shell.openPath(p)
  else showError('ファイルが見つかりませんでした', p)
}

// ---------------------------------------------------------------- 編集ウィンドウ

const editorWins = new Set()
const QUIT_WAIT_MS = 3000   // 「終了」のとき、編集画面が図形を書き出し終えるのを待つ上限

// 集中モードで道具を出すかどうかは、カーソルの実位置で決める。
// 画面側の mouseleave は、窓の枠ぎわや「つかんで動かす」領域の上を通ると取りこぼす
const FOCUS_WATCH_MS = 200
let focusWatchTimer = null

function watchFocusCursor() {
  if (focusWatchTimer) return
  focusWatchTimer = setInterval(() => {
    const wins = [...editorWins].filter((w) => !w.isDestroyed() && w.focusMode)
    if (!wins.length) { clearInterval(focusWatchTimer); focusWatchTimer = null; return }
    const p = screen.getCursorScreenPoint()
    for (const w of wins) {
      const b = w.getBounds()
      const inside = p.x >= b.x && p.x < b.x + b.width && p.y >= b.y && p.y < b.y + b.height
      if (w.uiOn === inside) continue
      w.uiOn = inside
      w.webContents.send('editor:ui', inside)
    }
  }, FOCUS_WATCH_MS)
}

// タイトルバーはファイル名から始める。見比べるときに一覧で区別が付くようにするため
function setEditorTitle(win, meta) {
  if (!win || win.isDestroyed()) return
  const name = displayName(meta)
  win.setTitle(name ? name + ' — ScreenShooter' : 'ScreenShooter — 編集')
  // タイトルバーは画面側で自作しているので、同じ文字をそちらにも出す
  if (!win.webContents.isDestroyed()) win.webContents.send('editor:title', win.getTitle())
}

// 保存でファイル名が変わったら、その窓のタイトルも付け替える
function refreshEditorTitle(id) {
  const meta = readEntry(id)
  if (!meta) return
  for (const w of editorWins) {
    if (!w.isDestroyed() && w.libraryId === id) setEditorTitle(w, meta)
  }
}

// 集中モードの窓の大きさ。絵は拡大しないので、画面に入る範囲で原寸に近づける
function focusSize(dipW, dipH, wa) {
  const k = Math.min(1, (wa.width * 0.94) / dipW, (wa.height * 0.94) / dipH)
  return { w: Math.max(140, Math.round(dipW * k)), h: Math.max(90, Math.round(dipH * k)) }
}

// 集中モードの窓は絵の縦横比ちょうどに保つ。setAspectRatio が効かない場合に備えて、
// 手を離した時点（resized）にも測り直して直す
function keepAspect(win, ratio) {
  win.aspect = ratio > 0 ? ratio : 0
  win.setAspectRatio(win.aspect)
  if (win.aspectHooked) return
  win.aspectHooked = true
  win.on('resized', () => {
    if (win.isDestroyed() || !win.aspect || win.isMaximized()) return
    const c = win.getContentSize()
    const h = Math.max(1, Math.round(c[0] / win.aspect))
    if (h === c[1]) return
    win.setContentSize(c[0], h)
  })
}

// 編集画面へ渡す初期データ。履歴パネルからのコピー（見えない編集画面）も同じものを使う
function editorInitData(image, meta) {
  const size = image.getSize()
  return {
    dataUrl: image.toDataURL(),
    width: size.width,
    height: size.height,
    color: settings.color,
    lineWidth: settings.lineWidth,
    markerWidth: settings.markerWidth,
    markerColor: settings.markerColor,
    fontSize: settings.fontSize,
    deco: settings.textDeco,
    halo: settings.textHalo,
    finish: exportFinish(),
    lineDash: LINE_DASHES.includes(settings.lineDash) ? settings.lineDash : 'solid',
    rectRadius: RECT_RADII.includes(settings.rectRadius) ? settings.rectRadius : 0,
    zoomK: ZOOM_FACTORS.includes(settings.zoomK) ? settings.zoomK : 2,
    padLast: validPad(settings.padLast),
    textFace: TEXT_FACES.includes(settings.textFace) ? settings.textFace : 'gothic',
    textBold: settings.textBold !== false,
    textItalic: !!settings.textItalic,
    textUnderline: !!settings.textUnderline,
    textAlign: TEXT_ALIGNS.includes(settings.textAlign) ? settings.textAlign : 'left',
    stylePresets: stylePresets(),
    libraryId: meta ? meta.id : null,
    canRetake: !!(meta && validRegion(meta.region)),
    shapes: meta ? (meta.shapes || []) : [],
    crop: meta ? (meta.crop || null) : null,
    scale: entryScale(meta),
    cuts: entryCuts(meta),
    pad: meta ? validPad(meta.pad) : null,
    resizeLast: settings.resizeLast || null,
    savedPath: meta ? (meta.file || null) : null,
    editedPath: meta ? (meta.editedPath || null) : null,
    fileName: displayName(meta),
    createdAt: meta ? meta.createdAt : null,
  }
}

// opts は集中モードの出入りで窓を作り直すとき、違いに赤枠を付けるとき、撮った直後だけ渡す
// （focus: 枠なしにするか / from: 前の窓の位置 / viewW,viewH: 今見えている絵の大きさ / carry: 引き継ぐ状態
//   / addShapes: 開いたあとに足す図形 / autoBlur: 開いたあと裏で個人情報を探してぼかす）
// 自作のタイトルバーの高さ。editor.css の #titlebar と合わせる
const EDITOR_TITLE_H = 40
// 下の帯（文字 16px）が仕上げ＋「見る」＋「サイズ 77.1%」ありでも1行に収まる幅（実測 1203）
const EDITOR_MIN_W = 1230

function openEditor(image, meta, opts) {
  const o = opts || {}
  const focus = !!o.focus
  // 大きさを変えてある絵は、その大きさで窓を見積もる
  const sk = o.carry && validScale(o.carry.scale) ? o.carry.scale : entryScale(meta)
  const cuts = o.carry && Array.isArray(o.carry.cuts) ? validCuts(o.carry.cuts) : entryCuts(meta)
  const size0 = image.getSize()
  const size = {
    width: Math.round(size0.width * sk),
    height: Math.round(Math.max(1, size0.height - cutsHeight(cuts, size0.height)) * sk),
  }
  // 切り抜き・はみ出しを入れた「いま見えている絵」。集中モードの窓はこの比にする
  const viewW = o.viewW > 0 ? o.viewW : size.width
  const viewH = o.viewH > 0 ? o.viewH : size.height
  const disp = o.from
    ? screen.getDisplayMatching(o.from)
    : screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const sf = disp.scaleFactor || 1
  const wa = disp.workArea
  // 編集画面の 100% は「絵の1px = CSS 1px」なので、窓も絵の実ピクセルをそのまま CSS px として見積もる。
  // 拡大率で割ると、150% の画面では窓が小さすぎて、小さな絵まで縮めて出てしまう。
  // 幅は 1160 以上あるとツールバーが2段で収まる（実測 97px。境目は約 1130、それ未満は3段 135px）。
  // 既定は下の帯が1行に収まる最小幅（EDITOR_MIN_W）に合わせる
  const ew = Math.round(Math.min(Math.max(size.width + 40, EDITOR_MIN_W), wa.width * 0.94))
  // ツールバー＋下の帯 44px＋自作のタイトルバー（EDITOR_TITLE_H）
  const CHROME = ew >= 1160 ? 183 : 221
  const box = focus ? focusSize(viewW / sf, viewH / sf, wa) : {
    w: ew,
    h: Math.round(Math.min(Math.max(size.height + CHROME + 40, 580), wa.height * 0.94)),
  }
  const w = box.w
  const h = box.h

  // 集中モードへ出入りするときは、前の窓の真ん中を保って開き直す（絵が飛ばないように）
  const base = o.from || { x: wa.x, y: wa.y, width: wa.width, height: wa.height }
  const x = Math.max(wa.x, Math.min(Math.round(base.x + (base.width - w) / 2), wa.x + wa.width - w))
  const y = Math.max(wa.y, Math.min(Math.round(base.y + (base.height - h) / 2), wa.y + wa.height - h))

  // 通常の窓の最小幅は、下の帯（大きさ・自動ぼかし・浮かせる・仕上げ・お気に入り4つ・拡大縮小と倍率）が1行に収まる幅。
  // 帯に物を足したら、いちばん狭い幅で右端の倍率が見えるかを測り直して EDITOR_MIN_W を広げる
  const win = new BrowserWindow({
    width: w,
    height: h,
    x,
    y,
    minWidth: focus ? 140 : EDITOR_MIN_W,
    minHeight: focus ? 90 : 480,
    frame: !focus,
    // Windows 標準のタイトルバーは文字を大きくできないので隠し、画面側の #titlebar で描く。
    // 最小化・最大化・閉じるのボタンは Windows に重ねて描かせる（スナップなどの動きをそのまま残すため）
    ...(focus ? {} : {
      titleBarStyle: 'hidden',
      titleBarOverlay: { color: '#1f2227', symbolColor: '#e8eaed', height: EDITOR_TITLE_H },
    }),
    show: false,
    backgroundColor: '#23262b',
    title: 'ScreenShooter — 編集',
    icon: path.join(ASSETS, 'app.ico'),
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  win.libraryId = meta ? meta.id : null
  win.focusMode = focus
  win.setMenu(null)
  if (focus) {
    // 拡大率 150% の画面などでは窓の大きさが 1px 単位で丸められ、絵との間に隙間ができる。
    // 中身の大きさを直に指定すると、狙った大きさちょうどになる
    keepAspect(win, viewW / viewH)
    win.setContentSize(w, h)
    watchFocusCursor()
  }
  // 画面側の <title> に上書きされないよう止めてから、ファイル名をタイトルにする。
  // 何枚も並べて見比べるとき、タイトルバーとタスクバーで「何時の絵か」が分かるようにするため。
  win.on('page-title-updated', (e) => e.preventDefault())
  setEditorTitle(win, meta)
  loadGuarded(win, path.join(RENDERER, 'editor.html'), '編集の画面', {
    onReady: () => {
      win.webContents.send('editor:init', Object.assign(editorInitData(image, meta), {
        focus,
        // 窓を作り直すときは、履歴より新しい「画面側の今の状態」で上書きする
        carry: o.carry || null,
        // 「違いに赤枠を付ける」で足す四角。画面側が元に戻せる1回の変更として足す
        addShapes: o.addShapes || null,
        autoBlur: !!o.autoBlur,
        // 撮った直後だけ：自動ぼかしのあとクリップボードへ入れる
        replaced: !!o.replaced,
        copyMode: o.copyMode || 'off',
      }))
      win.webContents.send('editor:title', win.getTitle())
    },
  })
  win.once('ready-to-show', () => { win.show(); win.focus() })

  // 閉じる前に、まだ書き出していない図形を履歴へ流し込ませる。
  // 画面側が死んでいるときは待たずに閉じる（閉じられなくなるのを防ぐため）。
  // 「終了」の途中でここを止めると終了ごと取り消されるので、閉じ終えた 'closed' で終了をやり直す。
  // 終了のときだけは、画面側が返事をしなくても時間切れで閉じる（アプリが残り続けないように）
  win.on('close', (e) => {
    if (win.allowClose) return
    if (win.webContents.isDestroyed() || win.webContents.isCrashed()) return
    e.preventDefault()
    win.webContents.send('editor:requestClose')
    if (app.isQuitting) {
      setTimeout(() => { if (!win.isDestroyed()) { win.allowClose = true; win.close() } }, QUIT_WAIT_MS)
    }
  })
  win.on('unresponsive', () => { win.allowClose = true })

  win.on('closed', () => {
    editorWins.delete(win)
    if (app.isQuitting) app.quit()
  })
  editorWins.add(win)
}

async function openEditorFromLibrary(id) {
  // 撮った直後の処理（自動ぼかしなど）がまだ裏で動いていたら、済んでから開く
  if (backgroundJobs.has(id)) {
    libraryToast('自動ぼかしの途中です。済んだら開きます')
    await backgroundJobs.get(id)
  }
  const meta = readEntry(id)
  if (!meta) return
  for (const w of editorWins) {
    if (!w.isDestroyed() && w.libraryId === id) {
      if (w.isMinimized()) w.restore()
      w.show(); w.focus()
      return
    }
  }
  const img = originalImage(meta)
  // 保存先のファイルを消した・動かしたときはここへ来る。履歴にコピーを持っていないので開けない
  if (!img) {
    showError('元の画像が見つかりませんでした', meta.file || id)
    return
  }
  openEditor(img, meta)
}

function timestampFrom(ms) {
  const d = new Date(ms)
  const p = (n) => String(n).padStart(2, '0')
  return 'ScreenShooter_' + d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
    + '_' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds())
}

function timestampBase() { return timestampFrom(Date.now()) }

// 縦長の絵を切り分けて保存する。1枚目で group（ファイル名の共通部分）を決め、以降は使い回す
ipcMain.handle('app:savePiece', async (e, data) => {
  const group = (typeof data.group === 'string' && data.group) ? data.group : timestampBase()
  const total = Math.max(1, Number(data.total) || 1)
  const index = Math.max(1, Number(data.index) || 1)
  const name = group + '_' + index + 'of' + total + '.png'
  try {
    fs.mkdirSync(settings.saveDir, { recursive: true })
    const target = path.join(settings.saveDir, name)
    fs.writeFileSync(target, nativeImage.createFromDataURL(data.dataUrl).toPNG())
    return { ok: true, group, path: target }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
})

// 原本は撮った瞬間に保存済みなので、ここでやることは3通りしかない。
//   書き込み無し・保存      … もう出すものがない（既に保存済みと返すだけ）
//   書き込み無し・名前を付けて … 原本をその名前へ動かす（コピーしない＝増やさない）
//   書き込みあり            … 焼いた絵を「_書き込み.png」として別に出す（原本は残す）。仕上げだけのときもこちら
// 原本を潰さないのは、あとから矢印や文字を動かし直せるようにしておくため。
// 保存できたら、いつも Ctrl+C を押してから保存していたので、同じ最終の絵をクリップボードにも入れる
// （閉じたあとそのまま貼れる。名前のダイアログをやめた・保存に失敗したときは入れない）。
// 中身を saveImage に分けたのは、ここで dataUrl を二度 IPC で渡さずに済ませるため。
ipcMain.handle('app:save', async (e, data) => {
  const r = await saveImage(e, data)
  if (r && r.ok) r.copied = copyImage(data.dataUrl).ok
  return r
})

// 元の絵が大きすぎるとき（30MB 超）は入れない。書き込み版が重くなりすぎるため
const EMBED_MAX_BYTES = 30 * 1024 * 1024

function embedEdits(buf, meta) {
  try {
    const src = originalPath(meta)
    if (!src) return buf
    const orig = fs.readFileSync(src)
    if (orig.length > EMBED_MAX_BYTES) return buf
    return pngmeta.embed(buf, {
      app: 'ScreenShooter', v: 1,
      name: path.basename(src),
      width: meta.width, height: meta.height,
      shapes: meta.shapes || [], crop: meta.crop || null,
      scale: entryScale(meta), cuts: entryCuts(meta), pad: validPad(meta.pad),
      title: meta.title || '', tags: meta.tags || [],
      original: orig.toString('base64'),
    })
  } catch (err) {
    console.error('編集の情報を入れられませんでした:', err)
    return buf
  }
}

// ScreenShooter の書き込み版（編集の情報入り）なら、元の絵を保存先へ書き出し、図形ごと履歴に入れる。
// ふつうの絵なら null（いつもどおり取り込む）
function importWithEdits(src) {
  let info = null
  try { info = pngmeta.extract(fs.readFileSync(src)) } catch (_) { info = null }
  if (!info || typeof info.original !== 'string') return null
  const orig = Buffer.from(info.original, 'base64')
  const img = nativeImage.createFromBuffer(orig)
  if (img.isEmpty()) return null
  let file
  try {
    fs.mkdirSync(settings.saveDir, { recursive: true })
    const base = path.basename(String(info.name || ''), path.extname(String(info.name || ''))) || path.basename(src, path.extname(src))
    file = uniquePath(settings.saveDir, cleanFileBase(base) || timestampBase(), '.png')
    fs.writeFileSync(file, orig)
  } catch (err) {
    console.error('元の絵を書き出せませんでした:', err)
    return null
  }
  const meta = addFileToLibrary(file, img, src)
  if (!meta) return null
  meta.shapes = Array.isArray(info.shapes) ? info.shapes : []
  meta.crop = info.crop || null
  if (validScale(info.scale) && info.scale !== 1) meta.scale = info.scale
  const cuts = validCuts(info.cuts)
  if (cuts.length) meta.cuts = cuts
  const pad = validPad(info.pad)
  if (pad) meta.pad = pad
  if (info.title) meta.title = String(info.title).slice(0, 200)
  if (Array.isArray(info.tags) && info.tags.length) meta.tags = info.tags.map(String).slice(0, 30)
  meta.importedEdits = true
  writeMeta(meta)
  return meta
}

async function saveImage(e, data) {
  const win = BrowserWindow.fromWebContents(e.sender)
  const meta = data.libraryId ? readEntry(data.libraryId) : null
  const edited = !!data.edited
  const origin = (meta && meta.file && fs.existsSync(meta.file)) ? meta.file : null

  if (!data.saveAs && !edited && origin) return { ok: true, path: origin, unchanged: true }

  try { fs.mkdirSync(settings.saveDir, { recursive: true }) } catch (_) {}

  // 何も書き込んでいないまま名前を付けるなら、原本そのものを動かす
  if (data.saveAs && !edited && origin) {
    const r = await dialog.showSaveDialog(win, {
      title: '名前を付けて保存',
      defaultPath: origin,
      filters: [{ name: 'PNG 画像', extensions: ['png'] }],
    })
    if (r.canceled || !r.filePath) return { ok: false, canceled: true }
    if (r.filePath !== origin) {
      try {
        fs.mkdirSync(path.dirname(r.filePath), { recursive: true })
        moveFile(origin, r.filePath)
      } catch (err) {
        return { ok: false, error: String(err) }
      }
      meta.file = r.filePath
      writeMeta(meta)
      notifyLibraryChanged()
      refreshEditorTitle(meta.id)
    }
    return { ok: true, path: meta.file, moved: true }
  }

  let buf
  try {
    buf = nativeImage.createFromDataURL(data.dataUrl).toPNG()
  } catch (err) {
    return { ok: false, error: String(err) }
  }

  // 書き込み版には、元の絵と図形の位置を入れておく。ScreenShooter に落とした人は図形を動かせる（チームで渡し合うため）
  if (edited && meta && settings.embedEdits !== false) buf = embedEdits(buf, meta)

  let target = edited
    ? ((meta && meta.editedPath) ? meta.editedPath : editedPathFor(meta))
    : uniquePath(settings.saveDir, timestampBase(), '.png')   // 原本が無いとき（書き出しに失敗した分）の保険

  if (data.saveAs) {
    const r = await dialog.showSaveDialog(win, {
      title: '名前を付けて保存',
      defaultPath: target,
      filters: [{ name: 'PNG 画像', extensions: ['png'] }],
    })
    if (r.canceled || !r.filePath) return { ok: false, canceled: true }
    target = r.filePath
  }

  try {
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, buf)
  } catch (err) {
    return { ok: false, error: String(err) }
  }

  if (meta) {
    if (edited) meta.editedPath = target
    else if (!meta.file) meta.file = target
    writeMeta(meta)
    notifyLibraryChanged()
    refreshEditorTitle(meta.id)
  }
  return { ok: true, path: target, edited }
}

function copyImage(dataUrl) {
  try {
    const img = nativeImage.createFromDataURL(dataUrl)
    // 大きすぎて画面側の toDataURL が失敗すると空の絵が来る。書き込みは黙って何もしないので、ここで失敗にする
    if (img.isEmpty()) return { ok: false, error: 'empty image' }
    clipboard.writeImage(img)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
}

ipcMain.handle('app:copy', (e, dataUrl) => copyImage(dataUrl))

ipcMain.on('app:reveal', (e, filePath) => {
  if (filePath && fs.existsSync(filePath)) shell.showItemInFolder(filePath)
  else openSaveDir()
})

ipcMain.on('app:closeWindow', (e) => {
  const win = BrowserWindow.fromWebContents(e.sender)
  if (!win || win.isDestroyed()) return
  win.allowClose = true
  win.close()
})

// 集中モード（枠なし・絵だけ）の出入り。Windows は開いたあとの窓から枠だけを外せないので、
// 同じ中身で窓を作り直す。図形や切り抜きは画面側から預かって引き継ぐ
ipcMain.on('editor:focus', (e, d) => {
  const win = BrowserWindow.fromWebContents(e.sender)
  if (!win || win.isDestroyed() || !d) return
  const img = nativeImage.createFromDataURL(d.dataUrl || '')
  if (img.isEmpty()) return
  const meta = win.libraryId ? readEntry(win.libraryId) : null
  openEditor(img, meta, {
    focus: !!d.on,
    from: win.getBounds(),
    viewW: d.viewW,
    viewH: d.viewH,
    carry: d.carry || null,
  })
  win.allowClose = true
  win.close()
})

// 集中モード中に切り抜くと絵の比が変わる。窓の形もそれに合わせる
ipcMain.on('editor:aspect', (e, d) => {
  const win = BrowserWindow.fromWebContents(e.sender)
  if (!win || win.isDestroyed() || !win.focusMode) return
  if (!d || !(d.w > 0) || !(d.h > 0)) return
  keepAspect(win, d.w / d.h)
  const c = win.getContentSize()
  win.setContentSize(c[0], Math.max(1, Math.round(c[0] * d.h / d.w)))
})

// 文字の飾り。知らない値を設定ファイルに書かないよう、ここで受け付けるものを決める（editor.js の DECOS と同じ）
const TEXT_DECOS = ['auto', 'white', 'black', 'shadow', 'white-shadow', 'none']
// コピー・書き出しの仕上げ。受け付ける値はここで決める（editor.js の FINISHES と同じ）
const EXPORT_FINISHES = ['none', 'border', 'round', 'shadow', 'backdrop']
// 線の種類・角の丸み・拡大鏡の倍率。受け付ける値はここで決める（editor.js の LINE_DASHES / RECT_RADII / ZOOM_FACTORS と同じ）
const LINE_DASHES = ['solid', 'dash', 'dot']
const RECT_RADII = [0, 6, 12, 20]
const ZOOM_FACTORS = [1.5, 2, 2.5, 3, 4]
const PAD_COLORS = ['#ffffff', '#000000', 'transparent']
// 文字の書体・寄せ（editor.js の TEXT_FACES / TEXT_ALIGNS と同じ）
const TEXT_FACES = ['gothic', 'meiryo', 'ud', 'mincho', 'arial']
const TEXT_ALIGNS = ['left', 'center', 'right']

// 手で足した余白 { t, r, b, l, color }。壊れた値・全部 0 は「余白なし」（null）
function validPad(p) {
  if (!p || typeof p !== 'object') return null
  const n = (v) => Math.max(0, Math.min(4000, Math.round(Number(v) || 0)))
  const out = { t: n(p.t), r: n(p.r), b: n(p.b), l: n(p.l), color: PAD_COLORS.includes(p.color) ? p.color : '#ffffff' }
  return out.t || out.r || out.b || out.l ? out : null
}

// 設定の仕上げ。手で壊された値は「そのまま」に戻す
function exportFinish() {
  return EXPORT_FINISHES.includes(settings.exportFinish) ? settings.exportFinish : 'none'
}

ipcMain.on('app:setDefaults', (e, data) => {
  const patch = {}
  if (typeof data.color === 'string') patch.color = data.color
  if (typeof data.markerColor === 'string') patch.markerColor = data.markerColor
  if (Number.isFinite(data.lineWidth)) patch.lineWidth = data.lineWidth
  if (Number.isFinite(data.markerWidth)) patch.markerWidth = data.markerWidth
  if (Number.isFinite(data.fontSize)) patch.fontSize = data.fontSize
  if (TEXT_DECOS.includes(data.deco)) patch.textDeco = data.deco
  if (Number.isFinite(data.halo) && data.halo > 0 && data.halo <= 1) patch.textHalo = data.halo
  if (EXPORT_FINISHES.includes(data.finish)) patch.exportFinish = data.finish
  if (LINE_DASHES.includes(data.lineDash)) patch.lineDash = data.lineDash
  if (RECT_RADII.includes(data.rectRadius)) patch.rectRadius = data.rectRadius
  if (ZOOM_FACTORS.includes(data.zoomK)) patch.zoomK = data.zoomK
  if (data.pad) { const p = validPad(data.pad); if (p) patch.padLast = p }
  if (TEXT_FACES.includes(data.textFace)) patch.textFace = data.textFace
  for (const k of ['textBold', 'textItalic', 'textUnderline']) if (typeof data[k] === 'boolean') patch[k] = data[k]
  if (TEXT_ALIGNS.includes(data.textAlign)) patch.textAlign = data.textAlign
  const rz = data.resize
  if (rz && ['pct', 'width', 'height'].includes(rz.mode)) {
    const num = (v, hi) => (Number.isFinite(v) && v > 0 && v <= hi ? v : 0)
    patch.resizeLast = { mode: rz.mode, pct: num(rz.pct, 800), width: num(rz.width, 100000), height: num(rz.height, 100000) }
  }
  saveSettings(patch)
})

// お気に入りに登録できる道具。選択・つかむ・切り抜きは「書き方」を持たないので入れない（editor.js の PRESET_TOOLS と同じ）
const PRESET_TOOLS = ['rect', 'ellipse', 'arrow', 'line', 'pen', 'marker', 'text', 'bubble', 'step', 'blur', 'spot', 'zoom', 'brace']

// お気に入り1つを検査する。知らない道具・色・範囲外の数は設定ファイルに書かない（手で壊されたときも既定に戻す）
function cleanPreset(p) {
  if (!p || typeof p !== 'object') return null
  if (!PRESET_TOOLS.includes(p.tool)) return null
  if (typeof p.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(p.color)) return null
  const num = (v, lo, hi, d) => (Number.isFinite(v) && v >= lo && v <= hi ? v : d)
  return {
    tool: p.tool,
    color: p.color.toLowerCase(),
    lineWidth: num(p.lineWidth, 1, 60, 4),
    fontSize: num(p.fontSize, 6, 200, 28),
    deco: TEXT_DECOS.includes(p.deco) ? p.deco : 'auto',
    halo: num(p.halo, 0.01, 1, 0.09),
  }
}

// 設定のお気に入りを、必ず4つそろった形で返す。壊れている枠だけ既定に戻す
function stylePresets() {
  const def = defaultStylePresets()
  const cur = Array.isArray(settings.stylePresets) ? settings.stylePresets : []
  return def.map((d, i) => cleanPreset(cur[i]) || d)
}

// お気に入りの1枠を登録し直す。開いているほかの編集画面にも配って、古い4つで上書きし合わないようにする
ipcMain.on('app:setStylePreset', (e, data) => {
  const i = data ? data.index : -1
  if (!Number.isInteger(i) || i < 0 || i > 3) return
  const p = cleanPreset(data.preset)
  if (!p) return
  const list = stylePresets()
  list[i] = p
  saveSettings({ stylePresets: list })
  for (const w of editorWins) {
    if (!w.isDestroyed() && w.webContents !== e.sender) w.webContents.send('editor:stylePresets', list)
  }
})

// 編集画面から、書き込んだ図形が変わるたびに届く（保存を押さなくても履歴には残る）
// 履歴パネルに外から落とされた画像。撮ったものと同じように履歴へ入れる
ipcMain.on('library:import', (e, paths) => {
  openImageFiles(paths)
})

// 履歴パネルで Ctrl+V。クリップボードの画像を一覧に足す（編集画面は開かない）
ipcMain.on('library:paste', () => { openClipboardImage(false) })

ipcMain.on('library:updateShapes', (e, data) => {
  const meta = readEntry(data.id)
  if (!meta) return
  meta.shapes = Array.isArray(data.shapes) ? data.shapes : []
  meta.crop = data.crop || null
  const sc = Number(data.scale)
  if (validScale(sc) && sc !== 1) meta.scale = sc
  else delete meta.scale
  const cuts = validCuts(data.cuts)
  if (cuts.length) meta.cuts = cuts
  else delete meta.cuts
  const pad = validPad(data.pad)
  if (pad) meta.pad = pad
  else delete meta.pad
  writeMeta(meta)
  if (data.thumbDataUrl) {
    try {
      const img = nativeImage.createFromDataURL(data.thumbDataUrl)
      if (!img.isEmpty()) fs.writeFileSync(path.join(entryDir(meta.id), 'thumb.png'), img.toPNG())
    } catch (_) { /* サムネイルは無くても困らない */ }
  }
  notifyLibraryChanged()
})

// ---- 履歴パネルからのコピー（Ctrl+C と右クリックの「クリップボードにコピー」）----
// 編集画面で Ctrl+C したときと同じ絵にする。図形は画像に焼いていないので、書き込みか切り抜きが
// ある絵だけ、見えない編集画面に描かせて書き出す（描き方を2か所に持つと見た目が食い違うため）。
// 保存済みの「_書き込み.png」は使わない。保存のあとに動かした図形が入っていないことがある

const EXPORT_WAIT_MS = 15000
const exportWaits = new Map()   // 見えない編集画面の webContents.id → 書き出しを受け取る関数
let libraryCopying = false

function libraryToast(msg) {
  if (libraryWin && !libraryWin.isDestroyed()) libraryWin.webContents.send('library:toast', msg)
}

function hasEdits(meta, size) {
  if ((meta.shapes || []).length) return true
  // 大きさを変えた絵は、見えない編集画面で作り直す（ここで縮めると編集画面と違う縮め方になるため）
  if (entryScale(meta) !== 1) return true
  if (entryCuts(meta).length) return true
  if (validPad(meta.pad)) return true
  const c = meta.crop
  return !!(c && (c.x !== 0 || c.y !== 0 || c.w !== size.width || c.h !== size.height))
}

// extra は初期データの上書き（並べて1枚にするときは仕上げを外すのに使う）
function renderEdited(image, meta, extra) {
  return renderEditedView(image, meta, extra).then((r) => (r ? r.dataUrl : null))
}

// 書き出した絵と、その左上が元の絵のどこに当たるか（x, y）を返す。浮かせるときの位置合わせに使う
function renderEditedView(image, meta, extra) {
  return new Promise((resolve) => {
    const win = new BrowserWindow({
      show: false,
      width: 400,
      height: 300,
      skipTaskbar: true,
      webPreferences: {
        preload: PRELOAD,
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false,
      },
    })
    const wcId = win.webContents.id
    let done = false
    let timer = null
    const finish = (out) => {
      if (done) return
      done = true
      clearTimeout(timer)
      exportWaits.delete(wcId)
      if (!win.isDestroyed()) win.destroy()
      resolve(out || null)
    }
    timer = setTimeout(() => finish(null), EXPORT_WAIT_MS)
    exportWaits.set(wcId, finish)
    win.on('closed', () => finish(null))
    // 履歴の ID は渡さない。この窓から履歴へ書き戻させないため
    loadGuarded(win, path.join(RENDERER, 'editor.html'), 'コピー用の編集画面', {
      quiet: true,
      onGiveUp: () => finish(null),
      onReady: () => win.webContents.send('editor:init',
        Object.assign(editorInitData(image, meta), extra || {}, { libraryId: null, exportOnly: true })),
    })
  })
}

ipcMain.on('editor:exported', (e, d) => {
  const finish = exportWaits.get(e.sender.id)
  if (!finish) return
  if (!d || typeof d.dataUrl !== 'string') { finish(null); return }
  finish({ dataUrl: d.dataUrl, x: Number(d.x) || 0, y: Number(d.y) || 0 })
})

// 画面側から来るのは「選んでいるもの全部」。コピーできるのは1枚だけ（画像を何枚も貼れる所はまず無い）
async function copyFromLibrary(ids) {
  if (!ids.length) { libraryToast('コピーしたいものを1回押して選んでください'); return }
  if (ids.length > 1) { libraryToast('コピーは1枚ずつです（まとめて渡すならドラッグ）'); return }
  const meta = readEntry(ids[0])
  if (!meta) return
  if (meta.kind === 'video') { libraryToast('録画はコピーできません（ドラッグで渡せます）'); return }
  const img = originalImage(meta)
  if (!img) { libraryToast('元の画像が見つかりませんでした（保存先のファイルが無い）'); return }
  if (libraryCopying) return
  libraryCopying = true
  try {
    let out = img
    // 仕上げ（影つき・背景つき）も見えない編集画面が付ける。付けないと編集画面の Ctrl+C と違う絵になる
    if (hasEdits(meta, img.getSize()) || exportFinish() !== 'none') {
      libraryToast('コピー中…')
      const dataUrl = await renderEdited(img, meta)
      out = dataUrl ? nativeImage.createFromDataURL(dataUrl) : null
    }
    if (!out || out.isEmpty()) { libraryToast('コピーに失敗しました'); return }
    clipboard.writeImage(out)
    libraryToast('クリップボードにコピーしました')
  } finally {
    libraryCopying = false
  }
}

ipcMain.on('library:copy', (e, payload) => { copyFromLibrary(idList(payload)) })

// ---- 何枚かを並べて1枚に（履歴で2枚以上選んで右クリック）----
// 各絵は履歴からのコピーと同じ道（書き込みのある絵だけ見えない編集画面の exportPNG）で取る。
// 描き方を main 側に真似て書くと、編集画面と見た目が食い違うため。仕上げ（影・背景）は1枚ずつには付けない

const COMBINE_MAX_SIDE = 32000         // 編集画面の canvas が作れる1辺の上限の手前
const COMBINE_MAX_AREA = 80000000      // これより大きいと編集画面が重くなりすぎる（8000万ピクセル）
const COMBINE_FONT_SIZES = [28, 32, 36, 40, 48, 56, 64]   // 編集画面の FONT_SIZES にある値だけ使う（プルダウンに出るように）
let libraryCombining = false

// 見出し。2枚なら「前」「後」、3枚以上は ①②③…（⑳を超えたら数字だけ）
function combineLabels(n) {
  if (n === 2) return ['前', '後']
  const out = []
  for (let i = 0; i < n; i++) out.push(i < 20 ? String.fromCharCode(0x2460 + i) : String(i + 1))
  return out
}

// 並べ方を決める。絵は縮めも伸ばしもせず原寸のまま、横並びは上端・縦並びは左端でそろえて、
// 足りない所は白い余白にする（縮めると文字がにじむため。透明だと貼り先で黒く見えることがある）。
// 見出しは各絵の上に取った帯へ置く
function combineLayout(sizes, dir) {
  const ref = Math.min(...sizes.map((s) => Math.max(s.width, s.height)))
  const want = Math.min(64, Math.max(28, Math.round(ref * 0.035)))
  const fontSize = COMBINE_FONT_SIZES.reduce((a, b) => (Math.abs(b - want) < Math.abs(a - want) ? b : a))
  const pad = Math.round(fontSize * 0.5)          // 外周と、見出しと絵のあいだ
  const gap = pad * 2                             // 絵と絵のあいだ
  const band = Math.round(fontSize * 1.28) + pad  // 見出しの帯（字の高さ＋絵までの余白）
  const spots = []
  let W, H
  if (dir === 'row') {
    let x = pad
    for (const s of sizes) {
      spots.push({ x, y: pad + band, lx: x, ly: pad })
      x += s.width + gap
    }
    W = x - gap + pad
    H = pad + band + Math.max(...sizes.map((s) => s.height)) + pad
  } else {
    let y = pad
    for (const s of sizes) {
      spots.push({ x: pad, y: y + band, lx: pad, ly: y })
      y += band + s.height + gap
    }
    W = pad + Math.max(...sizes.map((s) => s.width)) + pad
    H = y - gap + pad
  }
  return { W, H, spots, fontSize }
}

// 白地の上に絵を置く。toBitmap() は BGRA（透明度を掛け済み）なので、白の上に重ねるには
// 足りない不透明さのぶんだけ白を足す。はみ出した文字で広がった透明な所はここで白になる
function pasteOnWhite(out, W, img, ox, oy) {
  const { width: w, height: h } = img.getSize()
  const src = img.toBitmap()
  for (let y = 0; y < h; y++) {
    let s = y * w * 4
    let d = ((oy + y) * W + ox) * 4
    for (let x = 0; x < w; x++, s += 4, d += 4) {
      const a = src[s + 3]
      if (a === 255) { src.copy(out, d, s, s + 4); continue }
      if (a === 0) continue
      const k = 255 - a
      out[d] = Math.min(255, src[s] + k)
      out[d + 1] = Math.min(255, src[s + 1] + k)
      out[d + 2] = Math.min(255, src[s + 2] + k)
    }
  }
}

async function combineEntries(ids, dir) {
  if (libraryCombining) return
  const metas = ids.map(readEntry).filter(Boolean)
  const videos = metas.filter((m) => m.kind === 'video').length
  const picks = metas.filter((m) => m.kind !== 'video')   // 並びは画面の順（古い順）のまま
  if (picks.length < 2) { libraryToast('画像を2枚以上選んでください（録画は並べられません）'); return }
  libraryCombining = true
  try {
    const imgs = []
    for (let i = 0; i < picks.length; i++) {
      const meta = picks[i]
      const img = originalImage(meta)
      if (!img) { libraryToast('元の画像が見つからない絵があるので、並べるのをやめました'); return }
      if (!hasEdits(meta, img.getSize())) { imgs.push(img); continue }
      libraryToast('並べる準備中…（' + (i + 1) + ' / ' + picks.length + '）')
      const dataUrl = await renderEdited(img, meta, { finish: 'none' })
      const out = dataUrl ? nativeImage.createFromDataURL(dataUrl) : null
      // 書き込みの無い絵で黙って代用しない（見出しと中身が食い違った1枚ができるため）
      if (!out || out.isEmpty()) { libraryToast('書き込みの入った絵を作れなかったので、並べるのをやめました'); return }
      imgs.push(out)
    }

    const sizes = imgs.map((im) => im.getSize())
    const L = combineLayout(sizes, dir)
    if (L.W > COMBINE_MAX_SIDE || L.H > COMBINE_MAX_SIDE || L.W * L.H > COMBINE_MAX_AREA) {
      libraryToast('大きすぎて1枚にできません（枚数を減らすか、並べる向きを変えてください）')
      return
    }
    const buf = Buffer.alloc(L.W * L.H * 4, 255)
    imgs.forEach((im, i) => pasteOnWhite(buf, L.W, im, L.spots[i].x, L.spots[i].y))
    const combined = nativeImage.createFromBitmap(buf, { width: L.W, height: L.H })

    // できた絵は撮った絵と同じく保存先に1枚増えるだけ。元の絵には触れない
    const meta = addToLibrary(combined, null)
    if (!meta) { libraryToast('保存できませんでした'); return }
    // 見出しは焼き込まず、あとから直せる文字として置く（飾りなしの黒字。白い帯の上なので縁取りは要らない）
    const labels = combineLabels(imgs.length)
    meta.shapes = L.spots.map((p, i) => ({
      id: i + 1, type: 'text', color: '#1f2328', width: settings.lineWidth,
      fontSize: L.fontSize, deco: 'none', halo: settings.textHalo,
      x1: p.lx, y1: p.ly, x2: p.lx, y2: p.ly, text: labels[i],
    }))
    writeMeta(meta)
    notifyLibraryChanged()
    openEditor(combined, meta)
    libraryToast(videos ? '録画 ' + videos + ' 件は除いて並べました' : '並べて1枚にしました')
  } finally {
    libraryCombining = false
  }
}

// ---- 2枚の違いに赤枠（履歴で2枚選んで右クリック）----
// 比べるのは保存先にある元の絵どうし（書き込みは見ない）。新しいほうを開き、変わった所に
// ふつうの四角を足すだけで、絵には焼き込まない。位置合わせはしないので、同じ範囲で撮った同じ大きさの2枚だけが相手

const DIFF_COLOR = '#e8453c'   // 既定の赤（defaultSettings().color）
const DIFF_WIDTH = 4           // 既定の太さ。いま選んでいる太さ（20px など）だと、枠が変わった所を覆ってしまうため
const DIFF_NEED = '同じ範囲で撮った同じ大きさの2枚を選んでください'
let libraryDiffing = false

// 枠を切り抜き（無ければ絵全体）の内側に詰める。外に出た図形は画角を広げてしまい「切り抜けない」に戻るため。
// 線は座標を中心に太さの半分ずつ外へ出るので、線の外側が端に来るよう半分だけ内へ寄せる（寄せないと画角が 2px 広がる）
function clipToCrop(box, crop, size, lineWidth) {
  const c = (crop && crop.w > 0 && crop.h > 0) ? crop : { x: 0, y: 0, w: size.width, h: size.height }
  const half = lineWidth / 2
  const x1 = Math.max(box.x, c.x + half)
  const y1 = Math.max(box.y, c.y + half)
  const x2 = Math.min(box.x + box.w, c.x + c.w - half)
  const y2 = Math.min(box.y + box.h, c.y + c.h - half)
  return (x2 - x1 >= 4 && y2 - y1 >= 4) ? { x: x1, y: y1, w: x2 - x1, h: y2 - y1 } : null
}

async function diffEntries(ids) {
  if (libraryDiffing) return
  const metas = ids.map(readEntry).filter(Boolean)
  if (metas.length !== 2 || metas.some((m) => m.kind === 'video')) { libraryToast(DIFF_NEED); return }
  // 撮った日時が後のほうが「新しい絵」。同じなら一覧で後ろ（あとから入ったほう）
  const [older, newer] = (metas[1].createdAt || 0) >= (metas[0].createdAt || 0) ? metas : [metas[1], metas[0]]
  const oldImg = originalImage(older)
  const newImg = originalImage(newer)
  if (!oldImg || !newImg) { libraryToast('元の画像が見つからない絵があります（保存先のファイルが無い）'); return }
  const size = newImg.getSize()
  const os = oldImg.getSize()
  if (size.width !== os.width || size.height !== os.height) {
    libraryToast('大きさが違うので比べられません（' + DIFF_NEED + '）')
    return
  }

  libraryDiffing = true
  try {
    libraryToast('違いを探しています…')
    await delay(30)   // 比べている間は本体が止まるので、先にお知らせを出させておく
    let found
    try {
      found = findDiffBoxes(oldImg.toBitmap(), newImg.toBitmap(), size.width, size.height)
    } catch (err) {
      console.error('違いの検出に失敗:', err)
      libraryToast('比べられませんでした')
      return
    }
    // 大きさを変えた・省略した絵の切り抜き範囲は撮ったときの座標ではないので、ここでは絵の大きさだけで詰める
    // （編集画面の addShapesFromMain が今の座標に直してから、切り抜き範囲で詰め直す）
    const sameCoords = entryScale(newer) === 1 && !entryCuts(newer).length
    const boxes = found.boxes.map((b) => clipToCrop(b, sameCoords ? newer.crop : null, size, DIFF_WIDTH)).filter(Boolean)
    if (!boxes.length) { libraryToast('違いは見つかりませんでした'); return }
    const shapes = boxes.map((b) => ({
      type: 'rect', color: DIFF_COLOR, width: DIFF_WIDTH, fontSize: settings.fontSize,
      x1: b.x, y1: b.y, x2: b.x + b.w, y2: b.y + b.h,
    }))
    const msg = boxes.length + ' か所に枠を付けました'
    libraryToast(msg)

    // すでに開いている窓には、そこへ足してもらう。
    // 新しく開き直すと、開いている窓が次に履歴へ書き戻したときに足した枠を消してしまうため
    for (const w of editorWins) {
      if (w.isDestroyed() || w.libraryId !== newer.id) continue
      if (w.isMinimized()) w.restore()
      w.show(); w.focus()
      w.webContents.send('editor:addShapes', { shapes })
      return
    }
    openEditor(newImg, newer, { addShapes: { shapes } })
  } finally {
    libraryDiffing = false
  }
}

// ---------------------------------------------------------------- 個人情報の自動ぼかし

// 読み取りが長引いたら諦める。撮影や編集は止めない（ぼかしが付かないだけ）
const OCR_TIMEOUT_MS = 10000

// 保存先にある原寸の絵を tools/ocr.ps1 に読ませる。一時ファイルは作らない（原寸の絵は保存先の1個だけ）。
// 読んだ文字はログにも履歴にも残さない。失敗・時間切れは null
function readTextPositions(file) {
  return new Promise((resolve) => {
    const script = path.join(ROOT, 'tools', 'ocr.ps1')
    if (!file || !fs.existsSync(script) || !fs.existsSync(file)) { resolve(null); return }
    let child
    try {
      child = execFile(
        powershellPath(),
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-Path', file],
        { timeout: OCR_TIMEOUT_MS, windowsHide: true, maxBuffer: 64 * 1024 * 1024, encoding: 'utf8' },
        (err, stdout) => {
          if (err) { resolve(null); return }
          try {
            const data = JSON.parse(String(stdout).replace(/^\uFEFF/, '').trim())
            resolve(data && Array.isArray(data.passes) ? data : null)
          } catch (_) { resolve(null) }
        },
      )
    } catch (_) { resolve(null); return }
    child.on('error', () => resolve(null))
  })
}

// 編集画面が開いたあとに、画面側から頼まれて探す。どの絵かは窓が持っている履歴の ID で決める。
// 返すのは四角だけ（元の絵の実ピクセル）。切り抜き・すでにあるぼかしとの突き合わせは画面側がやる
ipcMain.handle('editor:findPrivate', async (e) => {
  const win = BrowserWindow.fromWebContents(e.sender)
  const meta = win && win.libraryId ? readEntry(win.libraryId) : null
  if (!meta || meta.kind === 'video') return null
  const ocr = await readTextPositions(originalPath(meta))
  if (!ocr) return null
  let userName = ''
  try { userName = os.userInfo().username } catch (_) {}
  try {
    return { boxes: findPrivateBoxes(ocr, { userName, words: settings.autoBlurWords, labels: settings.autoBlurLabels, level: settings.autoBlurLevel }) }
  } catch (err) {
    console.error('個人情報の検出に失敗:', err)
    return null
  }
})

// ---------------------------------------------------------------- 履歴パネル（右下）

let libraryWin = null
let libraryWatchTimer = null
let libraryOutSince = 0     // カーソルがパネルの外に出た時刻（0 = 中にいる）
let libraryTouched = false  // 開いてから一度でもカーソルが乗ったか
let libraryDragUntil = 0
let libraryFadeTimer = null // 消えかけの途中で閉じたときに止めるため

// サムネイル3列 × 3段と、下のボタン列がそのまま見える大きさを既定にする。
// 大きさと位置を変えたら覚えておき、次からはその形で開く。
const LIBRARY_DEFAULT = { width: 736, height: 600 }

function libraryStartBounds() {
  const saved = settings.libraryBounds
  if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)
    && saved.width >= 380 && saved.height >= 300) {
    // 画面構成が変わって枠外に行っていたら既定位置に戻す
    const fits = screen.getAllDisplays().some((d) => {
      const b = d.workArea
      return saved.x < b.x + b.width - 60 && saved.x + saved.width > b.x + 60
        && saved.y < b.y + b.height - 40 && saved.y + saved.height > b.y
    })
    if (fits) return saved
  }
  const wa = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea
  return {
    width: LIBRARY_DEFAULT.width,
    height: LIBRARY_DEFAULT.height,
    x: wa.x + wa.width - LIBRARY_DEFAULT.width - 14,
    y: wa.y + wa.height - LIBRARY_DEFAULT.height - 14,
  }
}

// 拡大率 150% などの画面では、作った窓が指定より数px 大きくなる（実測 1095×765 → 1099×769）。
// それを覚えると開くたびに育っていくので、ずれたぶんを逆に足して指定どおりに合わせ直す。
// 1回 setBounds し直すだけでは 1px ずつ残るので、一致するまで数回くり返す
function fitBounds(win, want, measure = () => win.getBounds()) {
  let ask = { x: want.x, y: want.y, width: want.width, height: want.height }
  for (let i = 0; i < 4; i++) {
    const got = measure()
    if (got.x === want.x && got.y === want.y && got.width === want.width && got.height === want.height) return
    ask = {
      x: ask.x + want.x - got.x,
      y: ask.y + want.y - got.y,
      width: ask.width + want.width - got.width,
      height: ask.height + want.height - got.height,
    }
    win.setBounds(ask)
  }
}

// 浮かせた絵は外枠ではなく中身（getContentBounds）を指定どおりに合わせる。resizable: true の枠なし窓は
// 拡大率 150% の画面で外枠が中身より左 1 DIP・下 1 DIP 大きく、外枠で合わせると中身が 1 DIP 足りず絵が縮んで描かれる
function fitContentBounds(win, want) {
  fitBounds(win, want, () => win.getContentBounds())
}

function ensureLibraryWindow() {
  if (libraryWin && !libraryWin.isDestroyed()) return libraryWin
  const b = libraryStartBounds()
  libraryWin = new BrowserWindow({
    width: b.width,
    height: b.height,
    x: b.x,
    y: b.y,
    minWidth: 380,
    minHeight: 300,
    show: false,
    frame: false,
    resizable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    backgroundColor: '#2c3037',
    title: 'ScreenShooter — 履歴パネル',
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  fitBounds(libraryWin, b)
  libraryWin.setMenu(null)
  // 諦めたら窓ごと捨てる。残すと次にトレイから開いても白いままなので、
  // 作り直して（＝子プロセスの起動をもう一度やって）出直せるようにする
  loadGuarded(libraryWin, path.join(RENDERER, 'library.html'), '履歴パネル', {
    onReady: notifyLibraryChanged,
    onGiveUp: () => { if (libraryWin && !libraryWin.isDestroyed()) libraryWin.destroy() },
  })

  let boundsTimer = null
  const remember = () => {
    clearTimeout(boundsTimer)
    boundsTimer = setTimeout(() => {
      if (libraryWin && !libraryWin.isDestroyed()) saveSettings({ libraryBounds: libraryWin.getBounds() })
    }, 600)
  }
  libraryWin.on('resize', remember)
  libraryWin.on('move', remember)
  libraryWin.on('focus', () => {
    if (!libraryWin.isAlwaysOnTop()) libraryWin.setAlwaysOnTop(true, 'floating')
  })
  libraryWin.on('closed', () => { clearTimeout(boundsTimer); stopLibraryWatch(); libraryWin = null })
  return libraryWin
}

function notifyLibraryChanged() {
  if (!libraryWin || libraryWin.isDestroyed()) return
  libraryWin.webContents.send('library:items', {
    items: libraryItems(80),
    pinned: !!settings.libraryPinned,
    thumbHeight: settings.libraryThumbHeight || 104,
    order: LIBRARY_ORDERS.includes(settings.libraryOrder) ? settings.libraryOrder : 'old',
  })
}

// マウスが離れたら引っ込む。じゃまにならないよう短くし、消えぎわは少しだけ薄くする
const LIBRARY_HIDE_MS = 2000
// 開いた直後だけは長く待つ（トレイから開いてカーソルを持ってくるまでの猶予）
const LIBRARY_OPEN_MS = 5000
// カーソルの居場所を見に行く間隔
const LIBRARY_WATCH_MS = 250

// 画面側の mouseenter / mouseleave には頼らない。カーソルが乗ったままウィンドウを隠すと
// mouseleave が来ないまま「乗っている」で固まり、二度と引っ込まなくなる（ピンを外しても解けない）。
// カーソルの実際の位置を見れば、ウィンドウを跨いでも隠れても取りこぼさない
function cursorOverLibrary() {
  const win = libraryWin
  if (!win || win.isDestroyed() || !win.isVisible()) return false
  const p = screen.getCursorScreenPoint()
  const b = win.getBounds()
  return p.x >= b.x && p.x < b.x + b.width && p.y >= b.y && p.y < b.y + b.height
}

function stopLibraryWatch() {
  clearInterval(libraryWatchTimer)
  libraryWatchTimer = null
  libraryOutSince = 0
}

// 出しているあいだだけカーソルを見張る。ピン留め中は見張らない
function startLibraryWatch() {
  stopLibraryWatch()
  if (settings.libraryPinned) return
  libraryWatchTimer = setInterval(() => {
    const win = libraryWin
    if (!win || win.isDestroyed() || !win.isVisible() || settings.libraryPinned) {
      stopLibraryWatch()
      return
    }
    const now = Date.now()
    // 外へドラッグしているあいだはカーソルがパネルの外に出ているので、そのぶん先送りする
    if (now < libraryDragUntil) { libraryOutSince = 0; return }
    if (cursorOverLibrary()) { libraryOutSince = 0; libraryTouched = true; return }
    if (!libraryOutSince) libraryOutSince = now
    // まだ一度もカーソルが乗っていないうちは、持ってくるまでの猶予を与える
    if (now - libraryOutSince >= (libraryTouched ? LIBRARY_HIDE_MS : LIBRARY_OPEN_MS)) {
      stopLibraryWatch()
      fadeOutLibrary()
    }
  }, LIBRARY_WATCH_MS)
}

function fadeOutLibrary() {
  const win = libraryWin
  if (!win || win.isDestroyed()) return
  let o = 1
  clearInterval(libraryFadeTimer)
  const timer = libraryFadeTimer = setInterval(() => {
    if (!win || win.isDestroyed()) { clearInterval(timer); return }
    // 消えるまでの間にマウスが戻ってきたら、そのまま元に戻す
    if (cursorOverLibrary() || settings.libraryPinned) {
      clearInterval(timer)
      win.setOpacity(1)
      startLibraryWatch()   // 見張りを戻さないと、次からは引っ込まなくなる
      return
    }
    o -= 0.2
    if (o <= 0) {
      clearInterval(timer)
      win.hide()
      win.setOpacity(1)
      return
    }
    win.setOpacity(o)
  }, 30)
}

// トレイをもう一度押したら、待たずにその場で引っ込める（すぐ消したいときのため）
function toggleLibrary() {
  const win = libraryWin
  if (win && !win.isDestroyed() && win.isVisible()) {
    stopLibraryWatch()
    clearInterval(libraryFadeTimer)   // 消えかけを止めてから隠す
    win.hide()
    win.setOpacity(1)
    return
  }
  showLibrary(false)
}

// auto = 撮影直後の自動表示。手前に出すがフォーカスは奪わない
function showLibrary(auto) {
  const win = ensureLibraryWindow()
  notifyLibraryChanged()
  win.setOpacity(1)   // 消えかけのまま出し直すことがあるので必ず戻す
  win.setAlwaysOnTop(true, 'floating')
  if (auto) win.showInactive()
  else { win.show(); win.focus() }
  libraryTouched = cursorOverLibrary()
  startLibraryWatch()
}

ipcMain.on('library:pin', (e, pinned) => {
  saveSettings({ libraryPinned: !!pinned })
  notifyLibraryChanged()
  if (settings.libraryPinned) stopLibraryWatch()
  // 外した直後はピンのボタン＝パネルの上にカーソルがいる。離れたら引っ込む扱いで始める
  else { libraryTouched = true; startLibraryWatch() }
})

// 開いた編集画面の上にパネルが居座らないよう、最前面を外して後ろに回す。
// パネルを触る（focus）かトレイから出し直すと最前面に戻る
ipcMain.on('library:open', (e, id) => {
  if (libraryWin && !libraryWin.isDestroyed()) libraryWin.setAlwaysOnTop(false)
  const meta = readEntry(id)
  if (meta && meta.kind === 'video') openRecording(id, 'video')
  else openEditorFromLibrary(id)
})

ipcMain.on('library:show', () => showLibrary(false))

// 撮る前に履歴パネル自身を引っ込める。出したままだと撮影する画面に写り込む。
// hide() の直後はまだ画面に残っていることがあるので、取り込みまで少しだけ待つ
async function hideLibraryForCapture() {
  const win = libraryWin
  if (!win || win.isDestroyed() || !win.isVisible()) return
  stopLibraryWatch()
  win.hide()
  win.setOpacity(1)
  await delay(140)
}

// 下のボタン列（トレイの右クリックメニューと同じ操作をパネルからも押せるようにしたもの）
ipcMain.on('library:action', async (e, name) => {
  if (name === 'settings') { openSettings(); return }
  if (name === 'record' && recording) { stopRecording(); return }
  if (name === 'repeat') {
    if (capturing || scrollBusy) return
    await hideLibraryForCapture()
    captureLastRegion()
    return
  }
  if (name !== 'region' && name !== 'scroll' && name !== 'record') return
  await hideLibraryForCapture()
  startRegionCapture(name === 'region' ? undefined : name)
})

ipcMain.handle('library:list', () => ({
  items: libraryItems(80),
  pinned: !!settings.libraryPinned,
  thumbHeight: settings.libraryThumbHeight || 104,
  order: LIBRARY_ORDERS.includes(settings.libraryOrder) ? settings.libraryOrder : 'old',
}))

// ---- 履歴パネルから外へドラッグする ----
// 何もしないと Chromium が <img> の元（小さい thumb.png）を持っていってしまうので、
// 画面側で dragstart を止めて、ここから本物のファイルでドラッグをやり直す。

// 掴んで外へ出ているあいだ、履歴パネルを引っ込めないでおく時間
const LIBRARY_DRAG_HOLD_MS = 8000
const DRAG_ICON_H = 72

// マウスに付いてくる絵。Windows は空だと startDrag が例外になるので、
// サムネイルが読めないときはドラッグ自体をやめる。大きいと邪魔なので高さで縮める
function dragIcon(id) {
  const p = path.join(entryDir(id), 'thumb.png')
  if (!fs.existsSync(p)) return null
  const img = nativeImage.createFromPath(p)
  if (img.isEmpty()) return null
  return img.getSize().height > DRAG_ICON_H
    ? img.resize({ height: DRAG_ICON_H, quality: 'good' })
    : img
}

// 渡すファイル。画像は書き込み版があればそちら（履歴パネルに出しているパスと同じ優先順）、
// 録画は動画と GIF のうち在るものを全部
function dragFilesFor(meta) {
  const out = []
  if (meta.kind === 'video') {
    for (const kind of ['video', 'gif']) {
      const p = recordingFile(meta, kind)
      if (fs.existsSync(p) && !out.includes(p)) out.push(p)
    }
    return out
  }
  if (meta.editedPath && fs.existsSync(meta.editedPath)) out.push(meta.editedPath)
  else {
    const p = originalPath(meta)
    if (p) out.push(p)
  }
  return out
}

// 画面側から来るのは「選んでいるもの全部」の配列（1件でも配列）
function idList(payload) {
  const list = Array.isArray(payload) ? payload : [payload]
  return list.filter((x) => typeof x === 'string' && x)
}

ipcMain.on('library:drag', (e, payload) => {
  const ids = idList(payload)
  const files = []
  let iconId = null
  let lost = ''
  for (const id of ids) {
    const meta = readEntry(id)
    if (!meta) continue
    const got = dragFilesFor(meta)
    // 無くなっているものが混じっても、渡せるぶんだけ渡す（ここで止めるとドラッグごと失敗する）
    if (!got.length) { lost = lost || (meta.file || meta.videoFile || id); continue }
    for (const p of got) if (!files.includes(p)) files.push(p)
    if (!iconId) iconId = id
  }
  if (!files.length) {
    showError('ファイルが見つかりませんでした', lost || ids.join('\n'))
    return
  }
  const icon = dragIcon(iconId)
  if (!icon) return
  libraryDragUntil = Date.now() + LIBRARY_DRAG_HOLD_MS
  libraryOutSince = 0
  e.sender.startDrag({ file: files[0], files, icon })
})

function libraryMenuForVideo(id, meta) {
  const gif = fs.existsSync(recordingFile(meta, 'gif'))
  return [
    { label: '動画を開く', click: () => openRecording(id, 'video') },
    { label: 'GIF を開く', enabled: gif, click: () => openRecording(id, 'gif') },
    { type: 'separator' },
    {
      label: 'ファイルの場所を開く',
      enabled: !!fileOf(meta),
      click: () => shell.showItemInFolder(fileOf(meta)),
    },
    { type: 'separator' },
    {
      label: 'この録画を履歴から消す（ファイルは残る）',
      click: () => { deleteEntry(id); notifyLibraryChanged() },
    },
  ]
}

// 同じフォルダのものは1つの窓にまとめる。1件ずつ開くとエクスプローラーが何枚も出る
function revealMany(files) {
  const seen = new Set()
  for (const p of files) {
    const dir = path.dirname(p)
    if (seen.has(dir)) continue
    seen.add(dir)
    shell.showItemInFolder(p)
  }
}

// 何枚も選んでいるときのメニュー。1つにしか意味のない操作（編集する・コピー）は出さない
function libraryMenuForMany(ids) {
  const metas = ids.map(readEntry).filter(Boolean)
  const files = []
  for (const m of metas) {
    const p = fileOf(m)
    if (p && !files.includes(p)) files.push(p)
  }
  const pics = metas.filter((m) => m.kind !== 'video').length
  return [
    { label: '選んだ ' + pics + ' 枚を画面に浮かせる', enabled: pics >= 1, click: () => pinFromLibrary(ids) },
    { type: 'separator' },
    { label: '横に並べて1枚に', enabled: pics >= 2, click: () => combineEntries(ids, 'row') },
    { label: '縦に並べて1枚に', enabled: pics >= 2, click: () => combineEntries(ids, 'col') },
    // 押せない理由が分かるよう、2枚以外・録画入り・大きさ違いでもグレーにせず、押したときに案内を出す
    { label: '違いに赤枠を付ける（同じ範囲で撮った2枚）', click: () => diffEntries(ids) },
    { type: 'separator' },
    {
      label: '選んだ ' + metas.length + ' 件のファイルの場所を開く',
      enabled: files.length > 0,
      click: () => revealMany(files),
    },
    { type: 'separator' },
    {
      label: '選んだ ' + metas.length + ' 件を履歴から消す（ファイルは残る）',
      click: () => {
        for (const m of metas) deleteEntry(m.id)
        notifyLibraryChanged()
      },
    },
  ]
}

// 右クリックメニューは Windows 標準のメニューを使わず、パネルの中に描かせる（標準のメニューは文字の大きさを変えられないため）。
// 組み立ては Menu のテンプレートと同じ形のまま。押された項目の番号が返ってきたら、その click を呼ぶ
let libraryMenuClicks = []
function showLibraryMenu(win, template) {
  if (!win || win.isDestroyed()) return
  libraryMenuClicks = []
  const items = template.map((t) => {
    if (t.type === 'separator') return { sep: true }
    libraryMenuClicks.push(t.click || null)
    return {
      i: libraryMenuClicks.length - 1,
      label: String(t.label || ''),
      accel: t.accelerator ? String(t.accelerator).replace('CmdOrCtrl', 'Ctrl') : '',
      enabled: t.enabled !== false,
    }
  })
  win.webContents.send('library:showMenu', items)
}
ipcMain.on('library:menuPick', (e, i) => {
  const click = Number.isInteger(i) ? libraryMenuClicks[i] : null
  libraryMenuClicks = []
  if (typeof click === 'function') click()
})

ipcMain.on('library:menu', (e, payload) => {
  const ids = idList(payload)
  const win = BrowserWindow.fromWebContents(e.sender)
  if (ids.length > 1) {
    showLibraryMenu(win, libraryMenuForMany(ids))
    return
  }
  const id = ids[0]
  const meta = id ? readEntry(id) : null
  if (!meta) return
  if (meta.kind === 'video') {
    showLibraryMenu(win, libraryMenuForVideo(id, meta))
    return
  }
  showLibraryMenu(win, [
    { label: '編集する', click: () => openEditorFromLibrary(id) },
    {
      label: 'クリップボードにコピー',
      accelerator: 'CmdOrCtrl+C',   // 表示だけ。キーは画面側の keydown で拾う
      registerAccelerator: false,
      click: () => copyFromLibrary([id]),
    },
    { label: '画面に浮かせる', click: () => pinFromLibrary([id]) },
    {
      label: 'ファイルの場所を開く',
      enabled: !!fileOf(meta),
      click: () => shell.showItemInFolder(fileOf(meta)),
    },
    { label: 'ファイルの場所（パス）をコピー', enabled: !!fileOf(meta), click: () => clipboard.writeText(fileOf(meta)) },
    { type: 'separator' },
    { label: '名前を変える…', accelerator: 'F2', registerAccelerator: false, click: () => askLibraryInfo(id, 'rename') },
    { label: 'タイトル・タグを付ける…', click: () => askLibraryInfo(id, 'info') },
    { type: 'separator' },
    {
      label: 'この1枚を履歴から消す（ファイルは残る）',
      click: () => {
        deleteEntry(id)
        notifyLibraryChanged()
      },
    },
  ])
})

// ---------------------------------------------------------------- 画面に浮かせる（ピン留め）
//
// 撮った絵を枠のない小さな窓にして、いつも手前に浮かべておく。撮影・録画には写る
// （録画ソフトにも映す必要があるので setContentProtection は使わない。2026-09-26 ユーザー決定）。
// スクロール撮影のあいだだけは隠す（ホイールが浮かせた絵に吸われるため）

const pinWins = new Set()
const PIN_ZOOM_STEP = 1.1       // ホイール1目盛りで大きさを何倍にするか
const PIN_MAX_SCALE = 4         // 等倍の何倍まで大きくできるか
const PIN_MIN_W = 48            // これより小さくはしない（掴めなくなるため）
const PIN_MIN_H = 32
const WM_EXITSIZEMOVE = 0x0232   // Windows の移動・リサイズが終わった（ボタンを離した）知らせ
const PIN_OPACITY_STEP = 0.1
const PIN_MIN_OPACITY = 0.2     // これより薄いと見失う
const PIN_DRAG_MS = 12          // 掴んでいるあいだ、カーソルの位置を読みに行く間隔
const PIN_CASCADE = 28          // 画面の真ん中に出すとき、重ならないよう1枚ごとにずらす幅

function livePins() {
  return [...pinWins].filter((w) => !w.isDestroyed())
}

// 最前面（screen-saver 段）の暗幕を壊すと、同じアプリの floating 段の窓まで最前面から外れる。
// 暗幕を閉じたら浮かせた絵を最前面に付け直す（外したり付けたりしないと Windows が付け直してくれない）
function raisePins() {
  for (const w of livePins()) {
    w.setAlwaysOnTop(false)
    w.setAlwaysOnTop(true, 'floating')
  }
}

function closeAllPins() {
  for (const w of livePins()) w.destroy()
}

// スクロール撮影の前に隠す。戻すのは隠したものだけ（呼び出し側が持って、終わったら showInactive）
function hidePinsForScroll() {
  const hidden = []
  for (const w of livePins()) {
    if (!w.isVisible()) continue
    stopPinDrag(w)
    w.hide()
    hidden.push(w)
  }
  return hidden
}

function stopPinDrag(win) {
  if (win.pinDrag) clearInterval(win.pinDrag)
  win.pinDrag = null
  win.pinResizeStep = null
}

// 大きさは等倍（画像の実ピクセル ÷ 拡大率）。範囲撮影の絵は撮った位置にぴったり重ねる。
// off は見えている絵の左上が元の絵のどこか（切り抜き・はみ出しのぶんずらすため）。
// 拡大率は scaleFactor ではなく「画像サイズ ÷ 画面の大きさ」の実測比で出す（オーバーレイと同じ）。
// 画面の構成が変わっていたら推測で重ねず、画面の真ん中寄りに出す
function openPin(image, meta, off) {
  const size = image.getSize()
  if (!size.width || !size.height) return null
  const o = off || { x: 0, y: 0 }
  const region = meta && validRegion(meta.region) ? meta.region : null
  const rd = region ? regionDisplay(region) : null
  const disp = rd || screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const kx = rd ? region.imageW / rd.bounds.width : (disp.scaleFactor || 1)
  const ky = rd ? region.imageH / rd.bounds.height : (disp.scaleFactor || 1)
  const baseW = size.width / kx
  const baseH = size.height / ky
  const wa = disp.workArea
  // 大きすぎる絵は作業領域に収める
  const scale = Math.min(1, wa.width / baseW, wa.height / baseH)
  const w = Math.max(PIN_MIN_W, Math.round(baseW * scale))
  const h = Math.max(PIN_MIN_H, Math.round(baseH * scale))

  let x, y
  if (rd && scale === 1) {
    const b = disp.bounds
    x = Math.round(b.x + (region.x + o.x) / kx)
    y = Math.round(b.y + (region.y + o.y) / ky)
    // はみ出した文字で画角が広がった絵は画面の外へ出ることがあるので、画面の中へ寄せる
    x = Math.max(b.x, Math.min(x, b.x + b.width - w))
    y = Math.max(b.y, Math.min(y, b.y + b.height - h))
  } else {
    const n = livePins().length % 8
    x = Math.round(wa.x + (wa.width - w) / 2 + n * PIN_CASCADE)
    y = Math.round(wa.y + (wa.height - h) / 2 + n * PIN_CASCADE)
    x = Math.max(wa.x, Math.min(x, wa.x + wa.width - w))
    y = Math.max(wa.y, Math.min(y, wa.y + wa.height - h))
  }

  // resizable は true にして、手で縁を引っぱる変更だけを will-resize で止める。
  // 枠なしで resizable: false の窓は拡大率 150% の画面で幅が 1 DIP 縮み、左に見えない縁が
  // 1 DIP できて中身が 2 DIP 狭くなる（setBounds でも直らない）。すると絵が縮めて描かれ、撮った画面と重ならない
  const win = new BrowserWindow({
    x, y, width: w, height: h,
    show: false,
    frame: false,
    resizable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    enableLargerThanScreen: true,
    backgroundColor: '#23262b',
    title: 'ScreenShooter — 浮かせた絵',
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  win.setMenu(null)
  // 縁を Windows に引っぱらせない（絵の縦横比が崩れるため）。setBounds には効かない。
  // 外周の数px（150% の画面で左・上は約 4 DIP、右・下は 1px）は Windows が横取りして画面側に押した知らせが来ないので、
  // Windows のリサイズが始まったのを合図に自前のリサイズへ切り替え、離した（WM_EXITSIZEMOVE）ところで終える
  win.on('will-resize', (ev, _nb, details) => {
    ev.preventDefault()
    const edge = PIN_OS_EDGES[details && details.edge]
    if (!edge) return
    if (!win.pinOsResizing) { win.pinOsResizing = true; startPinResize(win, edge, true) }
    // Windows のリサイズ中はタイマーが遅れることがあるので、動くたびにも合わせる
    if (win.pinResizeStep) win.pinResizeStep()
  })
  win.hookWindowMessage(WM_EXITSIZEMOVE, () => {
    if (!win.pinOsResizing) return
    win.pinOsResizing = false
    setImmediate(() => { if (!win.isDestroyed()) endPinDrag(win) })
  })
  // 大きさはいつも「等倍 × scale」から計算し直す。今の窓の大きさから掛け算すると、
  // 拡大率 150% の画面で 1px ずつ丸めがたまって育っていく
  win.pin = { image, libraryId: meta ? meta.id : null, baseW, baseH, scale, opacity: 1, w, h }
  fitContentBounds(win, { x, y, width: w, height: h })
  loadGuarded(win, path.join(RENDERER, 'pin.html'), '浮かせた絵', {
    onReady: () => win.webContents.send('pin:init', { dataUrl: image.toDataURL() }),
    onGiveUp: () => { if (!win.isDestroyed()) win.destroy() },
  })
  win.on('closed', () => { stopPinDrag(win); pinWins.delete(win) })
  pinWins.add(win)
  return win
}

function pinOf(e) {
  const win = BrowserWindow.fromWebContents(e.sender)
  return (win && !win.isDestroyed() && win.pin) ? win : null
}

// 絵を貼り終えてから出す（白い窓が一瞬出るのを防ぐ）
ipcMain.on('pin:ready', (e) => {
  const win = pinOf(e)
  if (!win) return
  win.setAlwaysOnTop(true, 'floating')
  if (win.isVisible()) return
  // Esc で閉じられるよう、出すときに手前に持ってくる
  win.show()
  const b = win.getContentBounds()
  fitContentBounds(win, { x: b.x, y: b.y, width: win.pin.w, height: win.pin.h })
})

// 移動は自前で。押しているあいだ本体がカーソルの実位置を読んで窓を動かす
// （-webkit-app-region: drag だと、その上では右クリックとホイールが届かないため）
ipcMain.on('pin:dragStart', (e) => {
  const win = pinOf(e)
  if (!win) return
  stopPinDrag(win)
  const c0 = screen.getCursorScreenPoint()
  const b0 = win.getContentBounds()
  // setPosition だけだと、150% の画面では呼ぶたびに Windows が大きさを丸めて広げ、掴んでいる間に育っていく。
  // 押した瞬間の中身の大きさを毎回いっしょに渡して、位置だけが変わるようにする
  win.pinDrag = setInterval(() => {
    if (win.isDestroyed()) return
    const p = screen.getCursorScreenPoint()
    win.setContentBounds({ x: b0.x + p.x - c0.x, y: b0.y + p.y - c0.y, width: b0.width, height: b0.height })
  }, PIN_DRAG_MS)
})

function clampPinScale(pin, scale) {
  const minScale = Math.min(1, Math.max(PIN_MIN_W / pin.baseW, PIN_MIN_H / pin.baseH))
  return Math.max(minScale, Math.min(PIN_MAX_SCALE, scale))
}

// 縁のドラッグで大きさを変える。ホイールで大まかに、縁で細かく合わせる用。
// 窓の縁を Windows に引っぱらせると縦横の比が崩れるので、移動と同じく本体がカーソルを読んで
// 「等倍 × scale」から大きさを出す（反対側の辺・角は動かさない）
ipcMain.on('pin:resizeStart', (e, edge) => {
  const win = pinOf(e)
  if (!win || typeof edge !== 'string' || !/^(n|s)?(e|w)?$/.test(edge) || !edge) return
  startPinResize(win, edge, false)
})

// Windows の will-resize の向き → pin の縁の向き
const PIN_OS_EDGES = {
  top: 'n', bottom: 's', left: 'w', right: 'e',
  'top-left': 'nw', 'top-right': 'ne', 'bottom-left': 'sw', 'bottom-right': 'se',
}

// fromOs = Windows が縁の外周を横取りして始めたリサイズ（画面側に押した知らせが来ない）。
// そのときは押した瞬間の位置が分からないので、縁そのものを押したとみなす
function startPinResize(win, edge, fromOs) {
  stopPinDrag(win)
  const pin = win.pin
  const b0 = win.getContentBounds()
  const sx = edge.includes('e') ? 1 : edge.includes('w') ? -1 : 0
  const sy = edge.includes('s') ? 1 : edge.includes('n') ? -1 : 0
  const c0 = fromOs
    ? { x: sx > 0 ? b0.x + b0.width : b0.x, y: sy > 0 ? b0.y + b0.height : b0.y }
    : screen.getCursorScreenPoint()
  let last = pin.scale
  const step = () => {
    if (win.isDestroyed()) return
    const p = screen.getCursorScreenPoint()
    // 引っぱった向きの伸びを倍率にする。角は縦横のうち大きく動かしたほう
    const kx = sx ? (b0.width + sx * (p.x - c0.x)) / b0.width : 0
    const ky = sy ? (b0.height + sy * (p.y - c0.y)) / b0.height : 0
    const k = sx && sy ? Math.max(kx, ky) : (sx ? kx : ky)
    const scale = clampPinScale(pin, (b0.width / pin.baseW) * k)
    if (scale === last) return
    last = scale
    const w = Math.max(1, Math.round(pin.baseW * scale))
    const h = Math.max(1, Math.round(pin.baseH * scale))
    pin.scale = scale
    pin.w = w
    pin.h = h
    // 反対側を止める。辺だけのときは、もう一方の向きは真ん中を止める
    const x = sx > 0 ? b0.x : sx < 0 ? b0.x + b0.width - w : Math.round(b0.x + (b0.width - w) / 2)
    const y = sy > 0 ? b0.y : sy < 0 ? b0.y + b0.height - h : Math.round(b0.y + (b0.height - h) / 2)
    win.setContentBounds({ x, y, width: w, height: h })
    win.webContents.send('pin:status', Math.round(scale * 100) + '%')
  }
  win.pinResizeStep = step
  win.pinDrag = setInterval(step, PIN_DRAG_MS)
}

function endPinDrag(win) {
  stopPinDrag(win)
  const b = win.getContentBounds()
  fitContentBounds(win, { x: b.x, y: b.y, width: win.pin.w, height: win.pin.h })
}

// 離したら大きさを合わせ直す。拡大率の違う画面へ動かすと Windows が窓の大きさを変えるため
ipcMain.on('pin:dragEnd', (e) => {
  const win = pinOf(e)
  if (win) endPinDrag(win)
})

// ホイールで大きさ（カーソルの下の点を動かさずに）、Ctrl+ホイールで濃さ。どちらも上へ回すと増える
ipcMain.on('pin:wheel', (e, d) => {
  const win = pinOf(e)
  if (!win || !d || !Number.isFinite(d.dy) || !d.dy) return
  const pin = win.pin
  const up = d.dy < 0
  if (d.ctrl) {
    const next = up ? pin.opacity + PIN_OPACITY_STEP : pin.opacity - PIN_OPACITY_STEP
    pin.opacity = Math.round(Math.max(PIN_MIN_OPACITY, Math.min(1, next)) * 10) / 10
    win.setOpacity(pin.opacity)
    win.webContents.send('pin:status', '濃さ ' + Math.round(pin.opacity * 100) + '%')
    return
  }
  const next = up ? pin.scale * PIN_ZOOM_STEP : pin.scale / PIN_ZOOM_STEP
  const scale = clampPinScale(pin, next)
  if (scale === pin.scale) return
  const b = win.getContentBounds()
  const fx = Number.isFinite(d.fx) ? Math.max(0, Math.min(1, d.fx)) : 0.5
  const fy = Number.isFinite(d.fy) ? Math.max(0, Math.min(1, d.fy)) : 0.5
  const w = Math.max(1, Math.round(pin.baseW * scale))
  const h = Math.max(1, Math.round(pin.baseH * scale))
  pin.scale = scale
  pin.w = w
  pin.h = h
  fitContentBounds(win, {
    x: Math.round(b.x + b.width * fx - w * fx),
    y: Math.round(b.y + b.height * fy - h * fy),
    width: w, height: h,
  })
  win.webContents.send('pin:status', Math.round(scale * 100) + '%')
})

ipcMain.on('pin:close', (e) => {
  const win = pinOf(e)
  if (win) win.destroy()
})

// 右クリックの小さなメニュー。コピーは浮かべている絵そのもの（書き込み・切り抜き込み、仕上げなし）
ipcMain.on('pin:menu', (e) => {
  const win = pinOf(e)
  if (!win) return
  const id = win.pin.libraryId
  Menu.buildFromTemplate([
    { label: '閉じる', click: () => { if (!win.isDestroyed()) win.destroy() } },
    { label: '編集画面で開く', enabled: !!(id && readEntry(id)), click: () => openEditorFromLibrary(id) },
    {
      label: 'クリップボードにコピー',
      click: () => { if (!win.isDestroyed()) clipboard.writeImage(win.pin.image) },
    },
  ]).popup({ window: win })
})

// 編集画面の「浮かせる」。見えている絵そのものと、その左上の位置が届く
ipcMain.on('editor:pin', (e, d) => {
  const win = BrowserWindow.fromWebContents(e.sender)
  if (!win || win.isDestroyed() || !d || typeof d.dataUrl !== 'string') return
  const img = nativeImage.createFromDataURL(d.dataUrl)
  if (img.isEmpty()) return
  const meta = win.libraryId ? readEntry(win.libraryId) : null
  openPin(img, meta, { x: Number(d.x) || 0, y: Number(d.y) || 0 })
})

// 履歴の右クリック「画面に浮かせる」。書き込みか切り抜きのある絵は、見えない編集画面に描かせてから出す
// （描き方を main 側に真似て書かないため）。仕上げの余白・影は付けない。録画は除く
let libraryPinning = false

async function pinFromLibrary(ids) {
  if (libraryPinning) return
  libraryPinning = true
  try {
    const metas = ids.map(readEntry).filter((m) => m && m.kind !== 'video')
    let lost = 0
    for (let i = 0; i < metas.length; i++) {
      const meta = metas[i]
      const img = originalImage(meta)
      if (!img) { lost++; continue }
      if (!hasEdits(meta, img.getSize())) { openPin(img, meta, { x: 0, y: 0 }); continue }
      if (metas.length > 1) libraryToast('浮かせる準備中…（' + (i + 1) + ' / ' + metas.length + '）')
      const r = await renderEditedView(img, meta, { finish: 'none' })
      const out = r ? nativeImage.createFromDataURL(r.dataUrl) : null
      if (!out || out.isEmpty()) { lost++; continue }
      openPin(out, meta, { x: r.x, y: r.y })
    }
    if (lost) libraryToast(lost + ' 枚は浮かせられませんでした（元の画像が見つからない）')
  } finally {
    libraryPinning = false
  }
}

// ---------------------------------------------------------------- 設定ウィンドウ

let settingsWin = null

function openSettings() {
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.show()
    settingsWin.focus()
    return
  }
  settingsWin = new BrowserWindow({
    width: 680,
    height: 986,
    resizable: false,
    show: false,
    backgroundColor: '#23262b',
    title: 'ScreenShooter — 設定',
    icon: path.join(ASSETS, 'app.ico'),
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  settingsWin.setMenu(null)
  loadGuarded(settingsWin, path.join(RENDERER, 'settings.html'), '設定の画面', {
    onGiveUp: () => { if (settingsWin && !settingsWin.isDestroyed()) settingsWin.destroy() },
  })
  settingsWin.once('ready-to-show', () => { settingsWin.show(); settingsWin.focus() })
  settingsWin.on('closed', () => { settingsWin = null })
}

// 自動起動は設定ファイルに持たず、スタートアップ フォルダの中身から毎回決める
ipcMain.handle('settings:get', () => ({ ...settings, exportFinish: exportFinish(), autoStart: autoStartEnabled() }))

ipcMain.handle('settings:save', (e, patch) => {
  const clean = {}
  if (typeof patch.hotkeyRegion === 'string') clean.hotkeyRegion = patch.hotkeyRegion.trim()
  if (typeof patch.hotkeyFull === 'string') clean.hotkeyFull = patch.hotkeyFull.trim()
  if (typeof patch.hotkeyScroll === 'string') clean.hotkeyScroll = patch.hotkeyScroll.trim()
  if (typeof patch.hotkeyRecord === 'string') clean.hotkeyRecord = patch.hotkeyRecord.trim()
  if (typeof patch.hotkeyRepeat === 'string') clean.hotkeyRepeat = patch.hotkeyRepeat.trim()
  if (typeof patch.hotkeyDelay === 'string') clean.hotkeyDelay = patch.hotkeyDelay.trim()
  if (typeof patch.hotkeyOcr === 'string') clean.hotkeyOcr = patch.hotkeyOcr.trim()
  if (typeof patch.hotkeyColor === 'string') clean.hotkeyColor = patch.hotkeyColor.trim()
  if (typeof patch.captureCursor === 'boolean') clean.captureCursor = patch.captureCursor
  if (typeof patch.claudeTranslate === 'boolean') clean.claudeTranslate = patch.claudeTranslate
  if (typeof patch.recordAutoBlur === 'boolean') clean.recordAutoBlur = patch.recordAutoBlur
  if (typeof patch.embedEdits === 'boolean') clean.embedEdits = patch.embedEdits
  if ([0, 3, 5].includes(patch.recordCountdown)) clean.recordCountdown = patch.recordCountdown
  if (Number.isFinite(patch.delaySeconds)) clean.delaySeconds = Math.max(1, Math.min(60, Math.round(patch.delaySeconds)))
  if (AFTER_CAPTURES.includes(patch.afterCapture)) clean.afterCapture = patch.afterCapture
  if (typeof patch.quickClipboard === 'boolean') clean.quickClipboard = patch.quickClipboard
  if (CAPTURE_CLIPBOARDS.includes(patch.captureClipboard)) clean.captureClipboard = patch.captureClipboard
  if (EXPORT_FINISHES.includes(patch.exportFinish)) clean.exportFinish = patch.exportFinish
  if (LIBRARY_ORDERS.includes(patch.libraryOrder)) clean.libraryOrder = patch.libraryOrder
  if (typeof patch.saveDir === 'string' && patch.saveDir.trim()) clean.saveDir = patch.saveDir.trim()
  if (typeof patch.sendToMenu === 'boolean') clean.sendToMenu = patch.sendToMenu
  if (typeof patch.snapWindows === 'boolean') clean.snapWindows = patch.snapWindows
  if (typeof patch.recordAudio === 'boolean') clean.recordAudio = patch.recordAudio
  if (typeof patch.autoBlur === 'boolean') clean.autoBlur = patch.autoBlur
  if (BLUR_LEVELS.includes(patch.autoBlurLevel)) clean.autoBlurLevel = patch.autoBlurLevel
  if (Array.isArray(patch.autoBlurWords)) {
    const words = []
    for (const w of patch.autoBlurWords) {
      const t = typeof w === 'string' ? w.trim().slice(0, 100) : ''
      if (t && !words.includes(t)) words.push(t)
    }
    clean.autoBlurWords = words.slice(0, 300)
  }
  if (Array.isArray(patch.autoBlurLabels)) {
    const labels = []
    for (const w of patch.autoBlurLabels) {
      const t = typeof w === 'string' ? w.trim().slice(0, 40) : ''
      if (t && !labels.includes(t)) labels.push(t)
    }
    clean.autoBlurLabels = labels.slice(0, 100)
  }
  if (Number.isFinite(patch.libraryLimit)) clean.libraryLimit = Math.max(10, Math.min(5000, Math.round(patch.libraryLimit)))
  if (Number.isFinite(patch.libraryThumbHeight)) clean.libraryThumbHeight = Math.max(64, Math.min(240, Math.round(patch.libraryThumbHeight)))
  if (Number.isFinite(patch.recordFps)) clean.recordFps = Math.max(5, Math.min(60, Math.round(patch.recordFps)))
  if (Number.isFinite(patch.gifFps)) clean.gifFps = Math.max(2, Math.min(25, Math.round(patch.gifFps)))
  if (Number.isFinite(patch.gifMaxWidth)) {
    const gw = Math.round(patch.gifMaxWidth)
    clean.gifMaxWidth = gw <= 0 ? 0 : Math.max(240, Math.min(1920, gw))
  }

  saveSettings(clean)
  applySendTo()
  pruneLibrary()
  notifyLibraryChanged()
  const failed = applyHotkeys()
  refreshTrayMenu()
  // 自動起動は、画面でチェックを切り替えたときだけ届く（autoStartChanged）。届かなければフォルダには触らない
  let autoStart = null
  if (patch.autoStartChanged === true && typeof patch.autoStart === 'boolean') autoStart = setAutoStart(patch.autoStart)
  return { ok: failed.length === 0 && (!autoStart || autoStart.ok), failed, autoStart, autoStartNow: autoStartEnabled() }
})

ipcMain.handle('settings:pickFolder', async (e) => {
  const win = BrowserWindow.fromWebContents(e.sender)
  const r = await dialog.showOpenDialog(win, {
    title: '保存先フォルダを選ぶ',
    defaultPath: settings.saveDir,
    properties: ['openDirectory', 'createDirectory'],
  })
  if (r.canceled || !r.filePaths.length) return null
  return r.filePaths[0]
})

ipcMain.handle('app:openFolder', () => { openSaveDir(); return true })

function openSaveDir() {
  try { fs.mkdirSync(settings.saveDir, { recursive: true }) } catch (_) {}
  shell.openPath(settings.saveDir)
}

// ---------------------------------------------------------------- ホットキー

// 登録できなかったものの一覧を返す（他のアプリに先に取られているとここに入る）
function applyHotkeys() {
  globalShortcut.unregisterAll()
  const failed = []
  const reg = (accel, label, fn) => {
    if (!accel) return
    let ok = false
    try { ok = globalShortcut.register(accel, fn) } catch (_) { ok = false }
    if (!ok) failed.push({ label, accel })
  }
  reg(settings.hotkeyRegion, '範囲を選んで撮る', () => { startRegionCapture('region') })
  reg(settings.hotkeyFull, '画面全体を撮る', () => { captureFullScreen() })
  reg(settings.hotkeyRepeat, '前回と同じ範囲で撮る', () => { captureLastRegion() })
  reg(settings.hotkeyScroll, 'スクロールして長いページを撮る', () => { startRegionCapture('scroll') })
  reg(settings.hotkeyOcr, '文字を読み取ってコピー', () => { startRegionCapture('ocr') })
  reg(settings.hotkeyColor, '色を拾ってコピー', () => { startRegionCapture('color') })
  // 時間差のキーは、数えている途中に押すと「やめる」になる
  reg(settings.hotkeyDelay, '時間差で撮る', () => {
    if (delayTimer) cancelDelayedCapture()
    else startDelayedCapture(delaySeconds())
  })
  // 録画のキーは、録画中に押すと「止める」になる
  reg(settings.hotkeyRecord, '録画する', () => {
    if (recording) stopRecording()
    else startRegionCapture('record')
  })
  return failed
}

// ---------------------------------------------------------------- Windows 起動時の自動起動
//
// スタートアップ フォルダの .lnk 1個で実現する（レジストリの Run はデスクトップより先に走り、トレイに出ないことがあるため）。
// IMPORTANT: 以前、設定のチェック1つで手で置いたショートカットを消す事故があった。そのため
//   ・動かすのは、設定画面でチェックを「切り替えた」ときだけ（保存のたびに状態を書き直さない）
//   ・消すのは、このアプリ（この electron.exe にこのフォルダを渡すもの）を起動するショートカットだけ
//   ・チェックの表示は、毎回フォルダの中身を見て決める（設定ファイルに覚えない）
// SCREENSHOOTER_STARTUP_DIR は動作確認用（本物のスタートアップ フォルダを触らずに試すため）
const STARTUP_LINKS = [app.getName() + '.lnk', OLD_NAME + '.lnk']

function startupDir() {
  return process.env.SCREENSHOOTER_STARTUP_DIR
    || path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup')
}

// このアプリを起動するショートカットか。引数の引用符は外して、フォルダの場所で比べる
function launchesThisApp(link) {
  try {
    const s = shell.readShortcutLink(link)
    return samePath(s.target, process.execPath) && samePath(String(s.args || '').replace(/"/g, '').trim(), ROOT)
  } catch (_) {
    return false
  }
}

function ourStartupLinks() {
  return STARTUP_LINKS.map((n) => path.join(startupDir(), n)).filter((p) => fs.existsSync(p) && launchesThisApp(p))
}

function autoStartEnabled() { return ourStartupLinks().length > 0 }

function setAutoStart(on) {
  try {
    if (!on) {
      for (const p of ourStartupLinks()) fs.rmSync(p, { force: true })
      return { ok: true }
    }
    if (autoStartEnabled()) return { ok: true }
    const link = path.join(startupDir(), STARTUP_LINKS[0])
    // 同じ名前で別のものを起動するショートカットがあったら、上書きしない
    if (fs.existsSync(link)) return { ok: false, error: '同じ名前の別のショートカットがあるため作れませんでした： ' + link }
    fs.mkdirSync(path.dirname(link), { recursive: true })
    // フォルダ名に空白が入るので、渡す側で引用符を付ける
    const ok = shell.writeShortcutLink(link, 'create', {
      target: process.execPath,
      args: '"' + ROOT + '"',
      cwd: ROOT,
      icon: path.join(ASSETS, 'app.ico'),
      iconIndex: 0,
      description: app.getName(),
    })
    return ok ? { ok: true } : { ok: false, error: 'ショートカットを作れませんでした' }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
}

// 右クリックの「送る」に出すショートカット。レジストリは触らず、ファイルを1個置くだけ。
// 「送る」で選んだファイルのパスは、この args の後ろに足されて渡ってくる（imagePathsFrom で拾う）
function sendToLinkPath(name) {
  return path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'SendTo', (name || app.getName()) + 'で開く.lnk')
}

// 起動のたびにも呼ぶ。アプリの名前・フォルダが変わっても、作り直して今の場所を指させるため
function applySendTo() {
  const link = sendToLinkPath()
  try {
    // 旧い名前で作ったもの（このアプリが作ったもの）は消す。オンなら新しい名前で作り直す
    const old = sendToLinkPath(OLD_NAME)
    if (fs.existsSync(old)) fs.rmSync(old, { force: true })
    if (!settings.sendToMenu) {
      if (fs.existsSync(link)) fs.rmSync(link, { force: true })
      return
    }
    fs.mkdirSync(path.dirname(link), { recursive: true })
    // フォルダ名に空白が入るので、渡す側で引用符を付ける
    shell.writeShortcutLink(link, fs.existsSync(link) ? 'replace' : 'create', {
      target: process.execPath,
      args: '"' + ROOT + '"',
      cwd: ROOT,
      icon: path.join(ASSETS, 'app.ico'),
      iconIndex: 0,
      description: app.getName() + 'で開く',
    })
  } catch (err) {
    console.error('「送る」への登録に失敗:', err)
  }
}

// ---------------------------------------------------------------- タスクトレイ

let tray = null

function trayTooltip() {
  return 'ScreenShooter — クリックで履歴パネル'
    + (settings.hotkeyRegion ? '（撮るのは ' + settings.hotkeyRegion + '）' : '')
}

// キーが決まっていない項目は、右のキー欄が空のままだと「無い」のか「決めていない」のか
// 分からないので、項目名に添える。accelerator は ASCII しか通らず日本語は黙って消えるため、
// 「未設定」はラベル側に書く。
function trayItem(text, accel, click) {
  return {
    label: accel ? text : text + '　［キー未設定］',
    accelerator: accel || undefined,
    registerAccelerator: false,
    click,
  }
}

// まだ一度も範囲で撮っていない・画面の構成が変わったときは、押すとふつうの範囲選択になる。
// 押してから驚かないよう、項目名でそれを知らせる
function repeatLabel(text) {
  return regionDisplay(settings.lastRegion) ? text : text + '（範囲を選ぶ）'
}

function refreshTrayMenu() {
  if (!tray) return
  tray.setToolTip(trayTooltip())
}

function trayMenuTemplate() {
  return [
    trayItem('範囲を選んで撮る', settings.hotkeyRegion, () => startRegionCapture()),
    trayItem(repeatLabel('前回と同じ範囲で撮る'), settings.hotkeyRepeat, () => captureLastRegion()),
    trayItem('画面全体を撮る', settings.hotkeyFull, () => captureFullScreen()),
    trayItem('スクロールして長いページを撮る', settings.hotkeyScroll, () => startRegionCapture('scroll')),
    trayItem(
      recording ? '録画を止める' : '録画する（GIF・動画）',
      settings.hotkeyRecord,
      () => { if (recording) stopRecording(); else startRegionCapture('record') },
    ),
    // 録画中は「止める」と「一時停止」だけを出す（同じ範囲でもう1本は重ねて始められない）
    ...(recording
      ? [{ label: recordPaused ? '録画を再開する' : '録画を一時停止する', click: () => pauseRecording() }]
      : [{ label: repeatLabel('前回と同じ範囲で録画'), click: () => recordLastRegion() }]),
    // 数えている途中は「やめる」だけを出す
    delayTimer
      ? { label: '時間差撮影をやめる', click: () => cancelDelayedCapture() }
      : {
        label: '時間差で撮る',
        submenu: [
          trayItem(delaySeconds() + '秒後に範囲を撮る（設定の秒数）', settings.hotkeyDelay, () => startDelayedCapture(delaySeconds())),
          { label: '3秒後に範囲を撮る', click: () => startDelayedCapture(3) },
          { label: '5秒後に範囲を撮る', click: () => startDelayedCapture(5) },
          { label: '10秒後に範囲を撮る', click: () => startDelayedCapture(10) },
        ],
      },
    { label: 'クリップボードの画像を開く', click: () => openClipboardImage(true) },
    trayItem('文字を読み取ってコピー', settings.hotkeyOcr, () => startRegionCapture('ocr')),
    trayItem('色を拾ってコピー', settings.hotkeyColor, () => startRegionCapture('color')),
    { type: 'separator' },
    { label: '履歴パネルを開く', click: () => showLibrary(false) },
    // 浮かせた絵があるときだけ出す（自前のメニューは「押せない項目」を持てないため）
    ...(livePins().length ? [{ label: '浮かせた絵をすべて閉じる（' + livePins().length + '枚）', click: () => closeAllPins() }] : []),
    { label: '保存フォルダを開く', click: () => openSaveDir() },
    { label: '設定…', click: () => openSettings() },
    { type: 'separator' },
    { label: '終了', click: () => { app.isQuitting = true; app.quit() } },
  ]
}

// Windows 標準のメニューは文字の大きさを変えられないので、右クリックのメニューは自前の窓で出す。
// 窓は一度作ったら隠して使い回す（毎回作ると出るまで待たされるため）。
let trayMenuWin = null
let trayMenuClicks = []
let trayMenuAt = null

function trayMenuItems(template) {
  return template.map((t) => {
    if (t.type === 'separator') return { sep: true }
    const item = { label: t.label, accel: t.accelerator || '' }
    if (t.submenu) item.sub = trayMenuItems(t.submenu)
    else { item.id = trayMenuClicks.length; trayMenuClicks.push(t.click) }
    return item
  })
}

function ensureTrayMenuWin(onReady) {
  if (trayMenuWin && !trayMenuWin.isDestroyed()) { onReady(); return }
  trayMenuWin = new BrowserWindow({
    width: 300, height: 200, show: false, frame: false, resizable: false,
    movable: false, minimizable: false, maximizable: false, fullscreenable: false,
    skipTaskbar: true, alwaysOnTop: true, backgroundColor: '#2b2d31',
    title: 'ScreenShooter — メニュー',
    // 隠して使い回すので、隠れている間も処理を止めさせない
    webPreferences: { preload: PRELOAD, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
  })
  trayMenuWin.setMenu(null)
  trayMenuWin.on('blur', () => hideTrayMenu())
  trayMenuWin.on('closed', () => { trayMenuWin = null })
  let first = true
  loadGuarded(trayMenuWin, path.join(RENDERER, 'traymenu.html'), 'メニュー', {
    quiet: true,
    onReady: () => { if (first) { first = false; onReady() } },
  })
}

function showTrayMenu() {
  trayMenuAt = screen.getCursorScreenPoint()
  ensureTrayMenuWin(() => {
    trayMenuClicks = []
    const items = trayMenuItems(trayMenuTemplate())
    trayMenuWin.webContents.send('traymenu:init', items)
  })
}

function hideTrayMenu() {
  if (trayMenuWin && !trayMenuWin.isDestroyed() && trayMenuWin.isVisible()) trayMenuWin.hide()
}

// 画面側が中身の大きさを測って知らせてくる。カーソルの左上に出し、画面からはみ出さないよう寄せる
ipcMain.on('traymenu:size', (_e, size) => {
  if (!trayMenuWin || trayMenuWin.isDestroyed() || !trayMenuAt) return
  const w = Math.ceil(size.width), h = Math.ceil(size.height)
  const area = screen.getDisplayNearestPoint(trayMenuAt).workArea
  let x = trayMenuAt.x - w, y = trayMenuAt.y - h
  x = Math.max(area.x, Math.min(x, area.x + area.width - w))
  y = Math.max(area.y, Math.min(y, area.y + area.height - h))
  trayMenuWin.setBounds({ x, y, width: w, height: h })
  trayMenuWin.setAlwaysOnTop(true, 'pop-up-menu')
  trayMenuWin.show()
  trayMenuWin.focus()
})

ipcMain.on('traymenu:pick', (_e, id) => {
  hideTrayMenu()
  const click = trayMenuClicks[id]
  // 窓が消えきってから動かす（撮影の画面にメニューが写り込まないように）
  if (click) setTimeout(click, 120)
})

ipcMain.on('traymenu:close', () => hideTrayMenu())

function buildTray() {
  const iconPath = path.join(ASSETS, 'tray.png')
  let icon = nativeImage.createFromPath(iconPath)
  if (icon.isEmpty()) icon = nativeImage.createEmpty()
  tray = new Tray(icon)
  // 撮るのはホットキーが主なので、左クリックは撮影履歴にあてる（撮影は右クリックのメニューから）
  tray.on('click', () => toggleLibrary())
  tray.on('right-click', () => showTrayMenu())
  refreshTrayMenu()
}

// ---------------------------------------------------------------- 起動

function showError(message, detail) {
  dialog.showMessageBox({ type: 'error', title: 'ScreenShooter', message, detail: detail || '' })
}

function init() {
  loadSettings()
  lib().ensure()
  applySendTo()
  // 画面の取り込みを許可する係。ここを付けないと録画の要求が全部断られる。
  // 録画したい画面をこちらで決めるので、選択ダイアログは出さない。
  session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
    const disp = screen.getAllDisplays().find((d) => d.id === recordDisplayId)
      || screen.getPrimaryDisplay()
    try {
      const sources = await desktopCapturer.getSources({
        types: ['screen'], thumbnailSize: { width: 1, height: 1 }, fetchWindowIcons: false,
      })
      const src = sources.find((x) => String(x.display_id) === String(disp.id)) || sources[0]
      // 音は「パソコンで鳴っている音」を取り込む（loopback）。頼まれたときだけ付ける
      callback(src ? { video: src, audio: request.audioRequested ? 'loopback' : undefined } : {})
    } catch (_) {
      callback({})
    }
  }, { useSystemPicker: false })
  buildTray()
  pruneLibrary()

  const failed = applyHotkeys()
  if (failed.length) {
    const list = failed.map((f) => '・' + f.label + '： ' + f.accel).join('\n')
    dialog.showMessageBox({
      type: 'warning',
      title: 'ScreenShooter',
      message: 'ショートカットキーを登録できませんでした',
      detail: list + '\n\n他のアプリ（ScreenPresso など）が同じキーを使っている可能性があります。'
        + '\nタスクトレイのアイコンを右クリック →「設定…」で別のキーに変えられます。',
    })
  }

  if (settings.libraryPinned) showLibrary(false)

  if (migration && migration.errors.length) {
    showError('「' + OLD_NAME + '」からの引っ越しで、一部を移せませんでした',
      migration.errors.slice(0, 10).join('\n')
      + '\n\n移せなかった絵は元のフォルダ（ピクチャ\\' + OLD_NAME + '）に残っていて、履歴からはそのまま開けます。')
  }
}

// 名前を「スクショ」から変えたので、旧い userData と保存先から引っ越す（済んでいれば何もしない）。
// userData を使うもの（requestSingleInstanceLock も）より前に済ませる。
// --user-data-dir を付けた試運転では、本物を写さないよう動かさない
let migration = null
if (path.resolve(app.getPath('userData')).toLowerCase()
  === path.resolve(app.getPath('appData'), app.getName()).toLowerCase()) {
  migration = migrateFromOldName({
    appData: app.getPath('appData'),
    userData: app.getPath('userData'),
    pictures: app.getPath('pictures'),
    newName: app.getName(),
  })
  if (migration.errors.length) console.error('引っ越しの失敗:', migration.errors)
}

// トレイ常駐アプリなので二重起動させない。
// 2つ目を起動した（＝ショートカットをもう一度押した）ときは、そのまま撮影を始める。
// ただし画像のパスが付いていたら（右クリックの「送る」から来たとき）、その絵を開く。
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', (e, argv, cwd) => {
    if (openImageFiles(imagePathsFrom(argv, cwd))) return
    startRegionCapture()
  })
  app.whenReady().then(() => {
    init()
    // アプリが止まっている状態で「送る」を使うと、こちらに届く
    openImageFiles(imagePathsFrom(process.argv))
  })
}

// 編集ウィンドウを全部閉じてもアプリは終了しない（トレイに常駐し続ける）
app.on('window-all-closed', () => {})

app.on('will-quit', () => { globalShortcut.unregisterAll() })
