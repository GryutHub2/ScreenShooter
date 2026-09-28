// 目立たせる道具：スポットライト（S）／拡大鏡（Z）／蛍光ペン（M、Shift で真横）
// 架空の設定画面（pages.js の settings）を編集画面で開き、絵のまわりだけを録る。
// 1本撮るごとに Ctrl+Z で描いたものを消して、次の回に持ち越さない。--only=spot,zoom,marker で回を選べる
const H = require('../harness')

const CAPS = {
  1: 'S キー（スポット）で、見てほしい所を囲む',
  2: 'まわりが暗くなる',
  3: 'Z キー（拡大鏡）で、小さい字を囲む',
  4: '丸く拡大されて、横に出る',
  5: 'M キー（蛍光ペン）で、Shift を押しながらなぞる',
  6: '横にまっすぐ引ける',
}

// 絵（600×380）の中の場所。calib の静止画で測った
const BUTTON = { x1: 434, y1: 56, x2: 578, y2: 108 }   // 「保存先を選ぶ」
const VERSION = { x1: 450, y1: 352, x2: 588, y2: 377 } // 右下の小さい版の番号
const ERROR = { x1: 24, x2: 348, y: 255 }              // ログの ERROR の行

H.main('highlight', async (ctx) => {
  const only = ctx.arg('only', '')
  const want = (n) => !only || only.split(',').includes(n)
  const E = await H.openInEditor(ctx, 'settings', 720)
  const top = Math.round(E.img.y - 80)
  const R = { x: Math.round(E.img.x - 40), y: top, width: Math.round(E.img.w + 80), height: Math.round(E.img.h + 80 + 24) }
  await H.makeCaption({ x: R.x + 20, y: top + 6, width: R.width - 40, height: 64 }, CAPS)
  await H.makeCursor()
  const rest = E.at(300, 330)
  // Esc は使わない（何も選んでいないときに押すと編集画面が閉じる）
  const undo = ['ctrl down', 'wait 100', 'key z', 'wait 100', 'ctrl up', 'wait 400']

  // キーを受け取れるよう、タイトルバーを押して編集画面を手前にする（絵の上を押すと描き始めてしまう）。
  // 録り終えるたびに録画の確認画面が手前に出てキーの行き先が変わるので、1本ごとにやり直す
  const tb = await E.el('#titlebar')
  const focus = async () => {
    E.ed.focus()
    await H.run([H.mv(H.phys(tb.x + 300, tb.y + tb.height / 2), 300), 'click', 'wait 300', H.mv(rest, 300), 'wait 300'])
  }
  await focus()

  const drag = (a, b, ms) => [H.mv(a, 800), 'wait 250', 'ldown', 'wait 100', H.mv(b, ms), 'wait 150', 'lup']

  if (want('spot')) {
    await H.clip(ctx, 'spot', R, [
      'wait 300', H.cap(1), 'wait 500', 'key s', 'wait 300',
      ...drag(E.at(BUTTON.x1, BUTTON.y1), E.at(BUTTON.x2, BUTTON.y2), 900),
      'wait 300', H.cap(2), H.mv(rest, 600), 'wait 2000', 'echo CAPOFF', 'wait 300',
    ])
    await focus()
    await H.run(undo)
  }
  if (want('zoom')) {
    await H.clip(ctx, 'zoom', R, [
      'wait 300', H.cap(3), 'wait 500', 'key z', 'wait 300',
      ...drag(E.at(VERSION.x1, VERSION.y1), E.at(VERSION.x2, VERSION.y2), 800),
      'wait 300', H.cap(4), H.mv(rest, 600), 'wait 2200', 'echo CAPOFF', 'wait 300',
    ])
    await focus()
    await H.run(undo)
  }
  if (want('marker')) {
    await H.clip(ctx, 'marker', R, [
      'wait 300', H.cap(5), 'wait 500', 'key m', 'wait 300',
      H.mv(E.at(ERROR.x1, ERROR.y), 800), 'wait 250', 'shift down', 'wait 150', 'ldown', 'wait 100',
      // 少し上下にぶれながら引いても、Shift を押していれば真横になる
      H.mv(E.at((ERROR.x1 + ERROR.x2) / 2, ERROR.y + 6), 600), H.mv(E.at(ERROR.x2, ERROR.y - 4), 600),
      'wait 150', 'lup', 'wait 100', 'shift up',
      'wait 300', H.cap(6), H.mv(rest, 600), 'wait 2000', 'echo CAPOFF', 'wait 300',
    ])
    await focus()
    await H.run(undo)
  }
  E.ed.setAlwaysOnTop(false)
})
