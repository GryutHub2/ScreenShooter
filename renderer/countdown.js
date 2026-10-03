'use strict'

// 時間差で撮るまでの残り秒数を大きく出すだけの窓。本体が1秒ごとに数を送ってくる
window.api.on('countdown:tick', (n) => {
  document.getElementById('num').textContent = String(n)
})
