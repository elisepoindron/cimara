// Find's list follows Find's map. The map holds a pin for every route the
// question matches; the list beside it is one page of the best of them inside
// the map's view, asked again of the server while the map moves and once more
// when it stops. Nothing off the map is ever a row: the header counts it.
// Pages are real links and the view is in the address (`vista`, `pagina`), so
// without this script every state of the list is still a page load away. See
// its design spec.
import { readLocatedPins, toFeatures, fitToFeatures, seenInsets } from './map-core.js'

/** How often the list is asked again while the map is still moving. */
const WHILE_MOVING_MS = 250

/** The map's view as the address carries it: `w,s,e,n`, to about ten metres. */
export function viewParam(box) {
  return [box.west, box.south, box.east, box.north].map(n => n.toFixed(4)).join(',')
}

/** Whether every located pin is inside `box`: then the list is the whole answer. */
export function holdsAll(pins, box) {
  return pins.every(p => typeof p.lat !== 'number' || typeof p.lon !== 'number'
    || (p.lon >= box.west && p.lon <= box.east && p.lat >= box.south && p.lat <= box.north))
}

/** The address of `line` in `view` (or on the whole map, when null), page 1. */
export function addressOf(line, view) {
  const params = new URLSearchParams({ q: line })
  if (view) params.set('vista', view)
  return `/trova?${params}`
}

/**
 * Puts `next` (a freshly parsed list) in place of `cur`, Glisse: rows still on
 * the page slide to their new rank, rows gone fade where they stood, newcomers
 * rise in (find-list-motion-options.html, A). Rows are matched by `data-id`, so
 * a row that stays is the same element, favourite button and focus included.
 */
function glide(cur, next, calm) {
  const rowsOf = list => [...list.querySelectorAll(':scope > .r[data-id]:not(.is-leaving)')]
  const old = new Map(rowsOf(cur).map(el => [el.dataset.id, el]))
  const before = new Map([...old.values()].map(el => [el, el.getBoundingClientRect().top]))

  const kids = [...next.children].map(n =>
    n.matches('.r[data-id]') && old.has(n.dataset.id) ? old.get(n.dataset.id) : document.adoptNode(n))
  const staying = new Set(kids)
  // Measured before anything moves: where each leaving row is, and the columns
  // it was drawn with, since a lifted row can no longer borrow the list's.
  const leaving = [...old.values()].filter(el => !staying.has(el)).map(el => ({
    el, top: el.offsetTop, left: el.offsetLeft, width: el.offsetWidth,
    cols: getComputedStyle(el).gridTemplateColumns,
  }))

  for (const el of kids) {
    el.getAnimations?.().forEach(a => a.cancel())
    if (el.matches?.('.r')) el.style.cssText = ''
  }
  cur.className = next.className
  cur.replaceChildren(...kids)
  if (calm) return

  const EASE = 'cubic-bezier(.2,.7,.2,1)'
  for (const { el, top, left, width, cols } of leaving) {
    el.getAnimations().forEach(a => a.cancel())
    el.classList.add('is-leaving')
    Object.assign(el.style, {
      position: 'absolute', top: `${top}px`, left: `${left}px`, width: `${width}px`, margin: '0',
      gridTemplateColumns: cols, pointerEvents: 'none', zIndex: '0',
    })
    cur.append(el)
    el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 240, easing: 'ease-out', fill: 'forwards' })
    // Removed on a timer rather than when the fade finishes: a page in a
    // background tab never finishes it, and a row gone from the answer must
    // not stay on screen however the animation went.
    setTimeout(() => el.remove(), 260)
  }

  let n = 0
  for (const el of rowsOf(cur)) {
    if (before.has(el)) {
      const dy = before.get(el) - el.getBoundingClientRect().top
      if (Math.abs(dy) < 0.5) continue
      el.style.position = 'relative'
      el.style.zIndex = '1'
      el.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 460, easing: EASE })
        .onfinish = () => { el.style.position = ''; el.style.zIndex = '' }
    } else {
      el.style.position = 'relative'
      el.style.zIndex = '1'
      el.animate([{ opacity: 0, transform: 'translateY(10px)' }, { opacity: 1, transform: 'none' }],
        { duration: 360, delay: 120 + Math.min(n++, 10) * 28, easing: EASE, fill: 'backwards' })
    }
  }
}

/**
 * The part of the map a visitor can see, as a box. On a wide screen that is the
 * whole map. On a phone the map runs under the question card and the list's
 * sheet (find-sheet.js), so only the band between them counts: a route hidden
 * under the sheet is not in view. Null when that band is too thin to mean
 * anything — the sheet pulled up full — and the list should stay as it is.
 */
function seenBox(map) {
  const m = map.getContainer().getBoundingClientRect()
  const ins = seenInsets(map)
  const top = ins.top, bottom = m.height - ins.bottom
  if (bottom - top < 48) return null
  // every corner, so a turned map still gives the box that holds what is seen
  const pts = [[0, top], [m.width, top], [0, bottom], [m.width, bottom]].map(p => map.unproject(p))
  return {
    west: Math.min(...pts.map(p => p.lng)), east: Math.max(...pts.map(p => p.lng)),
    south: Math.min(...pts.map(p => p.lat)), north: Math.max(...pts.map(p => p.lat)),
  }
}

/** Keeps `.col .list` in step with `map`, across find-live.js's swaps of the page. */
export function listFollowsMap(map, colorOf) {
  const calm = matchMedia('(prefers-reduced-motion: reduce)')
  const lineNow = () => new URL(location.href).searchParams.get('q') ?? ''

  // Whether the list is the whole answer (no view in the address), and the
  // address it was last asked at, so a glide that ends where it began asks nothing.
  let whole = !new URL(location.href).searchParams.has('vista')
  let asked = location.pathname + location.search
  let ticket = 0
  // A new search glides the map to its pins: the views it passes through are
  // not questions, and its list is already the whole answer.
  let quietUntil = 0
  // Until the map has loaded it has not been fitted to the pins: the view it
  // stands at is a placeholder, and the sheet settling then asks nothing.
  let ready = map.loaded()
  if (!ready) map.once('load', () => { ready = true })

  async function load(url, { toTop = false } = {}) {
    if (url === asked) return
    asked = url
    const mine = ++ticket
    let res
    try { res = await fetch(url, { headers: { accept: 'text/html' } }) } catch { return }
    if (mine !== ticket || !res.ok || new URL(res.url).pathname !== '/trova') return
    const doc = new DOMParser().parseFromString(await res.text(), 'text/html')
    const next = doc.querySelector('.col .list')
    const cur = document.querySelector('.col .list')
    if (mine !== ticket || !next || !cur) return
    glide(cur, next, calm.matches)
    history.replaceState(history.state, '', url)
    if (toTop && cur.getBoundingClientRect().top < 0) {
      cur.scrollIntoView({ block: 'start', behavior: calm.matches ? 'auto' : 'smooth' })
    }
  }

  const ask = () => {
    // The home's map is the same map, kept by find-live.js across the swap to
    // Find, but the home's list is its activities: only Find's list follows.
    if (location.pathname !== '/trova') return
    if (!ready || performance.now() < quietUntil || !document.querySelector('.col .list')) return
    const box = seenBox(map)
    if (!box) return
    if (holdsAll(readLocatedPins(), box)) {
      if (whole) return
      whole = true
      load(addressOf(lineNow(), null))
    } else {
      whole = false
      load(addressOf(lineNow(), viewParam(box)))
    }
  }

  let waiting = false
  map.on('move', () => {
    if (waiting) return
    waiting = true
    setTimeout(() => { waiting = false; ask() }, WHILE_MOVING_MS)
  })
  map.on('moveend', ask)

  // On a phone the sheet settling at another height shows more or less map.
  document.addEventListener('find:sheet', ask)

  document.addEventListener('find:pins', () => {
    whole = true
    asked = location.pathname + location.search
    ticket++
    quietUntil = performance.now() + 1000
  })

  // The list's own links: a page, or the way back to every route. Taken in the
  // capture phase so find-live.js, which would swap the whole page and refit the
  // map, sees them already handled.
  document.addEventListener('click', e => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    const a = e.target instanceof Element ? e.target.closest('.col .list a.list__all, .col .list .pages a[href]') : null
    if (!a) return
    e.preventDefault()
    if (a.matches('.list__all')) {
      fitToFeatures(map, toFeatures(readLocatedPins(), colorOf), { duration: 700 })
      return
    }
    load(new URL(a.href).pathname + new URL(a.href).search, { toTop: true })
  }, true)
}
