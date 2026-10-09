import { test } from 'node:test'
import assert from 'node:assert/strict'
import { maskSize, stampPositions } from '../../src/core/freeze.js'

test('stamps stay within the spacing and end on the target point', () => {
  const points = stampPositions([0, 0], [1, 0], 0.3)
  assert.equal(points.length, 4)
  assert.deepEqual(points.at(-1), [1, 0])
  let previous = [0, 0]
  for (const point of points) {
    assert.ok(Math.hypot(point[0] - previous[0], point[1] - previous[1]) <= 0.3 + 1e-9)
    previous = point
  }
})

test('a zero length segment still stamps once', () => {
  assert.deepEqual(stampPositions([0.5, 0.5], [0.5, 0.5], 0.1), [[0.5, 0.5]])
})

test('every photo shape gets a mask of at least one pixel each way', () => {
  assert.deepEqual(maskSize(1.5), { width: 512, height: 341 })
  assert.deepEqual(maskSize(1 / 1.5), { width: 341, height: 512 })
  for (const aspect of [1600, 1 / 1600, 1]) {
    const { width, height } = maskSize(aspect)
    assert.ok(width >= 1 && height >= 1, `aspect ${aspect} gave ${width} x ${height}`)
  }
})
