import { currentSet, loadBrand } from '../seed/brand.ts'

/** Words Info says about the site: one line in the hub, the paragraphs on its page. */
export interface BrandProse {
  readonly line: string
  readonly paragraphs: readonly string[]
}

/**
 * What a deploy calls itself. Data, not code: each data set carries its own
 * (`src/seed/sets/<set>/brand/brand.json`), and nothing in the code names a site.
 */
export interface Brand {
  readonly name: string
  /** The Info group the site's own subjects sit under. */
  readonly group: string
  /** Files on disk, served at `/assets/logo/mark.svg`, `mark-32.png`, `mark-180.png`. */
  readonly mark: { readonly svg: string; readonly png32: string; readonly png180: string }
  /** Where a correction is sent. Absent, no page offers to send one. */
  readonly contact: string | null
  readonly about: BrandProse
  readonly privacy: BrandProse
  /**
   * The prefix the cookies were once named with, read as well as the plain
   * names so that renaming them signed nobody out. Absent, only the plain names.
   */
  readonly legacyCookiePrefix: string | null
}

export interface Site {
  readonly brand: Brand
  /**
   * The public demonstration (`PUBLIC_DEMO=1`): read-only, and every page
   * says that the places are real and the reports invented.
   */
  readonly demo: boolean
}

let current: Site | null = null

/**
 * The deploy every page is drawn for. Until the server says otherwise, the
 * brand of the data set `SEED_SET` names (by default the private archive's),
 * and not the demonstration.
 */
export function site(): Site {
  current ??= { brand: loadBrand(currentSet()), demo: false }
  return current
}

export const brand = (): Brand => site().brand

/** Set once at startup, or by a test that draws another deploy's pages. */
export function configureSite(change: { brand?: Brand; demo?: boolean }): void {
  current = { ...site(), ...change }
}
