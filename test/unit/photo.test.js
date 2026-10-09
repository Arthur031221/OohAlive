import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fitWithin } from '../../src/core/photo.js'
import { gifSize } from '../../src/core/gif.js'

test('large photos shrink to the limit and keep their ratio', () => {
  assert.deepEqual(fitWithin(8000, 6000, 1600), { width: 1600, height: 1200 })
  assert.deepEqual(fitWithin(3000, 4000, 1600), { width: 1200, height: 1600 })
})

test('small photos are never upscaled', () => {
  assert.deepEqual(fitWithin(400, 300, 1600), { width: 400, height: 300 })
})

test('the GIF is 480 pixels on its long edge', () => {
  assert.deepEqual(gifSize(1280, 853), { width: 480, height: 320 })
  assert.deepEqual(gifSize(853, 1280), { width: 320, height: 480 })
  assert.deepEqual(gifSize(200, 100), { width: 200, height: 100 })
})
