import type { ActivitySchema } from '../registry.ts'
import { alpinismo } from './alpinismo.ts'
import { altro } from './altro.ts'
import { bicicletta } from './bicicletta.ts'
import { bouldering } from './bouldering.ts'
import { canoa } from './canoa.ts'
import { canyoning } from './canyoning.ts'
import { cascateGhiaccio } from './cascate_ghiaccio.ts'
import { ciaspole } from './ciaspole.ts'
import { escursionismo } from './escursionismo.ts'
import { falesia } from './falesia.ts'
import { fondo } from './fondo.ts'
import { freeride } from './freeride.ts'
import { mountainBike } from './mountain_bike.ts'
import { multipitch } from './multipitch.ts'
import { sciAlpinismo } from './sci_alpinismo.ts'
import { sciRipido } from './sci_ripido.ts'
import { trailRunning } from './trail_running.ts'
import { viaFerrata } from './via_ferrata.ts'
import { voloLibero } from './volo_libero.ts'

export class UnknownActivity extends Error {}

/**
 * Every activity the system knows — the source archive's nineteen, in the families its
 * own list groups them in: snow and ice, rock, land, water, air, and the rest,
 * which has no name of its own. Find's activity menu shows them so.
 * Adding one is adding a file and a line here.
 */
export const ACTIVITY_FAMILIES: readonly { readonly label: { readonly it: string } | null; readonly members: readonly ActivitySchema[] }[] = [
  { label: { it: 'Neve e ghiaccio' }, members: [sciAlpinismo, ciaspole, sciRipido, freeride, fondo, cascateGhiaccio] },
  { label: { it: 'Roccia' }, members: [multipitch, alpinismo, bouldering, viaFerrata, falesia] },
  { label: { it: 'Terra' }, members: [escursionismo, trailRunning, bicicletta, mountainBike] },
  { label: { it: 'Acqua' }, members: [canyoning, canoa] },
  { label: { it: 'Aria' }, members: [voloLibero] },
  { label: null, members: [altro] },
]

/** The same nineteen by id, in the families' order. */
export const ACTIVITIES: Record<string, ActivitySchema> = Object.fromEntries(
  ACTIVITY_FAMILIES.flatMap(f => f.members).map(a => [a.id, a]))

export function activityOf(id: string): ActivitySchema {
  const schema = ACTIVITIES[id]
  if (!schema) {
    throw new UnknownActivity(`no registry file declares the activity "${id}"`)
  }
  return schema
}
