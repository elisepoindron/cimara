// The relazione sheet's running count, "120 / 4000", in its foot. Written in
// by this script rather than into the page, so without it nothing on screen
// promises a count that never moves. The cap itself is the textarea's own
// `maxlength`, and the server's.
document.querySelectorAll('textarea[data-count]').forEach(area => {
  const out = document.getElementById(area.dataset.count)
  const max = area.maxLength
  if (!out || max <= 0) return
  const show = () => {
    const n = area.value.length
    out.textContent = `${n} / ${max}`
    out.classList.toggle('is-near', n > max * 0.9)
  }
  out.hidden = false
  area.addEventListener('input', show)
  show()
})
