// 入口。electron.exe <この scripts フォルダ> --scene=<名前> --work=<使い捨てフォルダ> [--run=N]
// 場面は scenes/<名前>.js。dummy だけは等倍で画像を作るため main.js を読み込まない
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith('--' + k + '=')); return a ? a.slice(k.length + 3) : d }
const scene = arg('scene', '')
if (!/^[a-z0-9-]+$/.test(scene)) { console.error('--scene=<名前> が要る'); process.exit(1) }
require('./scenes/' + scene + '.js')
