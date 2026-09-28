// 個人情報：「自動ぼかし」で見つかった所がぼける → 足りない所を「ぼかし」（B）で自分で囲む
// 架空の会員情報（pages.js の account）を編集画面で開き、絵と下の帯の「自動ぼかし」ボタンのまわりだけを録る
const H = require('../harness')

const CAPS = {
  1: '下の帯の「自動ぼかし」を押す',
  2: '見つかった所に、ぼかしが入る',
  3: '見落としは必ずある。自分の目でも確かめる',
  4: '足りない所は、ぼかし（B キー）で囲む',
}

// 絵の中の「山田 花子」（自動ぼかしが探さない「お名前」の値）
const NAME = { x1: 142, y1: 56, x2: 228, y2: 90 }

H.main('privacy', async (ctx) => {
  const E = await H.openInEditor(ctx, 'account', 720)
  const btn = await E.el('#btnAutoBlur')
  const bar = await E.el('#statusbar')
  // 字幕は絵の上の余白、赤枠のお知らせ（窓の下から 98px）とボタンは絵の下に写る
  const top = Math.round(E.img.y - 80)
  const R = { x: Math.round(E.img.x - 70), y: top, width: Math.round(E.img.w + 140), height: Math.round(bar.y + bar.height - top) }
  await H.makeCaption({ x: R.x + 20, y: top + 6, width: R.width - 40, height: 64 }, CAPS)
  await H.makeCursor()
  const rest = E.at(300, 330)
  const btnAt = H.phys(btn.x + btn.width / 2, btn.y + btn.height / 2)

  await H.run([H.mv(rest, 200)])
  await H.clip(ctx, 'autoblur', R, [
    'wait 300', H.cap(1), 'wait 300', H.mv(btnAt, 900), 'wait 250', 'click', 'wait 600',
    H.cap(2), 'wait 2600', H.cap(3), 'wait 2600', 'echo CAPOFF', 'wait 300',
  ])
  const shapes = await E.ed.webContents.executeJavaScript('JSON.stringify(state.shapes.map(s => [s.type, Math.round(s.x1), Math.round(s.y1), Math.round(s.x2), Math.round(s.y2)]))')
  H.log('after autoblur', shapes)

  // 赤枠のお知らせは閉じるまで残るので、次の回の前に閉じる
  const close = await E.el('#privNoticeClose')
  if (close && close.width) await H.run([H.mv(H.phys(close.x + close.width / 2, close.y + close.height / 2), 400), 'click', 'wait 400'])
  await H.run([H.mv(rest, 300), 'wait 300'])
  await H.clip(ctx, 'blur-manual', R, [
    'wait 300', H.cap(4), 'wait 500', 'key b', 'wait 400', H.mv(E.at(NAME.x1, NAME.y1), 800), 'wait 250',
    'ldown', 'wait 100', H.mv(E.at(NAME.x2, NAME.y2), 900), 'wait 150', 'lup', 'wait 1400',
    H.mv(rest, 600), 'wait 1200', 'echo CAPOFF', 'wait 300',
  ])
  E.ed.setAlwaysOnTop(false)
})
