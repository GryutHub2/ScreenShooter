// 履歴パネル：2枚をえらぶ → 右クリック →「横に並べて1枚に」／「違いに赤枠を付ける」
// 右クリックメニューは本物（input.ps1 の本物の右クリック）。メニューはパネルの中に描かれるので、項目の位置は画面から読む
const path = require('path')
const fs = require('fs')
const { app } = require('electron')
const H = require('../harness')

const CAPS = {
  1: '① 直す前の絵をクリック',
  2: '② 直した後の絵を Ctrl を押しながらクリック',
  3: '右上に「2件えらび中」と出れば OK',
  4: 'えらんだ絵の上で右クリック',
  5: '「違いに赤枠を付ける」を押す',
  6: '「横に並べて1枚に」を押す',
}

async function cards(lib) {
  return lib.webContents.executeJavaScript(`Array.from(document.querySelectorAll('.card')).map(c => { const r = c.getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height * 0.4) } })`)
}

H.main('before-after', async (ctx) => {
  const { A, UD, STAGE, OUT, WORK, arg } = ctx
  const MODE = arg('mode', 'record')
  // 古い順に取り込む（履歴パネルは新しい順に並ぶので、右から やること・前・後 の逆になる）
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
  const keep = await lib.webContents.executeJavaScript(`Array.from(document.querySelectorAll('.card')).map(c => c.dataset.id)`)

  const cb = lib.getContentBounds()
  const cs = (await cards(lib)).map((c) => H.phys(cb.x + c.x, cb.y + c.y))
  const rest = H.phys(cb.x + cb.width * 0.5, cb.y + cb.height * 0.62)
  H.log('panel', cb, 'cards', cs, 'rest', rest)

  if (MODE === 'calib') {
    const r = H.physRect(cb)
    await H.run([H.mv(rest, 300), H.mv(cs[1], 500), 'click', 'wait 300', H.mv(cs[2], 500), 'ctrl down', 'wait 120', 'click', 'wait 100', 'ctrl up', 'wait 400',
      H.mv(cs[1], 400), 'rclick', 'wait 1200', `grab ${r.x} ${r.y} ${r.width} ${r.height} ${path.join(OUT, 'calib.png')}`,
      'key esc', 'wait 300'])
    H.log('rclickAt', cs[1], 'regionOrigin', { x: r.x, y: r.y })
    return
  }

  // 右クリックメニューの項目（文字の頭で探す）の真ん中。開いてから読む
  const itemAt = async (head) => {
    const r = await H.waitFor(() => lib.webContents.executeJavaScript(`(() => { const m = Array.from(document.querySelectorAll('#ctxMenu:not([hidden]) .mi')).find((x) => x.textContent.startsWith(${JSON.stringify(head)})); if (!m) return null; const r = m.getBoundingClientRect(); return { x: r.x + 90, y: r.y + r.height / 2 } })()`), 5000)
    if (!r) throw new Error('menu item not found: ' + head)
    return H.phys(cb.x + r.x, cb.y + r.y)
  }
  await H.makeCaption({ x: cb.x + 10, y: cb.y + Number(arg('capY', '425')), width: cb.width - 20, height: 64 }, CAPS)
  await H.makeCursor()

  // 1本撮るごとに、できた絵・録画を履歴から外して最初の3枚に戻す（保存先の使い捨てフォルダには残る）。
  // 編集画面が閉じきる前に次を撮り始めると、録画の途中で窓が消えて Windows が手前の窓を切り替え、右クリックのメニューが閉じる
  async function reset() {
    for (const w of H.byUrl('editor.html')) w.close()
    if (!(await H.waitFor(() => H.byUrl('editor.html').length === 0, 20000))) {
      H.log('editor did not close; destroying')
      for (const w of H.byUrl('editor.html')) w.destroy()
    }
    await H.sleep(1500)
    const libDir = path.join(UD, 'library')
    for (const id of fs.readdirSync(libDir)) {
      if (!keep.includes(id) && fs.existsSync(path.join(libDir, id, 'meta.json'))) A.deleteEntry(id)
    }
    A.notifyLibraryChanged()
    await H.sleep(800)
    // パネルはもともと最前面。ここで moveTop すると字幕の窓がパネルの裏に回る
  }
  const shot = async (name, cmds) => {
    await H.run([H.mv(rest, 250), 'wait 150'])
    await H.clip(ctx, name, cb, cmds)
    await reset()
  }

  await shot('select', [H.cap(1), 'wait 500', H.mv(cs[1], 700), 'wait 150', 'click', 'wait 700',
    H.cap(2), 'wait 700', H.mv(cs[2], 700), 'ctrl down', 'wait 250', 'click', 'wait 150', 'ctrl up', 'wait 400',
    H.cap(3), 'wait 1800', 'echo CAPOFF', 'wait 300'])
  // 違いに赤枠は「後」の絵に枠を足すので、並べて1枚にを先に撮る
  await shot('combine', async () => {
    await H.run([H.cap(4), 'wait 500', H.mv(cs[1], 600), 'wait 250', 'rclick', 'wait 900'])
    await H.run([H.cap(6), 'wait 300', H.mv(await itemAt('横に並べて'), 700), 'wait 900', 'click', 'echo CAPOFF', 'wait 300', H.mv(rest, 500), 'wait 1500'])
  })
  await shot('diff', async () => {
    await H.run([H.cap(4), 'wait 500', H.mv(cs[1], 600), 'wait 250', 'rclick', 'wait 900'])
    await H.run([H.cap(5), 'wait 300', H.mv(await itemAt('違いに赤枠'), 700), 'wait 900', 'click', 'echo CAPOFF', 'wait 500'])
  })
})
