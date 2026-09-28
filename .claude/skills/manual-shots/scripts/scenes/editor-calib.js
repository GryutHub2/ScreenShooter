// 位置合わせ用：--page=<架空の画面の名前> を編集画面で開き、窓全体の静止画（out/calib.png）と
// 主な部品の四角（DIP）を log.txt に残すだけ。台本の座標を決めるときに使う
const path = require('path')
const H = require('../harness')

H.main('editor-calib', async (ctx) => {
  const page = ctx.arg('page', 'settings')
  const E = await H.openInEditor(ctx, page, Number(ctx.arg('height', '720')))
  for (const sel of ['#btnAutoBlur', '#statusbar', '#favs', '#toolbar', '#privNotice']) H.log(sel, await E.el(sel))
  H.log('img', E.img, 'origin(phys)', E.at(0, 0))
  await H.grab(E.ed.getContentBounds(), path.join(ctx.OUT, "calib.png"))
})
