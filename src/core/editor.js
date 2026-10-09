// Editor state: arrows, freeze strokes and sliders, with gesture level undo.
// No DOM here, so the rules are unit tested in plain Node.
import { MAX_ARROWS } from './renderer.js'

export const LIMITS = {
  radius: [0.04, 0.4],
  speed: [0.01, 0.12],
  brush: [0.015, 0.15],
}
export const DEFAULTS = { radius: 0.16, speed: 0.06, brush: 0.05 }
const HISTORY_LIMIT = 60

const clamp = (value, [low, high]) => Math.min(high, Math.max(low, value))
const unit = (value) => Math.min(1, Math.max(0, value))

export class Editor {
  arrows = []
  strokes = []
  radius = DEFAULTS.radius
  speed = DEFAULTS.speed
  brush = DEFAULTS.brush
  #nextId = 1
  #history = []
  #listeners = new Set()

  constructor(initial = {}) {
    this.initial = { arrows: initial.arrows ?? [], strokes: initial.strokes ?? [] }
    this.load(this.initial)
  }

  on(listener) {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  #emit() {
    for (const listener of this.#listeners) listener(this)
  }

  /** Replace the picture content, for a new photo or a first load. Clears undo. */
  load({ arrows = [], strokes = [] }) {
    this.initial = { arrows, strokes }
    this.arrows = arrows.map((a) => ({ ...a, id: this.#nextId++ }))
    this.strokes = [...strokes]
    this.#history = []
    this.#emit()
  }

  get canAddArrow() {
    return this.arrows.length < MAX_ARROWS
  }

  get canUndo() {
    return this.#history.length > 0
  }

  get historyLength() {
    return this.#history.length
  }

  /** Call before a gesture that changes arrows or strokes. */
  beginAction() {
    this.#history.push({ arrows: this.arrows.map((a) => ({ ...a })), strokes: [...this.strokes] })
    if (this.#history.length > HISTORY_LIMIT) this.#history.shift()
  }

  /** Throw away the gesture that just began, as if it never happened. */
  cancelAction() {
    const before = this.#history.pop()
    if (before) this.#restore(before)
  }

  undo() {
    const before = this.#history.pop()
    if (!before) return false
    this.#restore(before)
    return true
  }

  #restore({ arrows, strokes }) {
    this.arrows = arrows
    this.strokes = strokes
    this.#emit()
  }

  /** Back to the starting arrows and strokes. This can be undone. */
  reset() {
    this.beginAction()
    this.arrows = this.initial.arrows.map((a) => ({ ...a, id: this.#nextId++ }))
    this.strokes = [...this.initial.strokes]
    this.#emit()
  }

  addArrow({ x0, y0, x1, y1 }) {
    if (!this.canAddArrow) return null
    const arrow = { id: this.#nextId++, x0: unit(x0), y0: unit(y0), x1: unit(x1), y1: unit(y1) }
    this.arrows.push(arrow)
    this.#emit()
    return arrow.id
  }

  updateArrow(id, patch) {
    const arrow = this.arrows.find((a) => a.id === id)
    if (!arrow) return
    for (const key of ['x0', 'y0', 'x1', 'y1']) if (key in patch) arrow[key] = unit(patch[key])
    this.#emit()
  }

  /** Move one end ('tail' or 'head') or the whole arrow ('body') by a delta in image units. */
  moveArrow(id, part, dx, dy) {
    const arrow = this.arrows.find((a) => a.id === id)
    if (!arrow) return
    const ends = part === 'tail' ? ['0'] : part === 'head' ? ['1'] : ['0', '1']
    // A whole arrow keeps its shape, so the delta is limited by the end that would leave the photo.
    if (part === 'body') {
      const xs = [arrow.x0, arrow.x1]
      const ys = [arrow.y0, arrow.y1]
      dx = Math.min(1 - Math.max(...xs), Math.max(-Math.min(...xs), dx))
      dy = Math.min(1 - Math.max(...ys), Math.max(-Math.min(...ys), dy))
    }
    for (const end of ends) {
      arrow[`x${end}`] = unit(arrow[`x${end}`] + dx)
      arrow[`y${end}`] = unit(arrow[`y${end}`] + dy)
    }
    this.#emit()
  }

  removeArrow(id) {
    const index = this.arrows.findIndex((a) => a.id === id)
    if (index < 0) return
    this.arrows.splice(index, 1)
    this.#emit()
  }

  addStroke(stroke) {
    this.strokes.push(stroke)
    this.#emit()
  }

  setParam(name, value) {
    if (!(name in LIMITS)) return
    this[name] = clamp(value, LIMITS[name])
    this.#emit()
  }

  /** The renderer's view of the state. */
  get params() {
    return { arrows: this.arrows, radius: this.radius, speed: this.speed }
  }
}
