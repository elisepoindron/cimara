import type { Part } from '../domain/facts.ts'

/**
 * Whether a stored group name is really a group. A blank or whitespace-only
 * string is not — it means "no sector" the same way `null` does, and must not
 * bucket a via under a heading that reads `Settore , N vie`.
 */
function isGroup(group: string | null): group is string {
  return group !== null && group.trim() !== ''
}

/**
 * Distinct group names, in the order the parts first mention them — the single
 * definition of "grouped" that the vie list (`partsList`) reads off, so it
 * never disagrees with itself about a blank group.
 */
export function groupsOf(parts: readonly Part[]): string[] {
  const seen: string[] = []
  for (const p of parts) if (isGroup(p.group) && !seen.includes(p.group)) seen.push(p.group)
  return seen
}

/** Parts split into ungrouped (blank and whitespace-only groups included) and grouped. */
export function partitionByGroup(
  parts: readonly Part[],
): { ungrouped: Part[]; grouped: Part[] } {
  return {
    ungrouped: parts.filter(p => !isGroup(p.group)),
    grouped: parts.filter(p => isGroup(p.group)),
  }
}
