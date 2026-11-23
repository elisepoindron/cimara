/**
 * What the terrain model says about a point: its height and, where five
 * heights were sampled, how steep the ground is and which way it faces.
 * Measured by the extract, judged by the translator.
 */
export interface Terrain {
  /** Metres, rounded, at the point itself. */
  readonly ele: number
  /** Degrees from horizontal, rounded. Only where neighbours were sampled. */
  readonly slope?: number
  /** Degrees clockwise from north that the slope faces down, rounded. */
  readonly facing?: number
}

/**
 * From the height at a point and at four neighbours `d` metres north, south,
 * east and west of it: the gradient, so its steepness and the way it faces.
 * The same arithmetic Phase 0 used (scripts/demo/phase0-select.ts).
 */
export function aspectOf([h, n, s, e, w]: readonly [number, number, number, number, number], d: number): Terrain {
  const dzdx = (e - w) / (2 * d), dzdy = (n - s) / (2 * d)
  const facing = (Math.atan2(-dzdx, -dzdy) * 180 / Math.PI + 360) % 360
  return {
    ele: Math.round(h),
    slope: Math.round(Math.atan(Math.hypot(dzdx, dzdy)) * 180 / Math.PI),
    facing: Math.round(facing) % 360,
  }
}
