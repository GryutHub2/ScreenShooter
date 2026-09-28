// 操作を録画する：範囲を囲む → 左下に操作バー → 「停止」→ 真ん中に確認画面
// 録画そのものを見せるのでアプリの録画は使えない。grabClip（画面を何度も撮ってつなぐ）で撮る。
// 操作バーは画面の隅（左下が空いていれば左下）に出るので、架空の画面を左下に寄せ、隅まで含めて録る。
// 確認画面は画面の真ん中に出るので、GIF には入れず out/record-confirm.png に静止画で残す
const path = require('path')
const { BrowserWindow, screen } = require('electron')
const H = require('../harness')
const { form, FORM_W, FORM_H } = require('../pages')

const CAPS = {
  1: 'トレイを右クリック →「録画する（GIF・動画）」',
  2: '録りたい範囲をドラッグ。放した瞬間から録画',
  3: '画面の隅に操作バー。経過時間が進む',
  4: '終わったら「停止」',
  5: '画面の真ん中に確認画面が出る（下の画像）',
}

H.main('record', async (ctx) => {
  const { A, OUT } = ctx
  const wa = screen.getPrimaryDisplay().workArea
  const bottom = wa.y + wa.height
  const F = { x: wa.x + 30, y: bottom - FORM_H - 92, width: FORM_W, height: FORM_H }
  const R = { x: wa.x, y: F.y - 84, width: FORM_W + 60, height: bottom - (F.y - 84) }
  await H.makeBackdrop(R)
  const page = new BrowserWindow({
    x: F.x, y: F.y, width: F.width, height: F.height, useContentSize: true,
    frame: false, resizable: false, skipTaskbar: true, show: false, alwaysOnTop: true,
  })
  await page.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(form))
  page.showInactive()
  await H.sleep(600)
  await H.makeCaption({ x: R.x + 30, y: R.y + 8, width: R.width - 60, height: 64 }, CAPS)
  await H.makeCursor()

  const rest = H.phys(F.x + 400, F.y + 420)
  const from = H.phys(F.x + 20, F.y + 70)
  const to = H.phys(F.x + FORM_W - 20, F.y + 330)
  const field1 = H.phys(F.x + 700, F.y + 190)
  const field2 = H.phys(F.x + 420, F.y + 290)
  let bar = null

  await H.run([H.mv(rest, 200)])
  await H.grabClip(ctx, 'record', R, async () => {
    await H.run(['wait 300', H.cap(1), 'wait 2000'])
    // 始めた瞬間の画面がそのまま暗幕になるので、字幕と矢印を隠してから始める
    H.overlaysVisible(false)
    await H.sleep(200)
    A.startRegionCapture('record')
    if (!(await H.waitFor(() => H.byUrl('overlay.html').length, 8000))) throw new Error('overlay did not open')
    await H.sleep(500)
    H.overlaysVisible(true)
    await H.run([H.cap(2), 'wait 400', H.mv(from, 800), 'wait 250', 'ldown', 'wait 100', H.mv(to, 1100), 'wait 250', 'lup'])
    bar = await H.waitFor(() => H.byUrl('record.html')[0], 10000)
    if (!bar) throw new Error('record bar did not open')
    // 操作バーは録画に写らない設定になっている。手順書では見せたいので、この実演のときだけ外す
    try { bar.setContentProtection(false) } catch (_) {}
    await H.waitFor(() => bar.webContents.executeJavaScript("typeof phase !== 'undefined' && phase === 'rec'"), 15000)
    await H.run([H.cap(3), 'wait 300', H.mv(field1, 900), 'wait 300', 'click', 'wait 500', H.mv(field2, 900), 'wait 300', 'click', 'wait 900'])
    const b = bar.getContentBounds()
    const s = await bar.webContents.executeJavaScript('(() => { const r = document.getElementById("btnStop").getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })()')
    H.log('bar', b, 'stop', s)
    await H.run([H.cap(4), 'wait 400', H.mv(H.phys(b.x + s.x, b.y + s.y), 1000), 'wait 300', 'click', 'wait 900'])
    await H.run([H.cap(5), 'wait 2200', 'echo CAPOFF', 'wait 300'])
  })

  // 確認画面（止めると操作バーの窓が大きくなって真ん中へ移る）を静止画で残す
  await H.sleep(1500)
  if (bar && !bar.isDestroyed()) {
    bar.setAlwaysOnTop(true)
    bar.moveTop()
    await H.sleep(800)
    H.overlaysVisible(false)
    await H.grab(bar.getContentBounds(), path.join(OUT, 'record-confirm.png'))
    H.log('confirm', bar.getContentBounds())
    A.closeRecordWindow()
  }
})
