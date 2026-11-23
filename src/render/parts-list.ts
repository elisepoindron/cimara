import type { ActivitySchema } from '../domain/registry.ts'
import { ABSENT, type Part } from '../domain/facts.ts'
import { plural } from '../domain/italian.ts'
import { gradeBandAttr } from './grade-band.ts'
import { groupsOf, partitionByGroup } from './groups.ts'
import { html, join, type Html } from './html.ts'

/**
 * A crag's vie, broken into sectors when parts carry a group; parts with no
 * group render first, in a single headingless block, ahead of any sector —
 * `group` is an independent nullable column per row, so a crag can genuinely
 * mix grouped and ungrouped vie, and an ungrouped one must never be bucketed
 * under a blank "Settore , N vie".
 *
 * This is falesia-specific, not a generic parts renderer: the row below is
 * fixed to nome, lunghezza, grado — the order crag.html renders — which is
 * not alpinismo's field order (numero, grado only). A route's tiri would
 * need the registry to declare field *roles* before a shared row shape makes
 * sense; that's a registry change for a later activity, not this function.
 */
export function partsList(schema: ActivitySchema, parts: readonly Part[]): Html | null {
  const def = schema.parts
  if (!def || parts.length === 0) return null

  const rows = (of: readonly Part[]) =>
    html`<div class="routes">${join(of.map(p => row(schema, p)), '')}</div>`

  if (!def.groupBy) return rows(parts)

  const { ungrouped, grouped } = partitionByGroup(parts)
  if (grouped.length === 0) return rows(parts)

  // Groups in the order they first appear, which is the order the crag is walked.
  const order = groupsOf(grouped)
  const byGroup = new Map<string, Part[]>()
  for (const p of grouped) {
    const key = p.group!
    byGroup.set(key, [...(byGroup.get(key) ?? []), p])
  }

  const headed = order.map(key => {
    const members = byGroup.get(key)!
    const count = plural(members.length, def.each.it, def.label.it.toLowerCase())
    return html`<h3>${def.groupBy!.it} ${key}, ${count}</h3>${rows(members)}`
  })

  const blocks = ungrouped.length > 0 ? [rows(ungrouped), ...headed] : headed

  return join(blocks, '\n        ')
}

/**
 * One row: name, length, grade. A field the schema doesn't declare is a
 * programming error — this renderer called on an activity whose parts don't
 * carry that field — so it throws, naming the activity and the field, rather
 * than silently rendering a blank cell. A field that *is* declared but whose
 * stored value fails to parse is bad data, not a schema mismatch, and still
 * degrades to an empty cell.
 */
function row(schema: ActivitySchema, part: Part): Html {
  const field = (id: string) => {
    const d = schema.parts?.fields.find(f => f.id === id)
    if (!d) {
      throw new Error(
        `${schema.id}: parts do not declare a field "${id}" — partsList's row is falesia-specific (nome, lunghezza, grado)`)
    }
    // An optional field nobody recorded is said as absent, as an absent fact is
    // in the strip; an empty cell would read as a rendering fault.
    const raw = part.fields[id]
    if (d.optional && (raw === undefined || raw === null)) return ABSENT
    try { return d.quantity.format(d.quantity.parse(raw) as never) }
    catch { return '' }
  }
  const grado = field('grado')
  const name = field('nome'), length = field('lunghezza')
  // a length nobody recorded is marked, so a phone can leave that column out
  return html`<div><span>${name}</span><b${length === ABSENT ? html` class="nil"` : html``}>${length}</b><em${gradeBandAttr(grado)}>${grado}</em></div>`
}
