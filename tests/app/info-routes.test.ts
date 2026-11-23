import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseHTML } from 'linkedom'
import { running } from '../helpers/http.ts'

async function get(base: string, path: string) {
  const res = await fetch(base + path, { redirect: 'manual' })
  return { status: res.status, doc: parseHTML(await res.text()).document }
}

test('Info answers anyone, at the hub, a subject and a scale', async () => {
  const s = await running()
  try {
    const hub = await get(s.base, '/info')
    assert.equal(hub.status, 200)
    assert.equal(hub.doc.querySelector('.phead h1')?.textContent, 'Info')

    const privacy = await get(s.base, '/info/privacy')
    assert.equal(privacy.status, 200)
    assert.equal(privacy.doc.querySelector('.info__main h1')?.textContent, 'Privacy e cookie')

    const scale = await get(s.base, '/info/scale/sci-ripido')
    assert.equal(scale.status, 200)
    assert.equal(scale.doc.querySelectorAll('.info__levels').length, 3)
  } finally { s.server.close() }
})

test('a path Info does not hold is a 404, not a hub', async () => {
  const s = await running()
  try {
    for (const p of ['/info/forum', '/info/nulla', '/info/scale/nulla', '/info/privacy/altro']) {
      assert.equal((await get(s.base, p)).status, 404, p)
    }
  } finally { s.server.close() }
})

test('Info is read, never written to', async () => {
  const s = await running()
  try {
    const res = await fetch(s.base + '/info/privacy', { method: 'POST', redirect: 'manual' })
    assert.equal(res.status, 405)
  } finally { s.server.close() }
})
