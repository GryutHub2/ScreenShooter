// 個人情報の続き：設定に登録 →「自動ぼかし」で、自動では見つからない紹介コードもぼける。
// --kind=regex は「自動でぼかす言葉」に正規表現（words.gif）、--kind=label は「見出しとして探す言葉」に「紹介コード」（labels.gif）。
// 架空の会員情報（pages.js の account）を編集画面で開き、その右に設定画面を低く縮めて重ね、両方を録る。
// 設定画面は書く欄が真ん中に来るまで送っておく（上の節には保存先のパスが出るので写さない）
const H = require('../harness')

const KINDS = {
  regex: {
    id: 'autoBlurWords', gif: 'words', text: '/KX-\\d{4}-\\d{2}/',
    caps: {
      1: '設定の「自動でぼかす言葉」を開く',
      2: '形が決まった番号は / で囲む（正規表現）',
      3: 'KX- と数字4桁、- と数字2桁、という形',
      4: '「保存する」を押す',
      5: '「自動ぼかし」で、紹介コードもぼける',
    },
  },
  label: {
    id: 'autoBlurLabels', gif: 'labels', text: '紹介コード',
    caps: {
      1: '設定の「見出しとして探す言葉」を開く',
      2: '画面の項目名を、1行に1つ書く',
      3: 'この言葉の右（または下）の値がぼける',
      4: '「保存する」を押す',
      5: '「自動ぼかし」で、紹介コードもぼける',
    },
  },
}
const SW = 680
const SH = 540

H.main('words', async (ctx) => {
  const { A } = ctx
  const K = KINDS[ctx.arg('kind', 'regex')]
  if (!K) throw new Error('--kind は regex か label')
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
  const ID = JSON.stringify(K.id)
  await sw.webContents.executeJavaScript(`(() => {
    const el = document.getElementById(${ID})
    el.value = ''
    el.dispatchEvent(new Event('input'))
    el.scrollIntoView({ block: 'center' })
    return true })()`)
  sw.hide()

  const top = Math.round(E.img.y - 120)
  const R = { x: Math.round(E.img.x - 60), y: top, width: Math.round(S.x + SW + 20 - (E.img.x - 60)), height: Math.round(bar.y + bar.height - top) }
  await H.makeBackdrop(R)
  E.ed.moveTop()
  await H.makeCaption({ x: R.x + 20, y: top + 6, width: R.width - 40, height: 64 }, K.caps)
  await H.makeCursor()
  const rest = E.at(300, 360)
  await H.run([H.mv(rest, 200)])

  // 本物のキーでは日本語と記号が打てないので、1文字ずつ入れて打っているように見せる（input を流して設定画面に取り込ませる）
  const type = (text) => sw.webContents.executeJavaScript(`(async () => {
    const el = document.getElementById(${ID})
    for (const ch of ${JSON.stringify(text)}) {
      el.value += ch
      el.selectionStart = el.selectionEnd = el.value.length
      el.dispatchEvent(new Event('input'))
      await new Promise((r) => setTimeout(r, 140))
    }
    return true })()`)
  const center = (sel) => sw.webContents.executeJavaScript(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, left: r.x, top: r.y } })()`)

  await H.clip(ctx, K.gif, R, async () => {
    await H.run(['wait 300', H.cap(1), 'wait 600'])
    // 編集画面（最前面）より上の段に置く。同じ段だと、押したときに編集画面が前に来ることがある
    sw.setAlwaysOnTop(true, 'pop-up-menu')
    sw.showInactive()
    sw.moveTop()
    await H.sleep(900)
    const b = sw.getContentBounds()
    const ta = await center('#' + K.id)
    await H.run([H.mv(H.phys(b.x + ta.left + 40, b.y + ta.top + 16), 900), 'wait 250', 'click', 'wait 500', H.cap(2), 'wait 300'])
    await type(K.text)
    await H.run(['wait 700', H.cap(3), 'wait 2200'])
    const save = await center('#btnSave')
    const close = await center('#btnClose')
    await H.run([H.cap(4), 'wait 300', H.mv(H.phys(b.x + save.x, b.y + save.y), 900), 'wait 300', 'click', 'wait 1300',
      H.mv(H.phys(b.x + close.x, b.y + close.y), 700), 'wait 300', 'click', 'wait 900'])
    await H.run([H.cap(5), 'wait 300', H.mv(H.phys(btn.x + btn.width / 2, btn.y + btn.height / 2), 1000), 'wait 250', 'click', 'wait 1200',
      H.mv(rest, 700), 'wait 3000', 'echo CAPOFF', 'wait 300'])
  })
  const shapes = await E.ed.webContents.executeJavaScript('JSON.stringify(state.shapes.map(s => [s.type, Math.round(s.x1), Math.round(s.y1), Math.round(s.x2), Math.round(s.y2)]))')
  H.log('after autoblur', shapes)
  E.ed.setAlwaysOnTop(false)
})
