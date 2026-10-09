// The photo, its live preview, the arrow overlay and every pointer gesture.
import { Renderer } from '../core/renderer.js'
import { FreezeMask } from '../core/freeze.js'
import { GIF } from '../core/gif.js'

const LOOP_MS = GIF.frames * GIF.delayMs
const MIN_ARROW = 0.04 // image heights, shorter drags are treated as a click
const NS = 'http://www.w3.org/2000/svg'
const NARROW = '(max-width: 860px)'

function svg(tag, attrs = {}, parent) {
  const node = document.createElementNS(NS, tag)
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value)
  parent?.append(node)
  return node
}

const sameList = (a, b) => a.length === b.length && a.every((item, i) => item === b[i])

export class Stage extends EventTarget {
  tool = 'arrow'
  selectedId = null
  playing = true
  photo = null
  mask = null
  #views = new Map()
  #aspect = 1.5
  #size = { width: 1, height: 1 }
  #clock = 0
  #strength = 1
  #target = 1
  #dirty = true
  #maskDirty = false
  #painted = []
  #drag = null
  #lastTick = 0
  #reachTimer = 0
  #nudgedAt = 0
  #nudged = null
  #nudgeDepth = 0

  constructor({ area, stage, canvas, tint, overlay, cursor, editor, toast }) {
    super()
    Object.assign(this, { area, stage, canvas, tint, overlay, cursor, editor, toast })
    this.renderer = new Renderer(canvas)
    this.renderer.onRestore = () => this.#paintChanged()
    editor.on(() => this.#onEditorChange())
    new ResizeObserver(() => this.layout()).observe(area.parentElement)
    stage.addEventListener('pointerdown', (e) => this.#down(e))
    stage.addEventListener('pointermove', (e) => this.#move(e))
    stage.addEventListener('pointerup', (e) => this.#up(e))
    stage.addEventListener('pointercancel', (e) => this.#up(e))
    stage.addEventListener('pointerleave', () => this.cursor.classList.remove('on'))
    stage.addEventListener('keydown', (e) => this.#key(e))
    requestAnimationFrame(this.#frame)
  }

  setPhoto(photo) {
    this.photo = photo
    this.#aspect = photo.width / photo.height
    this.renderer.setPhoto(photo)
    this.mask = new FreezeMask(this.#aspect, this.tint)
    this.#painted = []
    this.#syncMask()
    this.layout()
  }

  setTool(tool) {
    this.tool = tool
    this.cursor.classList.remove('on')
    this.#syncCursorSize()
  }

  setPlaying(playing) {
    this.playing = playing
    this.stage.parentElement.classList.toggle('paused', !playing)
    this.#dirty = true
  }

  /** Show the untouched photo while held, easing the motion out and back in. */
  setOriginal(on) {
    this.#target = on ? 0 : 1
    this.stage.classList.toggle('original', on)
    this.#dirty = true
  }

  /** Pause on a frame where the motion is visible, for people who prefer reduced motion. */
  restAtPeak() {
    this.#clock = LOOP_MS * 0.5
  }

  /** Flash the reach halo, so a slider change shows what it changes. */
  showReach() {
    this.stage.classList.add('reach')
    clearTimeout(this.#reachTimer)
    this.#reachTimer = setTimeout(() => this.stage.classList.remove('reach'), 1100)
  }

  select(id) {
    this.selectedId = id
    for (const [key, view] of this.#views) view.group.classList.toggle('selected', key === id)
    this.dispatchEvent(new Event('select'))
  }

  /** Fit the photo into the free area, then size the canvases and overlay to it. */
  layout() {
    if (!this.photo) return
    const { area, stage } = this
    const column = area.parentElement
    const narrow = matchMedia(NARROW).matches
    const maxWidth = column.clientWidth
    const footer = column.lastElementChild.offsetHeight + parseFloat(getComputedStyle(column).rowGap)
    const maxHeight = narrow ? innerHeight * 0.62 : column.clientHeight - footer
    const width = Math.max(1, Math.min(maxWidth, maxHeight * this.#aspect))
    const height = width / this.#aspect
    area.style.height = `${height}px`
    Object.assign(stage.style, { width: `${width}px`, height: `${height}px`, left: `${(maxWidth - width) / 2}px`, top: '0px' })
    this.#size = { width, height }
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const scale = Math.min(dpr, 1400 / Math.max(width, height))
    this.renderer.resize(Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale)))
    this.overlay.setAttribute('viewBox', `0 0 ${width} ${height}`)
    this.#syncArrows()
    this.#syncCursorSize()
    this.#dirty = true
  }

  // Rendering

  /** Draw the preview at one loop position and return its pixels, for tests and the verify script. */
  snapshot(phase) {
    if (this.#maskDirty) {
      this.renderer.setFreeze(this.mask.mask)
      this.#maskDirty = false
    }
    this.renderer.draw({ ...this.editor.params, strength: 1 }, phase)
    return { width: this.renderer.canvas.width, height: this.renderer.canvas.height, rgba: this.renderer.read() }
  }

  #frame = (now) => {
    requestAnimationFrame(this.#frame)
    const dt = Math.min(64, now - (this.#lastTick || now))
    this.#lastTick = now
    if (this.playing) this.#clock += dt
    const easing = Math.abs(this.#target - this.#strength) > 0.001
    if (easing) this.#strength += (this.#target - this.#strength) * (1 - Math.exp(-dt / 70))
    else this.#strength = this.#target
    if (!this.photo || !(this.playing || easing || this.#dirty)) return
    if (this.#maskDirty) {
      this.renderer.setFreeze(this.mask.mask)
      this.#maskDirty = false
    }
    this.renderer.draw({ ...this.editor.params, strength: this.#strength }, this.#clock / LOOP_MS)
    this.#dirty = false
  }

  #onEditorChange() {
    this.#syncMask()
    this.#syncArrows()
    this.#dirty = true
  }

  #syncMask() {
    if (!this.mask) return
    if (!sameList(this.editor.strokes, this.#painted)) {
      this.mask.replay(this.editor.strokes, this.#aspect)
      this.#painted = [...this.editor.strokes]
    }
    this.#maskDirty = true
  }

  // Arrow overlay

  #syncArrows() {
    const live = new Set(this.editor.arrows.map((a) => a.id))
    for (const [id, view] of this.#views) {
      if (live.has(id)) continue
      view.group.remove()
      this.#views.delete(id)
      if (this.selectedId === id) this.select(null)
    }
    this.editor.arrows.forEach((arrow, index) => {
      let view = this.#views.get(arrow.id)
      if (!view) {
        view = this.#buildArrow(arrow.id)
        this.#views.set(arrow.id, view)
      }
      view.index = index + 1
      this.#place(view, arrow)
    })
    this.dispatchEvent(new Event('arrows'))
  }

  #buildArrow(id) {
    const group = svg('g', { class: 'arrow born' }, this.overlay)
    group.dataset.id = id
    const line = (cls, part) => {
      const node = svg('line', { class: cls }, group)
      if (part) node.dataset.part = part
      return node
    }
    const view = { group }
    view.halo = line('halo')
    view.grab = line('grab', 'body')
    view.edge = line('edge')
    view.body = line('body')
    view.flow = line('flow')
    view.tip = svg('polygon', { class: 'tip' }, group)
    view.tail = svg('circle', { class: 'handle tail', r: 11, tabindex: 0, role: 'button' }, group)
    view.head = svg('circle', { class: 'handle head', r: 16, tabindex: 0, role: 'button' }, group)
    view.tail.dataset.part = 'tail'
    view.head.dataset.part = 'head'
    setTimeout(() => group.classList.remove('born'), 400)
    return view
  }

  #place(view, { x0, y0, x1, y1 }) {
    const { width: W, height: H } = this.#size
    const [ax, ay, bx, by] = [x0 * W, y0 * H, x1 * W, y1 * H]
    const length = Math.hypot(bx - ax, by - ay) || 1
    const [ux, uy] = [(bx - ax) / length, (by - ay) / length]
    const tipLength = Math.min(20, length * 0.5)
    const [cx, cy] = [bx - ux * tipLength, by - uy * tipLength]
    const half = tipLength * 0.5
    for (const node of [view.edge, view.body, view.flow]) {
      node.setAttribute('x1', ax)
      node.setAttribute('y1', ay)
      node.setAttribute('x2', cx)
      node.setAttribute('y2', cy)
    }
    for (const node of [view.halo, view.grab]) {
      node.setAttribute('x1', ax)
      node.setAttribute('y1', ay)
      node.setAttribute('x2', bx)
      node.setAttribute('y2', by)
    }
    view.halo.setAttribute('stroke-width', this.editor.radius * H * 3)
    view.tip.setAttribute('points', `${bx},${by} ${cx - uy * half},${cy + ux * half} ${cx + uy * half},${cy - ux * half}`)
    view.tail.setAttribute('cx', ax)
    view.tail.setAttribute('cy', ay)
    view.head.setAttribute('cx', bx)
    view.head.setAttribute('cy', by)
    const name = `Arrow ${view.index}`
    view.tail.setAttribute('aria-label', `${name} start. Arrow keys move it. Delete removes the arrow.`)
    view.head.setAttribute('aria-label', `${name} end. Arrow keys move it. Delete removes the arrow.`)
  }

  // Pointer gestures

  #point(event) {
    const box = this.stage.getBoundingClientRect()
    return [
      Math.min(1, Math.max(0, (event.clientX - box.left) / box.width)),
      Math.min(1, Math.max(0, (event.clientY - box.top) / box.height)),
    ]
  }

  #syncCursorSize() {
    const diameter = this.editor.brush * this.#size.height * 2
    this.cursor.style.width = this.cursor.style.height = `${diameter}px`
  }

  #down(event) {
    if (event.button > 0 || this.#drag || !this.photo) return
    const [x, y] = this.#point(event)
    try {
      this.stage.setPointerCapture(event.pointerId)
    } catch {
      // A synthetic pointer has no active id to capture. Events still arrive while the pointer is over the stage.
    }
    this.stage.focus({ preventScroll: true })
    if (this.tool === 'arrow') this.#startArrow(event, x, y)
    else this.#startStroke(event, x, y)
    // A second finger must not steer or end the gesture the first one started.
    if (this.#drag) this.#drag.pointerId = event.pointerId
  }

  #startArrow(event, x, y) {
    const grabbed = event.target.closest?.('.arrow')
    if (grabbed) {
      const id = Number(grabbed.dataset.id)
      this.editor.beginAction()
      this.#drag = { kind: 'move', id, part: event.target.dataset.part ?? 'body', last: [x, y], moved: false }
      this.select(id)
      if (event.target.dataset.part !== 'body') event.target.focus({ preventScroll: true })
      event.preventDefault()
      return
    }
    if (!this.editor.canAddArrow) {
      this.toast('Six arrows is the limit. Remove one or drag one somewhere new.')
      return
    }
    this.editor.beginAction()
    const id = this.editor.addArrow({ x0: x, y0: y, x1: x, y1: y })
    this.#drag = { kind: 'new', id }
    this.select(id)
    this.dispatchEvent(new Event('draw'))
  }

  #startStroke(event, x, y) {
    const mode = this.tool
    const stroke = { mode, size: this.editor.brush, points: [[x, y]] }
    this.editor.beginAction()
    this.#drag = { kind: 'stroke', stroke }
    this.mask.dab(x, y, stroke.size, mode)
    this.#paintChanged()
  }

  #paintChanged() {
    this.#maskDirty = true
    this.#dirty = true
  }

  #move(event) {
    const [x, y] = this.#point(event)
    if (this.tool !== 'arrow' && event.pointerType !== 'touch') {
      const box = this.stage.getBoundingClientRect()
      this.cursor.style.transform = `translate(${event.clientX - box.left - parseFloat(this.cursor.style.width) / 2}px, ${event.clientY - box.top - parseFloat(this.cursor.style.height) / 2}px)`
      this.cursor.classList.add('on')
    }
    const drag = this.#drag
    if (!drag || drag.pointerId !== event.pointerId) return
    if (drag.kind === 'new') {
      this.editor.updateArrow(drag.id, { x1: x, y1: y })
    } else if (drag.kind === 'move') {
      const [dx, dy] = [x - drag.last[0], y - drag.last[1]]
      if (drag.part === 'body') this.editor.moveArrow(drag.id, 'body', dx, dy)
      else this.editor.updateArrow(drag.id, drag.part === 'tail' ? { x0: x, y0: y } : { x1: x, y1: y })
      drag.last = [x, y]
      drag.moved ||= dx !== 0 || dy !== 0
    } else {
      const { stroke } = drag
      this.mask.segment(stroke.points.at(-1), [x, y], stroke.size, stroke.mode, this.#aspect)
      stroke.points.push([x, y])
      this.#paintChanged()
    }
  }

  #up(event) {
    const drag = this.#drag
    if (!drag || drag.pointerId !== event.pointerId) return
    this.#drag = null
    if (this.stage.hasPointerCapture(event.pointerId)) this.stage.releasePointerCapture(event.pointerId)
    if (drag.kind === 'stroke') {
      this.#painted = [...this.editor.strokes, drag.stroke]
      this.editor.addStroke(drag.stroke)
    } else if (drag.kind === 'new') {
      const arrow = this.editor.arrows.find((a) => a.id === drag.id)
      const length = arrow ? Math.hypot((arrow.x1 - arrow.x0) * this.#aspect, arrow.y1 - arrow.y0) : 0
      if (length < MIN_ARROW) {
        this.editor.cancelAction()
        this.select(null)
      }
    } else if (!drag.moved) {
      this.editor.cancelAction()
    }
  }

  #key(event) {
    const handle = event.target.closest?.('.handle')
    if (!handle) return
    const id = Number(handle.closest('.arrow').dataset.id)
    if (event.key === 'Delete' || event.key === 'Backspace') {
      this.editor.beginAction()
      this.editor.removeArrow(id)
      this.stage.focus({ preventScroll: true })
      event.preventDefault()
      return
    }
    const step = event.shiftKey ? 0.05 : 0.01
    const delta = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[event.key]
    if (!delta) return
    event.preventDefault()
    // One undo step per burst of key presses on the same handle.
    const now = performance.now()
    const grouped = now - this.#nudgedAt <= 700 && this.#nudged === handle && this.editor.historyLength === this.#nudgeDepth
    if (!grouped) this.editor.beginAction()
    this.#nudgedAt = now
    this.#nudged = handle
    this.#nudgeDepth = this.editor.historyLength
    this.editor.moveArrow(id, handle.dataset.part, delta[0], delta[1])
    this.select(id)
  }
}
