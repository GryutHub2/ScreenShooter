// 長いページを1枚に：範囲を選ぶ → 自動でスクロールしてつなぐ → 長い1枚が編集画面で開く
// 架空のお知らせ一覧（pages.js の longPage）を窓に出し、そのまわりだけをアプリの録画機能で録る。
// できあがった編集画面は out/scroll-result.png に静止画で残す
const path = require('path')
const { BrowserWindow, screen } = require('electron')
const H = require('../harness')
const { longPage, LONG_W, LONG_H } = require('../pages')

const CAPS = {
  1: 'トレイを右クリック →「スクロールして長いページを撮る」',
  2: 'スクロールする中身を、ドラッグで囲む',
  3: 'あとは自動。終わるまでマウスに触らない',
  4: 'つないだ1枚が、編集画面で開く',
}

H.main('scroll', async (ctx) => {
  const { A, OUT } = ctx
  const wa = screen.getPrimaryDisplay().workArea
  const P = { x: Math.round(wa.x + (wa.width - LONG_W) / 2), y: Math.round(wa.y + (wa.height - LONG_H) / 2) + 40, width: LONG_W, height: LONG_H }
  // 字幕はページの上の余白に置く（スクロール撮影が撮る範囲の外なので、つないだ絵に写らない）。
  // 余白ごと無地の窓で覆ってから、ページを重ねる
  const R = { x: P.x - 20, y: P.y - 84, width: P.width + 40, height: P.height + 104 }
  await H.makeBackdrop(R)
  const page = new BrowserWindow({
    x: P.x, y: P.y, width: P.width, height: P.height, useContentSize: true,
    frame: false, resizable: false, skipTaskbar: true, show: false, alwaysOnTop: true,
  })
  await page.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(longPage))
  page.showInactive()
  await H.sleep(600)

  await H.makeCaption({ x: R.x + 20, y: R.y + 8, width: R.width - 40, height: 64 }, CAPS)
  await H.makeCursor()
  const rest = H.phys(P.x + 380, P.y + 470)
  const from = H.phys(P.x + 16, P.y + 46)
  const to = H.phys(P.x + P.width - 30, P.y + P.height - 14)

  await H.run([H.mv(rest, 200)])
  let ed = null
  await H.clip(ctx, 'scroll', R, async () => {
    await H.run(['wait 300', H.cap(1), 'wait 2000'])
    // 始めた瞬間の画面がそのまま暗幕になるので、字幕と矢印を隠してから始める
    H.overlaysVisible(false)
    await H.sleep(200)
    A.startRegionCapture('scroll')
    if (!(await H.waitFor(() => H.byUrl('overlay.html').length, 8000))) throw new Error('overlay did not open')
    await H.sleep(500)
    H.overlaysVisible(true)
    await H.run([H.cap(2), 'wait 400', H.mv(from, 800), 'wait 250', 'ldown', 'wait 100', H.mv(to, 1100), 'wait 250', 'lup'])
    // スクロール撮影の1枚ずつに写り込まないよう、矢印は終わるまで隠す（字幕は撮る範囲の外）
    H.overlaysVisible(false)
    await H.run([H.cap(3)])
    ed = await H.waitFor(() => H.byUrl('editor.html')[0], 90000)
    if (!ed) throw new Error('editor did not open')
    // 開いた編集画面を手前に出し、絵を映す所（#canvasWrap）が録る範囲にぴったり重なるよう置いて、全体表示にする
    ed.setAlwaysOnTop(true)
    ed.moveTop()
    await H.waitFor(() => ed.webContents.executeJavaScript('!!(state && state.img)'), 15000)
    const wrapTop = await ed.webContents.executeJavaScript('document.getElementById("canvasWrap").getBoundingClientRect().top')
    const eb = ed.getBounds()
    ed.setBounds({ x: Math.round(R.x + R.width / 2 - eb.width / 2), y: Math.round(R.y - wrapTop), width: eb.width, height: Math.round(wrapTop + R.height + 44) })
    await H.sleep(300)
    await ed.webContents.executeJavaScript('document.getElementById("btnZoomFit").click()')
    await H.sleep(700)
    H.overlaysVisible(true)
    await H.run([H.cap(4), 'wait 2500', 'echo CAPOFF', 'wait 300'])
  })
  H.log('page', P, 'editor', ed.getBounds())
  const size = await ed.webContents.executeJavaScript('state.img ? [state.img.width, state.img.height] : null')
  H.log('long image', size)
  H.overlaysVisible(false)
  ed.setAlwaysOnTop(true)
  ed.focus()
  await H.sleep(800)
  await H.grab(ed.getContentBounds(), path.join(OUT, "scroll-result.png"))
  ed.setAlwaysOnTop(false)
})
