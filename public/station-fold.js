// The weather stations under Adesso, folded: a details element the browser
// already opens and closes. This only makes it move — the list grows down to
// its height and shrinks back, rather than appearing at once. Without it, or
// with reduced motion asked for, the browser's own toggle stands.
// See stationsFold in src/render/conditions-slot.ts.
(() => {
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches

  for (const fold of document.querySelectorAll('details.stz')) {
    const summary = fold.querySelector('summary')
    const body = fold.querySelector('.stz__body')
    if (!summary || !body || fold.dataset.wired) continue
    fold.dataset.wired = '1'

    // Ends an animation at rest: no fixed height, so the list reflows with the window.
    const settle = () => { body.style.height = '' }
    // On transitionend, or a beat after it should have come: a browser that
    // skips the transition (a hidden tab) must still leave the fold open or shut.
    const after = done => {
      let ended = false
      const end = () => { if (!ended) { ended = true; done() } }
      body.addEventListener('transitionend', end, { once: true })
      setTimeout(end, 450)
    }

    summary.addEventListener('click', event => {
      if (reduced()) return
      event.preventDefault()
      const opening = !fold.open

      if (opening) {
        fold.open = true
        const to = body.getBoundingClientRect().height
        body.style.height = '0px'
        body.getBoundingClientRect() // commit the start height before moving
        body.style.height = `${to}px`
        after(settle)
      } else {
        body.style.height = `${body.getBoundingClientRect().height}px`
        body.getBoundingClientRect()
        body.style.height = '0px'
        after(() => { fold.open = false; settle() })
      }
      fold.classList.toggle('is-open', opening)
    })
  }
})()
