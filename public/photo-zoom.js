// The photo viewer for the mosaics photo-mosaic.ts draws (a report's photos on
// Tutte le relazioni, the route's in the rail). Each tile is a link to the
// gallery's own :target viewer, which works with no script at all; this takes
// the click instead and grows the photo out of its tile, then shrinks it back
// into the tile it now stands for on closing. ‹ › , the arrow keys and a swipe
// step through the tile's block — hidden tiles included, so a report's eighth
// photo is reached though five are shown. Chosen in
// a design study. On a touch screen the arrows are
// gone: the photo follows the finger and the next one slides in beside it.

const EASE = 'cubic-bezier(.2,.8,.2,1)'
const still = matchMedia('(prefers-reduced-motion: reduce)')

let box = null
let list = []
let at = 0
let back = null
let cur = null   // the photo shown
let peer = null  // its neighbour, waiting off screen while a swipe or step slides it in
let busy = false
const dims = new Map()
const GAP = 24

function viewer() {
  if (box) return box
  box = document.createElement('div')
  box.className = 'pz'
  box.hidden = true
  box.setAttribute('role', 'dialog')
  box.setAttribute('aria-modal', 'true')
  box.setAttribute('aria-label', 'Foto')
  // Under the photo: its caption, then two labelled fields — who took it (and
  // its licence, only where there is one) and the report's day, with a way to
  // read it. Chosen in a design study (R4).
  box.innerHTML = '<img class="pz__img" alt=""><img class="pz__img pz__peer" alt="" aria-hidden="true"><b class="pz__count"></b>'
    + '<div class="pz__cap"><p class="pz__t"></p><dl class="pz__f">'
    + '<div><dt>Foto di</dt><dd><b class="pz__by"></b><a class="pz__lic" target="_blank" rel="noopener"></a></dd></div>'
    + '<div><dt>Relazione del</dt><dd><i class="pz__day"></i> · <a class="pz__go">Leggi</a></dd></div>'
    + '</dl></div>'
    + '<button type="button" class="pz__prev" aria-label="Foto precedente">‹</button>'
    + '<button type="button" class="pz__next" aria-label="Foto successiva">›</button>'
    + '<button type="button" class="pz__close" aria-label="Chiudi">×</button>'
  document.body.append(box)
  ;[cur, peer] = box.querySelectorAll('.pz__img')

  box.addEventListener('click', (e) => {
    if (e.target.closest('.pz__prev')) return step(-1)
    if (e.target.closest('.pz__next')) return step(1)
    if (e.target.classList.contains('pz__img')) return
    close()
  })
  swipe()
  return box
}

const img = () => cur

/** Where the photo sits when open: as large as fits, never blown up past 1.2× its own size, a little above centre. */
function fit(w, h) {
  const s = Math.min(innerWidth * 0.9 / w, innerHeight * 0.74 / h, 1.2)
  const tw = w * s, th = h * s
  return { x: (innerWidth - tw) / 2, y: (innerHeight - th) / 2 - 24, w: tw, h: th }
}

/** The tile drawn at the photo's place: the same box, the photo cropped to it as the tile crops it. */
function from(r, t) {
  const s = Math.max(r.width / t.w, r.height / t.h)
  const vw = r.width / s, vh = r.height / s
  return {
    transform: `translate(${r.left + r.width / 2 - (t.x + t.w / 2)}px,${r.top + r.height / 2 - (t.y + t.h / 2)}px) scale(${s})`,
    clipPath: `inset(${(t.h - vh) / 2}px ${(t.w - vw) / 2}px round ${12 / s}px)`,
  }
}

/** The visible tile a photo can go back into, or null when it is hidden or off screen. */
function tileOf(link) {
  if (!link || link.hidden) return null
  const r = link.getBoundingClientRect()
  return r.width > 0 && r.bottom > 0 && r.top < innerHeight ? r : null
}

function size(src) {
  if (dims.has(src)) return Promise.resolve(dims.get(src))
  return new Promise((done) => {
    const i = new Image()
    const keep = (d) => { dims.set(src, d); done(d) }
    i.onload = () => keep([i.naturalWidth, i.naturalHeight])
    i.onerror = () => keep([4, 3])
    i.src = src
  })
}

const srcAt = (i) => list[(i + list.length) % list.length].querySelector('img')

/** Loads the two neighbours' sizes ahead, so a swipe never waits for one. */
function warm() {
  if (list.length > 1) { size(srcAt(at + 1).src); size(srcAt(at - 1).src) }
}

/** Sets an image at its open place, for the photo d steps away. */
function lay(el, d) {
  const im = srcAt(at + d)
  const t = fit(...(dims.get(im.src) || [4, 3]))
  if (el.getAttribute('src') !== im.src) el.src = im.src
  el.alt = im.alt
  Object.assign(el.style, { left: `${t.x}px`, top: `${t.y}px`, width: `${t.w}px`, height: `${t.h}px`, clipPath: 'inset(0 round 8px)' })
}

const shift = (el, x) => { el.style.transform = x ? `translateX(${x}px)` : 'none' }
const span = () => innerWidth + GAP

/** Puts the neighbour on side d (1 right, -1 left), out of view, ready to slide. */
function ready(d) {
  peer.style.transition = 'none'
  lay(peer, d)
  peer.style.opacity = '1'
  shift(peer, d * span())
  peer.dataset.side = d
}

/** Both photos slide by dx: the shown one off, the neighbour in. */
function drag(dx, d) {
  shift(cur, dx)
  shift(peer, d * span() + dx)
  box.querySelector('.pz__cap').style.opacity = String(Math.max(0, 1 - Math.abs(dx) / (innerWidth * 0.5)))
}

/** Ends a slide toward side d (or back, when d is 0); ms is how long the rest of the way takes. */
function settle(d, ms) {
  const side = Number(peer.dataset.side)
  const ease = `transform ${ms}ms ${EASE}`
  cur.style.transition = peer.style.transition = ease
  const cap = box.querySelector('.pz__cap')
  cap.style.transition = 'opacity .2s'
  if (!d) {
    shift(cur, 0)
    shift(peer, side * span())
    cap.style.opacity = ''
    return
  }
  busy = true
  shift(cur, -d * span())
  shift(peer, 0)
  setTimeout(() => {
    at = (at + d + list.length) % list.length
    ;[cur, peer] = [peer, cur]
    peer.style.transition = 'none'
    peer.style.opacity = '0'
    cur.removeAttribute('aria-hidden')
    peer.setAttribute('aria-hidden', 'true')
    peer.classList.add('pz__peer')
    cur.classList.remove('pz__peer')
    caption()
    cap.style.opacity = ''
    busy = false
    warm()
  }, ms)
}

/** The finger: a horizontal drag carries the photo, a quick flick or half a screen turns it. */
function swipe() {
  let x0 = 0, y0 = 0, t0 = 0, dx = 0, d = 0, mode = null
  box.addEventListener('touchstart', (e) => {
    if (busy || e.touches.length > 1 || list.length < 2 || !box.classList.contains('on')) { mode = 'off'; return }
    x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; t0 = e.timeStamp
    dx = 0; d = 0; mode = null
    cur.style.transition = 'none'
  }, { passive: true })
  box.addEventListener('touchmove', (e) => {
    if (mode === 'off') return
    if (e.touches.length > 1) { if (mode === 'x') settle(0, 260); mode = 'off'; return }
    const mx = e.touches[0].clientX - x0, my = e.touches[0].clientY - y0
    if (!mode) {
      if (Math.abs(mx) < 8 && Math.abs(my) < 8) return
      mode = Math.abs(mx) > Math.abs(my) ? 'x' : 'off'
      if (mode === 'off') return
    }
    e.preventDefault()
    dx = mx
    const side = dx < 0 ? 1 : -1
    if (side !== d) { d = side; ready(d) }
    drag(dx, d)
  }, { passive: false })
  const end = (e) => {
    if (mode !== 'x') { mode = null; return }
    mode = null
    const v = Math.abs(dx) / Math.max(1, e.timeStamp - t0)
    const turn = Math.abs(dx) > innerWidth * 0.25 || (v > 0.45 && Math.abs(dx) > 30)
    // The rest of the way takes as long as the finger's speed says, within reason.
    const left = turn ? span() - Math.abs(dx) : Math.abs(dx)
    const ms = Math.round(Math.min(420, Math.max(200, left / Math.max(v, 1.4))))
    settle(turn ? d : 0, ms)
  }
  box.addEventListener('touchend', end)
  box.addEventListener('touchcancel', (e) => { if (mode === 'x') settle(0, 260); mode = null })
}

function caption() {
  const a = list[at]
  const q = (s) => box.querySelector(s)
  q('.pz__t').textContent = a.dataset.cap || ''
  q('.pz__by').textContent = a.dataset.by || ''
  const lic = q('.pz__lic')
  lic.textContent = a.dataset.lic || ''
  if (a.dataset.lic && a.dataset.src) lic.href = a.dataset.src
  else lic.removeAttribute('href')
  q('.pz__day').textContent = a.dataset.day || ''
  const go = q('.pz__go')
  if (a.dataset.report) go.href = a.dataset.report
  else go.removeAttribute('href')
  q('.pz__count').textContent = `${at + 1} / ${list.length}`
}

async function open(link) {
  viewer()
  list = [...link.closest('.mo').querySelectorAll('a[data-zoom]')]
  at = list.indexOf(link)
  back = link
  box.classList.toggle('pz--one', list.length === 1)
  peer.style.transition = 'none'
  peer.style.opacity = '0'

  const src = link.querySelector('img').src
  const t = fit(...await size(src))
  const im = img()
  im.src = src
  im.alt = link.querySelector('img').alt
  Object.assign(im.style, { left: `${t.x}px`, top: `${t.y}px`, width: `${t.w}px`, height: `${t.h}px`, transition: 'none', opacity: '1' })
  const r = tileOf(link)
  if (r && !still.matches) Object.assign(im.style, from(r, t))
  else Object.assign(im.style, { transform: 'none', clipPath: 'inset(0 round 8px)', opacity: '0' })
  caption()

  box.hidden = false
  document.documentElement.style.overflow = 'hidden'
  im.getBoundingClientRect()
  im.style.transition = still.matches ? 'opacity .2s' : `transform .42s ${EASE},clip-path .42s ${EASE}`
  box.classList.add('on')
  Object.assign(im.style, { transform: 'none', clipPath: 'inset(0 round 8px)', opacity: '1' })
  box.querySelector('.pz__close').focus({ preventScroll: true })
  warm()
}

async function step(d) {
  if (list.length < 2 || busy) return
  if (still.matches) return fade(d)
  await size(srcAt(at + d).src)
  ready(d)
  peer.getBoundingClientRect()
  settle(d, 380)
}

/** With reduced motion, a step is a short fade in place. */
async function fade(d) {
  busy = true
  at = (at + d + list.length) % list.length
  cur.style.transition = 'opacity .14s'
  cur.style.opacity = '0'
  await size(srcAt(at).src)
  setTimeout(() => {
    lay(cur, 0)
    shift(cur, 0)
    caption()
    cur.style.opacity = '1'
    busy = false
    warm()
  }, 140)
}

function close() {
  if (!box || box.hidden) return
  const im = img()
  const link = list[at]
  const r = tileOf(link)
  box.classList.remove('on')
  peer.style.opacity = '0'
  document.documentElement.style.overflow = ''
  if (r && !still.matches) {
    const t = { x: parseFloat(im.style.left), y: parseFloat(im.style.top), w: parseFloat(im.style.width), h: parseFloat(im.style.height) }
    im.style.transition = `transform .36s ${EASE},clip-path .36s ${EASE},opacity .1s .3s`
    Object.assign(im.style, from(r, t), { opacity: '0' })
  } else {
    im.style.transition = 'opacity .2s'
    im.style.opacity = '0'
  }
  setTimeout(() => { if (!box.classList.contains('on')) box.hidden = true }, 420)
  ;(tileOf(link) ? link : back)?.focus({ preventScroll: true })
}

document.addEventListener('click', (e) => {
  const link = e.target.closest('a[data-zoom]')
  // The rail's +N tile leads to the photos page; it stays in the sequence above.
  if (!link || link.hasAttribute('data-all') || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
  e.preventDefault()
  open(link)
})

document.addEventListener('keydown', (e) => {
  if (!box || box.hidden || !box.classList.contains('on')) return
  if (e.key === 'Escape') { e.preventDefault(); close() }
  else if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1) }
  else if (e.key === 'ArrowRight') { e.preventDefault(); step(1) }
})
