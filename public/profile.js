// A route's elevation profile (src/render/profile-section.ts): the switch
// between the path's gradient and the ground's angle, recoloured in place, and
// the reading that follows a pointer or a finger along the curve. Without this
// script the profile stays as it was served, on the path's gradient.
for (const box of document.querySelectorAll('.pf')) {
  const samples = JSON.parse(box.dataset.samples || '[]')
  if (samples.length < 2) continue
  const L = samples[samples.length - 1][0]
  const top = Number(box.dataset.top), bottom = Number(box.dataset.bottom)
  const plot = box.querySelector('.pf__plot')
  const hair = box.querySelector('.pf__hair'), dot = box.querySelector('.pf__dot'), tip = box.querySelector('.pf__tip')
  const km = m => (m / 1000).toFixed(1).replace('.', ',')

  const sw = box.querySelector('.pf__sw')
  sw.hidden = false
  sw.addEventListener('click', ev => {
    const b = ev.target.closest('button')
    if (!b) return
    box.dataset.k = b.dataset.k
    for (const x of sw.querySelectorAll('button')) x.setAttribute('aria-pressed', String(x === b))
  })

  const nearest = d => {
    let lo = 0, hi = samples.length - 1
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (samples[mid][0] < d) lo = mid; else hi = mid }
    return d - samples[lo][0] < samples[hi][0] - d ? samples[lo] : samples[hi]
  }
  const show = clientX => {
    const r = plot.getBoundingClientRect()
    const d = Math.max(0, Math.min(L, (clientX - r.left) / r.width * L))
    const [at, e, s, g] = nearest(d)
    const x = at / L * 100, y = (top - e) / (top - bottom) * 100
    hair.hidden = dot.hidden = tip.hidden = false
    hair.style.left = dot.style.left = x + '%'
    dot.style.top = y + '%'
    tip.innerHTML = `km ${km(at)} · <b>${e} m</b> · percorso <b>${Math.abs(g)}%</b> · pendio <b>${s}°</b>`
    const w = tip.offsetWidth
    tip.style.left = Math.max(0, Math.min(r.width - w, x / 100 * r.width - w / 2)) + 'px'
  }
  const hide = () => { hair.hidden = dot.hidden = tip.hidden = true }
  plot.addEventListener('pointermove', ev => show(ev.clientX))
  plot.addEventListener('pointerdown', ev => show(ev.clientX))
  plot.addEventListener('pointerleave', hide)

  // The curve draws itself from left to right the first time it comes into view.
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches && 'IntersectionObserver' in window) {
    box.classList.add('pf--hold')
    const io = new IntersectionObserver(entries => {
      if (!entries.some(e => e.isIntersecting)) return
      box.classList.replace('pf--hold', 'pf--in')
      io.disconnect()
    }, { threshold: 0.3 })
    io.observe(box)
  }
}
