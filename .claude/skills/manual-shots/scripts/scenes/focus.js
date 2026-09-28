// 貼ったときの見え方を確かめる：F キーで集中モード（枠も道具も消えて絵だけ）→ カーソルを乗せると道具が出る → 「集中を解除」
// 集中モードは窓を作り直すので、切り替わるたびに新しい窓を最前面へ上げる。
// 絵だけの窓は小さくなり、まわりが空くので、録る範囲（元の編集画面の窓）を先に無地の窓で覆っておく
const H = require('../harness')

const CAPS = {
  1: 'F キー（または「集中」）で、絵だけになる',
  2: 'カーソルを乗せている間だけ、道具が出る',
  3: '「集中を解除」か Esc で、元に戻る',
}

// 前の窓が閉じて、次の編集画面が絵を読み終えるまで待ち、最前面へ上げる
async function nextEditor(old) {
  const w = await H.waitFor(() => H.byUrl('editor.html').find((x) => x !== old && !x.isDestroyed()), 10000)
  if (!w) throw new Error('editor was not reopened')
  await H.waitFor(() => w.webContents.executeJavaScript('!!(state && state.img)'), 10000)
  w.setAlwaysOnTop(true)
  w.moveTop()
  await H.sleep(500)
  return w
}

H.main('focus', async (ctx) => {
  // 集中モードの窓は絵の実寸（150% の画面では 2/3）になり、道具が重なるので、大きめの絵を使う
  const E = await H.openInEditor(ctx, 'form', 760)
  // 常に出している履歴パネルが、集中モードで空いた所に写り込むので隠す
  const lib = ctx.A.libraryWin
  if (lib && !lib.isDestroyed()) lib.hide()
  const cb = E.cb
  const R = { x: cb.x, y: cb.y, width: cb.width, height: cb.height }
  await H.makeBackdrop(R)
  E.ed.moveTop()
  // 字幕は窓の下端（下の帯の上）に出す。集中モードの窓は真ん中に出るので、そこには重ならない
  await H.makeCaption({ x: E.img.x, y: cb.y + cb.height - 70, width: E.img.w, height: 64 }, CAPS)
  await H.makeCursor()
  const out = H.phys(cb.x + 140, cb.y + cb.height / 2)   // 集中モードの窓の外（左の空き）
  const tb = await E.el('#titlebar')
  E.ed.focus()
  await H.run([H.mv(H.phys(tb.x + 300, tb.y + tb.height / 2), 300), 'click', 'wait 300', H.mv(out, 300), 'wait 300'])

  await H.clip(ctx, 'focus', R, async () => {
    await H.run(['wait 300', H.cap(1), 'wait 1200', 'key f'])
    const fw = await nextEditor(E.ed)
    await H.run([H.cap(1), 'wait 1800'])
    const b = fw.getContentBounds()
    H.log('focus window', b)
    const inside = H.phys(b.x + b.width / 2, b.y + b.height * 0.7)
    await H.run([H.cap(2), 'wait 300', H.mv(inside, 900), 'wait 1600', H.mv(out, 900), 'wait 1300', H.mv(inside, 900), 'wait 1000'])
    const r = await fw.webContents.executeJavaScript('(() => { const r = document.getElementById("btnFocus").getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })()')
    await H.run([H.cap(3), 'wait 400', H.mv(H.phys(b.x + r.x, b.y + r.y), 800), 'wait 400', 'click'])
    await nextEditor(fw)
    await H.run([H.cap(3), H.mv(out, 700), 'wait 2000', 'echo CAPOFF', 'wait 300'])
  })
})
