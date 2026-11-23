// The "Mostra" control on the account pages' password fields. Added here
// rather than written into the page, so that without this script the field is
// a plain password field and nothing on screen promises what cannot happen.
document.querySelectorAll('.pw').forEach(wrap => {
  const input = wrap.querySelector('input')
  if (!input) return
  const button = document.createElement('button')
  button.type = 'button'
  button.textContent = 'Mostra'
  button.setAttribute('aria-pressed', 'false')
  button.setAttribute('aria-controls', input.id)
  button.addEventListener('click', () => {
    const show = input.type === 'password'
    input.type = show ? 'text' : 'password'
    button.textContent = show ? 'Nascondi' : 'Mostra'
    button.setAttribute('aria-pressed', String(show))
    input.focus()
  })
  wrap.append(button)
})
