'use strict'

// 撮影履歴の置き場を扱う。1件 = 1フォルダ。
//
//   <root>/<id>/original.png … 書き込む前の元画像
//   <root>/<id>/flat.png     … 書き込み後の絵（書き込みがあるときだけ）
//   <root>/<id>/thumb.png    … 一覧用の小さい絵
//   <root>/<id>/meta.json    … 図形・切り抜き・保存先
//
// Electron に依存しないので、そのままテストできる。

const fs = require('fs')
const path = require('path')

// 「20260910-014233-a7f3」の形。この形の名前で meta.json を持つフォルダしか消さない。
const ID_RE = /^\d{8}-\d{6}-[0-9a-f]{4}$/

function createStore(root) {
  const entryDir = (id) => path.join(root, id)
  const filePath = (id, name) => path.join(root, id, name)

  function newId(date) {
    const d = date || new Date()
    const p = (n) => String(n).padStart(2, '0')
    return '' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate())
      + '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds())
      + '-' + Math.floor(Math.random() * 0x10000).toString(16).padStart(4, '0')
  }

  function read(id) {
    if (!ID_RE.test(String(id))) return null
    try {
      const meta = JSON.parse(fs.readFileSync(filePath(id, 'meta.json'), 'utf8'))
      meta.id = id
      return meta
    } catch (_) { return null }
  }

  function write(meta) {
    if (!meta || !ID_RE.test(String(meta.id))) return false
    try {
      fs.mkdirSync(entryDir(meta.id), { recursive: true })
      fs.writeFileSync(filePath(meta.id, 'meta.json'), JSON.stringify(meta, null, 2), 'utf8')
      return true
    } catch (_) { return false }
  }

  // 新しい順
  function list() {
    let names = []
    try { names = fs.readdirSync(root) } catch (_) { return [] }
    const out = []
    for (const n of names) {
      const meta = read(n)
      if (meta) out.push(meta)
    }
    out.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    return out
  }

  // 決まった形の名前で、meta.json を持つフォルダだけを消す。
  // 名前が違う・meta.json が無いものには触らない（別のフォルダを巻き添えにしないため）。
  function remove(id) {
    if (!ID_RE.test(String(id))) return false
    const dir = entryDir(id)
    if (!fs.existsSync(path.join(dir, 'meta.json'))) return false
    try { fs.rmSync(dir, { recursive: true, force: true }); return true } catch (_) { return false }
  }

  function prune(limit) {
    const n = Math.max(10, Number(limit) || 300)
    const removed = []
    for (const meta of list().slice(n)) {
      if (remove(meta.id)) removed.push(meta.id)
    }
    return removed
  }

  function ensure() {
    try { fs.mkdirSync(root, { recursive: true }); return true } catch (_) { return false }
  }

  return { root, ID_RE, entryDir, filePath, newId, read, write, list, remove, prune, ensure }
}

module.exports = { createStore, ID_RE }
