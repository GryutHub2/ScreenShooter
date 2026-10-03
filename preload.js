'use strict'

const { contextBridge, ipcRenderer, webUtils } = require('electron')

// 画面側(renderer)から本体(main)へ渡せる用件をここで固定する。
// 一覧に無い名前は素通りさせない（画面側の書き間違いで妙なことが起きないようにするため）。
const RECEIVE = [
  'overlay:init', 'overlay:rects',
  'editor:init', 'editor:title', 'editor:requestClose', 'editor:ui', 'editor:stylePresets', 'editor:addShapes', 'editor:toast',
  'ocr:init',
  'library:items', 'library:toast', 'library:editInfo',
  'progress:text',
  'countdown:tick',
  'traymenu:init',
  'record:init', 'record:stop', 'record:pause', 'record:blur',
  'pin:init', 'pin:status',
]
const SEND = [
  'overlay:ready', 'overlay:select', 'overlay:cancel', 'overlay:color',
  'ocr:copy', 'editor:replace',
  'app:reveal', 'app:closeWindow', 'app:setDefaults', 'app:setStylePreset',
  'editor:focus', 'editor:aspect', 'editor:exported', 'editor:retake', 'editor:pin', 'editor:backgroundDone',
  'library:updateShapes',
  'library:pin', 'library:open', 'library:menu', 'library:show', 'library:action',
  'library:drag', 'library:import', 'library:copy', 'library:paste', 'library:query', 'library:askInfo',
  'progress:cancel',
  'traymenu:size', 'traymenu:pick', 'traymenu:close',
  'record:cancel', 'record:state', 'record:error', 'record:resize',
  'pin:ready', 'pin:dragStart', 'pin:resizeStart', 'pin:dragEnd', 'pin:wheel', 'pin:menu', 'pin:close',
]
const INVOKE = [
  'app:save', 'app:savePiece', 'app:copy', 'app:copyCaptured', 'ocr:translate', 'app:openFolder', 'editor:findPrivate',
  'settings:get', 'settings:save', 'settings:pickFolder',
  'library:list', 'library:rename', 'library:saveInfo',
  'record:store', 'record:save',
]

contextBridge.exposeInMainWorld('api', {
  on(channel, fn) {
    if (!RECEIVE.includes(channel)) return
    ipcRenderer.on(channel, (_e, data) => fn(data))
  },
  send(channel, data) {
    if (!SEND.includes(channel)) return
    ipcRenderer.send(channel, data)
  },
  // 落とされたファイルの置き場所。Electron 32 から File.path が無くなったのでこちらを使う
  filePath(file) {
    try { return webUtils.getPathForFile(file) } catch (_) { return '' }
  },
  invoke(channel, data) {
    if (!INVOKE.includes(channel)) return Promise.resolve(null)
    return ipcRenderer.invoke(channel, data)
  },
})
