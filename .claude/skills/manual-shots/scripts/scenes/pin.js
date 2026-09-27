// 浮かせた絵：ホイールで大きさ／四隅のドラッグで大きさ／Ctrl+ホイールで濃さ（透かす）
// 下に「経費の入力」の架空の画面を敷き、その上に家計簿の絵を浮かせて、架空の画面の範囲だけを録る
// （範囲の外の本物の画面は写らない）。--mode=calib は録画せずに位置合わせの静止画だけ撮る
const { BrowserWindow, nativeImage, screen } = require('electron')
const path = require('path')
const H = require('../harness')
const { form, FORM_W, FORM_H } = require('../pages')

const CAPS = {
  1: 'ホイールを上へ回すと大きく',
  2: '下へ回すと小さく',
  3: '四隅をドラッグしても大きさを変えられる',
  4: 'Ctrl を押しながらホイールを下へ',
  5: '下の画面が透けて見える',
  6: '上へ回すと元の濃さに戻る',
}

H.main('pin', async (ctx) => {
  const { A, WORK, OUT, arg } = ctx
  const MODE = arg('mode', 'record')
  const wa = screen.getPrimaryDisplay().workArea
  const F = { x: Math.round(wa.x + (wa.width - FORM_W) / 2), y: Math.round(wa.y + (wa.height - FORM_H) / 2), width: FORM_W, height: FORM_H }

  const back = new BrowserWindow({
    x: F.x, y: F.y, width: F.width, height: F.height, useContentSize: true,
    frame: false, resizable: false, skipTaskbar: true, show: false, alwaysOnTop: true,
  })
  await back.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(form))
  back.showInactive()
  await H.sleep(500)

  const img = nativeImage.createFromPath(path.join(WORK, 'dummy', '3-after.png'))
  // 大きくする回は、広がっても録る範囲に収まるよう左寄りに置く。透かす回は下の金額欄に重ねる
  const LEFT = { x: F.x + 330, y: F.y + 110 }
  const OVER = { x: F.x + 400, y: F.y + 110 }
  const rest = H.phys(F.x + 160, F.y + 330)
  // 毎回まっさらな絵を浮かせ直す（前の回で変えた大きさ・濃さを持ち越さない）
  async function freshPin(P0) {
    for (const w of [...A.pinWins]) if (!w.isDestroyed()) w.destroy()
    await H.run([H.mv(rest, 200)])
    const win = A.openPin(img, null)
    if (!win) throw new Error('openPin failed')
    await H.waitFor(() => win.isVisible(), 8000)
    A.fitContentBounds(win, { x: P0.x, y: P0.y, width: win.pin.w, height: win.pin.h })
    win.moveTop()
    // 開いた直後に出る操作の案内（約2.6秒）が消えるのを待つ
    await H.sleep(3200)
    return win
  }

  await H.makeCaption({ x: F.x + 40, y: F.y + FORM_H - 78, width: FORM_W - 80, height: 64 }, CAPS)
  await H.makeCursor()

  let pin = await freshPin(LEFT)
  const b = () => pin.getContentBounds()
  const center = () => H.phys(b().x + b().width / 2, b().y + b().height / 2)
  H.log('form', F, 'pin', b())

  if (MODE === 'calib') {
    await H.grab(F, path.join(OUT, 'calib.png'))
    return
  }

  // --only=pin-wheel,pin-corner のように、撮り直す回だけ選べる
  const only = arg('only', '')
  const want = (n) => !only || only.split(',').includes(n)
  const notch = (n, dir) => { const a = []; for (let i = 0; i < n; i++) a.push('wheel ' + (120 * dir), 'wait 380'); return a }

  if (want('pin-wheel')) await H.clip(ctx, 'pin-wheel', F, [
    'wait 300', H.mv(center(), 700), 'wait 300',
    H.cap(1), 'wait 400', ...notch(3, 1), 'wait 700',
    H.cap(2), 'wait 400', ...notch(3, -1), 'wait 900', 'echo CAPOFF', 'wait 300',
  ])

  if (want('pin-corner')) {
    pin = await freshPin(LEFT)
    const c0 = b()
    // 右下の角。縁から数px内側（外周の1pxは Windows が横取りする）
    const corner = H.phys(c0.x + c0.width - 5, c0.y + c0.height - 5)
    const out = H.phys(c0.x + c0.width + 60, c0.y + c0.height + 38)
    const back2 = H.phys(c0.x + c0.width - 45, c0.y + c0.height - 28)
    await H.clip(ctx, 'pin-corner', F, [
      'wait 300', H.cap(3), 'wait 400', H.mv(corner, 800), 'wait 300',
      'ldown', 'wait 150', H.mv(out, 900), 'wait 250', H.mv(back2, 900), 'wait 150', 'lup', 'wait 900',
      'echo CAPOFF', 'wait 300',
    ])
  }

  if (want('pin-opacity')) {
    pin = await freshPin(OVER)
    await H.clip(ctx, 'pin-opacity', F, [
      'wait 300', H.mv(center(), 700), 'wait 300',
      H.cap(4), 'wait 500', 'ctrl down', 'wait 200', ...notch(5, -1), 'ctrl up',
      H.cap(5), 'wait 1800',
      H.cap(6), 'wait 300', 'ctrl down', 'wait 200', ...notch(5, 1), 'ctrl up', 'wait 900',
      'echo CAPOFF', 'wait 300',
    ])
  }
  for (const w of [...A.pinWins]) if (!w.isDestroyed()) w.destroy()
})
