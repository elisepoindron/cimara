// Module-private, so only this file can produce a value that satisfies `Html`.
// Without this, `Html` was detected structurally (`'html' in value`), and any
// plain object carrying an `html` property — e.g. `{"html": "<script>..."}`
// parsed out of a StoredFacts JSON column — would be treated as pre-escaped,
// trusted markup and emitted verbatim. The brand makes that shape unforgeable
// from outside this module: "did I escape this?" is answered by the type,
// not by whether an object happens to look right.
const BRAND = Symbol('html')

/**
 * A string already known to be safe markup. Every renderer returns one of these,
 * so "did I escape this?" is answered by the type rather than by reading.
 */
export interface Html {
  readonly html: string
  readonly [BRAND]: true
}

const ESCAPES: Record<string, string> = {
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}

export function escape(value: string): string {
  return value.replace(/[&<>"']/g, c => ESCAPES[c]!)
}

function mark(markup: string): Html {
  return { html: markup, [BRAND]: true }
}

/** The deliberate escape hatch. Rare, and visible at the call site. */
export function raw(markup: string): Html {
  return mark(markup)
}

export function render(node: Html): string {
  return node.html
}

function interpolate(value: unknown): string {
  if (value === null || value === undefined || value === false) return ''
  if (typeof value === 'object' && value !== null && BRAND in value) {
    return (value as Html).html
  }
  if (Array.isArray(value)) return value.map(interpolate).join('')
  if (typeof value === 'number') return String(value)
  return escape(String(value))
}

export function html(strings: TemplateStringsArray, ...values: unknown[]): Html {
  let out = strings[0] ?? ''
  for (let i = 0; i < values.length; i++) {
    out += interpolate(values[i]) + (strings[i + 1] ?? '')
  }
  return mark(out)
}

export function join(items: readonly Html[], separator = ''): Html {
  return mark(items.map(i => i.html).join(separator))
}

/** Build one node from several. Never use `+` on Html — the type exists to stop that. */
export function concat(...parts: Html[]): Html {
  return mark(parts.map(pt => pt.html).join(''))
}
