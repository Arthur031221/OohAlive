// The freeze mask: where the picture must stay still. Strokes are kept as data
// so undo can replay them, and painted on two canvases: a black and white one
// for the renderer and a tinted one for the interface.

const MASK_EDGE = 512
const TINT = [143, 124, 255]

/** Points along a-b at most `spacing` apart, including b and excluding a. */
export function stampPositions(a, b, spacing) {
  const distance = Math.hypot(b[0] - a[0], b[1] - a[1])
  const steps = Math.max(1, Math.ceil(distance / spacing))
  return Array.from({ length: steps }, (_, i) => [
    a[0] + ((b[0] - a[0]) * (i + 1)) / steps,
    a[1] + ((b[1] - a[1]) * (i + 1)) / steps,
  ])
}

// Solid in the middle, fading to nothing at the rim. The rim keeps the brush
// colour so a faded dab never greys the pixels under it.
function sprite([r, g, b]) {
  const size = 96
  const canvas = Object.assign(document.createElement('canvas'), { width: size, height: size })
  const ctx = canvas.getContext('2d')
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  gradient.addColorStop(0, `rgb(${r} ${g} ${b} / 1)`)
  gradient.addColorStop(0.45, `rgb(${r} ${g} ${b} / 1)`)
  gradient.addColorStop(1, `rgb(${r} ${g} ${b} / 0)`)
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, size, size)
  return canvas
}

/** Mask size for a photo shape. A hairline photo still gets at least one pixel each way. */
export function maskSize(aspect) {
  const height = Math.max(1, aspect >= 1 ? Math.round(MASK_EDGE / aspect) : MASK_EDGE)
  return { width: Math.max(1, Math.round(height * aspect)), height }
}

export class FreezeMask {
  /** `tint` may be an existing canvas element, so the interface paints without a copy. */
  constructor(aspect, tint = document.createElement('canvas')) {
    const { width, height } = maskSize(aspect)
    this.width = width
    this.height = height
    this.mask = Object.assign(document.createElement('canvas'), { width, height })
    this.tint = Object.assign(tint, { width, height })
    this.maskCtx = this.mask.getContext('2d')
    this.tintCtx = this.tint.getContext('2d')
    this.sprites = { white: sprite([255, 255, 255]), black: sprite([0, 0, 0]), tint: sprite(TINT) }
    this.clear()
  }

  clear() {
    this.maskCtx.globalCompositeOperation = 'source-over'
    this.maskCtx.fillStyle = '#000'
    this.maskCtx.fillRect(0, 0, this.width, this.height)
    this.tintCtx.clearRect(0, 0, this.width, this.height)
    this.empty = true
  }

  /** One round dab. x and y are 0..1 image coordinates, size is the brush radius in image heights. */
  dab(x, y, size, mode) {
    const diameter = size * this.height * 2
    const px = x * this.width - diameter / 2
    const py = y * this.height - diameter / 2
    const painting = mode === 'paint'
    this.maskCtx.drawImage(painting ? this.sprites.white : this.sprites.black, px, py, diameter, diameter)
    this.tintCtx.globalCompositeOperation = painting ? 'source-over' : 'destination-out'
    this.tintCtx.drawImage(this.sprites.tint, px, py, diameter, diameter)
    if (painting) this.empty = false
  }

  /** Paint from the previous point to the next one. aspect corrects x spacing so dabs stay round. */
  segment(from, to, size, mode, aspect) {
    const spacing = (size * 0.35) / Math.max(1, aspect)
    for (const [x, y] of stampPositions(from, to, spacing)) this.dab(x, y, size, mode)
  }

  replay(strokes, aspect) {
    this.clear()
    for (const stroke of strokes) {
      let previous = stroke.points[0]
      this.dab(previous[0], previous[1], stroke.size, stroke.mode)
      for (const point of stroke.points.slice(1)) {
        this.segment(previous, point, stroke.size, stroke.mode, aspect)
        previous = point
      }
    }
  }
}
