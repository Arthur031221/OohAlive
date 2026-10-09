// GIF writer on top of gifenc: one global palette for all frames, ordered
// dithering so a sky does not band, and unchanged pixels left transparent so
// the file does not repeat what a frozen region already shows.
import { GIFEncoder, quantize } from 'gifenc/dist/gifenc.esm.js'

// 20 frames at 50 ms is exactly one repeat of the motion (see Renderer.draw).
export const GIF = { frames: 20, delayMs: 50, longEdge: 480 }

const BAYER = (() => {
  let matrix = [[0]]
  while (matrix.length < 8) {
    const n = matrix.length
    const next = Array.from({ length: n * 2 }, () => new Array(n * 2))
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const v = matrix[y][x] * 4
        next[y][x] = v
        next[y][x + n] = v + 2
        next[y + n][x] = v + 3
        next[y + n][x + n] = v + 1
      }
    }
    matrix = next
  }
  return Float32Array.from(matrix.flat(), (v) => (v + 0.5) / 64 - 0.5)
})()

/** A copy of the frame with a fixed ordered dither pattern of +-amplitude/2 levels added. */
export function dither(rgba, width, height, amplitude) {
  const out = new Uint8ClampedArray(rgba.length)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = BAYER[(y & 7) * 8 + (x & 7)] * amplitude
      const i = (y * width + x) * 4
      out[i] = rgba[i] + offset
      out[i + 1] = rgba[i + 1] + offset
      out[i + 2] = rgba[i + 2] + offset
      out[i + 3] = 255
    }
  }
  return out
}

/** One palette for the whole animation, built from every other frame. */
export function buildPalette(frames, colors) {
  const sampled = frames.filter((_, i) => i % 2 === 0)
  const joined = new Uint8ClampedArray(sampled.reduce((n, f) => n + f.length, 0))
  let at = 0
  for (const frame of sampled) {
    joined.set(frame, at)
    at += frame.length
  }
  return quantize(joined, colors, { format: 'rgb565' })
}

const KEY = (rgba, i) => ((rgba[i] >> 3) << 11) | ((rgba[i + 1] >> 2) << 5) | (rgba[i + 2] >> 3)

/**
 * Maps pixels to palette entries through one table for the whole GIF. gifenc's
 * applyPalette caches by 5-6-5 colour per call and keeps the match of the first
 * pixel it meets, so the same colour can land on different entries in different
 * frames and a still region shimmers.
 */
function paletteIndexer(palette) {
  const table = new Int16Array(65536).fill(-1)
  const nearest = (key) => {
    const r5 = key >> 11
    const g6 = (key >> 5) & 63
    const b5 = key & 31
    const r = (r5 << 3) | (r5 >> 2)
    const g = (g6 << 2) | (g6 >> 4)
    const b = (b5 << 3) | (b5 >> 2)
    let best = 0
    let bestDistance = Infinity
    palette.forEach(([pr, pg, pb], n) => {
      const distance = (pr - r) ** 2 + (pg - g) ** 2 + (pb - b) ** 2
      if (distance < bestDistance) {
        bestDistance = distance
        best = n
      }
    })
    return best
  }
  return (rgba) => {
    const out = new Uint8Array(rgba.length / 4)
    for (let p = 0; p < out.length; p++) {
      const key = KEY(rgba, p * 4)
      out[p] = table[key] >= 0 ? table[key] : (table[key] = nearest(key))
    }
    return out
  }
}

/**
 * frames: RGBA arrays of equal size. Returns the GIF bytes. Frames after the
 * first only carry the pixels that changed, which is lossless once indexed.
 */
export function encodeGif(frames, width, height, { delayMs = GIF.delayMs, amplitude = 10, onFrame } = {}) {
  const transparentIndex = 255
  const palette = buildPalette(frames, transparentIndex)
  while (palette.length < 256) palette.push([0, 0, 0])
  const toIndex = paletteIndexer(palette.slice(0, transparentIndex))
  const encoder = GIFEncoder()
  let previous = null
  frames.forEach((frame, n) => {
    const index = toIndex(dither(frame, width, height, amplitude))
    const kept = previous ? index.map((v, i) => (v === previous[i] ? transparentIndex : v)) : index
    encoder.writeFrame(kept, width, height, {
      palette: n === 0 ? palette : null,
      delay: delayMs,
      repeat: 0,
      dispose: 1,
      transparent: n > 0,
      transparentIndex,
    })
    previous = index
    onFrame?.(n + 1, frames.length)
  })
  encoder.finish()
  return encoder.bytes()
}

/** Pixel size of the GIF for a photo, capped on the long edge and never upscaled. */
export function gifSize(width, height, longEdge = GIF.longEdge) {
  const scale = Math.min(1, longEdge / Math.max(width, height))
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}
