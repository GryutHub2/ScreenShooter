// 手順を①②③で説明する：N キーで番号を置く（Shift+クリックで縦にそろう）→ 右クリックで1つ消すと振り直し
// 架空の登録画面（pages.js の signup）を編集画面で開き、絵のまわりだけを録る
const H = require('../harness')

const CAPS = {
  1: 'N キー（番号）で、クリックした所に ① が付く',
  2: 'Shift を押しながらクリックすると、縦にそろう',
  3: 'いらない番号は右クリックで消す。番号は振り直される',
}

// 絵（600×380）の中の場所。signup.png で測った（左の余白に置く）
const MX = 46
const ROWS = [75, 137, 199, 261]

H.main('steps', async (ctx) => {
  const E = await H.openInEditor(ctx, 'signup', 720)
  const top = Math.round(E.img.y - 80)
  const R = { x: Math.round(E.img.x - 40), y: top, width: Math.round(E.img.w + 80), height: Math.round(E.img.h + 80 + 24) }
  await H.makeCaption({ x: R.x + 20, y: top + 6, width: R.width - 40, height: 64 }, CAPS)
  await H.makeCursor()
  const rest = E.at(430, 345)
  const tb = await E.el('#titlebar')
  E.ed.focus()
  await H.run([H.mv(H.phys(tb.x + 300, tb.y + tb.height / 2), 300), 'click', 'wait 300', H.mv(rest, 300), 'wait 300'])

  await H.clip(ctx, 'steps', R, [
    'wait 300', H.cap(1), 'wait 500', 'key n', 'wait 300',
    H.mv(E.at(MX, ROWS[0]), 800), 'wait 250', 'click', 'wait 700',
    H.cap(2),
    // わざと数px 横にずらしてクリックしても、Shift で ① の真下に吸い付く
    H.mv(E.at(MX + 4, ROWS[1]), 800), 'wait 200', 'shift down', 'wait 150', 'click', 'wait 100', 'shift up', 'wait 500',
    H.mv(E.at(MX - 3, ROWS[2]), 700), 'wait 200', 'shift down', 'wait 150', 'click', 'wait 100', 'shift up', 'wait 500',
    H.mv(E.at(MX + 3, ROWS[3]), 700), 'wait 200', 'shift down', 'wait 150', 'click', 'wait 100', 'shift up', 'wait 900',
    H.cap(3), 'wait 400', H.mv(E.at(MX, ROWS[2]), 800), 'wait 300', 'rclick', 'wait 600',
    H.mv(rest, 700), 'wait 2000', 'echo CAPOFF', 'wait 300',
  ])
  E.ed.setAlwaysOnTop(false)
})
