// A route or crag page on a phone.
//
// The header: once the page's title has gone under it, it says the page's name
// with the page's star beside it (S2, N1) — the CSS slides the site's name up
// and out and the name up in after it.
//
// The tabs (K1, E1): the strip carries a map from each section's id to its
// panel. A tab shows its sections and hides the rest, in place, the newcomers
// sliding in from the side the tab lies on (M2's easing); a sideways swipe on
// the content moves to the next or previous tab. The panel is in the address as
// `#t-<tab>`, so back and a shared link land on it. A section with no panel —
// the nearby routes, the webcams — is not shown on a phone.
//
// Nothing in a tab folds: the description, the walk in and the list of vie
// read in full. Above 760px none of this happens and the page is untouched.
const phone = matchMedia('(max-width: 760px)')
const calm = matchMedia('(prefers-reduced-motion: reduce)')
const header = document.querySelector('header.has-name')
const title = document.querySelector('.ptitle h1')
const strip = document.querySelector('.ptabs')
const mark = strip?.querySelector('.ptabs__ul')
const tabs = strip ? [...strip.querySelectorAll('[role="tab"]')] : []
const keys = tabs.map(t => t.dataset.tab)
const map = strip ? JSON.parse(strip.dataset.map || '{}') : {}
const l3 = document.querySelector('.l3')

// The header's star is the page's own, pressed from further away.
const star = header?.querySelector('.hstar')
if (star) {
  star.addEventListener('click', () => document.querySelector('.ptitle .fav')?.click())
  star.classList.toggle('on', !!document.querySelector('.ptitle .fav--on'))
}

function titled() {
  if (!phone.matches || !header || !title) return
  header.classList.toggle('is-titled', title.getBoundingClientRect().bottom < header.getBoundingClientRect().bottom)
}
/** A scroll handler run at most once a frame: a phone fires scroll faster than it paints. */
function perFrame(fn) {
  let queued = false
  return () => {
    if (queued) return
    queued = true
    requestAnimationFrame(() => { queued = false; fn() })
  }
}
addEventListener('scroll', perFrame(titled), { passive: true })

/** Every section of the page's body, however deep the columns hold it. */
const sections = () => l3 ? [...l3.querySelectorAll('section[id]')].filter(s => !s.parentElement.closest('section')) : []

let current = null
function place(btn, slide) {
  if (!mark || !btn) return
  mark.style.transition = slide && !calm.matches ? '' : 'none'
  mark.style.left = btn.offsetLeft + 'px'
  mark.style.width = btn.offsetWidth + 'px'
  strip.scrollTo({ left: Math.max(0, btn.offsetLeft - (strip.clientWidth - btn.offsetWidth) / 2), behavior: slide && !calm.matches ? 'smooth' : 'auto' })
}

function show(key, { slide = true, write = true } = {}) {
  if (!strip || !keys.includes(key)) key = keys[0]
  const from = keys.indexOf(current), to = keys.indexOf(key)
  current = key
  tabs.forEach(t => t.setAttribute('aria-selected', String(t.dataset.tab === key)))
  document.documentElement.classList.add('has-tabs')
  for (const s of sections()) {
    const mine = map[s.id] === key
    if (mine === !s.hidden) continue
    s.hidden = !mine
    if (mine && slide && from >= 0 && !calm.matches) {
      s.style.setProperty('--from', (to > from ? 28 : -28) + 'px')
      s.classList.remove('tab-in'); void s.offsetWidth; s.classList.add('tab-in')
    }
  }
  // the colophon is about the description, so it closes Generale only
  const foot = document.querySelector('.pfoot')
  if (foot) foot.hidden = key !== keys[0]
  place(tabs[to], slide)
  if (key === 'relazioni') { foldChanges(); startFeed() }
  if (write) history.replaceState(history.state, '', '#t-' + key)
  // the page comes back to the strip when the reader was further down
  if (slide) {
    const top = strip.getBoundingClientRect().top + scrollY - (header?.offsetHeight ?? 0)
    if (scrollY > top + 1) scrollTo({ top, behavior: calm.matches ? 'auto' : 'smooth' })
  }
}

function reset() {
  document.documentElement.classList.remove('has-tabs')
  for (const s of sections()) { s.hidden = false; s.classList.remove('tab-in') }
  const foot = document.querySelector('.pfoot')
  if (foot) foot.hidden = false
  header?.classList.remove('is-titled')
  current = null
}

tabs.forEach(t => t.addEventListener('click', () => show(t.dataset.tab)))

// a sideways swipe on the content is the next tab, or the one before
let x0 = null, y0 = null
l3?.addEventListener('touchstart', e => { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY }, { passive: true })
l3?.addEventListener('touchend', e => {
  if (x0 === null || !current) return
  const dx = e.changedTouches[0].clientX - x0, dy = e.changedTouches[0].clientY - y0
  x0 = null
  if (Math.abs(dx) < 60 || Math.abs(dx) < 2 * Math.abs(dy)) return
  const i = keys.indexOf(current) + (dx < 0 ? 1 : -1)
  if (i >= 0 && i < keys.length) show(keys[i])
}, { passive: true })

/** Attenzione and Novità open in place under the summary, folded at first. */
function foldChanges() {
  for (const g of document.querySelectorAll('.l3 #relazioni .sum__g:not([data-fold])')) {
    g.dataset.fold = '1'
    const head = g.querySelector('.sum__gh')
    if (!head) continue
    // the header's last word says how many, folded, where it said "ultima volta"
    const rows = g.querySelectorAll(':scope > div:not(.sum__gh)').length
    const more = Number(g.querySelector('.sum__more')?.textContent.match(/\d+/)?.[0] ?? (g.querySelector('.sum__more') ? 1 : 0))
    head.lastElementChild.textContent = String(rows + more)
    head.setAttribute('role', 'button'); head.tabIndex = 0
    const toggle = () => { g.classList.toggle('is-folded'); head.setAttribute('aria-expanded', String(!g.classList.contains('is-folded'))) }
    head.addEventListener('click', toggle)
    head.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle() } })
    g.classList.add('is-folded'); head.setAttribute('aria-expanded', 'false')
  }
}

/**
 * The reports themselves, under the summary in the Relazioni panel: read once
 * from the reports page, laid out three at a time as the reader nears the end,
 * with no Leggile tutte — scrolling is the way to the next ones.
 *
 * A theme in the summary, or a change under Attenzione or Novità, is a filter,
 * as `?tema=` and `?cambio=` are on the reports page: tapped, the feed holds
 * only the reports it was read from, with a line above them saying so and a ×
 * to see them all again; tapped again, it lets go.
 */
let feed = null
function startFeed() {
  const box = document.getElementById('relazioni')
  if (feed || !box) return
  feed = document.createElement('section')
  feed.id = 'feed'; feed.setAttribute('aria-label', 'Relazioni')
  map.feed = 'relazioni'
  box.after(feed)
  feed.innerHTML = '<div class="feed__more" aria-label="Caricamento"><i></i><i></i><i></i></div>'
  const href = box.querySelector('.sum__go')?.getAttribute('href') ?? location.pathname.replace(/\/$/, '') + '/relazioni'
  fetch(href, { headers: { accept: 'text/html' } }).then(r => r.text()).then(text => {
    const all = [...new DOMParser().parseFromString(text, 'text/html').querySelectorAll('.slips > .slip')]
      .map(s => document.adoptNode(s))
    const said = s => new Set([...s.querySelectorAll('.slip__theme, .slip__change')].map(t => t.textContent.trim()))
    let pick = null, slips = all, shown = 0, waiting = false
    const spinner = feed.querySelector('.feed__more')
    const bar = document.createElement('p'); bar.className = 'feed__pick'; bar.hidden = true
    feed.prepend(bar)

    const more = () => {
      for (const s of slips.slice(shown, shown + 3)) spinner.before(s)
      shown += 3
      const done = shown >= slips.length
      spinner.hidden = done
      feed.querySelector('.feed__end')?.remove()
      if (done) {
        const end = document.createElement('p'); end.className = 'feed__end'
        end.textContent = slips.length === 1 ? (pick ? 'È l’unica' : 'È l’unica relazione') : `Sono tutte e ${slips.length}`
        feed.append(end)
      }
    }
    function near() {
      if (waiting || current !== 'relazioni' || shown >= slips.length) return
      if (innerHeight + scrollY < document.documentElement.scrollHeight - 600) return
      waiting = true
      setTimeout(() => { more(); waiting = false }, calm.matches ? 0 : 350)
    }

    const rows = [...box.querySelectorAll('.sum__l > div, .sum__g > div:not(.sum__gh)')]
    function choose(label) {
      pick = label === pick ? null : label
      slips = pick ? all.filter(s => said(s).has(pick)) : all
      for (const s of all) s.remove()
      shown = 0
      rows.forEach(r => r.setAttribute('aria-pressed', String(r.dataset.pick === pick)))
      bar.hidden = !pick
      bar.innerHTML = ''
      if (pick) {
        const n = slips.length
        bar.append(n === 1 ? 'Una relazione su ' : `${n} relazioni su `)
        const q = document.createElement('q'); q.textContent = pick; bar.append(q)
        const x = document.createElement('button'); x.type = 'button'; x.className = 'feed__x'
        x.setAttribute('aria-label', 'Mostra tutte le relazioni'); x.textContent = '×'
        x.addEventListener('click', () => choose(pick))
        bar.append(x)
      }
      more()
      if (pick) {
        const top = feed.getBoundingClientRect().top + scrollY - (header?.offsetHeight ?? 0) - (strip?.offsetHeight ?? 0) - 12
        scrollTo({ top, behavior: calm.matches ? 'auto' : 'smooth' })
      }
    }
    for (const r of rows) {
      const label = r.querySelector('span')?.textContent.trim()
      if (!label) continue
      r.dataset.pick = label
      r.setAttribute('role', 'button'); r.tabIndex = 0; r.setAttribute('aria-pressed', 'false')
      r.addEventListener('click', () => choose(label))
      r.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(label) } })
    }

    more()
    addEventListener('scroll', perFrame(near), { passive: true })
  }).catch(() => { feed.remove(); feed = null; delete map.feed })
}

function start() {
  if (!phone.matches) { reset(); return }
  if (strip) show(location.hash.startsWith('#t-') ? location.hash.slice(3) : keys[0], { slide: false, write: false })
  titled()
}
phone.addEventListener('change', start)
// Safari on a phone fires resize while scrolling, as its toolbar grows and shrinks: only a new
// width moves the tabs, or the strip would be measured and scrolled on every one.
let width = innerWidth
addEventListener('resize', () => {
  if (innerWidth === width) return
  width = innerWidth
  place(tabs[keys.indexOf(current)], false)
})
start()
