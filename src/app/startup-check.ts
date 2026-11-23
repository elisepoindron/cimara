import type { Db } from '../db/open.ts'
import { allItineraries, partsOf } from '../db/itinerary.ts'
import { activityOf, UnknownActivity } from '../domain/activities/index.ts'
import { resolveFacts, resolveAccessFacts, FactError } from '../domain/facts.ts'
import { storedProse } from '../domain/registry.ts'

export class RegistryMismatch extends Error {
  readonly problems: readonly string[]
  constructor(problems: readonly string[]) {
    super(`the store no longer matches the registry:\n  ${problems.join('\n  ')}`)
    this.problems = problems
  }
}

/**
 * Every stored row, checked against the registry file that claims to describe
 * it. Run at boot: a registry edit that orphans existing data should stop a
 * deploy, not quietly drop a figure from a page nobody looks at.
 */
export async function checkRegistryAgainstStore(db: Db): Promise<void> {
  const problems: string[] = []

  for (const it of await allItineraries(db)) {
    const where = `${it.name} (${it.id})`
    try {
      const schema = activityOf(it.activity)
      const parts = await partsOf(db, it.id)
      resolveFacts(schema, it.facts, parts)
      resolveAccessFacts(schema, it.facts, parts)

      // Keyed by id so a stored section can be told apart from one the registry
      // still declares but no longer as prose — "accesso" moved to furniture on
      // this branch, and a database seeded or imported before that move still
      // holds real prose under that id with none of the new access facts. Read
      // the value here, render nothing there: the boot check is where that gets
      // caught, loudly, rather than at render time where it just disappears.
      // A run-in (a crag's history inside its presentation) is stored under an
      // id of its own that no section declares; it is prose all the same.
      const declared = [...schema.document, ...schema.rail]
      const sections = new Map(declared.map(s => [s.id, s]))
      const runIns = storedProse(declared)
      for (const id of Object.keys(it.sections)) {
        const def = sections.get(id) ?? runIns.get(id)
        if (!def) problems.push(`${where}: prose for undeclared section "${id}"`)
        else if (def.kind !== 'prose') {
          problems.push(
            `${where}: prose stored for section "${id}", which the registry now declares `
            + `"${def.kind}", not prose`)
        }
      }
    } catch (err) {
      if (err instanceof UnknownActivity) problems.push(`${where}: ${err.message}`)
      else if (err instanceof FactError) {
        for (const p of err.problems) problems.push(`${where}: ${p}`)
      } else throw err
    }
  }

  if (problems.length) throw new RegistryMismatch(problems)
}
