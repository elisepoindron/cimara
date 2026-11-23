import { test } from 'node:test'
import assert from 'node:assert/strict'
import { groupsOf, partitionByGroup } from '../../src/render/groups.ts'
import type { Part } from '../../src/domain/facts.ts'

const via = (n: number, group: string | null): Part =>
  ({ id: `v${n}`, group, position: n, fields: {} })

test('groupsOf lists distinct groups in first-appearance order', () => {
  const parts = [via(1, 'Basso'), via(2, 'Scuola'), via(3, 'Basso'), via(4, 'Centrale')]
  assert.deepEqual(groupsOf(parts), ['Basso', 'Scuola', 'Centrale'])
})

test('groupsOf treats a blank string the same as null — ungrouped, not a group named ""', () => {
  const parts = [via(1, ''), via(2, 'Basso')]
  assert.deepEqual(groupsOf(parts), ['Basso'])
})

test('groupsOf treats a whitespace-only string as ungrouped too', () => {
  const parts = [via(1, '   '), via(2, 'Basso')]
  assert.deepEqual(groupsOf(parts), ['Basso'])
})

test('partitionByGroup buckets null, blank and whitespace-only groups as ungrouped', () => {
  const parts = [via(1, null), via(2, ''), via(3, '  '), via(4, 'Basso')]
  const { ungrouped, grouped } = partitionByGroup(parts)

  assert.deepEqual(ungrouped.map(p => p.id), ['v1', 'v2', 'v3'])
  assert.deepEqual(grouped.map(p => p.id), ['v4'])
})

test('groupsOf and partitionByGroup agree on the same input — the bug this replaces was them disagreeing', () => {
  const parts = [via(1, ''), via(2, 'Basso'), via(3, 'Basso')]

  assert.deepEqual(groupsOf(parts), ['Basso'])
  const { ungrouped, grouped } = partitionByGroup(parts)
  assert.deepEqual(ungrouped.map(p => p.id), ['v1'])
  assert.deepEqual(grouped.map(p => p.id), ['v2', 'v3'])
})
