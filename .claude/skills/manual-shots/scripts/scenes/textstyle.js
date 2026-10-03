// 編集画面の「かっこ」（K）と「書式」。--only=brace か --only=format で1本ずつ撮る（開く架空の画面が違うため）。
// brace：支出の表（ledger）の行の右に、上から下へ中かっこを引く
// format：設定画面（settings）に文字を置き、「書式」ボタンから斜体・下線を付ける
const H = require('../harness')

const CAPS = {
  1: 'K キー（かっこ）で、行の横を上から下へ引く',
  2: '左上から右下へ引くと、とがった所が右を向く',
  3: 'T キーで文字を置いて、Ctrl+Enter で確定',
  4: '「書式」ボタンで、書体・太字・斜体・下線・寄せを選ぶ',
}

// ledger.png（520×530）の 9/01〜9/05 の行の右端（金額の右）
const BRACE = { x1: 499, y1: 90, x2: 516, y2: 183 }
// settings.png（600×380）のログの下の空き
const TEXT_AT = { x: 36, y: 312 }
const TEXT = '保存先を選び直してください'

async function focusEditor(E) {
  const tb = await E.el('#titlebar')
  E.ed.focus()
  await H.run([H.mv(H.phys(tb.x + 300, tb.y + tb.height / 2), 300), 'click', 'wait 300'])
}

H.main('textstyle', async (ctx) => {
  const only = ctx.arg('only', '')
  if (only === 'brace') {
    const E = await H.openInEditor(ctx, 'ledger', 880)
    const top = Math.round(E.img.y - 80)
    const R = { x: Math.round(E.img.x - 40), y: top, width: Math.round(E.img.w + 80), height: Math.round(E.img.h + 80 + 24) }
    await H.makeCaption({ x: R.x + 20, y: top + 6, width: R.width - 40, height: 64 }, CAPS)
    await H.makeCursor()
    await focusEditor(E)
    const rest = E.at(300, 470)
    await H.run([H.mv(rest, 300), 'wait 300'])
    await H.clip(ctx, 'brace', R, [
      'wait 300', H.cap(1), 'wait 500', 'key k', 'wait 300',
      H.mv(E.at(BRACE.x1, BRACE.y1), 900), 'wait 250', 'ldown', 'wait 100', H.mv(E.at(BRACE.x2, BRACE.y2), 1200), 'wait 300', 'lup',
      // 選んだままだと、つまみの四角が重なってかっこの形が見えないので、選ぶ道具で何もない所を押して外す
      'wait 400', H.cap(2), 'key v', 'wait 200', H.mv(rest, 700), 'wait 200', 'click', 'wait 2800', 'echo CAPOFF', 'wait 300',
    ])
    H.log('shapes', await E.ed.webContents.executeJavaScript('JSON.stringify(state.shapes.map((s) => [s.type, s.x1, s.y1, s.x2, s.y2]))'))
    E.ed.setAlwaysOnTop(false)
    return
  }
  if (only === 'format') {
    const E = await H.openInEditor(ctx, 'settings', 820)
    const top = Math.round(E.img.y - 80)
    // 書式のパネルはツールバーの下に出るので、上はツールバーまで録る
    const tb = await E.el('#toolbar')
    const R = { x: Math.round(E.img.x - 40), y: Math.round(tb.y), width: Math.round(E.img.w + 80), height: Math.round(E.img.y + E.img.h + 84 - tb.y) }
    await H.makeCaption({ x: R.x + 20, y: Math.round(E.img.y + E.img.h + 12), width: R.width - 40, height: 64 }, CAPS)
    await H.makeCursor()
    await focusEditor(E)
    const rest = E.at(420, 200)
    await H.run([H.mv(rest, 300), 'wait 300'])
    const center = async (sel) => { const r = await E.el(sel); return H.phys(r.x + r.width / 2, r.y + r.height / 2) }
    await H.clip(ctx, 'format', R, async () => {
      await H.run(['wait 300', H.cap(3), 'wait 500', 'key t', 'wait 300', H.mv(E.at(TEXT_AT.x, TEXT_AT.y), 900), 'wait 250', 'click', 'wait 500'])
      await H.typeInto(E.ed, '#textEdit', TEXT)
      await H.run(['wait 400', 'ctrl down', 'wait 100', 'key enter', 'wait 100', 'ctrl up', 'wait 700'])
      await H.run([H.cap(4), 'wait 300', H.mv(await center('#btnFormat'), 1000), 'wait 300', 'click', 'wait 700'])
      await H.run([H.mv(await center('#fmtI'), 600), 'wait 300', 'click', 'wait 800',
        H.mv(await center('#fmtU'), 500), 'wait 300', 'click', 'wait 800',
        H.mv(await center('#fmtB'), 500), 'wait 300', 'click', 'wait 1000',
        H.mv(rest, 700), 'wait 2200', 'echo CAPOFF', 'wait 300'])
    })
    H.log('shapes', await E.ed.webContents.executeJavaScript('JSON.stringify(state.shapes.map((s) => [s.type, s.text, s.bold, s.italic, s.underline]))'))
    E.ed.setAlwaysOnTop(false)
    return
  }
  throw new Error('--only=brace か --only=format')
})
