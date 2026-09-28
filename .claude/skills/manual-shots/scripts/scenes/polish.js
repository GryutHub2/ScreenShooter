// 資料に貼る前に整える：「サイズ」で 50% に（resize）→ 下の帯の「仕上げ」で背景つきを選んで「見る」（finish）
// ダイアログ・下の帯・仕上げの見え方は窓いっぱいに出るので、編集画面の窓ごと録る。
// 仕上げのプルダウンは窓の下へはみ出して開くので、その分だけ下まで録り、無地の窓で覆っておく。--only=resize,finish
const H = require('../harness')

const CAPS = {
  1: '下の帯の「サイズ」を押す',
  2: '「50%」を押して OK',
  3: '絵が半分の大きさに（Ctrl+Z で戻る）',
  4: '「仕上げ」で「背景つき」を選ぶ',
  5: '「見る」で、貼ったときの見え方を確認',
}
const DROP = 150   // プルダウンが下へはみ出す分（DIP）

H.main('polish', async (ctx) => {
  const only = ctx.arg('only', '')
  const want = (n) => !only || only.split(',').includes(n)
  const E = await H.openInEditor(ctx, '3-after', 600)
  const cb = E.cb
  const R = { x: cb.x, y: cb.y, width: cb.width, height: cb.height + DROP }
  await H.makeBackdrop({ x: R.x, y: cb.y + cb.height, width: R.width, height: DROP })
  E.ed.moveTop()
  // 字幕は窓の下の帯の右側に出す（絵・ダイアログ・仕上げの見え方に重ねない。左側はプルダウンが開く所）
  await H.makeCaption({ x: Math.round(cb.x + cb.width * 0.56), y: cb.y + cb.height + 14, width: Math.round(cb.width * 0.43), height: 64 }, CAPS)
  await H.makeCursor()
  const rest = E.at(260, 300)
  const mid = (r) => H.phys(r.x + r.width / 2, r.y + r.height / 2)
  const tb = await E.el('#titlebar')
  const focus = async () => {
    E.ed.focus()
    await H.run([H.mv(H.phys(tb.x + 300, tb.y + tb.height / 2), 300), 'click', 'wait 300', H.mv(rest, 300), 'wait 300'])
  }
  await focus()

  if (want('resize')) {
    const btn = await E.el('#btnResize')
    await H.clip(ctx, 'resize', R, async () => {
      await H.run(['wait 300', H.cap(1), 'wait 500', H.mv(mid(btn), 900), 'wait 300', 'click', 'wait 900'])
      const chip = await E.el('.rzChip[data-pct="50"]')
      const ok = await E.el('#rzOk')
      await H.run([H.cap(2), 'wait 400', H.mv(mid(chip), 800), 'wait 300', 'click', 'wait 800', H.mv(mid(ok), 700), 'wait 300', 'click', 'wait 900'])
      // ボタンの上に止めると説明の吹き出しが出て帯を隠すので、少し上で止める
      await H.run([H.cap(3), H.mv(H.phys(btn.x + btn.width / 2, btn.y - 60), 800), 'wait 2600', 'echo CAPOFF', 'wait 300'])
    })
    // 次の回は元の大きさから（サイズは undo で戻る）
    await focus()
    await H.run(['ctrl down', 'wait 100', 'key z', 'wait 100', 'ctrl up', 'wait 800'])
  }

  if (want('finish')) {
    const sel = await E.el('#finish')
    await H.clip(ctx, 'finish', R, async () => {
      await H.run(['wait 300', H.cap(4), 'wait 500', H.mv(mid(sel), 900), 'wait 300', 'click', 'wait 900',
        'key down', 'wait 400', 'key down', 'wait 400', 'key down', 'wait 600', 'key enter', 'wait 900'])
      const view = await E.el('#btnFinishView')
      await H.run([H.cap(5), 'wait 400', H.mv(mid(view), 800), 'wait 300', 'click', 'wait 3000',
        // 見え方はクリックで閉じる
        'click', 'wait 900', H.mv(rest, 600), 'wait 600', 'echo CAPOFF', 'wait 300'])
    })
  }
  E.ed.setAlwaysOnTop(false)
})
