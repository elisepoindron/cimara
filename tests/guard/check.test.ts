import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PRIVATE_NAME } from '../../src/import/osm/never-named.ts'
import { isNoreply, names, scanTree } from '../../scripts/guard/check.ts'

test('the private name is found in any case, and only it', () => {
  assert.equal(PRIVATE_NAME.length, 8)
  assert.ok(names(`un muro ${PRIVATE_NAME.toUpperCase()} qui`))
  assert.ok(!names('Cimara, un archivio della montagna'))
})

test('a tree is searched by path and by bytes, git and node_modules aside', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'guard-'))
  try {
    await mkdir(join(dir, 'a'))
    await mkdir(join(dir, 'node_modules'))
    await writeFile(join(dir, 'a', 'clean.txt'), 'nothing to see')
    await writeFile(join(dir, 'a', `${PRIVATE_NAME}.txt`), 'a clean body')
    await writeFile(join(dir, 'a', 'body.bin'), Buffer.concat([Buffer.from([0, 255]), Buffer.from(PRIVATE_NAME), Buffer.from([0])]))
    await writeFile(join(dir, 'node_modules', 'x.txt'), PRIVATE_NAME)
    assert.deepEqual((await scanTree(dir)).sort(), [`a/${PRIVATE_NAME}.txt: in its path`, 'a/body.bin: in its content'].sort())
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('a commit is authored with a GitHub noreply address', () => {
  assert.ok(isNoreply('12345+someone@users.noreply.github.com'))
  assert.ok(isNoreply('noreply@github.com'))
  assert.ok(!isNoreply('someone@example.com'))
  assert.ok(!isNoreply('users.noreply.github.com.example.com'))
})
