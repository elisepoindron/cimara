import { sportGradeBand } from '../domain/quantity.ts'
import { html, raw, type Html } from './html.ts'

/**
 * The attribute that puts a grade mark (a chart bar, a histogram bar, a grade label) on the
 * difficulty scale: ` data-grade="6"`, or nothing for a grade with no band. app.css
 * colours by it. The value is one of seven digits the domain chose, never the stored text,
 * which is why it can be raw.
 */
export function gradeBandAttr(grade: string): Html {
  const band = sportGradeBand(grade)
  return band === null ? html`` : raw(` data-grade="${band}"`)
}
