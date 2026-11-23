// Keyboard shortcuts for the photo viewer: Esc closes, the arrow keys step
// to the neighbouring photo. The viewer itself is plain :target CSS and
// already works with none of this — clicking through is never blocked if
// this script fails to load. See src/render/photos-page.ts.
document.addEventListener('keydown', (e) => {
  const open = document.querySelector('.lb:target')
  if (!open) return

  const target = e.key === 'Escape' ? '.lb__close'
    : e.key === 'ArrowLeft' ? '.lb__prev'
    : e.key === 'ArrowRight' ? '.lb__next'
    : null
  if (!target) return

  e.preventDefault()
  open.querySelector(target)?.click()
})
