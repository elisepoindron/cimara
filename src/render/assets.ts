import { html, raw, type Html } from './html.ts'

/**
 * The address of every stylesheet and script the pages load, carrying a hash
 * of the file's bytes: `/map-core.js?v=3kQ…`. A deploy that changes a file
 * changes its address, so the server can tell a browser to keep the file for
 * good (`immutable`, in serveFile) and the browser never asks again.
 *
 * That is the point. With the bare names every file had to be asked for again
 * on every page — a dozen round trips, three of them holding the first paint
 * (the stylesheet, MapLibre's, page-motion.js) — which on a phone, through
 * Cloudflare Access, is most of the wait between tapping a link and seeing the
 * page, and the cross-document view transition holds the old page frozen for
 * all of it.
 *
 * Set once by the server from the files on disk. Unset, as in a render test,
 * every address is the bare name and there is no import map.
 */
let versions: ReadonlyMap<string, string> = new Map()

/** Called once by the server: each servable path, with a hash of its bytes. */
export function versionAssets(hashes: ReadonlyMap<string, string>): void {
  versions = hashes
}

/** A file's address, with its version when the server gave one. */
export function asset(path: string): string {
  const v = versions.get(path)
  return v ? `${path}?v=${v}` : path
}

/**
 * Modules import each other by bare path (`import … from '/map-core.js'`,
 * MapLibre's `./maplibre-gl-shared.mjs`), which `asset()` never sees. The
 * import map sends those imports to the versioned addresses too, so a module
 * loaded twice is one file, kept once. It has to come before the first module
 * script in the page, or the browser ignores it.
 */
export function importMap(): Html {
  const imports: Record<string, string> = {}
  for (const path of versions.keys()) {
    if (/\.m?js$/.test(path)) imports[path] = asset(path)
  }
  if (Object.keys(imports).length === 0) return html``
  // Paths and base64url hashes only: nothing here can close the element, and
  // a script's text is never entity-decoded, so `html`'s escaping would break it.
  return raw(`<script type="importmap">${JSON.stringify({ imports })}</script>`)
}
