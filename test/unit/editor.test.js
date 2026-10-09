import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Editor, DEFAULTS, LIMITS } from '../../src/core/editor.js'
import { MAX_ARROWS } from '../../src/core/renderer.js'

const arrow = { x0: 0.1, y0: 0.2, x1: 0.8, y1: 0.3 }

test('adds up to six arrows and refuses the seventh', () => {
  const editor = new Editor()
  for (let i = 0; i < MAX_ARROWS; i++) assert.ok(editor.addArrow(arrow))
  assert.equal(editor.canAddArrow, false)
  assert.equal(editor.addArrow(arrow), null)
  assert.equal(editor.arrows.length, MAX_ARROWS)
})

test('keeps arrow ends inside the photo', () => {
  const editor = new Editor()
  const id = editor.addArrow({ x0: -1, y0: 2, x1: 0.5, y1: 0.5 })
  assert.deepEqual([editor.arrows[0].x0, editor.arrows[0].y0], [0, 1])
  editor.updateArrow(id, { x1: 4 })
  assert.equal(editor.arrows[0].x1, 1)
})

test('undo restores the state before a gesture', () => {
  const editor = new Editor()
  editor.beginAction()
  const id = editor.addArrow(arrow)
  editor.beginAction()
  editor.moveArrow(id, 'head', 0.1, 0)
  assert.equal(editor.arrows[0].x1, 0.9)
  assert.ok(editor.undo())
  assert.equal(editor.arrows[0].x1, 0.8)
  assert.ok(editor.undo())
  assert.equal(editor.arrows.length, 0)
  assert.equal(editor.undo(), false)
})

test('a cancelled gesture leaves no undo step behind', () => {
  const editor = new Editor()
  editor.beginAction()
  editor.addArrow(arrow)
  editor.cancelAction()
  assert.equal(editor.arrows.length, 0)
  assert.equal(editor.canUndo, false)
})

test('moving a whole arrow keeps its shape at the edge', () => {
  const editor = new Editor()
  const id = editor.addArrow({ x0: 0.5, y0: 0.5, x1: 0.9, y1: 0.5 })
  editor.moveArrow(id, 'body', 0.5, 0)
  const [a] = editor.arrows
  assert.ok(Math.abs(a.x1 - 1) < 1e-9)
  assert.ok(Math.abs(a.x1 - a.x0 - 0.4) < 1e-9)
})

test('reset returns to the starting scene and can be undone', () => {
  const editor = new Editor({ arrows: [arrow], strokes: [{ mode: 'paint', size: 0.05, points: [[0.5, 0.5]] }] })
  editor.beginAction()
  editor.removeArrow(editor.arrows[0].id)
  editor.addStroke({ mode: 'paint', size: 0.05, points: [[0.1, 0.1]] })
  editor.reset()
  assert.equal(editor.arrows.length, 1)
  assert.equal(editor.strokes.length, 1)
  editor.undo()
  assert.equal(editor.arrows.length, 0)
  assert.equal(editor.strokes.length, 2)
})

test('undo history keeps only the most recent 60 actions', () => {
  const editor = new Editor()
  const id = editor.addArrow(arrow)
  for (let i = 1; i <= 61; i++) {
    editor.beginAction()
    editor.updateArrow(id, { x1: 0.8 + i / 1000 })
  }

  for (let i = 0; i < 60; i++) assert.ok(editor.undo())
  assert.equal(editor.arrows[0].x1, 0.801)
  assert.equal(editor.undo(), false)
})

test('sliders clamp to their range and ignore unknown names', () => {
  const editor = new Editor()
  editor.setParam('speed', 5)
  assert.equal(editor.speed, LIMITS.speed[1])
  editor.setParam('radius', -1)
  assert.equal(editor.radius, LIMITS.radius[0])
  editor.setParam('colour', 1)
  assert.equal(editor.colour, undefined)
  assert.equal(new Editor().brush, DEFAULTS.brush)
})

test('listeners hear every change and can unsubscribe', () => {
  const editor = new Editor()
  let calls = 0
  const off = editor.on(() => calls++)
  editor.addArrow(arrow)
  editor.setParam('speed', 0.05)
  off()
  editor.addArrow(arrow)
  assert.equal(calls, 2)
})
