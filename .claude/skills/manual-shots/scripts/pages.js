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

// 自動ぼかし用。値はすべて見本と分かるもの（example.com・見本の番号・でたらめのキー）。
// 「紹介コード」は自動ぼかしが探さない見出し・形なので、手でぼかす例と、設定に登録する例に使う
const account = doc(`<style>
dl{display:grid;grid-template-columns:120px 1fr;margin:0;background:#fff;font-size:16px}
dt,dd{margin:0;padding:10px 14px;border-bottom:1px solid #e3e6eb}
dt{color:#667;background:#f7f8fa}
dd.key{font-family:Consolas,monospace;font-size:14px}
</style>
<header>会員情報 <small>サンプル</small></header>
<div class="wrap"><dl>
  <dt>お名前</dt><dd>山田 花子</dd>
  <dt>メール</dt><dd>hanako.yamada@example.com</dd>
  <dt>電話番号</dt><dd>090-1234-5678</dd>
  <dt>会員番号</dt><dd>A-00123456</dd>
  <dt>紹介コード</dt><dd>KX-3391-07</dd>
  <dt>API キー</dt><dd class="key">sk-ant-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx</dd>
</dl>
<div class="btns"><button>閉じる</button><button class="primary">変更する</button></div></div>`, 600, 420)

// 目立たせる道具用。小さい版の番号（拡大鏡）・エラーの1行（蛍光ペン）・押してほしいボタン（スポットライト）
const settings = doc(`<style>
.row{display:flex;align-items:center;justify-content:space-between;background:#fff;border:1px solid #e3e6eb;border-radius:6px;padding:10px 14px;margin-bottom:10px;font-size:15px}
.row small{display:block;color:#889;font-size:12px;margin-top:2px}
.log{background:#1f2329;color:#c9d1d9;font-family:Consolas,monospace;font-size:13px;border-radius:6px;padding:8px 12px;line-height:1.7}
.log .err{color:#ff7b72}
.ver{position:absolute;right:16px;bottom:8px;font-size:10px;color:#99a}
</style>
<header>アプリの設定 <small>サンプル</small></header>
<div class="wrap">
  <div class="row"><div>保存先のフォルダ<small>D:\\写真\\まとめ</small></div><button class="primary">保存先を選ぶ</button></div>
  <div class="row"><div>起動時に開く<small>前回の画面</small></div><button>変更</button></div>
  <div class="log">
    10:02:11 起動しました<br>
    10:02:12 設定を読み込みました<br>
    <span class="err">10:02:13 ERROR 保存先のフォルダが見つかりません</span><br>
    10:02:13 既定のフォルダを使います
  </div>
</div>
<div class="ver">バージョン 2.4.1（ビルド 1187）</div>`, 600, 380)

// 番号マーカー用。入れる順に並んだ登録画面。左の余白（96px）に ①②③ を置く。行の間隔は 62px でそろえる
const signup = doc(`<style>
.sf{padding:16px 24px 0 96px}
.fr{display:flex;align-items:center;height:38px;margin-bottom:24px;font-size:15px}
.fr .lab{width:92px;color:#556}
.fr .in{flex:1;background:#fff;border:1px solid #c9d0da;border-radius:6px;height:38px}
.agree{display:flex;align-items:center;height:38px;font-size:15px;margin-bottom:18px}
.agree b{display:inline-block;width:18px;height:18px;border:2px solid #9aa5b4;border-radius:4px;margin-right:10px;background:#fff}
.sf .go{display:flex;justify-content:flex-end}
.sf .go button{padding:8px 34px}
</style>
<header>会員登録 <small>サンプル</small></header>
<div class="sf">
  <div class="fr"><span class="lab">お名前</span><span class="in"></span></div>
  <div class="fr"><span class="lab">メール</span><span class="in"></span></div>
  <div class="fr"><span class="lab">パスワード</span><span class="in"></span></div>
  <div class="agree"><b></b>利用規約に同意する</div>
  <div class="go"><button class="primary">登録する</button></div>
</div>`, 600, 380)

// 省略用。行の多い支出の表。真ん中の行を抜いて、最初の数行と合計だけを見せる
const LEDGER = [
  ['9/01', 'スーパー', '3,200'], ['9/03', 'ドラッグストア', '1,180'], ['9/05', '電気代', '6,800'],
  ['9/08', 'スーパー', '2,640'], ['9/10', '水道代', '3,950'], ['9/12', '本', '1,500'],
  ['9/15', 'スーパー', '4,020'], ['9/18', '美容院', '5,500'], ['9/21', 'ガス代', '4,310'],
  ['9/24', 'スーパー', '2,870'], ['9/27', '映画', '1,900'], ['9/30', '携帯電話', '3,300'],
]
const ledger = doc(`<header>サンプル家計簿 <small>9月の支出</small></header>
<div class="wrap">
  <table><colgroup><col class="d"><col><col class="m"></colgroup>
    <tr><th>日付</th><th>内容</th><th class="r">金額</th></tr>
    ${LEDGER.map(([d, t, m]) => `<tr><td>${d}</td><td>${t}</td><td class="r">${m}円</td></tr>`).join('')}
    <tr class="total"><td></td><td>合計</td><td class="r">41,170円</td></tr>
  </table>
</div>`, 520, 530)

// スクロール撮影用の長いページ（窓に直に出す）。画面に貼り付く見出しは置かない（継ぎ目を見失うため）。
// 1件ずつ文の長さ・色を変えて、どこを切っても同じ帯にならないようにする
const LONG_W = 760
const LONG_H = 520
const NEWS = [
  ['重要', '#c0392b', '10月から、ポイントの有効期限が1年に変わります'],
  ['更新', '#3b6fb6', 'アプリを更新しました。検索が速くなっています'],
  ['お知らせ', '#23803f', '年末年始の営業時間のご案内'],
  ['更新', '#3b6fb6', '明るさの自動調整を追加しました'],
  ['メンテ', '#8e44ad', '9月30日 2:00〜4:00 にメンテナンスを行います'],
  ['お知らせ', '#23803f', '新しい店舗が駅前にオープンしました'],
  ['重要', '#c0392b', 'パスワードの再設定をお願いしています（対象の方のみ）'],
  ['更新', '#3b6fb6', '印刷の余白を細かく選べるようになりました'],
  ['お知らせ', '#23803f', '秋のキャンペーンのお知らせ'],
  ['メンテ', '#8e44ad', '10月5日 1:00〜3:00 に一部の機能が止まります'],
  ['更新', '#3b6fb6', '文字の大きさを3段階から選べるようにしました'],
  ['お知らせ', '#23803f', 'よくある質問のページを新しくしました'],
  ['重要', '#c0392b', '古い版のアプリは11月で使えなくなります'],
  ['更新', '#3b6fb6', 'ダークモードに対応しました'],
  ['お知らせ', '#23803f', 'アンケートにご協力ください（5分ほど）'],
  ['更新', '#3b6fb6', '通知の時刻を選べるようになりました'],
]
const longPage = doc(`<style>
html{overflow-y:scroll}body{overflow:visible;width:auto!important;height:auto!important}
.item{background:#fff;border:1px solid #e3e6eb;border-radius:8px;padding:12px 16px;margin-bottom:10px}
.item .d{color:#889;font-size:13px}
.item .t{font-size:16px;margin-top:4px}
.tag{display:inline-block;color:#fff;font-size:12px;border-radius:4px;padding:1px 8px;margin-right:8px}
.item p{margin:6px 0 0;color:#556;font-size:14px;line-height:1.6}
</style>
<header>お知らせ一覧 <small>サンプル</small></header>
<div class="wrap">${NEWS.map(([tag, color, title], i) => `<div class="item"><span class="tag" data-c="${i}">${tag}</span><span class="d">2026/${String(9 - Math.floor(i / 6)).padStart(2, '0')}/${String(28 - i).padStart(2, '0')}</span>
<div class="t">${title}</div><p>${'詳しくは、このお知らせの本文をご覧ください。'.repeat(1 + (i % 3))}</p></div>`).join('')}</div>
<style>${NEWS.map(([, color], i) => `.tag[data-c="${i}"]{background:${color}}`).join('')}</style>`, LONG_W, LONG_H)

// 文字の読み取り・色を拾う用。ふつうの字（等幅や黒地でない）のエラー画面。日本語と英語を混ぜる（翻訳の例にもなる）
const notice = doc(`<style>
.msg{background:#fff;border:1px solid #e3e6eb;border-radius:8px;padding:16px 20px;font-size:17px;line-height:1.75}
.msg .t{font-size:20px;font-weight:bold;color:#c0392b;margin-bottom:6px}
.msg .en{color:#445}
.msg .code{color:#556;font-size:16px}
</style>
<header>ファイルの保存 <small>サンプル</small></header>
<div class="wrap">
  <div class="msg">
    <div class="t">保存できませんでした</div>
    保存先のフォルダが見つかりません。<br>
    <span class="en">The destination folder was not found.</span><br>
    <span class="code">エラーコード：E-1042</span>
  </div>
  <div class="btns"><button>閉じる</button><button class="primary">もう一度試す</button></div>
</div>`, 600, 380)

const PNGS = {
  'notice': { html: notice, w: 600, h: 380 },
  'account': { html: account, w: 600, h: 420 },
  'settings': { html: settings, w: 600, h: 380 },
  'signup': { html: signup, w: 600, h: 380 },
  'ledger': { html: ledger, w: 520, h: 530 },
  'form': { html: form, w: FORM_W, h: FORM_H },
  '1-todo': { html: todo, w: 520, h: 330 },
  '2-before': { html: kakeibo(false), w: 520, h: 330 },
  '3-after': { html: kakeibo(true), w: 520, h: 330 },
}

module.exports = { PNGS, form, FORM_W, FORM_H, longPage, LONG_W, LONG_H }
