import type { OsmRow } from './source.ts'
import { translateOsm, type OsmVocabulary } from './translate.ts'

/** Same name, same activity, this close: one place mapped in pieces, not two places. */
const ONE_PLACE_KM = 10

function km(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const r = (x: number) => x * Math.PI / 180
  const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lon - a.lon) / 2) ** 2
  return 12742 * Math.asin(Math.sqrt(h))
}

interface Member { readonly row: OsmRow; readonly name: string; readonly comune: string; readonly lat: number; readonly lon: number }

/**
 * OpenStreetMap names two different places alike (a `Cascata` at Baceno and another at Omegna) and
 * cuts one long route into stages that all carry its name. The archive keys a page by its name, so
 * a name held by two places is told apart, only by what OpenStreetMap itself says:
 *
 *   - stages of a route, where every one has `from` and `to`: `SICAI Ciclo: Garessio – Viozene`;
 *   - otherwise the comune, in brackets: `Cascata (Baceno)`.
 *
 * Pieces of one place (the same name within ten km) are not told apart: they stay one name, for
 * the tiers to keep once. A name held by one place, or by one cluster of pieces, is left alone.
 * Nothing is invented: a name that cannot be told apart this way stays as it is, and the build
 * and the checker refuse it.
 */
export function tellNamesApart(rows: readonly OsmRow[], known: OsmVocabulary): OsmRow[] {
  const byName = new Map<string, Member[]>()
  for (const row of rows) {
    const t = translateOsm(row, known)
    if (!t.ok || t.place.nameFrom !== 'name') continue
    const m = { row, name: t.place.name, comune: t.place.comune, lat: t.place.lat, lon: t.place.lon }
    const list = byName.get(m.name)
    if (list) list.push(m); else byName.set(m.name, [m])
  }
  const renamed = new Map<string, string>()
  for (const [name, members] of byName) {
    if (members.length < 2) continue
    // Pieces within ten km of one another are one place.
    const cluster: number[] = members.map((_, i) => i)
    const find = (i: number): number => cluster[i] === i ? i : (cluster[i] = find(cluster[i]!))
    members.forEach((a, i) => members.forEach((b, j) => {
      if (j > i && km(a, b) < ONE_PLACE_KM) cluster[find(j)] = find(i)
    }))
    const clusters = new Map<number, Member[]>()
    members.forEach((m, i) => { const c = find(i); clusters.set(c, [...(clusters.get(c) ?? []), m]) })
    if (clusters.size < 2) continue

    const ends = (m: Member) => `${name}: ${m.row.tags.from?.trim()} – ${m.row.tags.to?.trim()}`
    const stages = members.every(m => m.row.tags.from?.trim() && m.row.tags.to?.trim())
    for (const group of clusters.values()) {
      // One label for the cluster: its first comune by name.
      const comune = group.map(m => m.comune).sort((a, b) => a.localeCompare(b, 'it'))[0]
      for (const m of group) {
        // A stage between two long crossroads is told by its comune instead.
        renamed.set(m.row.osm, stages && ends(m).length <= 80 ? ends(m) : `${name} (${stages ? m.comune : comune})`)
      }
    }
  }
  return rows.map(r => renamed.has(r.osm) ? { ...r, tags: { ...r.tags, name: renamed.get(r.osm)! } } : r)
}
