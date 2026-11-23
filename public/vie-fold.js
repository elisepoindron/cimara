// A crag's long list of vie, folded: the first rows show and fade into the
// paper, and one link opens the rest in place, the list growing down to its
// full height. "Mostra meno" folds it back. The section was already marked
// folded by an inline line while the page was parsed (so the full list is
// never painted first); this only wires the link. Without it the list reads
// in full and the link stays hidden. See src/render/itinerary-page.ts.
(() => {
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches

  for (const section of document.querySelectorAll('.vie-fold.is-folded')) {
    const body = section.querySelector('.vie-fold__body')
    const toggle = section.querySelector('.vie-fold__toggle')
    if (!body || !toggle || toggle.dataset.wired) continue
    toggle.dataset.wired = '1'

    // Ends an animation at its resting state: open has no fixed height, so
    // the list still reflows with the window; folded falls back to the CSS.
    const settle = () => { body.style.height = '' }

    toggle.addEventListener('click', () => {
      const opening = section.classList.contains('is-folded')
      const from = body.getBoundingClientRect().height

      section.classList.toggle('is-folded', !opening)
      section.classList.toggle('is-open', opening)
      toggle.setAttribute('aria-expanded', String(opening))
      toggle.textContent = opening ? toggle.dataset.less : toggle.dataset.more

      if (!opening) {
        // Folding a list read to its end: bring its heading back into view
        // rather than leaving the reader stranded far below it.
        const top = section.getBoundingClientRect().top
        if (top < 0) section.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'start' })
      }
      if (reduced()) return settle()

      body.style.height = ''
      const to = body.getBoundingClientRect().height
      body.style.height = `${from}px`
      body.getBoundingClientRect() // commit the start height before moving
      body.style.height = `${to}px`
      body.addEventListener('transitionend', settle, { once: true })
    })
  }
})()
