// 架空の画面を等倍の PNG にして <work>/dummy に置く（ほかの場面はここから読む）
const { app, BrowserWindow } = require('electron')
const path = require('path')
const fs = require('fs')
const { PNGS } = require('../pages')

app.commandLine.appendSwitch('force-device-scale-factor', '1')
app.on('window-all-closed', () => {})
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith('--' + k + '=')); return a ? a.slice(k.length + 3) : d }
const OUT = path.join(arg('work'), 'dummy')

app.whenReady().then(async () => {
  fs.mkdirSync(OUT, { recursive: true })
  for (const [name, p] of Object.entries(PNGS)) {
    const w = new BrowserWindow({ width: p.w, height: p.h, useContentSize: true, show: false, frame: false })
    await w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(p.html))
    await new Promise((r) => setTimeout(r, 400))
    const img = await w.capturePage()
    fs.writeFileSync(path.join(OUT, name + '.png'), img.toPNG())
    console.log(name, img.getSize())
    w.destroy()
  }
  app.exit(0)
})
