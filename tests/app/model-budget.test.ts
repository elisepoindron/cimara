import { test } from 'node:test'
import assert from 'node:assert/strict'
import { budget, limitCallModel, limitRewriteLine, OverBudget } from '../../src/app/model-budget.ts'
import type { CallModel } from '../../src/app/synthesis.ts'

test('a budget holds each window: the minute, the hour and the day', () => {
  let t = 0
  const b = budget({ perMinute: 2, perHour: 3, perDay: 4 }, () => t)
  assert.deepEqual([b.take(), b.take(), b.take()], [true, true, false], 'two a minute')
  t += 61_000
  assert.deepEqual([b.take(), b.take()], [true, false], 'three an hour')
  t += 3_600_000
  assert.deepEqual([b.take(), b.take()], [true, false], 'four a day, the first two gone with their hour only')
  t += 86_400_000
  assert.equal(b.take(), true, 'a new day')
})

test('the report reading spends the budget on each call, merge and check included, and stops at its ceiling', async () => {
  const calls: string[] = []
  const inner = Object.assign(async () => { calls.push('read'); return { themes: [] } }, {
    merge: async () => { calls.push('merge'); return { groups: [] } },
    check: async () => { calls.push('check'); return { groups: [] } },
  }) as unknown as CallModel
  const limited = limitCallModel(inner, budget({ perMinute: 2, perHour: 10, perDay: 10 }))
  await limited({} as never)
  await limited.merge!({} as never)
  await assert.rejects(limited.check!({} as never), OverBudget)
  assert.deepEqual(calls, ['read', 'merge'])
})

test('Find’s rewriting over budget is refused, and the parser answers alone', async () => {
  let asked = 0
  const limited = limitRewriteLine(async () => { asked++; return 'falesie' }, budget({ perMinute: 1, perHour: 1, perDay: 1 }))
  assert.equal(await limited({ line: 'crag', activities: [], phrases: [] }), 'falesie')
  await assert.rejects(limited({ line: 'crag', activities: [], phrases: [] }), OverBudget)
  assert.equal(asked, 1)
})
