'use strict'

// 名前を「スクショ」から変えたときの引っ越し。
// productName が変わると userData（%APPDATA%\<名前>）も変わり、設定と履歴が消えたように見えるため、
// 旧フォルダから写す。保存先の既定（ピクチャ\<名前>）も新しい名前へ移す。
// Electron に依存しないので、偽のフォルダを渡してそのままテストできる。

const fs = require('fs')
const path = require('path')
const { ID_RE } = require('./store')

const OLD_NAME = 'スクショ'
const MARK_KEY = 'renamedFrom'   // settings.json に残す「保存先の引っ越しは済んだ」の印

// 履歴の meta.json で、保存先の絵・動画の絶対パスを持つ項目
const PATH_KEYS = ['file', 'editedPath', 'videoFile', 'gifFile', 'savedPath', 'source']

// 保存先から動かさないもの（フォルダの表示名などを持つ、Windows のファイル）
const SKIP_NAMES = ['desktop.ini', 'thumbs.db']

function exists(p) { try { fs.accessSync(p); return true } catch (_) { return false } }

function samePath(a, b) {
  if (!a || !b) return false
  return path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase()
}

// dir の中なら dir からの相対パス、外なら null
function inside(p, dir) {
  if (typeof p !== 'string' || !p) return null
  const rel = path.relative(dir, p)
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null
  return rel
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')) } catch (_) { return null }
}

// BOM 無しで書く（BOM が付くと JSON.parse が失敗して既定値に戻るため）。
// 書きかけで落ちても壊れた JSON を残さないよう、隣に書いてから置き換える
function writeJson(file, obj) {
  const tmp = file + '.writing'
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), 'utf8')
  fs.renameSync(tmp, file)
}

// 旧 userData から設定・履歴・スクロール撮影の記録を写す。旧フォルダには書き込まない（控えとして残す）。
// 新しい側は Chromium が起動直後に作るので「フォルダがあるか」では判定できない。
// settings.json があれば済んでいるとみなす。settings.json を最後に写すのは、途中で落ちても次の起動で続きからやり直すため
function copyUserData(oldDir, newDir, out) {
  if (samePath(oldDir, newDir) || !exists(oldDir)) return
  const newSettings = path.join(newDir, 'settings.json')
  const newLibrary = path.join(newDir, 'library')
  if (exists(newSettings)) return

  fs.mkdirSync(newDir, { recursive: true })
  const oldLibrary = path.join(oldDir, 'library')
  if (exists(oldLibrary) && !exists(newLibrary)) {
    const tmp = newLibrary + '.copying'
    fs.cpSync(oldLibrary, tmp, { recursive: true, force: true })
    fs.renameSync(tmp, newLibrary)
  }
  for (const name of ['scroll-log.txt', 'scroll-debug']) {
    const src = path.join(oldDir, name)
    const dst = path.join(newDir, name)
    if (!exists(src) || exists(dst)) continue
    try { fs.cpSync(src, dst, { recursive: true }) } catch (err) {
      out.errors.push(name + ': ' + err.message)   // 記録だけなので、写せなくても先へ進む
    }
  }
  const oldSettings = path.join(oldDir, 'settings.json')
  if (exists(oldSettings)) {
    fs.copyFileSync(oldSettings, newSettings + '.copying')
    fs.renameSync(newSettings + '.copying', newSettings)
  }
  out.copied = true
}

// 履歴が指す絵のパスを、移した先に付け替える。
// 旧の場所に無く新しい場所にあるものだけ直す（動かせず残した絵は旧パスのまま開ける）
function rewriteMetas(libraryDir, oldPics, newPics, out) {
  let names = []
  try { names = fs.readdirSync(libraryDir) } catch (_) { return }
  for (const id of names) {
    if (!ID_RE.test(id)) continue
    const file = path.join(libraryDir, id, 'meta.json')
    const meta = readJson(file)
    if (!meta) continue
    let changed = false
    for (const key of PATH_KEYS) {
      const rel = inside(meta[key], oldPics)
      if (rel === null) continue
      const moved = path.join(newPics, rel)
      if (exists(meta[key]) || !exists(moved)) continue
      meta[key] = moved
      changed = true
    }
    if (!changed) continue
    try { writeJson(file, meta); out.rewritten++ } catch (err) { out.errors.push(id + ': ' + err.message) }
  }
}

// 保存先が旧の既定（ピクチャ\スクショ）のままなら、中身を新しい既定へ移して設定を直す。
// ユーザーが別の場所を選んでいたら触らない。どちらの場合も印を付け、2回目からは何もしない
// （印が無いと、あとでユーザーが旧フォルダを保存先に選び直したときに、また動かしてしまう）。
// 絵を移す → 履歴を直す → 設定を書く、の順。途中で落ちても次の起動で続きからやり直せる
function movePictures(userData, pictures, newName, out) {
  const settingsFile = path.join(userData, 'settings.json')
  const raw = readJson(settingsFile)
  if (!raw || raw[MARK_KEY]) return

  const oldPics = path.join(pictures, OLD_NAME)
  const newPics = path.join(pictures, newName)
  const usesOldDefault = !raw.saveDir || samePath(raw.saveDir, oldPics)
  if (usesOldDefault) {
    fs.mkdirSync(newPics, { recursive: true })
    let names = []
    try { names = fs.readdirSync(oldPics) } catch (_) {}
    for (const name of names) {
      if (SKIP_NAMES.includes(name.toLowerCase())) continue
      const dst = path.join(newPics, name)
      if (exists(dst)) { out.kept++; continue }    // 同じ名前を潰さない。元の場所に残す
      try { fs.renameSync(path.join(oldPics, name), dst); out.moved++ } catch (err) {
        out.kept++                                 // 開いていて動かせないものは元の場所に残す
        out.errors.push(name + ': ' + err.message)
      }
    }
    rewriteMetas(path.join(userData, 'library'), oldPics, newPics, out)
    raw.saveDir = newPics
  }
  raw[MARK_KEY] = OLD_NAME
  writeJson(settingsFile, raw)
  out.picturesDone = true
}

// opts: { appData, userData, pictures, newName }。
// userData は既定の場所（appData\newName）のときだけ渡すこと。--user-data-dir の試運転で本物を写さないため
function migrateFromOldName(opts) {
  const out = { copied: false, picturesDone: false, moved: 0, kept: 0, rewritten: 0, errors: [] }
  try {
    copyUserData(path.join(opts.appData, OLD_NAME), opts.userData, out)
    movePictures(opts.userData, opts.pictures, opts.newName, out)
  } catch (err) {
    out.errors.push(err.message)
  }
  return out
}

module.exports = { migrateFromOldName, OLD_NAME, MARK_KEY }
