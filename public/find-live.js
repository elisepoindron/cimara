// Home and Find without page loads. Both pages are server-rendered with the same
// frame (the question and a list on the left, the map on the right) and every
// control on them is a real form or link, so all of this is optional: without
// it each step is an ordinary navigation. With it, a step fetches the next page
// in the background and swaps only what changes, the question and the list,
// inside a view transition where the browser has one. The map is left standing
// and is handed the new pins (map-core.js, followPins). The address bar follows,
// so a search is still a link, and back and forward move through the same steps
// in place, home included.

import './line-examples.js'
import { enhance } from './find-menus.js'

const root = document.documentElement
root.classList.add('find-live')

/** The pages this script moves between in place. */
const LIVE = new Set(['/', '/trova'])

const calm = matchMedia('(prefers-reduced-motion: reduce)')

let latest = 0

/** Fetches `url` and swaps the question and the list in place. */
async function go(url, { push = true } = {}) {
  const ticket = ++latest
  const col = document.querySelector('.col')
  col?.classList.add('is-loading')

  let res
  try {
    res = await fetch(url, { headers: { accept: 'text/html' } })
  } catch {
    location.href = url
    return
  }
  // A newer step was started while this one was on its way: it wins.
  if (ticket !== latest) return

  // Anything that isn't one of these pages (an error, a redirect elsewhere) is
  // a real navigation.
  if (!res.ok || !LIVE.has(new URL(res.url).pathname)) {
    location.href = res.url
    return
  }

  const next = new DOMParser().parseFromString(await res.text(), 'text/html')
  if (ticket !== latest) return
  const question = next.querySelector('section.q')
  const list = next.querySelector('.col .list')
  const data = next.getElementById('map-data')
  if (!question || !list || !data || !document.querySelector('section.q') || !document.querySelector('.col .list')) {
    location.href = res.url
    return
  }

  // Keep the focus on the control the visitor was using, across the swap.
  const active = document.activeElement
  const label = active?.closest?.('section.q') ? active.getAttribute('aria-label') : null
  const pins = JSON.parse(data.textContent)

  const swap = () => {
    document.querySelector('section.q').replaceWith(document.adoptNode(question))
    enhance(document.querySelector('section.q'))
    document.querySelector('.col .list').replaceWith(document.adoptNode(list))
    document.title = next.title
    document.getElementById('map-data').textContent = data.textContent
    col?.classList.remove('is-loading')
  }

  if (push) history.pushState({ live: true }, '', res.url)

  // The map glides on its own; it is told once the page has settled, so its
  // movement isn't hidden under the transition's still picture of it.
  const tellMap = () => document.dispatchEvent(new CustomEvent('find:pins', { detail: pins }))
  if (document.startViewTransition && !calm.matches) {
    const t = document.startViewTransition(swap)
    t.updateCallbackDone.then(() => refocus(label))
    t.finished.then(tellMap, tellMap)
  } else {
    swap()
    refocus(label)
    tellMap()
  }
}

/** The control the visitor was on, or the open line if there is one to type in. */
function refocus(label) {
  if (label) {
    document.querySelector(`section.q [aria-label="${CSS.escape(label)}"]`)?.focus()
    return
  }
  const line = document.getElementById('q')
  if (line) {
    line.focus({ preventScroll: true })
    line.setSelectionRange(line.value.length, line.value.length)
  }
}

/** The URL a form in the question would navigate to. */
function urlOf(form, submitter) {
  const url = new URL(form.action, location.href)
  url.search = new URLSearchParams(new FormData(form, submitter)).toString()
  return url.href
}

const inQuestion = el => el instanceof Element && el.closest('section.q')

// A menu choice or an unticked phrase searches at once.
document.addEventListener('change', e => {
  const t = e.target
  if (!inQuestion(t) || !t.matches('.q__f select, .q__f input[type="checkbox"]')) return
  go(urlOf(t.form))
})

// Enter in a typed slot, or the open line's own submit (home's included).
document.addEventListener('keydown', e => {
  const t = e.target
  if (e.key !== 'Enter' || !inQuestion(t) || !t.matches('.q__f input[type="text"]')) return
  e.preventDefault()
  go(urlOf(t.form))
})
document.addEventListener('submit', e => {
  if (!inQuestion(e.target) || e.target.method.toLowerCase() !== 'get') return
  e.preventDefault()
  go(urlOf(e.target, e.submitter))
})

// Any link to home or Find: the examples, the activities, the header, the way
// to the open line and back. A route's own page is a real navigation.
document.addEventListener('click', e => {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
  const a = e.target instanceof Element ? e.target.closest('a[href]') : null
  if (!a || a.target) return
  const url = new URL(a.href, location.href)
  if (url.origin !== location.origin || !LIVE.has(url.pathname)) return
  e.preventDefault()
  go(url.href)
})

// Typed slots grow with what is typed in them.
document.addEventListener('input', e => {
  const t = e.target
  if (inQuestion(t) && t.matches('input.slot--t')) t.size = Math.max(t.value.length, 3)
})

// The sentence's menus are drawn by the page (find-menus.js).
enhance(document.querySelector('section.q'))

// Back and forward move through the same steps, in place.
history.replaceState({ live: true }, '', location.href)
window.addEventListener('popstate', e => {
  if (e.state?.live && LIVE.has(location.pathname)) go(location.href, { push: false })
})
