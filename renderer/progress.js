'use strict'

const msgEl = document.getElementById('msg')

window.api.on('progress:text', (text) => { msgEl.textContent = String(text || '') })

document.getElementById('cancel').addEventListener('click', () => window.api.send('progress:cancel'))
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { e.preventDefault(); window.api.send('progress:cancel') }
})
