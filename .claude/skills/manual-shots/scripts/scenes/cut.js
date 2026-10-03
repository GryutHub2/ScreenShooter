// 省略（X）：要らない横の帯を上下にドラッグ → そこが抜けて、上下がギザギザでつながる
// 架空の支出の表（pages.js の ledger）を編集画面で開き、絵のまわりだけを録る。抜くと絵が短くなるので、録る範囲は元の大きさで取る
const H = require('../harness')

const CAPS = {
  1: 'X キー（省略）で、要らない行を上下にドラッグ',
  2: 'そこが抜けて、上下がギザギザでつながる',
}

// 絵（520×530）の中の場所。ledger.png で測った（9/08 の行の上 〜 9/24 の行の下）
const BAND = { x: 300, y1: 185, y2: 414 }

H.main('cut', async (ctx) => {
  const E = await H.openInEditor(ctx, 'ledger', 880)
  const top = Math.round(E.img.y - 80)
  const R = { x: Math.round(E.img.x - 40), y: top, width: Math.round(E.img.w + 80), height: Math.round(E.img.h + 80 + 24) }
  await H.makeCaption({ x: R.x + 20, y: top + 6, width: R.width - 40, height: 64 }, CAPS)
  await H.makeCursor()
  const tb = await E.el('#titlebar')
  E.ed.focus()
  await H.run([H.mv(H.phys(tb.x + 300, tb.y + tb.height / 2), 300), 'click', 'wait 300', H.mv(E.at(BAND.x, 120), 300), 'wait 300'])

  await H.clip(ctx, 'cut', R, [
    'wait 300', H.cap(1), 'wait 500', 'key x', 'wait 300',
    H.mv(E.at(BAND.x, BAND.y1), 800), 'wait 250', 'ldown', 'wait 100', H.mv(E.at(BAND.x, BAND.y2), 1200), 'wait 400', 'lup',
    'wait 500', H.cap(2), H.mv(E.at(BAND.x + 100, 542), 700), 'wait 2600', 'echo CAPOFF', 'wait 300',
  ])
  const cuts = await E.ed.webContents.executeJavaScript('JSON.stringify(state.cuts)')
  H.log('cuts', cuts)
  E.ed.setAlwaysOnTop(false)
})
