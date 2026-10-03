'use strict'

const textEl = document.getElementById('text')
const trBox = document.getElementById('trBox')
const trText = document.getElementById('trText')
const trStatus = document.getElementById('trStatus')
const trLang = document.getElementById('trLang')
const btnTranslate = document.getElementById('btnTranslate')
const btnCopyTr = document.getElementById('btnCopyTr')

function copyAndClose(text) {
  window.api.send('ocr:copy', String(text || ''))
}

window.api.on('ocr:init', (d) => {
  textEl.value = (d && d.text) || ''
  // 翻訳のボタンは、設定で Claude を使うことにしたときだけ出す
  btnTranslate.hidden = !(d && d.translate)
  if (d && d.empty) textEl.placeholder = '文字を読み取れませんでした（小さすぎる・薄い字は読めないことがあります）'
  textEl.focus()
})

document.getElementById('btnCopyAll').addEventListener('click', () => copyAndClose(textEl.value))
document.getElementById('btnCopySel').addEventListener('click', () => {
  const sel = textEl.value.slice(textEl.selectionStart, textEl.selectionEnd)
  copyAndClose(sel || textEl.value)
})
btnCopyTr.addEventListener('click', () => copyAndClose(trText.value))
document.getElementById('btnClose').addEventListener('click', () => window.api.send('app:closeWindow'))

btnTranslate.addEventListener('click', async () => {
  const text = textEl.value.trim()
  if (!text) return
  trBox.hidden = false
  trText.value = ''
  trStatus.textContent = 'Claude に問い合わせ中…（10〜30秒）'
  btnTranslate.disabled = true
  let r = null
  try { r = await window.api.invoke('ocr:translate', { text, to: trLang.value }) } catch (err) { r = { ok: false, error: String(err) } }
  btnTranslate.disabled = false
  if (r && r.ok) {
    trText.value = r.text
    trStatus.textContent = '翻訳しました（AI：' + (r.model || 'Claude') + '）'
    btnCopyTr.hidden = false
  } else {
    trStatus.textContent = '翻訳できませんでした：' + ((r && r.error) || '')
  }
})

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { e.preventDefault(); window.api.send('app:closeWindow') }
  else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); copyAndClose(textEl.value) }
})
