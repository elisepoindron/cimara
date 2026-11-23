// Find's menus, drawn by the page instead of the system
// (a design study: A · Tendina, and the grade as one
// ruler, R3 · Fascia).
//
// The server renders every choice in the sentence as a real <select>, which is
// what the form posts and what works with no script. `enhance` puts a button in
// front of each one, drawn as the slot, and hides the select without taking it
// out of the form. A click opens a paper card under the slot; picking sets the
// select and fires its `change`, which find-live.js already turns into a search
// in place. The grade's two ends are one ruler, always opened under `dal`
// whichever end was clicked, and it stays open across the search it starts.
// Adding a grade (`+ grado`) opens the same ruler over the whole scale.

// ---- Pure arithmetic over the two grade menus, tested in node ----

/**
 * The ruler's two ends from the menus' selected indices. Each menu's first
 * option is the open end (`fino`, `in su`), and its others are the steps in
 * order, so a step's index is the option's less one.
 */
export function rangeOf(loSelected, hiSelected, steps) {
  return {
    lo: loSelected <= 0 ? 0 : loSelected - 1,
    hi: hiSelected <= 0 ? steps - 1 : hiSelected - 1,
  }
}

/** The menus' selected indices for two ends: an end at the scale's edge is open. */
export function selectedOf(lo, hi, steps) {
  return { lo: lo <= 0 ? 0 : lo + 1, hi: hi >= steps - 1 ? 0 : hi + 1 }
}

/** One end moved to step `i`, never past the other end nor off the scale. */
export function moveEnd(end, i, range, steps) {
  const at = Math.max(0, Math.min(steps - 1, i))
  return end === 'lo'
    ? { lo: Math.min(at, range.hi), hi: range.hi }
    : { lo: range.lo, hi: Math.max(at, range.lo) }
}

/** The end a press at step `i` takes hold of: the one beyond it, else the closer. */
export function nearestEnd(i, range) {
  if (i <= range.lo) return 'lo'
  if (i >= range.hi) return 'hi'
  return i - range.lo <= range.hi - i ? 'lo' : 'hi'
}

/**
 * What a ruler opened from `+ grado` adds to the line, as the parser reads it:
 * `dal 6a al 7a`, a floor `dal 6a`, a ceiling `al 7a`, or nothing for the whole scale.
 */
export function phraseOf(range, grades) {
  const from = range.lo > 0 ? `dal ${grades[range.lo]}` : ''
  const to = range.hi < grades.length - 1 ? `al ${grades[range.hi]}` : ''
  return [from, to].filter(Boolean).join(' ')
}

/**
 * The scale cut into its families, for the labels under the band: by grade
 * band where the steps have one (`6`), else by the grade without its sign
 * (`PD` for `PD-`, `PD`, `PD+`).
 */
export function familiesOf(grades, bands) {
  const out = []
  grades.forEach((g, i) => {
    const key = bands[i] ?? g.replace(/[+-]$/, '')
    const last = out[out.length - 1]
    if (last && last.key === key) last.to = i
    else out.push({ key, from: i, to: i })
  })
  return out
}

// ---- The page ----

const buttons = new WeakMap() // select -> the button drawn for it
const selects = new WeakMap() // button -> its select
let current = null            // the open menu or ruler

const calm = () => matchMedia('(prefers-reduced-motion: reduce)').matches

/** Draws a button for every menu in the question, once. */
export function enhance(q) {
  if (!q) return
  for (const sel of q.querySelectorAll('select.slot, select.q__add')) {
    if (buttons.has(sel)) continue
    const b = document.createElement('button')
    b.type = 'button'
    b.className = sel.classList.contains('q__add') ? 'q__add q__add--menu' : `${sel.className} slot--menu`
    b.setAttribute('aria-label', sel.getAttribute('aria-label') ?? '')
    b.setAttribute('aria-haspopup', sel.dataset.range ? 'dialog' : 'listbox')
    b.setAttribute('aria-expanded', 'false')
    b.textContent = sel.selectedOptions[0]?.textContent ?? ''
    sel.removeAttribute('aria-label')
    sel.hidden = true
    sel.tabIndex = -1
    sel.before(b)
    buttons.set(sel, b)
    selects.set(b, sel)
  }
  current?.rebind?.(q)
}

function close({ focus = false } = {}) {
  if (!current) return
  const c = current
  current = null
  c.flush?.()
  for (const t of c.triggers()) t?.setAttribute('aria-expanded', 'false')
  if (focus) c.triggers()[0]?.focus()
  if (calm()) c.el.remove()
  else { c.el.classList.add('is-out'); setTimeout(() => c.el.remove(), 130) }
}

/** Under `anchor`, kept inside the window; the window's width on a phone. */
function place(el, anchor) {
  const r = anchor.getBoundingClientRect()
  const vw = document.documentElement.clientWidth
  el.style.top = `${r.bottom + scrollY + 6}px`
  if (vw < 600) {
    el.style.left = `${16 + scrollX}px`
    el.style.width = `${vw - 32}px`
    return
  }
  el.style.width = ''
  const w = el.offsetWidth
  el.style.left = `${Math.max(16, Math.min(r.left, vw - 16 - w)) + scrollX}px`
}

// ---- A · Tendina ----

function openMenu(btn) {
  const sel = selects.get(btn)
  const el = document.createElement('div')
  el.className = 'fm'
  el.setAttribute('role', 'listbox')
  el.setAttribute('aria-label', btn.getAttribute('aria-label') ?? '')

  const adding = sel.classList.contains('q__add')
  const item = o => {
    const it = document.createElement('button')
    it.type = 'button'
    it.className = 'fm__it'
    it.setAttribute('role', 'option')
    it.setAttribute('aria-selected', String(!adding && o.selected))
    it.dataset.i = String(o.index)
    if (o.dataset.act) {
      const dot = document.createElement('span')
      dot.className = 'fm__dot'
      dot.style.background = `var(--act-${o.dataset.act})`
      it.append(dot)
    }
    it.append(o.dataset.name ?? o.textContent)
    return it
  }
  const heading = text => {
    const h = document.createElement('p')
    h.className = 'fm__h'
    h.textContent = text
    return h
  }

  // Families, when the menu has them, fill two columns about evenly, never split.
  const blocks = []
  for (const child of sel.children) {
    if (child.tagName === 'OPTGROUP') {
      const group = document.createElement('div')
      group.className = 'fm__g'
      group.append(heading(child.label))
      for (const o of child.children) group.append(item(o))
      blocks.push({ node: group, size: child.children.length + 1 })
    } else if (!(adding && child.index === 0)) {
      blocks.push({ node: item(child), size: 1 })
    }
  }
  if (sel.querySelector('optgroup')) {
    el.classList.add('fm--cols')
    const half = blocks.reduce((n, b) => n + b.size, 0) / 2
    const cols = [document.createElement('div'), document.createElement('div')]
    let filled = 0
    for (const b of blocks) {
      cols[filled < half ? 0 : 1].append(b.node)
      filled += b.size
    }
    el.append(...cols)
  } else {
    el.append(...blocks.map(b => b.node))
  }

  el.addEventListener('click', e => {
    const it = e.target.closest('.fm__it')
    if (!it) return
    sel.selectedIndex = Number(it.dataset.i)
    btn.textContent = adding ? btn.textContent : sel.selectedOptions[0]?.textContent ?? ''
    close({ focus: true })
    sel.dispatchEvent(new Event('change', { bubbles: true }))
  })
  el.addEventListener('keydown', e => {
    const items = [...el.querySelectorAll('.fm__it')]
    const at = items.indexOf(document.activeElement)
    const step = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key]
    if (step) { e.preventDefault(); items[(at + step + items.length) % items.length]?.focus() }
    else if (e.key === 'Home') { e.preventDefault(); items[0]?.focus() }
    else if (e.key === 'End') { e.preventDefault(); items[items.length - 1]?.focus() }
    else if (e.key === 'Escape') { e.preventDefault(); close({ focus: true }) }
    else if (e.key === 'Tab') close()
  })

  document.body.append(el)
  place(el, btn)
  btn.setAttribute('aria-expanded', 'true')
  current = { el, trigger: btn, triggers: () => [btn] }
  const on = el.querySelector('.fm__it[aria-selected="true"]') ?? el.querySelector('.fm__it')
  on?.focus({ preventScroll: true })
  on?.scrollIntoView({ block: 'nearest' })
}

// ---- R3 · Fascia: the grade's two ends on one band ----

function openRuler(btn) {
  const q = btn.closest('section.q')
  let lo = q.querySelector('select[data-range="lo"]')
  let hi = q.querySelector('select[data-range="hi"]')
  // `+ grado`: no grade asked yet, the whole scale, posted through the adder's own menu.
  let adder = selects.get(btn)?.dataset.range ? null : selects.get(btn)
  if (adder) lo = hi = null
  else if (!lo || !hi) return
  const opts = [...(adder ?? lo).options].slice(1)
  const grades = opts.map(o => o.textContent.replace(/^dal /, ''))
  const bands = opts.map(o => o.dataset.grade ?? null)
  const n = grades.length
  let range = adder ? { lo: 0, hi: n - 1 } : rangeOf(lo.selectedIndex, hi.selectedIndex, n)
  let sent = { ...range }
  let timer = null

  const el = document.createElement('div')
  el.className = 'fr'
  el.setAttribute('role', 'group')
  el.setAttribute('aria-label', 'Grado')
  const pct = i => `${(i / n) * 100}%`
  const mid = i => `${((i + 0.5) / n) * 100}%`
  el.innerHTML = `<p class="fr__top"><span>Grado</span><b></b></p><div class="fr__trk"></div>`
  const trk = el.querySelector('.fr__trk')
  grades.forEach((g, i) => {
    const c = document.createElement('span')
    c.className = 'fr__c'
    c.style.left = pct(i)
    c.style.width = `${100 / n}%`
    if (bands[i]) c.dataset.grade = bands[i]
    trk.append(c)
  })
  for (const f of familiesOf(grades, bands)) {
    const l = document.createElement('span')
    l.className = 'fr__f'
    l.style.left = mid((f.from + f.to) / 2)
    l.textContent = f.key
    trk.append(l)
  }
  const handles = {}
  for (const end of ['lo', 'hi']) {
    const h = document.createElement('span')
    h.className = 'fr__h'
    h.dataset.end = end
    h.tabIndex = 0
    h.setAttribute('role', 'slider')
    h.setAttribute('aria-label', end === 'lo' ? 'Grado da' : 'Grado a')
    h.setAttribute('aria-valuemin', '0')
    h.setAttribute('aria-valuemax', String(n - 1))
    h.append(document.createElement('em'))
    trk.append(h)
    handles[end] = h
  }

  const paint = () => {
    for (const end of ['lo', 'hi']) {
      const h = handles[end], i = range[end]
      h.style.left = mid(i)
      h.firstChild.textContent = grades[i]
      h.setAttribute('aria-valuenow', String(i))
      h.setAttribute('aria-valuetext', grades[i])
    }
    trk.querySelectorAll('.fr__c').forEach((c, i) => c.classList.toggle('is-in', i >= range.lo && i <= range.hi))
    el.querySelector('.fr__top b').textContent =
      `${range.lo === 0 ? 'qualsiasi' : grades[range.lo]} – ${range.hi === n - 1 ? 'qualsiasi' : grades[range.hi]}`
    if (!lo || !hi) return
    const s = selectedOf(range.lo, range.hi, n)
    lo.selectedIndex = s.lo
    hi.selectedIndex = s.hi
    for (const sel of [lo, hi]) {
      const b = buttons.get(sel)
      if (b) b.textContent = sel.selectedOptions[0]?.textContent ?? ''
    }
  }
  // The search runs when a gesture ends, not under the finger.
  const flush = () => {
    clearTimeout(timer)
    timer = null
    if (range.lo === sent.lo && range.hi === sent.hi) return
    sent = { ...range }
    if (lo) { lo.dispatchEvent(new Event('change', { bubbles: true })); return }
    const phrase = phraseOf(range, grades)
    if (!phrase) return
    adder.append(new Option(phrase, phrase))
    adder.value = phrase
    adder.dispatchEvent(new Event('change', { bubbles: true }))
  }
  const later = ms => { clearTimeout(timer); timer = setTimeout(flush, ms) }
  const set = (end, i) => {
    const next = moveEnd(end, i, range, n)
    if (next.lo === range.lo && next.hi === range.hi) return
    range = next
    paint()
  }

  const stepAt = x => {
    const r = trk.getBoundingClientRect()
    return Math.max(0, Math.min(n - 1, Math.floor(((x - r.left) / r.width) * n)))
  }
  let drag = null
  trk.addEventListener('pointerdown', e => {
    const i = stepAt(e.clientX)
    drag = e.target.closest('.fr__h')?.dataset.end ?? nearestEnd(i, range)
    handles[drag].classList.add('is-drag')
    handles[drag].focus({ preventScroll: true })
    trk.setPointerCapture(e.pointerId)
    set(drag, i)
    e.preventDefault()
  })
  trk.addEventListener('pointermove', e => { if (drag) set(drag, stepAt(e.clientX)) })
  const up = () => {
    if (!drag) return
    handles[drag].classList.remove('is-drag')
    drag = null
    flush()
  }
  trk.addEventListener('pointerup', up)
  trk.addEventListener('pointercancel', up)
  el.addEventListener('keydown', e => {
    const h = e.target.closest('.fr__h')
    if (e.key === 'Escape') { e.preventDefault(); close({ focus: true }); return }
    if (e.key === 'Enter') { e.preventDefault(); close({ focus: true }); return }
    if (!h) return
    const end = h.dataset.end
    const to = { ArrowLeft: range[end] - 1, ArrowDown: range[end] - 1, ArrowRight: range[end] + 1, ArrowUp: range[end] + 1, Home: 0, End: n - 1 }[e.key]
    if (to === undefined) return
    e.preventDefault()
    set(end, to)
    later(450)
  })

  document.body.append(el)
  paint()
  const anchor = () => (lo ? buttons.get(lo) : btn)
  place(el, anchor())
  const triggers = () => (lo ? [buttons.get(lo), buttons.get(hi)] : [btn])
  for (const t of triggers()) t?.setAttribute('aria-expanded', 'true')
  current = {
    el, ruler: true, triggers, flush, trigger: adder ? btn : undefined,
    focusEnd: end => handles[end].focus({ preventScroll: true }),
    // The search it started replaced the question: the same ruler, on the new menus.
    rebind(nextQ) {
      const l = nextQ.querySelector('select[data-range="lo"]'), h = nextQ.querySelector('select[data-range="hi"]')
      if (!l || !h || l.options.length !== n + 1) { close(); return }
      lo = l
      hi = h
      adder = null
      paint()
      place(el, anchor())
      for (const t of triggers()) t?.setAttribute('aria-expanded', 'true')
    },
  }
  current.focusEnd(selects.get(btn)?.dataset.range ?? 'lo')
}

// ---- Wiring ----

if (typeof document !== 'undefined') {
  document.addEventListener('click', e => {
    const btn = e.target instanceof Element ? e.target.closest('section.q .slot--menu, section.q .q__add--menu') : null
    if (!btn) return
    const sel = selects.get(btn)
    const range = sel?.dataset.range
    const addsGrade = sel?.classList.contains('q__add') && sel.querySelector('option[data-grade]') !== null
    if (current?.ruler && range && !current.trigger) {
      // Either end of an open ruler: the same ruler, in the same place, that end's handle.
      current.focusEnd(range)
      return
    }
    if (current?.trigger === btn) { close(); return }
    close()
    if (range || addsGrade) openRuler(btn)
    else openMenu(btn)
  })
  document.addEventListener('pointerdown', e => {
    if (!current) return
    const t = e.target
    if (current.el.contains(t) || current.triggers().some(b => b?.contains(t))) return
    close()
  }, true)
  document.addEventListener('keydown', e => {
    const btn = e.target instanceof Element ? e.target.closest('.slot--menu, .q__add--menu') : null
    if (btn && e.key === 'ArrowDown') { e.preventDefault(); btn.click() }
    if (btn && e.key === 'Escape' && current) { e.preventDefault(); close({ focus: true }) }
  })
  addEventListener('resize', () => close())
}
