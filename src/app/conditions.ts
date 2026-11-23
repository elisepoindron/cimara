/**
 * How near is nearby, for the page's own section of routes around this one.
 * "Tre itinerari sulla stessa esposizione entro 5 km" was the design's own
 * phrase when these numbers first served the grading engine; the engine is
 * gone
 * and the section keeps them.
 */
export const NEIGHBOUR_RADIUS_M = 5_000
export const ALT_TOLERANCE_M = 400

/**
 * How far the page's own map looks for the other routes of the same activity
 * it draws as pins: every one of them, whatever its aspect or altitude, since
 * the map shows what is around, not what is alike. Much wider than the
 * section's radius: the map never moves on its own to show them, so they are
 * there for whoever pans a few valleys over, and a neighbour that vanishes
 * at an arbitrary edge reads as the end of the archive.
 */
export const MAP_NEIGHBOUR_RADIUS_M = 40_000
