// Find and the home on a phone (a design study, C3, H2,
// D1–D3, M2): the map fills the screen, the question floats over it, and the
// list is a sheet that rests at one of three heights — low (the count), half
// (where Find opens), full (the list, with a Mappa button back). The list scrolls
// at half and at full. Dragged by its top, or pulled down from a list already
// at its top, it settles on the nearest height, or the next one in the direction of a
// flick, with a calm deceleration and no overshoot. On the home the sheet holds
// the activities and is as tall as they are.
//
// The sheet's height lives on .split as two custom properties, so it survives
// find-live.js swapping the list for the next page's. Above 760px this file
// does nothing and the desktop's two columns stand as they are.
const phone = matchMedia('(max-width: 760px)')
const split = document.querySelector('.split')
const LOW = 92

let stop = 'half'
let dragging = null

const list = () => split.querySelector('.col .list')
const question = () => split.querySelector('.col > .q')
const isHome = () => !!list()?.querySelector('.acts')

/** The three heights, in pixels, for the split as it is now. */
function heights() {
  const H = split.clientHeight
  const q = question()
  const top = q ? q.offsetTop + q.offsetHeight + 10 : 80
  const full = Math.max(LOW + 40, H - top)
  return { H, low: LOW, half: Math.min(full, Math.round(H * 0.52)), full }
}

/** Puts the sheet at `h` pixels tall, animated or not. */
function setHeight(h, animate) {
  const { full } = heights()
  split.style.setProperty('--sheet-h', full + 'px')
  split.style.setProperty('--sheet-y', Math.round(full - h) + 'px')
  split.classList.toggle('is-moving', !animate)
}

function settle(name, animate = true) {
  stop = name
  const hs = heights()
  if (isHome()) {
    // the home's sheet is as tall as its activities, up to half the screen
    // measured from the sheet's top to the end of its last child, since the
    // sheet itself is as tall as the full height and only translated down
    const l = list(), last = l?.lastElementChild
    const content = last ? last.offsetTop + last.offsetHeight + 14 : hs.half
    const want = Math.min(hs.half, Math.max(hs.low, content))
    setHeight(want, animate)
    split.dataset.sheet = 'home'
    return
  }
  setHeight(hs[name], animate)
  split.dataset.sheet = name
  if (name === 'low') list()?.scrollTo({ top: 0 })
  // once it has come to rest, the list asks again for the map it uncovers (list-in-view.js)
  clearTimeout(rested)
  rested = setTimeout(() => document.dispatchEvent(new Event('find:sheet')), animate ? 360 : 0)
}
let rested = 0

// Where a gesture starts decides what it does. The top edge (the handle and the
// count) always moves the sheet; at its lowest, all of it does. Elsewhere the
// list scrolls, at half as at full, and a finger pulling down while the list is
// already at its top moves the sheet instead — the way a phone's own sheets do.
const GRAB = 56

function begin(y, t, target) {
  if (!phone.matches || isHome()) return false
  const l = list()
  if (!l || !l.contains(target)) return false
  const fromTop = y - l.getBoundingClientRect().top
  dragging = { y0: y, h0: heights()[stop], track: [[t, y]], moved: false,
    grab: stop === 'low' || fromTop <= GRAB, decided: false, target, held: false }
  return true
}

/** Moves the sheet with the finger; false when this gesture is the list's to scroll. */
function follow(y, t) {
  const d = dragging
  const dy = y - d.y0
  if (!d.decided) {
    if (dy === 0) return false
    d.decided = true
    // pulling down a list already at its top moves the sheet; anything else scrolls
    if (!d.grab && !(dy > 0 && list().scrollTop <= 0)) { dragging = null; return false }
  }
  if (!d.moved && Math.abs(dy) < 6) return true
  d.moved = true
  const hs = heights()
  let h = d.h0 - dy
  // past either end the sheet resists, a third of the finger's travel
  if (h > hs.full) h = hs.full + (h - hs.full) / 3
  if (h < hs.low) h = hs.low - (hs.low - h) / 3
  d.h = h
  setHeight(h, false)
  d.track.push([t, y]); if (d.track.length > 5) d.track.shift()
  return true
}

// a touch: the browser scrolls unless the first move is taken (touch-action: pan-y)
function onTouchStart(e) {
  dragging = null
  if (e.touches.length !== 1) { dragging = null; return }
  const p = e.touches[0]
  begin(p.clientY, e.timeStamp, e.target)
}
function onTouchMove(e) {
  if (!dragging) return
  if (e.touches.length !== 1) { onUp(); return }
  if (follow(e.touches[0].clientY, e.timeStamp) && e.cancelable) {
    e.preventDefault()
    if (dragging) dragging.held = true
  }
}
// A finger never lands still: a tap on a row drifts a pixel or two, and at the
// list's top a drift downwards reads as the start of a pull, whose taken move
// cancels the tap's click in Safari — the row would not open. A touch held that
// way which never got far enough to move the sheet was a tap, so it gets its
// click back.
function onTouchEnd(e) {
  const d = dragging
  if (d && d.held && !d.moved && e.cancelable) {
    const hit = d.target instanceof Element ? d.target.closest('a[href], button') : null
    if (hit) { e.preventDefault(); hit.click() }
  }
  onUp()
}

// a mouse (a desktop browser at phone width): no native drag-to-scroll, so the
// handle moves the sheet and the wheel scrolls the list
function onDown(e) {
  if (e.pointerType !== 'mouse' || e.button !== 0) return
  if (e.target.closest('a, button, select, input')) return
  if (begin(e.clientY, e.timeStamp, e.target) && stop !== 'full') dragging.grab = true
}
function onMove(e) {
  if (e.pointerType !== 'mouse' || !dragging) return
  follow(e.clientY, e.timeStamp)
}

function onUp() {
  if (!dragging) return
  const d = dragging; dragging = null
  if (!d.moved) return
  addEventListener('click', swallow, { capture: true, once: true })
  setTimeout(() => removeEventListener('click', swallow, { capture: true }), 400)
  const hs = heights()
  const [[t0, y0]] = d.track, [t1, y1] = d.track[d.track.length - 1]
  const v = t1 > t0 ? -(y1 - y0) / (t1 - t0) : 0
  const order = ['low', 'half', 'full']
  const h = Math.max(hs.low, Math.min(hs.full, d.h ?? d.h0))
  let next
  if (Math.abs(v) > 0.45) {
    const i = order.indexOf(stop)
    next = order[Math.max(0, Math.min(2, i + (v > 0 ? 1 : -1)))]
    // a long flick can pass a stop
    if (v > 0 && h > hs.half + 20) next = 'full'
    if (v < 0 && h < hs.half - 20) next = 'low'
  } else {
    next = order.reduce((a, n) => Math.abs(hs[n] - h) < Math.abs(hs[a] - h) ? n : a, 'half')
  }
  settle(next)
}

function swallow(e) { e.preventDefault(); e.stopPropagation() }

function start() {
  if (!split) return
  if (!phone.matches) {
    split.style.removeProperty('--sheet-h'); split.style.removeProperty('--sheet-y')
    delete split.dataset.sheet
    return
  }
  document.documentElement.classList.add('has-sheet')
  settle(stop, false)
  // the map was laid out before the sheet; tell it the size it now has
  requestAnimationFrame(() => dispatchEvent(new Event('resize')))
}

if (split) {
  split.addEventListener('touchstart', onTouchStart, { passive: true })
  split.addEventListener('touchmove', onTouchMove, { passive: false })
  split.addEventListener('touchend', onTouchEnd)
  split.addEventListener('touchcancel', onUp)
  split.addEventListener('pointerdown', onDown)
  addEventListener('pointermove', onMove, { passive: true })
  // a finger's pointerup comes before its touchend, and would end the gesture
  // before onTouchEnd could tell a tap from a pull
  addEventListener('pointerup', e => { if (e.pointerType === 'mouse') onUp() })
  // Mappa, once the list is full, drops it back to its lowest
  const back = document.createElement('button')
  back.type = 'button'; back.className = 'sheet__map'
  back.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2zM9 4v14M15 6v14"/></svg>Mappa'
  back.addEventListener('click', () => settle('low'))
  split.append(back)
  // a new question, or home to Find and back: Find opens at half, the home fits its activities
  document.addEventListener('find:pins', () => { if (phone.matches) settle(isHome() ? 'half' : (stop === 'low' ? 'low' : 'half')) })
  addEventListener('resize', () => { if (phone.matches && !dragging) settle(stop, false) })
  phone.addEventListener('change', start)
  start()
}
