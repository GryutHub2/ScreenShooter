// 吹き出し（U）：クリックして文字を打つ → Ctrl+Enter で確定 → しっぽの先の四角をドラッグして、指す所を決める
// 架空の設定画面（pages.js の settings）を編集画面で開き、絵のまわりだけを録る
const H = require('../harness')

const CAPS = {
  1: 'U キー（吹き出し）で、書きたい所をクリック',
  2: '文字を打って、Ctrl+Enter で確定',
  3: 'しっぽの先の四角をドラッグして、指す所を決める',
}

// 絵（600×380）の中の場所。settings.png で測った
const PLACE = { x: 190, y: 136 }   // 2段目の白い所（文字の左上）
const TIP = { x: 488, y: 94 }      // 「保存先を選ぶ」ボタンの下寄り
const TEXT = 'ここを押して選ぶ'

H.main('bubble', async (ctx) => {
  const E = await H.openInEditor(ctx, 'settings', 720)
  const top = Math.round(E.img.y - 80)
  const R = { x: Math.round(E.img.x - 40), y: top, width: Math.round(E.img.w + 80), height: Math.round(E.img.h + 80 + 24) }
  await H.makeCaption({ x: R.x + 20, y: top + 6, width: R.width - 40, height: 64 }, CAPS)
  await H.makeCursor()
  const rest = E.at(300, 345)
  const tb = await E.el('#titlebar')
  E.ed.focus()
  await H.run([H.mv(H.phys(tb.x + 300, tb.y + tb.height / 2), 300), 'click', 'wait 300', H.mv(rest, 300), 'wait 300'])

  // 本物のキーでは日本語が打てないので、1文字ずつ入れて打っているように見せる（input を流して枠を描き直させる）
  const type = (text) => E.ed.webContents.executeJavaScript(`(async () => {
    for (const ch of ${JSON.stringify(text)}) {
      textEdit.value += ch
      textEdit.selectionStart = textEdit.selectionEnd = textEdit.value.length
      textEdit.dispatchEvent(new Event('input'))
      await new Promise((r) => setTimeout(r, 140))
    }
    return true })()`)
  const tail = () => E.ed.webContents.executeJavaScript(
    'JSON.stringify((() => { const s = state.shapes.find((x) => x.bubble); return s ? { x: s.tx, y: s.ty } : null })())')

  await H.clip(ctx, 'bubble', R, async () => {
    await H.run(['wait 300', H.cap(1), 'wait 500', 'key u', 'wait 300', H.mv(E.at(PLACE.x, PLACE.y), 900), 'wait 250', 'click', 'wait 600', H.cap(2), 'wait 300'])
    await type(TEXT)
    await H.run(['wait 500', 'ctrl down', 'wait 100', 'key enter', 'wait 100', 'ctrl up', 'wait 900'])
    const t = JSON.parse(await tail())
    H.log('tail', t)
    if (!t) throw new Error('bubble was not placed')
    await H.run([H.cap(3), 'wait 400', H.mv(E.at(t.x, t.y), 900), 'wait 300', 'ldown', 'wait 150', H.mv(E.at(TIP.x, TIP.y), 1100), 'wait 200', 'lup',
      'wait 300', H.mv(rest, 700), 'wait 2200', 'echo CAPOFF', 'wait 300'])
  })
  const shapes = await E.ed.webContents.executeJavaScript('JSON.stringify(state.shapes.map((s) => [s.type, !!s.bubble, s.text, Math.round(s.tx), Math.round(s.ty)]))')
  H.log('after', shapes)
  E.ed.setAlwaysOnTop(false)
})
