// The open line's grey example, turning. The server writes the field with its
// first example as a plain placeholder and the whole list in data-examples;
// this swaps the placeholder for an overlay and brings each next sentence in
// word by word ("Parole"), every few seconds. Typing hides it, emptying the
// field brings it back. find-live.js swaps the question in place, so each tick
// looks the line up again rather than holding on to one.

const EVERY = 3500
const calm = matchMedia('(prefers-reduced-motion: reduce)')

let at = 0

/** The overlay for this line, built the first time it is seen. */
function overlay(line) {
  let ph = line.querySelector('.q__ph')
  if (ph) return ph
  const input = line.querySelector('input')
  const examples = JSON.parse(line.dataset.examples || '[]')
  if (!input || examples.length === 0) return null
  ph = document.createElement('span')
  ph.className = 'q__ph'
  ph.setAttribute('aria-hidden', 'true')
  ph.append(sentence(examples[at % examples.length], false))
  input.placeholder = ''
  line.append(ph)
  line.classList.toggle('has-text', input.value !== '')
  return ph
}

/** One sentence, its words wrapped so they can rise one after another. */
function sentence(text, rising) {
  const s = document.createElement('span')
  s.className = rising ? 'q__ex-in' : 'q__ex-on'
  text.split(' ').forEach((word, k) => {
    if (k > 0) s.append(' ')
    const w = document.createElement('i')
    w.textContent = word
    w.style.transitionDelay = `${k * 45}ms`
    s.append(w)
  })
  return s
}

function tick() {
  // A hidden tab still runs the interval but holds back animation frames, so
  // sentences queued there would all arrive at once on return, on top of each
  // other. Nothing turns while nobody is looking.
  if (document.hidden) return
  const line = document.querySelector('.q__line[data-examples]')
  if (!line) return
  const ph = overlay(line)
  if (!ph) return
  const examples = JSON.parse(line.dataset.examples)
  at = (at + 1) % examples.length

  // Only one sentence is ever on the line: whatever an earlier turn left
  // half-done (still rising, still leaving) goes now, not when its timer says.
  ph.querySelectorAll('.q__ex-in, .q__ex-out').forEach(s => s.remove())
  const old = [...ph.querySelectorAll('.q__ex-on')]
  const next = sentence(examples[at], !calm.matches && !line.classList.contains('has-text'))
  if (next.className === 'q__ex-on') {
    old.forEach(s => s.remove())
    ph.append(next)
    return
  }
  ph.append(next)
  next.offsetWidth // let the words start below before they rise
  requestAnimationFrame(() => {
    if (!next.isConnected) return
    next.className = 'q__ex-on'
    old.forEach(s => {
      s.className = 'q__ex-out'
      setTimeout(() => s.remove(), 600)
    })
  })
}

document.addEventListener('input', e => {
  const line = e.target instanceof Element ? e.target.closest('.q__line[data-examples]') : null
  if (line) line.classList.toggle('has-text', e.target.value !== '')
})

// The line on the page now, and any find-live.js swaps in later.
const dress = () => {
  const line = document.querySelector('.q__line[data-examples]')
  if (line) overlay(line)
}
dress()
new MutationObserver(dress).observe(document.body, { childList: true, subtree: true })
setInterval(tick, EVERY)
