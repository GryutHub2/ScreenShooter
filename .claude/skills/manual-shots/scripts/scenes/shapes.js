// 編集画面の図形：Ctrl+C → Ctrl+V で複製し、Shift を押しながら動かしてほかの図形にそろえる
// 家計簿の絵の「3,200円」に四角を1つ付けておき、それを複製して下の2行へ並べる。
// 録るのは絵のまわりだけ（編集画面のボタン類は写さない）。--mode=calib は静止画だけ撮る
const path = require('path')
const fs = require('fs')
const { app } = require('electron')
const H = require('../harness')

const CAPS = {
  1: '四角をクリックして選ぶ',
  2: 'Ctrl+C → Ctrl+V で複製',
  3: 'Shift を押しながらドラッグ',
  4: 'ピンクの線の所にぴったりそろう',
  5: 'もう一度 Ctrl+V → Shift+ドラッグ',
  6: '間隔もそろう',
}

// 家計簿の絵（520×330）の中の、金額の列の四角。行の高さは 33px
const RECT = { x1: 424, y1: 133, x2: 502, y2: 157 }
const ROW = 33

H.main('shapes', async (ctx) => {
  const { A, WORK, STAGE, OUT, arg } = ctx
  const MODE = arg('mode', 'record')

  const src = path.join(STAGE, 'ScreenShooter_2026-09-28_103000.png')
  fs.copyFileSync(path.join(WORK, 'dummy', '3-after.png'), src)
  app.emit('second-instance', {}, [process.execPath, src], STAGE)
  const ed = await H.waitFor(() => H.byUrl('editor.html')[0], 15000)
  if (!ed) throw new Error('editor did not open')
  await H.waitFor(() => ed.webContents.executeJavaScript('!!(state && state.img)'), 15000)
  // 絵の下に字幕を置く余白が要るので、窓を縦に伸ばして画面の真ん中へ。ほかの窓の裏に回らないよう最前面に
  const wa = require('electron').screen.getPrimaryDisplay().workArea
  const eb = ed.getBounds()
  ed.setBounds({ x: Math.round(wa.x + (wa.width - eb.width) / 2), y: Math.round(wa.y + (wa.height - 720) / 2), width: eb.width, height: 720 })
  ed.setAlwaysOnTop(true)
  await H.sleep(800)
  ed.webContents.send('editor:addShapes', { shapes: [Object.assign({ type: 'rect', color: A.DIFF_COLOR, width: A.DIFF_WIDTH }, RECT)] })
  // 足したときのお知らせ（約4秒）が消えるのを待つ
  await H.sleep(4800)

  const g = await ed.webContents.executeJavaScript(
    '(() => { const r = cv.getBoundingClientRect(); const v = view(); return { left: r.left, top: r.top, w: r.width, h: r.height, zoom: state.zoom, vx: v.x, vy: v.y } })()')
  const cb = ed.getContentBounds()
  H.log('editor', cb, 'canvas', g)
  // 絵の座標 → 画面の実ピクセル
  const at = (x, y) => H.phys(cb.x + g.left + (x - g.vx) * g.zoom, cb.y + g.top + (y - g.vy) * g.zoom)
  const img = { x: cb.x + g.left, y: cb.y + g.top, w: g.w, h: g.h }
  // 字幕は絵の上の余白に、Ctrl+C のお知らせ（窓の下から 52px）は絵の下に写るよう、範囲を上下に広げる
  const top = Math.round(img.y - 80)
  const R = { x: Math.round(img.x - 24), y: top, width: Math.round(img.w + 48), height: Math.round(cb.y + cb.height - 36 - top) }
  await H.makeCaption({ x: R.x + 20, y: top + 6, width: R.width - 40, height: 64 }, CAPS)
  await H.makeCursor()
  const rest = at(260, 290)

  if (MODE === 'calib') {
    await H.run([H.mv(rest, 200)])
    await H.grab(R, path.join(OUT, 'calib.png'))
    return
  }

  // 貼り付けは右へはみ出すので左下へ 20px ずつずれる（pasteShape）。
  // 掴むのは下の辺の、つまみ（角と辺の真ん中）から離れた所。つまみを掴むと動かずに大きさが変わる
  const cx = (RECT.x1 + RECT.x2) / 2
  const grab1 = at(RECT.x1 - 20 + 16, RECT.y2 + 20)          // 1つ目の複製（左へ20・下へ20）
  const drop1 = at(RECT.x1 + 16, RECT.y2 + ROW)
  const near1 = at(RECT.x1 + 16 - 4, RECT.y2 + ROW - 4)       // そろう位置の少し手前（吸い付くのを見せる）
  const grab2 = at(RECT.x1 - 40 + 16, RECT.y2 + 40)          // 2つ目の複製（左へ40・下へ40）
  const drop2 = at(RECT.x1 + 16, RECT.y2 + ROW * 2)
  const near2 = at(RECT.x1 + 16 - 4, RECT.y2 + ROW * 2 + 4)

  await H.run([H.mv(rest, 200)])
  await H.clip(ctx, 'shapes-copy-snap', R, [
    'wait 300', H.cap(1), 'wait 300', H.mv(at(cx, RECT.y1), 700), 'wait 200', 'click', 'wait 700',
    H.cap(2), 'wait 500', 'ctrl down', 'wait 150', 'key c', 'wait 600', 'key v', 'wait 150', 'ctrl up', 'wait 900',
    H.cap(3), 'wait 300', H.mv(grab1, 600), 'wait 200', 'ldown', 'wait 120', 'shift down', 'wait 150',
    H.mv(near1, 900), 'wait 200', H.cap(4), H.mv(drop1, 500), 'wait 1000', 'lup', 'wait 100', 'shift up', 'wait 700',
    H.cap(5), 'wait 300', 'ctrl down', 'wait 150', 'key v', 'wait 150', 'ctrl up', 'wait 700',
    H.mv(grab2, 600), 'wait 200', 'ldown', 'wait 120', 'shift down', 'wait 150',
    H.mv(near2, 900), 'wait 200', H.cap(6), H.mv(drop2, 500), 'wait 1100', 'lup', 'wait 100', 'shift up', 'wait 500',
    'key esc', H.mv(rest, 500), 'wait 1200', 'echo CAPOFF', 'wait 300',
  ])
  const shapes = await ed.webContents.executeJavaScript('JSON.stringify(state.shapes.map(s => [s.x1, s.y1, s.x2, s.y2]))')
  H.log('shapes', shapes)
  ed.setAlwaysOnTop(false)
})
