// 個人情報の続き：設定の「自動でぼかす言葉」に名前（空白なし）と正規表現（/A-\d{8}/）を登録 →「自動ぼかし」で名前も会員番号もぼける
// 架空の会員情報（pages.js の account）を編集画面で開き、その右に設定画面を低く縮めて重ね、両方を録る。
// 設定画面は「自動でぼかす言葉」の節まで送っておく（上の節には保存先のパスが出るので写さない）
const H = require('../harness')

const CAPS = {
  1: '設定の「自動でぼかす言葉」に、1行に1つ書く',
  2: '名前は、空白の有無を気にせず書いてよい',
  3: '決まった形の番号は / で囲む（A- と数字8桁）',
  4: '「保存する」を押す',
  5: '「自動ぼかし」で、名前も会員番号もぼける',
}
const SW = 680
const SH = 540

H.main('words', async (ctx) => {
  const { A } = ctx
  const E = await H.openInEditor(ctx, 'account', 720)
  const btn = await E.el('#btnAutoBlur')
  const bar = await E.el('#statusbar')
  // 常に出している履歴パネルが、右の空いた所に写り込むので隠す
  const lib = A.libraryWin
  if (lib && !lib.isDestroyed()) lib.hide()

  // 設定画面を先に開いておき、録り始めてから出す
  A.openSettings()
  const sw = await H.waitFor(() => { const w = A.settingsWin; return w && !w.isDestroyed() && w.isVisible() ? w : null }, 15000)
  if (!sw) throw new Error('settings did not open')
  const S = { x: Math.round(E.img.x + E.img.w + 30), y: Math.round(E.img.y - 40), width: SW, height: SH }
  // 設定画面は大きさを変えられない窓なので、いったん許してから縮める
  sw.setResizable(true)
  sw.setBounds(S)
  await H.sleep(300)
  H.log('settings', sw.getBounds())
  await sw.webContents.executeJavaScript(`(() => {
    const el = document.getElementById('autoBlurWords')
    el.value = ''
    el.dispatchEvent(new Event('input'))
    el.closest('section').scrollIntoView({ block: 'start' })
    return true })()`)
  sw.hide()

  const top = Math.round(E.img.y - 120)
  const R = { x: Math.round(E.img.x - 60), y: top, width: Math.round(S.x + SW + 20 - (E.img.x - 60)), height: Math.round(bar.y + bar.height - top) }
  await H.makeBackdrop(R)
  E.ed.moveTop()
  await H.makeCaption({ x: R.x + 20, y: top + 6, width: R.width - 40, height: 64 }, CAPS)
  await H.makeCursor()
  const rest = E.at(300, 330)
  await H.run([H.mv(rest, 200)])

  // 本物のキーでは日本語と記号が打てないので、1文字ずつ入れて打っているように見せる（input を流して設定画面に取り込ませる）
  const type = (text) => sw.webContents.executeJavaScript(`(async () => {
    const el = document.getElementById('autoBlurWords')
    for (const ch of ${JSON.stringify(text)}) {
      el.value += ch
      el.selectionStart = el.selectionEnd = el.value.length
      el.dispatchEvent(new Event('input'))
      await new Promise((r) => setTimeout(r, 140))
    }
    return true })()`)

  await H.clip(ctx, 'words', R, async () => {
    await H.run(['wait 300', H.cap(1), 'wait 600'])
    // 編集画面（最前面）より上の段に置く。同じ段だと、押したときに編集画面が前に来ることがある
    sw.setAlwaysOnTop(true, 'pop-up-menu')
    sw.showInactive()
    sw.moveTop()
    await H.sleep(900)
    const b = sw.getContentBounds()
    const ta = await sw.webContents.executeJavaScript('(() => { const r = document.getElementById("autoBlurWords").getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height } })()')
    await H.run([H.mv(H.phys(b.x + ta.x + 40, b.y + ta.y + 16), 900), 'wait 250', 'click', 'wait 500', H.cap(2), 'wait 300'])
    await type('山田花子')
    await H.run(['wait 900', H.cap(3), 'wait 300'])
    await type('\n/A-\\d{8}/')
    await H.run(['wait 1400'])
    const save = await sw.webContents.executeJavaScript('(() => { const r = document.getElementById("btnSave").getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })()')
    const close = await sw.webContents.executeJavaScript('(() => { const r = document.getElementById("btnClose").getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })()')
    await H.run([H.cap(4), 'wait 300', H.mv(H.phys(b.x + save.x, b.y + save.y), 900), 'wait 300', 'click', 'wait 1300',
      H.mv(H.phys(b.x + close.x, b.y + close.y), 700), 'wait 300', 'click', 'wait 900'])
    await H.run([H.cap(5), 'wait 300', H.mv(H.phys(btn.x + btn.width / 2, btn.y + btn.height / 2), 1000), 'wait 250', 'click', 'wait 1200',
      H.mv(rest, 700), 'wait 3000', 'echo CAPOFF', 'wait 300'])
  })
  const shapes = await E.ed.webContents.executeJavaScript('JSON.stringify(state.shapes.map(s => [s.type, Math.round(s.x1), Math.round(s.y1), Math.round(s.x2), Math.round(s.y2)]))')
  H.log('after autoblur', shapes)
  E.ed.setAlwaysOnTop(false)
})
