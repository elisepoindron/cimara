import type { SectionDef } from '../domain/registry.ts'
import { html, join, type Html } from './html.ts'

const blank = (text: string | undefined): boolean => !text || text.trim() === ''

/** Plain text as blocks: a blank line starts a paragraph, "## " a subheading. */
function blocks(text: string): Html[] {
  return text.trim().split(/\n\s*\n/).map(block => {
    const line = block.trim()
    return line.startsWith('## ')
      ? html`<h3>${line.slice(3).trim()}</h3>`
      : html`<p>${line}</p>`
  })
}

/**
 * A section of authored text. Contributors write plain text, so exactly two
 * conventions are honoured — a blank line starts a paragraph, and a line opening
 * with "## " is a subheading. Everything else is escaped.
 *
 * `runInTexts` holds the section's run-ins (see `SectionDef.runIns`) by id:
 * each one's paragraphs follow the section's own, in the declared order, the
 * first opening on that run-in's label. Any one text is enough to draw the
 * section; none, and there is none. A text for an id the section does not
 * declare is ignored. A section with a `lead` and no words of its own draws
 * that run-in's words as its body, unlabelled.
 */
export function proseSection(
  def: SectionDef, text: string | undefined,
  runInTexts: Readonly<Record<string, string | undefined>> = {},
): Html | null {
  // With no words of its own, the section's lead run-in is its body.
  const lead = blank(text) && def.lead !== undefined && !blank(runInTexts[def.lead]) ? def.lead : undefined
  const own = lead === undefined ? text : runInTexts[lead]
  const runIn = (def.runIns ?? []).filter(r => r.id !== lead).flatMap(r => {
    const t = runInTexts[r.id]
    return blank(t) ? [] : (t as string).trim().split(/\n\s*\n/).map((block, i) => i === 0
      ? html`<p class="runin"><span class="lab">${r.label.it}</span>${block.trim()}</p>`
      : html`<p class="runin">${block.trim()}</p>`)
  })
  if (blank(own) && runIn.length === 0) return null

  const body = join([...(blank(own) ? [] : blocks(own as string)), ...runIn], '\n        ')
  return html`<section id="${def.id}">
        <h2>${def.label.it}</h2>
        ${body}
      </section>`
}
