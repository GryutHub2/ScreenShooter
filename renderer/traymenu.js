'use strict'

const menu = document.getElementById('menu')
let rows = []      // 見えている項目（キー操作で上下に動く順）
let active = -1

function reportSize() {
  const r = menu.getBoundingClientRect()
  window.api.send('traymenu:size', { width: r.width, height: r.height })
}

function setActive(i) {
  active = i
  rows.forEach((el, n) => el.classList.toggle('active', n === i))
}

function visibleRows() {
  return [...menu.querySelectorAll('.item')].filter((el) => !el.hidden)
}

function row(item, child) {
  const el = document.createElement('div')
  el.className = 'item' + (child ? ' child' : '')
  const label = document.createElement('span')
  label.textContent = item.label + (item.sub ? '　▾' : '')
  const accel = document.createElement('span')
  accel.className = 'accel'
  accel.textContent = item.accel
  el.append(label, accel)
  el.addEventListener('mouseenter', () => setActive(rows.indexOf(el)))
  return el
}

// 子メニュー（時間差で撮る）は横に出さず、押すとその下に開く
function render(items) {
  menu.textContent = ''
  for (const item of items) {
    if (item.sep) { const s = document.createElement('div'); s.className = 'sep'; menu.append(s); continue }
    const el = row(item, false)
    menu.append(el)
    if (item.sub) {
      const kids = item.sub.map((c) => {
        const k = row(c, true)
        k.hidden = true
        k.addEventListener('click', () => window.api.send('traymenu:pick', c.id))
        menu.append(k)
        return k
      })
      el.addEventListener('click', () => {
        const open = kids[0].hidden
        kids.forEach((k) => { k.hidden = !open })
        rows = visibleRows()
        setActive(rows.indexOf(el))
        reportSize()
      })
    } else {
      el.addEventListener('click', () => window.api.send('traymenu:pick', item.id))
    }
  }
  rows = visibleRows()
  setActive(-1)
}

window.api.on('traymenu:init', (items) => {
  render(items)
  // requestAnimationFrame は隠した窓では来ないので使わない（2回目以降メニューが出なくなる）
  reportSize()
})

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') window.api.send('traymenu:close')
  else if (e.key === 'ArrowDown') setActive((active + 1) % rows.length)
  else if (e.key === 'ArrowUp') setActive((active - 1 + rows.length) % rows.length)
  else if (e.key === 'Enter' && rows[active]) rows[active].click()
  else return
  e.preventDefault()
})
