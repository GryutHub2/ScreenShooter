// 手順書に写す「架空の画面」。本物の個人情報・パス・画面は一切入れない。
// PNG にするもの（PNGS）は scenes/dummy.js が等倍で書き出し、窓にそのまま出すもの（form）は台本が直に開く。

const CSS = `
body{margin:0;font-family:"Yu Gothic UI","Meiryo",sans-serif;background:#f4f6f9;color:#222;overflow:hidden}
header{background:#3b6fb6;color:#fff;padding:9px 16px;font-size:17px;font-weight:bold;display:flex;justify-content:space-between;align-items:center}
header small{font-weight:normal;font-size:13px;opacity:.85}
.wrap{padding:12px 16px}
table{width:100%;border-collapse:collapse;background:#fff;font-size:15px;table-layout:fixed}
col.d{width:90px} col.m{width:140px}
td,th{padding:6px 10px;border-bottom:1px solid #e3e6eb;text-align:left}
th{background:#eef1f5;font-weight:600;color:#555}
.r{text-align:right}
.total td{font-weight:bold;border-bottom:none}
.banner{border-radius:6px;padding:6px 10px;font-size:14px;margin-bottom:10px;border:1px solid}
.ng{background:#fdecea;color:#c0392b;border-color:#f5c6cb}
.ok{background:#e8f6ec;color:#23803f;border-color:#bfe3c9}
.btns{margin-top:12px;display:flex;gap:10px;justify-content:flex-end}
button{font:inherit;font-size:15px;padding:6px 20px;border-radius:6px;border:1px solid #bbb;background:#fff;color:#333}
.primary{background:#3b6fb6;color:#fff;border-color:#3b6fb6}
.off{background:#ccd3dc;color:#fff;border-color:#ccd3dc}
ul{list-style:none;margin:0;padding:0;background:#fff;font-size:15px}
li{padding:9px 12px;border-bottom:1px solid #e3e6eb}
li b{display:inline-block;width:18px;height:18px;border:2px solid #9aa5b4;border-radius:4px;vertical-align:-4px;margin-right:10px}
li.done{color:#999;text-decoration:line-through}
li.done b{background:#3b6fb6;border-color:#3b6fb6}
`

const doc = (body, w, h) => `<!doctype html><meta charset="utf-8"><style>${CSS} body{width:${w}px;height:${h}px}</style>${body}`

function kakeibo(fixed) {
  return doc(`<header>サンプル家計簿 <small>9月</small></header>
<div class="wrap">
  <div class="banner ${fixed ? 'ok' : 'ng'}">${fixed ? '✓ 合計を計算しました' : '⚠ 合計を計算できませんでした'}</div>
  <table><colgroup><col class="d"><col><col class="m"></colgroup>
    <tr><th>日付</th><th>内容</th><th class="r">金額</th></tr>
    <tr><td>9/01</td><td>スーパー</td><td class="r">3,200円</td></tr>
    <tr><td>9/05</td><td>電気代</td><td class="r">6,800円</td></tr>
    <tr><td>9/12</td><td>本</td><td class="r">1,500円</td></tr>
    <tr class="total"><td></td><td>合計</td><td class="r">${fixed ? '11,500円' : '――円'}</td></tr>
  </table>
  <div class="btns"><button>キャンセル</button><button class="${fixed ? 'primary' : 'off'}">保存</button></div>
</div>`, 520, 330)
}

const todo = doc(`<header>やることメモ <small>サンプル</small></header>
<div class="wrap"><ul>
  <li class="done"><b></b>牛乳を買う</li>
  <li class="done"><b></b>電気代を払う</li>
  <li><b></b>本を返す</li>
  <li><b></b>家計簿の合計を直してもらう</li>
  <li><b></b>写真を整理する</li>
</ul></div>`, 520, 330)

// 浮かせた絵の下に敷く「作業中の画面」。家計簿を見ながら書き写している場面
const FORM_W = 820
const FORM_H = 520
const form = doc(`<style>
.f{padding:16px 22px}
.f h2{margin:0 0 12px;font-size:16px;color:#3b6fb6}
.row{display:grid;grid-template-columns:110px 1fr 170px;gap:12px;margin-bottom:12px}
.lab{font-size:13px;color:#667;margin-bottom:4px}
.in{background:#fff;border:1px solid #c9d0da;border-radius:6px;height:34px;display:flex;align-items:center;padding:0 10px;font-size:15px}
.in.fill{color:#222}.in.empty{color:#aab}
.note{background:#fff;border:1px solid #c9d0da;border-radius:6px;height:92px;padding:8px 10px;font-size:14px;color:#556;line-height:1.6}
</style>
<header>経費の入力 <small>サンプル</small></header>
<div class="f">
  <h2>9月の支出</h2>
  <div class="row"><div><div class="lab">日付</div><div class="in fill">9/01</div></div><div><div class="lab">内容</div><div class="in fill">スーパー</div></div><div><div class="lab">金額</div><div class="in fill">3,200</div></div></div>
  <div class="row"><div><div class="lab">日付</div><div class="in fill">9/05</div></div><div><div class="lab">内容</div><div class="in fill">電気代</div></div><div><div class="lab">金額</div><div class="in empty">円</div></div></div>
  <div class="row"><div><div class="lab">日付</div><div class="in empty">月/日</div></div><div><div class="lab">内容</div><div class="in empty"></div></div><div><div class="lab">金額</div><div class="in empty">円</div></div></div>
  <div class="lab">メモ</div>
  <div class="note">家計簿の画面を見ながら書き写す。</div>
  <div class="btns"><button>下書き保存</button><button class="primary">送信</button></div>
</div>`, FORM_W, FORM_H)

const PNGS = {
  '1-todo': { html: todo, w: 520, h: 330 },
  '2-before': { html: kakeibo(false), w: 520, h: 330 },
  '3-after': { html: kakeibo(true), w: 520, h: 330 },
}

module.exports = { PNGS, form, FORM_W, FORM_H }
