'use strict'

// このパソコンの Claude（Claude Code の claude.exe）を呼んで、文字を翻訳する。
// API キーは使わない（ログイン済みの claude.exe を呼ぶだけ）。送るのは文字だけで、絵は送らない。
// 呼び方は All-In-Dashboard の家計簿アプリ（tools/ai-explain.mjs）と同じ決まりにそろえている
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawn } = require('child_process')

const MODEL = 'haiku'
const TIMEOUT_MS = 120000

// ストア版の Claude は claude.exe を %LOCALAPPDATA%\Packages\Claude_*\LocalCache\Roaming\Claude\claude-code\<版>（またはその1段下）に置く。
// アプリの中からは %APPDATA%\Claude\claude-code に見えることもあるので両方を探し、最後に PATH も見る（会社のパソコンなど）
function claudeBases() {
  const bases = [path.join(process.env.APPDATA || '', 'Claude', 'claude-code')]
  const pk = path.join(process.env.LOCALAPPDATA || '', 'Packages')
  try {
    for (const d of fs.readdirSync(pk)) if (/^Claude_/.test(d)) bases.push(path.join(pk, d, 'LocalCache', 'Roaming', 'Claude', 'claude-code'))
  } catch (_) { /* ストア版でない */ }
  return bases
}

function findClaude() {
  const num = (v) => v.split('.').map(Number)
  const found = []
  for (const base of claudeBases()) {
    let vers = []
    try { vers = fs.readdirSync(base).filter((v) => /^\d+(\.\d+)*$/.test(v)) } catch (_) { continue }
    for (const v of vers) {
      const dirs = [path.join(base, v)]
      try { for (const d of fs.readdirSync(dirs[0], { withFileTypes: true })) if (d.isDirectory()) dirs.push(path.join(dirs[0], d.name)) } catch (_) {}
      const exe = dirs.map((d) => path.join(d, 'claude.exe')).find((p) => fs.existsSync(p))
      if (exe) found.push({ v, exe })
    }
  }
  found.sort((x, y) => { const a = num(x.v), b = num(y.v); for (let i = 0; i < 4; i++) if ((a[i] || 0) !== (b[i] || 0)) return (b[i] || 0) - (a[i] || 0); return 0 })
  if (found.length) return found[0].exe
  for (const dir of String(process.env.PATH || '').split(path.delimiter)) {
    const p = path.join(dir, 'claude.exe')
    if (dir && fs.existsSync(p)) return p
  }
  return null
}

// 親（Claude Code の中から動かしたとき）のセッションの情報を子に渡さない。本人が用意した設定だけ残す
const KEEP_ENV = new Set(['CLAUDE_CONFIG_DIR', 'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CODE_GIT_BASH_PATH'])
function childEnv() {
  const env = { ...process.env }
  for (const k of Object.keys(env)) {
    if ((k.startsWith('CLAUDE') && !KEEP_ENV.has(k)) || k === 'ANTHROPIC_BASE_URL') delete env[k]
  }
  return env
}

const SYSTEM = 'あなたは翻訳係です。渡された文章を指定の言語に訳し、訳文だけを出力します。説明・前置き・引用符は付けません。'
  + '改行の位置はできるだけ元の文章に合わせます。画面から読み取った文字なので、読み間違いらしい所は文脈に合わせて自然に直して構いません。'

// --no-session-persistence：この依頼を会話履歴に残さない / --safe-mode：CLAUDE.md・フック・スキルを読ませない /
// --tools ""：ファイルやコマンドに一切触らせない。文章は標準入力で渡す（長さと文字化けの心配がないため）
function translate(text, to) {
  return new Promise((resolve) => {
    const exe = findClaude()
    if (!exe) { resolve({ ok: false, error: 'このパソコンに Claude（Claude Code）が見つかりませんでした' }); return }
    const args = [
      '-p', '次の文章を' + (to || '日本語') + 'に翻訳してください。訳文だけを出力してください。',
      '--no-session-persistence', '--safe-mode', '--tools', '',
      '--model', MODEL, '--output-format', 'text', '--system-prompt', SYSTEM,
    ]
    let ch
    try {
      ch = spawn(exe, args, { cwd: os.tmpdir(), env: childEnv(), windowsHide: true })
    } catch (err) {
      resolve({ ok: false, error: String(err) })
      return
    }
    let so = ''
    let se = ''
    const timer = setTimeout(() => { try { ch.kill() } catch (_) {} resolve({ ok: false, error: '時間切れ（' + TIMEOUT_MS / 1000 + '秒）' }) }, TIMEOUT_MS)
    ch.stdout.setEncoding('utf8')
    ch.stderr.setEncoding('utf8')
    ch.stdout.on('data', (d) => { so += d })
    ch.stderr.on('data', (d) => { se += d })
    ch.on('error', (err) => { clearTimeout(timer); resolve({ ok: false, error: String(err) }) })
    ch.on('close', (code) => {
      clearTimeout(timer)
      const out = so.trim()
      if (code === 0 && out) { resolve({ ok: true, text: out, model: MODEL }); return }
      const msg = (se || so || '').trim()
      resolve({ ok: false, error: /log ?in|auth/i.test(msg) ? 'Claude のログインが必要です（README の「翻訳」を参照）' : (msg.slice(0, 200) || '応答がありませんでした') })
    })
    ch.stdin.end(String(text || ''), 'utf8')
  })
}

module.exports = { translate, findClaude }
