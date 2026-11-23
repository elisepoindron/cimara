/**
 * The guard: nothing in this repository names the private archive
 * (src/import/osm/never-named.ts), and every commit is authored with a GitHub
 * noreply address, never a personal one.
 *
 *   node scripts/guard/check.ts --message <file>   the commit-msg hook
 *   node scripts/guard/check.ts --staged           the pre-commit hook: staged paths and bytes, and the author
 *   node scripts/guard/check.ts --tree [dir]       every file of a checkout, by path and by bytes (CI, npm run guard)
 *   node scripts/guard/check.ts --history          every commit's message, author and committer (CI)
 *
 * A hook can be skipped with --no-verify; CI runs --tree and --history on every
 * push, so a skipped hook is still caught before anything is merged.
 *
 * Exits 1 naming every hit, 0 when there is none.
 */
import { execFileSync } from 'node:child_process'
import { readdir, readFile } from 'node:fs/promises'
import { join, relative, resolve, sep } from 'node:path'
import { NEVER_NAMED } from '../../src/import/osm/never-named.ts'

/** Folders a tree scan never enters: git's own and what npm installs. */
const SKIPPED = new Set(['.git', 'node_modules'])

/** The addresses a commit may carry: a user's GitHub noreply address, or GitHub's own (web merges). */
const NOREPLY = /(^|[.+@])users\.noreply\.github\.com$|^noreply@github\.com$/i

/** Bytes as text, one byte to one character, so a name inside a binary file is found too. */
const asText = (bytes: Buffer) => bytes.toString('latin1')

export function names(text: string): boolean {
  return NEVER_NAMED.test(text)
}

export function isNoreply(email: string): boolean {
  return NOREPLY.test(email.trim())
}

/** Every file under `dir` whose path or bytes name the private archive, as paths relative to it. */
export async function scanTree(dir: string): Promise<string[]> {
  const root = resolve(dir)
  const hits: string[] = []
  const walk = async (folder: string): Promise<void> => {
    for (const e of await readdir(folder, { withFileTypes: true })) {
      if (SKIPPED.has(e.name)) continue
      const path = join(folder, e.name)
      const rel = relative(root, path).split(sep).join('/')
      if (names(rel)) hits.push(`${rel}: in its path`)
      if (e.isDirectory()) await walk(path)
      else if (e.isFile() && names(asText(await readFile(path)))) hits.push(`${rel}: in its content`)
    }
  }
  await walk(root)
  return hits
}

const git = (args: string[]): Buffer => execFileSync('git', args, { maxBuffer: 1 << 30 })

function stagedHits(): string[] {
  const hits: string[] = []
  const paths = git(['diff', '--cached', '--name-only', '-z', '--diff-filter=ACMR']).toString('utf8').split('\0').filter(Boolean)
  for (const p of paths) {
    if (names(p)) hits.push(`${p}: in its path`)
    if (names(asText(git(['show', `:${p}`])))) hits.push(`${p}: in its staged content`)
  }
  const ident = git(['var', 'GIT_AUTHOR_IDENT']).toString('utf8')
  const email = /<([^>]*)>/.exec(ident)?.[1] ?? ''
  if (!isNoreply(email)) hits.push(`author address ${email || '(none)'}: not a GitHub noreply address (git config user.email <id>+<login>@users.noreply.github.com)`)
  if (names(ident)) hits.push('author name: names the private archive')
  return hits
}

function historyHits(): string[] {
  const hits: string[] = []
  const log = git(['log', '--all', '--format=%H%x00%an%x00%ae%x00%cn%x00%ce%x00%B%x1e']).toString('utf8')
  for (const entry of log.split('\x1e')) {
    const [hash, an, ae, cn, ce, body] = entry.replace(/^\n/, '').split('\0')
    if (!hash) continue
    const at = hash.slice(0, 10)
    if (names([an, ae, cn, ce, body].join('\n'))) hits.push(`${at}: its message or its people name the private archive`)
    if (!isNoreply(ae ?? '')) hits.push(`${at}: authored with ${ae}, not a GitHub noreply address`)
    if (!isNoreply(ce ?? '')) hits.push(`${at}: committed with ${ce}, not a GitHub noreply address`)
  }
  return hits
}

async function main(argv: string[]): Promise<number> {
  const [mode, arg] = argv
  let hits: string[]
  switch (mode) {
    case '--message': {
      if (!arg) throw new Error('--message needs the message file')
      hits = names(await readFile(arg, 'utf8')) ? ['the commit message names the private archive'] : []
      break
    }
    case '--staged': hits = stagedHits(); break
    case '--tree': hits = await scanTree(arg ?? process.cwd()); break
    case '--history': hits = historyHits(); break
    default:
      console.error('usage: check.ts --message <file> | --staged | --tree [dir] | --history')
      return 2
  }
  if (hits.length) {
    console.error(`Refused by the guard (scripts/guard/check.ts):\n  ${hits.join('\n  ')}`)
    return 1
  }
  return 0
}

if (import.meta.filename === process.argv[1]) process.exitCode = await main(process.argv.slice(2))
