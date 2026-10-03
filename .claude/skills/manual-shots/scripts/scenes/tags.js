// 履歴パネル：右クリック →「タイトル・タグを付ける」→ タイトルを入れ、タグは候補から選ぶ／新しく足す → 決める → Ctrl+F で絞り込む。
// 右クリックメニューは本物。メニューはパネルの中に描かれるので、項目の位置は画面から読む
const path = require('path')
const fs = require('fs')
const { app } = require('electron')
const H = require('../harness')

const CAPS = {
  1: '右クリック →「タイトル・タグを付ける」',
  2: 'タイトルを入れる',
  3: 'タグは打つと、付けてあるタグから候補が出る',
  4: 'Enter で札になる。候補に無い言葉は新しいタグに',
  5: '「決める」と、一覧にはタイトルが出る',
  6: 'Ctrl+F で絞り込み（名前・タイトル・タグ・撮った日）',
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

  // 1枚のときのメニューは長く、字幕を 425 に置くと最後の項目に重なるので、少し下げる
  await H.makeCaption({ x: cb.x + 10, y: cb.y + Number(arg('capY', '462')), width: cb.width - 20, height: 64 }, CAPS)
  await H.makeCursor()
  await H.run([H.mv(rest, 250), 'wait 150'])

  const center = async (sel) => {
    const r = await lib.webContents.executeJavaScript(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })()`)
    return H.phys(cb.x + r.x, cb.y + r.y)
  }
  const itemAt = async (head) => {
    const r = await H.waitFor(() => lib.webContents.executeJavaScript(`(() => { const m = Array.from(document.querySelectorAll('#ctxMenu:not([hidden]) .mi')).find((x) => x.textContent.startsWith(${JSON.stringify(head)})); if (!m) return null; const r = m.getBoundingClientRect(); return { x: r.x + 90, y: r.y + r.height / 2 } })()`), 5000)
    if (!r) throw new Error('menu item not found: ' + head)
    return H.phys(cb.x + r.x, cb.y + r.y)
  }
  await H.clip(ctx, 'tags', cb, async () => {
    await H.run([H.cap(1), 'wait 500', H.mv(cs[1], 700), 'wait 250', 'click', 'wait 200', 'rclick', 'wait 900'])
    await H.run([H.mv(await itemAt('タイトル・タグ'), 700), 'wait 800', 'click', 'wait 600', H.cap(2), 'wait 300'])
    await H.typeInto(lib, '#infoTitleIn', '家計簿の合計が出ない')
    await H.run(['wait 400', H.cap(3), 'wait 300', H.mv(await center('#infoTags'), 600), 'wait 200', 'click', 'wait 400'])
    await H.typeInto(lib, '#infoTags', '家', 300)
    await H.run(['wait 1400', H.cap(4), 'wait 500', 'key enter', 'wait 900'])
    await H.typeInto(lib, '#infoTags', '不具合', 200)
    await H.run(['wait 600', 'key enter', 'wait 1200',
      H.cap(5), H.mv(await center('#infoOk'), 700), 'wait 300', 'click', 'wait 600', H.mv(rest, 500), 'wait 1800',
      H.cap(6), 'wait 600', 'ctrl down', 'wait 100', 'key f', 'wait 100', 'ctrl up', 'wait 400'])
    await H.typeInto(lib, '#search', '家計簿', 220)
    await H.run(['wait 2600', 'echo CAPOFF', 'wait 300'])
  })
  H.log('items', await lib.webContents.executeJavaScript(`Array.from(document.querySelectorAll('.card')).map(c => c.innerText.replace(/\\s+/g, ' '))`))
})
