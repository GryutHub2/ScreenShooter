// 文字を読み取ってコピー（ocr）と、色を拾ってコピー（color）。
// 架空のエラー画面（pages.js の notice）を窓に出し、まわりを無地の窓で覆ってから、真ん中の範囲をアプリの録画機能で録る。
// 読み取った文字の窓は画面の真ん中に出るので、録る範囲はそれが収まる大きさにする。
// 本物のクリップボードを使うので、撮る前の中身を控えて最後に戻す
const { BrowserWindow, screen, clipboard } = require('electron')
const H = require('../harness')
const { PNGS } = require('../pages')

const CAPS = {
  1: 'トレイを右クリック →「文字を読み取ってコピー」',
  2: '読みたい所をドラッグで囲む',
  3: '読み取った文字が出る。直してからコピーできる',
  4: '「全部コピー」でクリップボードへ',
  5: 'トレイを右クリック →「色を拾ってコピー」',
  6: '拡大鏡で狙ってクリック',
  7: '',
}

H.main('textcolor', async (ctx) => {
  const { A, arg } = ctx
  const only = arg('only', '')
  const saved = { text: clipboard.readText(), image: clipboard.readImage() }
  try {
    const wa = screen.getPrimaryDisplay().workArea
    const cx = Math.round(wa.x + wa.width / 2), cy = Math.round(wa.y + wa.height / 2)
    // 読み取った文字の窓（700×480）が真ん中に出る。上に字幕の余白を足す
    const R = { x: cx - 420, y: cy - 330, width: 840, height: 600 }
    await H.makeBackdrop(R)
    const P = { x: R.x + 120, y: R.y + 90, width: 600, height: 380 }
    const page = new BrowserWindow({
      x: P.x, y: P.y, width: P.width, height: P.height, useContentSize: true,
      frame: false, resizable: false, skipTaskbar: true, show: false, alwaysOnTop: true, focusable: false,
    })
    await page.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(PNGS.notice.html))
    page.showInactive()
    await H.sleep(600)
    const rectOf = async (sel) => {
      const r = await page.webContents.executeJavaScript(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height } })()`)
      return { x: P.x + r.x, y: P.y + r.y, w: r.w, h: r.h }
    }
    const log = await rectOf('.msg')
    const head = await rectOf('header')
    H.log('msg', log, 'head', head)

    await H.makeCaption({ x: R.x + 20, y: R.y + 8, width: R.width - 40, height: 64 }, CAPS)
    await H.makeCursor()
    const rest = H.phys(P.x + 300, P.y + 350)
    await H.run([H.mv(rest, 200)])

    // 始めた瞬間の画面がそのまま暗幕になるので、字幕と矢印を隠してから始める
    async function begin(mode) {
      H.overlaysVisible(false)
      await H.sleep(200)
      A.startRegionCapture(mode)
      if (!(await H.waitFor(() => H.byUrl('overlay.html').length, 8000))) throw new Error('overlay did not open')
      await H.sleep(500)
      H.overlaysVisible(true)
    }

    if (!only || only === 'ocr') {
      await H.clip(ctx, 'ocr', R, async () => {
        await H.run(['wait 300', H.cap(1), 'wait 2000'])
        await begin('ocr')
        await H.run([H.cap(2), 'wait 400', H.mv(H.phys(log.x - 6, log.y - 6), 800), 'wait 250', 'ldown', 'wait 100',
          H.mv(H.phys(log.x + log.w + 6, log.y + log.h + 6), 1100), 'wait 250', 'lup'])
        const ow = await H.waitFor(() => H.byUrl('ocr.html')[0], 15000)
        if (!ow) throw new Error('ocr window did not open')
        // 覆いの窓（最前面）より上に出す
        ow.setAlwaysOnTop(true, 'pop-up-menu')
        ow.moveTop()
        const text = await H.waitFor(() => ow.webContents.executeJavaScript('document.getElementById("text").value'), 20000)
        H.log('ocr text', text)
        await H.sleep(400)
        await H.run([H.cap(3), 'wait 2600'])
        const cb = ow.getContentBounds()
        const b = await ow.webContents.executeJavaScript('(() => { const r = document.getElementById("btnCopyAll").getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })()')
        await H.run([H.cap(4), 'wait 400', H.mv(H.phys(cb.x + b.x, cb.y + b.y), 900), 'wait 300', 'click', 'wait 1600', 'echo CAPOFF', 'wait 300'])
      })
      H.log('clipboard after ocr', clipboard.readText())
    }

    if (!only || only === 'color') {
      await H.run([H.mv(rest, 300), 'wait 300'])
      await H.clip(ctx, 'color', R, async () => {
        await H.run(['wait 300', H.cap(5), 'wait 2000'])
        await begin('color')
        await H.run([H.cap(6), 'wait 400', H.mv(H.phys(head.x + 260, head.y + head.h / 2 + 30), 1300), 'wait 500',
          H.mv(H.phys(head.x + 300, head.y + head.h / 2), 500), 'wait 900', 'click', 'wait 500'])
        const got = clipboard.readText()
        H.log('color', got)
        CAPS[7] = 'クリップボードに「' + got + '」が入る'
        await H.run([H.cap(7), H.mv(rest, 600), 'wait 2400', 'echo CAPOFF', 'wait 300'])
      })
    }
  } finally {
    if (!saved.image.isEmpty()) clipboard.writeImage(saved.image)
    else clipboard.writeText(saved.text)
  }
})
