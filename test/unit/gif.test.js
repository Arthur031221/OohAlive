import { test } from 'node:test'
import assert from 'node:assert/strict'
import { GifReader } from 'omggif'
import { encodeGif, dither, GIF } from '../../src/core/gif.js'

const W = 96
const H = 64

function gradientFrames(count) {
  return Array.from({ length: count }, (_, f) => {
    const rgba = new Uint8ClampedArray(W * H * 4)
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4
        // The top half never changes, the bottom half drifts, like a frozen sky over moving water.
        rgba[i] = x * 2
        rgba[i + 1] = y < H / 2 ? 120 : (y * 3 + f * 5) % 256
        rgba[i + 2] = 200 - x
        rgba[i + 3] = 255
      }
    }
    return rgba
  })
}

/** Decode every frame to full RGBA, drawing each one over the previous like a viewer does. */
function decode(bytes) {
  const reader = new GifReader(bytes)
  const canvas = new Uint8Array(reader.width * reader.height * 4)
  const frames = []
  for (let n = 0; n < reader.numFrames(); n++) {
    reader.decodeAndBlitFrameRGBA(n, canvas)
    frames.push(canvas.slice())
  }
  return { reader, frames }
}

test('writes the loop the page promises: size, frame count, 5 centisecond delay, forever', () => {
  const bytes = encodeGif(gradientFrames(GIF.frames), W, H)
  const { reader } = decode(bytes)
  assert.equal(reader.width, W)
  assert.equal(reader.height, H)
  assert.equal(reader.numFrames(), GIF.frames)
  assert.equal(reader.loopCount(), 0)
  for (let n = 0; n < GIF.frames; n++) assert.equal(reader.frameInfo(n).delay, 5)
})

test('every frame uses the single global palette', () => {
  const reader = new GifReader(encodeGif(gradientFrames(12), W, H))
  // omggif reports the global table's offset for a frame without a local table of its own.
  const global = reader.frameInfo(0).palette_offset
  for (let n = 0; n < reader.numFrames(); n++) assert.equal(reader.frameInfo(n).palette_offset, global)
})

test('decoded frames stay close to the input', () => {
  const input = gradientFrames(8)
  const { frames } = decode(encodeGif(input, W, H))
  frames.forEach((out, n) => {
    let squared = 0
    for (let i = 0; i < input[n].length; i += 4) {
      for (let c = 0; c < 3; c++) squared += (out[i + c] - input[n][i + c]) ** 2
    }
    const psnr = 10 * Math.log10((255 * 255) / (squared / (W * H * 3)))
    assert.ok(psnr > 30, `frame ${n} PSNR ${psnr.toFixed(1)} dB`)
  })
})

test('unchanged pixels are skipped, so a still region costs nothing after the first frame', () => {
  const still = Array.from({ length: 10 }, () => gradientFrames(1)[0])
  const moving = gradientFrames(10)
  assert.ok(encodeGif(still, W, H).length < encodeGif(moving, W, H).length / 3)
})

test('dither keeps the average level and only moves pixels by a few levels', () => {
  const flat = new Uint8ClampedArray(W * H * 4).fill(128)
  const out = dither(flat, W, H, 10)
  let sum = 0
  for (let i = 0; i < out.length; i += 4) {
    assert.ok(Math.abs(out[i] - 128) <= 6)
    sum += out[i]
  }
  assert.ok(Math.abs(sum / (W * H) - 128) < 0.6)
})

test('a region that never changes decodes to the same pixels in every frame', () => {
  // Noise first in scan order, a smooth still gradient after it. The noise hits colours the gradient also
  // uses, in a different order each frame, which used to send the still pixels to different palette entries.
  let seed = 7
  const random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) * 256
  const frames = Array.from({ length: 12 }, () => {
    const rgba = new Uint8ClampedArray(W * H * 4)
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4
        const moving = y < H / 2
        rgba[i] = moving ? random() : (x * 2 + y) % 256
        rgba[i + 1] = moving ? random() : (x * 3 + y * 2) % 256
        rgba[i + 2] = moving ? random() : (x + y * 3) % 256
        rgba[i + 3] = 255
      }
    }
    return rgba
  })
  const { frames: out } = decode(encodeGif(frames, W, H))
  const still = (a, b) => {
    for (let i = (W * H * 4) / 2; i < a.length; i++) if (a[i] !== b[i]) return false
    return true
  }
  out.forEach((frame, n) => assert.ok(still(frame, out[0]), `frame ${n} changed the still half`))
})

test('a one-pixel frozen border near palette bucket boundaries stays still in every decoded frame', (t) => {
  const left = 20
  const right = W - 21
  const top = 12
  const bottom = H - 13
  const border = []
  const moving = []
  let seed = 19
  const random = () => (seed = (seed * 1664525 + 1013904223) >>> 0) >>> 24
  // Spread frozen colors across RGB565 cells, on either side of their edges.
  const frozenColors = new Uint8ClampedArray(W * H * 3)
  for (let i = 0; i < frozenColors.length; i++) {
    const bucket = i % 3 === 1 ? 4 : 8
    frozenColors[i] = Math.floor(random() / bucket) * bucket + (i % 2 ? bucket - 1 : 0)
  }
  const input = Array.from({ length: GIF.frames }, (_, n) => {
    const rgba = new Uint8ClampedArray(W * H * 4)
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4
        const frozen = ((x === left || x === right) && y >= top && y <= bottom) ||
          ((y === top || y === bottom) && x >= left && x <= right)
        if (n === 0 && frozen) border.push(i)
        if (n === 0 && x > left && x < right && y > top && y < bottom) moving.push(i)
        for (let c = 0; c < 3; c++) rgba[i + c] = frozen ? frozenColors[(y * W + x) * 3 + c] : random()
        rgba[i + 3] = 255
      }
    }
    return rgba
  })
  const { frames: out } = decode(encodeGif(input, W, H))
  for (let n = 1; n < GIF.frames; n++) {
    for (const i of border) {
      for (let c = 0; c < 4; c++) {
        assert.equal(input[n][i + c], input[0][i + c], 'fixture changed its frozen input')
        assert.equal(out[n][i + c], out[0][i + c], `frame ${n} changed frozen border pixel ${i / 4}, channel ${c}`)
      }
    }
    assert.ok(moving.some((i) => out[n][i] !== out[n - 1][i] || out[n][i + 1] !== out[n - 1][i + 1] || out[n][i + 2] !== out[n - 1][i + 2]), `frame ${n} lost the moving-region control`)
  }
  // Unchanged-input control exercises the same palette and delta-frame path.
  const still = decode(encodeGif(input.map(() => input[0]), W, H)).frames
  assert.ok(still.every((f) => Buffer.compare(Buffer.from(f), Buffer.from(still[0])) === 0), 'unchanged input must decode unchanged')
  t.diagnostic(`${border.length} frozen border pixels unchanged across ${GIF.frames} decoded frames, moving and unchanged-input controls passed`)
})
