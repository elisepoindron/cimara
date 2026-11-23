import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { publicDemoSet } from '../../src/seed/brand.ts'
import { PRIVATE_NAME } from '../../src/import/osm/never-named.ts'

const SERVER = fileURLToPath(new URL('../../src/app/server.ts', import.meta.url))

test('a public demonstration presents any set but the private archive', () => {
  assert.equal(publicDemoSet({ SEED_SET: 'demo' }), 'demo')
  assert.equal(publicDemoSet({}), 'demo', 'the default set is the demo’s')
  assert.throws(() => publicDemoSet({ SEED_SET: PRIVATE_NAME }), /never presents the private archive/)
  assert.throws(() => publicDemoSet({ SEED_SET: PRIVATE_NAME.toUpperCase() }), /never presents the private archive/)
})

/** Starts the server as Dockerfile.demo does; resolves with its output once it listens or exits. */
async function start(env: Record<string, string>): Promise<{ listened: boolean; code: number | null; out: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'demo-start-'))
  const { DATABASE_FILE: _d, SEED_SET: _s, PUBLIC_DEMO: _p, ANTHROPIC_API_KEY: _k, ...rest } = process.env
  const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', SERVER], {
    env: { ...rest, DATABASE_FILE: join(dir, 'demo.db'), UPLOADS_DIR: join(dir, 'uploads'), PORT: '0', ...env },
  })
  let out = ''
  try {
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { child.kill(); reject(new Error(`no answer in 20 s:\n${out}`)) }, 20_000)
      const read = (chunk: Buffer) => {
        out += chunk.toString('utf8')
        if (/listening on :/.test(out)) { clearTimeout(timer); child.kill(); resolve({ listened: true, code: null, out }) }
      }
      child.stdout.on('data', read)
      child.stderr.on('data', read)
      child.on('exit', code => { clearTimeout(timer); resolve({ listened: /listening on :/.test(out), code, out }) })
    })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

test('the server starts as the public image starts it: the demo set, PUBLIC_DEMO=1', async () => {
  const r = await start({ SEED_SET: 'demo', PUBLIC_DEMO: '1' })
  assert.ok(r.listened, r.out)
  assert.match(r.out, /public demonstration: read-only, as Cimara/)
})

test('the server refuses to open the private archive as a public demonstration', async () => {
  const r = await start({ SEED_SET: PRIVATE_NAME, PUBLIC_DEMO: '1' })
  assert.equal(r.listened, false, r.out)
  assert.notEqual(r.code, 0)
  assert.match(r.out, /never presents the private archive/)
})
