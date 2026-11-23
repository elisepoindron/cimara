/**
 * Find's sentence as a visitor reads it: each menu as its chosen option, each
 * typed slot as its value, a ticked phrase as its words. Whitespace folded.
 */
export function sentenceOf(doc: Document): string {
  const s = doc.querySelector('.q__s')
  if (!s) return ''
  const walk = (n: Node): string => {
    if (n.nodeType === 3) return n.textContent ?? ''
    if (n.nodeType !== 1) return ''
    const el = n as Element
    const tag = el.tagName.toLowerCase()
    if (tag === 'select') {
      return (el.querySelector('option[selected]') ?? el.querySelector('option'))?.textContent ?? ''
    }
    if (tag === 'input') return el.getAttribute('type') === 'checkbox' ? '' : el.getAttribute('value') ?? ''
    if (el.classList.contains('x')) return ''
    return [...el.childNodes].map(walk).join('')
  }
  return walk(s).replace(/\s+/gu, ' ').trim()
}

/**
 * The line the sentence's form would post back: every `p` field in the
 * sentence, as it would be typed, in order.
 */
export function piecesOf(doc: Document): string[] {
  return [...doc.querySelectorAll('.q__s [name="p"]')].map(el => {
    if (el.tagName.toLowerCase() === 'select') {
      return (el.querySelector('option[selected]') ?? el.querySelector('option'))?.getAttribute('value') ?? ''
    }
    return el.getAttribute('value') ?? ''
  })
}
