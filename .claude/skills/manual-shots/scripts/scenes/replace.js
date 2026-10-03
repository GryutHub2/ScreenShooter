// 撮り直し・差し替え：直す前の家計簿（2-before）に赤枠と矢印を描いておき、
// 「撮り直し・差し替え」→「クリップボードの絵に差し替え」で、直した後（3-after）に下の絵だけ入れ替える。
// 差し替えると編集画面が開き直されるので、録る範囲を先に無地の窓で覆う（窓が入れ替わる一瞬に本物の画面が写らないように）。
// 本物のクリップボードを使うので、撮る前の中身を控えて最後に戻す
const path = require('path')
const { clipboard, nativeImage } = require('electron')
const H = require('../harness')

const CAPS = {
  1: '直す前の画面に、赤枠と矢印を描いてある',
  2: '「撮り直し・差し替え」→ 差し替え方を選ぶ',
  3: '書き込みはそのまま、下の絵だけ新しくなる',
}

H.main('replace', async (ctx) => {
  const saved = { text: clipboard.readText(), image: clipboard.readImage() }
  try {
    // 覆いは編集画面より先に作る（編集画面は openInEditor で最前面に上がる）
    const E0 = { w: 520, h: 330 }
    const { screen } = require('electron')
    const wa = screen.getPrimaryDisplay().workArea
    const backdrop = await H.makeBackdrop({ x: wa.x, y: wa.y, width: wa.width, height: wa.height })
    const E = await H.openInEditor(ctx, '2-before', 640)
    const tb = await E.el('#toolbar')
    const R = { x: Math.round(E.img.x - 60), y: Math.round(tb.y), width: Math.round(E.img.w + 280), height: Math.round(E.img.y + E.img.h + 30 - tb.y) }
    await H.makeCaption({ x: R.x + 20, y: Math.round(E.img.y + E.img.h - 66), width: R.width - 40, height: 60 }, CAPS)
    await H.makeCursor()
    const title = await E.el('#titlebar')
    E.ed.focus()
    await H.run([H.mv(H.phys(title.x + 300, title.y + title.height / 2), 300), 'click', 'wait 300'])
    // 書き込み（録らない）：知らせの帯を赤枠、合計の欄に矢印
    await H.run(['key r', 'wait 200', H.mv(E.at(10, 43), 300), 'ldown', H.mv(E.at(510, 86), 500), 'lup', 'wait 300',
      'key a', 'wait 200', H.mv(E.at(300, 300), 300), 'ldown', H.mv(E.at(438, 250), 500), 'lup', 'wait 300', 'key v', 'wait 200'])
    H.log('before', await E.ed.webContents.executeJavaScript('JSON.stringify(state.shapes.map((s) => s.type))'))
    clipboard.writeImage(nativeImage.createFromPath(path.join(ctx.WORK, 'dummy', '3-after.png')))
    const rest = E.at(260, 310)
    await H.run([H.mv(rest, 300), 'wait 600'])

    let ed2 = null
    await H.clip(ctx, 'replace', R, async () => {
      await H.run(['wait 300', H.cap(1), 'wait 2200', H.cap(2), 'wait 300'])
      const btn = await E.el('#btnRetake')
      await H.run([H.mv(H.phys(btn.x + btn.width / 2, btn.y + btn.height / 2), 900), 'wait 300', 'click', 'wait 700'])
      const item = await E.el('#replaceMenu [data-how="clipboard"]')
      await H.run([H.mv(H.phys(item.x + 60, item.y + item.height / 2), 700), 'wait 700', 'click'])
      ed2 = await H.waitFor(() => H.byUrl('editor.html').find((w) => w !== E.ed && w.isVisible()), 15000)
      if (!ed2) throw new Error('editor did not reopen')
      ed2.setAlwaysOnTop(true)
      ed2.moveTop()
      await H.waitFor(() => ed2.webContents.executeJavaScript('!!(state && state.img)'), 15000)
      await H.run(['wait 300', H.cap(3), H.mv(rest, 600), 'wait 3000', 'echo CAPOFF', 'wait 300'])
    })
    if (ed2) {
      H.log('after', await ed2.webContents.executeJavaScript('JSON.stringify(state.shapes.map((s) => s.type))'), ed2.getBounds(), E0)
      ed2.setAlwaysOnTop(false)
    }
    backdrop.destroy()
  } finally {
    if (!saved.image.isEmpty()) clipboard.writeImage(saved.image)
    else clipboard.writeText(saved.text)
  }
})
