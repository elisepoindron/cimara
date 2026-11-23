import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { filesystemPhotoStore, extFor, mimeForExt } from '../../src/app/photo-store.ts'

test('extFor names the extension for each accepted mime', () => {
  assert.equal(extFor('image/jpeg'), 'jpg')
  assert.equal(extFor('image/png'), 'png')
})

test('mimeForExt is extFor\'s inverse', () => {
  assert.equal(mimeForExt('jpg'), 'image/jpeg')
  assert.equal(mimeForExt('png'), 'image/png')
})

test('a photo written to the filesystem store reads back byte for byte', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'app-photo-'))
  try {
    const store = filesystemPhotoStore(dir)
    const bytes = Buffer.from([0xff, 0xd8, 0xff, 1, 2, 3])

    await store.put('ph1', 'image/jpeg', bytes)

    assert.deepEqual(await store.get('ph1', 'image/jpeg'), bytes)
  } finally {
    await rm(dir, { recursive: true })
  }
})

test('a photo nobody wrote is absent, not an error', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'app-photo-'))
  try {
    const store = filesystemPhotoStore(dir)
    assert.equal(await store.get('non-esiste', 'image/png'), null)
  } finally {
    await rm(dir, { recursive: true })
  }
})

test('the same id under different mimes are different files', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'app-photo-'))
  try {
    const store = filesystemPhotoStore(dir)
    await store.put('ph1', 'image/jpeg', Buffer.from('jpeg-bytes'))
    await store.put('ph1', 'image/png', Buffer.from('png-bytes'))

    assert.deepEqual(await store.get('ph1', 'image/jpeg'), Buffer.from('jpeg-bytes'))
    assert.deepEqual(await store.get('ph1', 'image/png'), Buffer.from('png-bytes'))
  } finally {
    await rm(dir, { recursive: true })
  }
})

test('the store creates its own directory', async () => {
  const dir = join(await mkdtemp(join(tmpdir(), 'app-photo-')), 'nested', 'uploads')
  try {
    filesystemPhotoStore(dir)   // must not throw for a directory that does not exist yet
    const store = filesystemPhotoStore(dir)
    await store.put('ph1', 'image/png', Buffer.from('x'))
    assert.deepEqual(await store.get('ph1', 'image/png'), Buffer.from('x'))
  } finally {
    await rm(join(dir, '..', '..'), { recursive: true })
  }
})
