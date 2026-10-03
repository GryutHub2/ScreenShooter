// 履歴パネル：右クリック →「タイトル・タグを付ける」→ 入れて決める → Ctrl+F で絞り込む。
// 右クリックメニューは本物。項目の位置は --mode=calib の静止画で測って --itemX / --infoY（右クリックした点からの距離、実ピクセル）で渡す
const path = require('path')
const fs = require('fs')
const { app } = require('electron')
const H = require('../harness')

const CAPS = {
  1: '右クリック →「タイトル・タグを付ける」',
  2: 'タイトルとタグを入れて「決める」',
  3: '一覧にはタイトルが出る',
  4: 'Ctrl+F で絞り込み（名前・タイトル・タグ・撮った日）',
}

async function cards(lib) {
  return lib.webContents.executeJavaScript(`Array.from(document.querySelectorAll('.card')).map(c => { const r = c.getBoundingClientRect(); return { id: c.dataset.id, x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height * 0.4) } })`)
}

H.main('tags', async (ctx) => {
  const { A, STAGE, OUT, WORK, arg } = ctx
  const MODE = arg('mode', 'record')
  const names = [['1-todo', 'ScreenShooter_2026-09-28_101200'], ['2-before', 'ScreenShooter_2026-09-28_101500'], ['3-after', 'ScreenShooter_2026-09-28_103000']]
  for (const [src, dst] of names) {
    const p = path.join(STAGE, dst + '.png')
    fs.copyFileSync(path.join(WORK, 'dummy', src + '.png'), p)
    app.emit('second-instance', {}, [process.execPath, p], STAGE)
    await H.sleep(1600)
  }
  await H.sleep(1200)
  for (const w of H.byUrl('editor.html')) w.close()
  await H.sleep(1200)

  const lib = await H.waitFor(() => A.libraryWin)
  if (!lib) throw new Error('library not shown')
  await H.waitFor(async () => (await cards(lib)).length >= 3)
  lib.setAlwaysOnTop(true, 'floating')
  lib.moveTop()
  await H.sleep(800)

  const cb = lib.getContentBounds()
  const cl = await cards(lib)
  const cs = cl.map((c) => H.phys(cb.x + c.x, cb.y + c.y))
  const rest = H.phys(cb.x + cb.width * 0.5, cb.y + cb.height * 0.62)
  H.log('panel', cb, 'cards', cl)

  if (MODE === 'calib') {
    const r = H.physRect(cb)
    await H.run([H.mv(rest, 300), H.mv(cs[1], 500), 'click', 'wait 300', 'rclick', 'wait 1200',
      `grab ${r.x} ${r.y} ${r.width} ${r.height} ${path.join(OUT, 'calib.png')}`, 'key esc', 'wait 300'])
    H.log('rclickAt', cs[1], 'regionOrigin', { x: r.x, y: r.y })
    return
  }

  // 「直した後」には先にタイトルとタグを付けておく（絞り込みで2枚が残るように）
  await lib.webContents.executeJavaScript(`window.api.invoke('library:saveInfo', { id: ${JSON.stringify(cl[0].id)}, title: '家計簿の合計（直った）', tags: '家計簿' })`)
  await H.sleep(800)

  const infoAt = { x: cs[1].x + Number(arg('itemX', '120')), y: cs[1].y + Number(arg('infoY', '200')) }
  await H.makeCaption({ x: cb.x + 10, y: cb.y + Number(arg('capY', '425')), width: cb.width - 20, height: 64 }, CAPS)
  await H.makeCursor()
  await H.run([H.mv(rest, 250), 'wait 150'])

  const center = async (sel) => {
    const r = await lib.webContents.executeJavaScript(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })()`)
    return H.phys(cb.x + r.x, cb.y + r.y)
  }
  await H.clip(ctx, 'tags', cb, async () => {
    await H.run([H.cap(1), 'wait 500', H.mv(cs[1], 700), 'wait 250', 'click', 'wait 200', 'rclick', 'wait 900',
      H.mv(infoAt, 700), 'wait 800', 'click', 'wait 600', H.cap(2), 'wait 300'])
    await H.typeInto(lib, '#infoTitleIn', '家計簿の合計が出ない')
    await H.sleep(300)
    await H.typeInto(lib, '#infoTags', '家計簿、不具合')
    await H.run(['wait 400', H.mv(await center('#infoOk'), 700), 'wait 300', 'click', 'wait 600', H.cap(3), H.mv(rest, 500), 'wait 1800',
      H.cap(4), 'wait 600', 'ctrl down', 'wait 100', 'key f', 'wait 100', 'ctrl up', 'wait 400'])
    await H.typeInto(lib, '#search', '家計簿', 220)
    await H.run(['wait 2600', 'echo CAPOFF', 'wait 300'])
  })
  H.log('items', await lib.webContents.executeJavaScript(`Array.from(document.querySelectorAll('.card')).map(c => c.innerText.replace(/\\s+/g, ' '))`))
})
