import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Brand } from '../render/site.ts'
import { PRIVATE_NAME } from '../import/osm/never-named.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..', '..')

/** The data set a deploy loads when `SEED_SET` names none: the demo's. */
export const DEFAULT_SET = 'demo'

type Env = Readonly<Record<string, string | undefined>>

/** The data set this process presents: the one `SEED_SET` names, or the default. */
export function currentSet(env: Env = process.env): string {
  return env.SEED_SET || DEFAULT_SET
}

/**
 * The set a public demonstration (`PUBLIC_DEMO=1`) presents: any but the
 * private archive's, which holds real people's accounts and reports and must
 * never be opened to all. Refuses it by name, before anything listens.
 */
export function publicDemoSet(env: Env = process.env): string {
  const set = currentSet(env)
  if (set.toLowerCase() === PRIVATE_NAME) {
    throw new Error('PUBLIC_DEMO=1 never presents the private archive: SEED_SET must name the public data set')
  }
  return set
}

/**
 * The database a process opens when `DATABASE_FILE` names none: one file per
 * data set, `<set>.db` in the working directory. The default set opens the
 * file it always has, and a set named by `SEED_SET` never falls into it.
 */
export function databaseFile(env: Env = process.env): string {
  return env.DATABASE_FILE ?? `${currentSet(env)}.db`
}

/**
 * A data set's brand: the name, the mark, the contact address and the words
 * Info says about the site, read from `sets/<set>/brand/brand.json`. The
 * brand belongs to the archive it presents, not to the code, so a deploy's
 * name is chosen with its data (`SEED_SET`). A folder of its own, so the seed,
 * which reads every `.json` of a set, never takes it for routes.
 *
 * Read synchronously: it is read once, before the first page is drawn, and a
 * set whose brand is missing or incomplete stops the start by name.
 */
export function loadBrand(set: string): Brand {
  if (!/^[a-z0-9_-]+$/.test(set)) throw new Error(`brand: no data set named ${JSON.stringify(set)}`)
  const file = join(HERE, 'sets', set, 'brand', 'brand.json')
  let raw: Record<string, unknown>
  try {
    raw = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
  } catch (err) {
    throw new Error(`brand: cannot read ${file}: ${(err as Error).message}`)
  }
  const need = (k: string) => {
    if (raw[k] === undefined) throw new Error(`brand: ${file} has no ${k}`)
    return raw[k]
  }
  const mark = need('mark') as Record<string, string>
  for (const k of ['svg', 'png32', 'png180']) {
    if (typeof mark[k] !== 'string') throw new Error(`brand: ${file} has no mark.${k}`)
  }
  const prose = (k: string) => {
    const p = need(k) as { line?: unknown; paragraphs?: unknown }
    if (typeof p.line !== 'string' || !Array.isArray(p.paragraphs) || !p.paragraphs.every(x => typeof x === 'string'))
      throw new Error(`brand: ${file} has no ${k}.line and ${k}.paragraphs`)
    return { line: p.line, paragraphs: p.paragraphs as string[] }
  }
  return {
    name: need('name') as string,
    group: need('group') as string,
    // The files, as absolute paths: the server serves them at neutral addresses.
    mark: { svg: join(ROOT, mark.svg!), png32: join(ROOT, mark.png32!), png180: join(ROOT, mark.png180!) },
    contact: typeof raw.contact === 'string' ? raw.contact : null,
    about: prose('about'),
    privacy: prose('privacy'),
    legacyCookiePrefix: typeof raw.legacyCookiePrefix === 'string' ? raw.legacyCookiePrefix : null,
  }
}
