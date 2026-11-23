// Motion between whole pages. app.css opts every page into the browser's
// cross-document view transitions. This file says which way a step goes, so
// the stylesheet can move it:
//   deeper     into a route's own page: the map card slides out to the right,
//              the list fades, and the page's blocks rise one after another
//              (the `page-rising` class, on the arriving page);
//   shallower  back out of a route's page: the page fades and the map slides
//              back in from the right as the list returns.
// Any other step keeps the plain cross-fade.
//
// While the whole page slides, the parts find-live.js animates on their own
// (the question and the list) are folded back into the page with the
// `page-moving` class, so they travel with it instead of fading in place.
//
// A classic script in the head on purpose: `pagereveal` fires before the first
// paint, so its listener has to exist before the body is parsed. Browsers
// without these events simply navigate as before.
(() => {
  const ROUTE = /^\/itinerario\/[^/]+\/?$/
  const root = document.documentElement
  const isRoute = url => ROUTE.test(new URL(url, location.href).pathname)

  // The first page of a visit, when it is home: the layout waits while the
  // ground is surveyed in under the site's name (ground-motion.js runs it).
  // Decided here, before the first paint, so the page never shows and then
  // vanishes. `/?intro` replays it, for whoever is tuning it.
  try {
    const forced = new URLSearchParams(location.search).has('intro')
    const first = !sessionStorage.getItem('fondo.seen')
    if (location.pathname === '/' && (forced || first) &&
        !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      root.classList.add('intro')
      if (forced) sessionStorage.removeItem('fondo.seen')
      // whatever happens to the module that runs it, the page comes back
      setTimeout(() => root.classList.remove('intro'), 7000)
    }
  } catch {}

  // Leaving: the outgoing picture is one piece.
  addEventListener('pageswap', e => {
    if (e.viewTransition) root.classList.add('page-moving')
  })

  // Arriving: name the direction, and keep the page one piece until it lands.
  addEventListener('pagereveal', e => {
    const t = e.viewTransition
    if (!t) {
      root.classList.remove('page-moving')
      return
    }
    t.ready.catch(() => {})
    const from = globalThis.navigation?.activation?.from?.url
    if (from) {
      if (!isRoute(from) && isRoute(location.href)) {
        t.types.add('deeper')
        // kept on: the cascade outlasts the transition, and runs only once
        root.classList.add('page-rising')
      } else if (isRoute(from) && !isRoute(location.href)) t.types.add('shallower')
    }
    root.classList.add('page-moving')
    t.finished.finally(() => root.classList.remove('page-moving'))
  })
})()
