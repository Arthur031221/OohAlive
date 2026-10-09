// The renderer is checked through the real page and its real WebGL shader, on a
// noise texture where any shift, smear or leak is visible in the pixels.
import { after, before, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { diff, frame, launch, openApp, png, texture } from './helpers.js'

const W = 240
const H = 160
const noise = texture(W, H)
const source = new Uint8Array(W * H * 4)
for (let i = 0; i < W * H; i++) {
  source.set(noise.subarray(i * 3, i * 3 + 3), i * 4)
  source[i * 4 + 3] = 255
}

let browser
let page
let context

before(async () => {
  browser = await launch()
  ;({ page, context } = await openApp(browser))
  await page.setInputFiles('#file', { name: 'noise.png', mimeType: 'image/png', buffer: png(W, H, noise) })
  await page.waitForFunction((w) => window.oohalive.stage.photo.width === w, W)
})

after(async () => {
  await context?.close()
  await browser?.close()
})

const reset = () =>
  page.evaluate(() => {
    const { editor } = window.oohalive
    editor.load({})
    editor.setParam('radius', 0.1)
    editor.setParam('speed', 0.06)
  })

const addArrow = (a) => page.evaluate((a) => window.oohalive.editor.addArrow(a), a)

/** Distance from a pixel to the middle of the image, in image heights. */
const at = (x, y) => (y * W + x) * 4

describe('renderer invariants', () => {
  test('without arrows every phase reproduces the photo', async () => {
    await reset()
    for (const phase of [0, 0.31, 0.5, 0.77]) {
      const out = await frame(page, phase)
      assert.ok(diff(out, source).max <= 1, `phase ${phase}`)
    }
  })

  test('a fully frozen photo does not move under strong arrows', async () => {
    await reset()
    await addArrow({ x0: 0.1, y0: 0.5, x1: 0.9, y1: 0.5 })
    await page.evaluate(() => {
      const { editor } = window.oohalive
      editor.setParam('speed', 0.12)
      for (const [x, y] of [[0.1, 0.2], [0.9, 0.2], [0.5, 0.5], [0.1, 0.8], [0.9, 0.8]]) {
        editor.addStroke({ mode: 'paint', size: 0.9, points: [[x, y]] })
      }
    })
    for (const phase of [0.13, 0.25, 0.6]) {
      const out = await frame(page, phase)
      assert.ok(diff(out, source).max <= 1, `phase ${phase}`)
    }
  })

  test('motion is local: it moves near the arrow, spares the freeze and the far corners', async () => {
    await reset()
    await addArrow({ x0: 0.15, y0: 0.5, x1: 0.55, y1: 0.5 })
    await page.evaluate(() => window.oohalive.editor.addStroke({ mode: 'paint', size: 0.14, points: [[0.35, 0.5]] }))
    const out = await frame(page, 0.25)
    const moved = (x, y) => diff(out.subarray(at(x, y), at(x, y) + 4), source.subarray(at(x, y), at(x, y) + 4)).max > 3

    // The brush radius is 22 px and its core, 45% of that, is fully frozen.
    let frozenMoved = 0
    for (let y = 80 - 6; y <= 80 + 6; y++) for (let x = 84 - 6; x <= 84 + 6; x++) if (moved(x, y)) frozenMoved++
    assert.equal(frozenMoved, 0, 'frozen core moved')

    // Near the arrow, outside the freeze, a clear share of pixels moved.
    let near = 0
    let total = 0
    for (let y = 70; y < 90; y++) for (let x = 40; x < 60; x++, total++) if (moved(x, y)) near++
    assert.ok(near / total > 0.5, `only ${near} of ${total} pixels moved near the arrow`)

    // Five reach widths away the arrow has no pull left.
    let far = 0
    for (let y = 0; y < 12; y++) for (let x = 190; x < W; x++) if (moved(x, y)) far++
    assert.equal(far, 0, 'far corner moved')
  })

  test('displacement fades out at the photo border', async () => {
    await reset()
    await addArrow({ x0: 0.0, y0: 0.5, x1: 1.0, y1: 0.5 })
    await addArrow({ x0: 0.5, y0: 0.0, x1: 0.5, y1: 1.0 })
    await page.evaluate(() => window.oohalive.editor.setParam('speed', 0.12))
    // On pure noise a shift of a tenth of a pixel already shows, so compare rings: the
    // outermost pixels must move far less than pixels well inside the photo.
    const ring = (out, inset) => {
      let sum = 0
      let n = 0
      for (let x = inset; x < W - inset; x++) {
        for (const y of [inset, H - 1 - inset]) {
          sum += Math.abs(out[at(x, y)] - source[at(x, y)])
          n++
        }
      }
      for (let y = inset; y < H - inset; y++) {
        for (const x of [inset, W - 1 - inset]) {
          sum += Math.abs(out[at(x, y)] - source[at(x, y)])
          n++
        }
      }
      return sum / n
    }
    for (const phase of [0.2, 0.45, 0.9]) {
      const out = await frame(page, phase)
      assert.ok(ring(out, 0) < ring(out, 20) * 0.1, `phase ${phase}: border ${ring(out, 0).toFixed(2)} inside ${ring(out, 20).toFixed(2)}`)
    }
  })

  test('the loop closes: the last frame leads into the first like any other pair', async () => {
    await reset()
    await addArrow({ x0: 0.1, y0: 0.4, x1: 0.8, y1: 0.55 })
    const frames = []
    for (let k = 0; k < 40; k++) frames.push(await frame(page, k / 40))
    const wrap = await frame(page, 1)
    assert.ok(diff(wrap, frames[0]).max === 0, 'phase 1 must equal phase 0')
    const gap = (a, b) => {
      let sum = 0
      for (let i = 0; i < a.length; i += 4) sum += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2])
      return sum / (a.length / 4)
    }
    const steps = frames.slice(0, 39).map((f, k) => gap(f, frames[k + 1])).sort((a, b) => a - b)
    const median = steps[Math.floor(steps.length / 2)]
    const closing = gap(frames[39], frames[0])
    assert.ok(closing <= median * 1.5, `closing step ${closing.toFixed(2)} against median ${median.toFixed(2)}`)
    assert.ok(median > 0.2, 'frames should differ from each other')
  })

  test('the preview canvas and the export renderer draw identical pixels', async () => {
    await reset()
    await addArrow({ x0: 0.2, y0: 0.3, x1: 0.7, y1: 0.6 })
    await page.evaluate(() => window.oohalive.editor.addStroke({ mode: 'paint', size: 0.1, points: [[0.45, 0.45]] }))
    const same = await page.evaluate(() => {
      const preview = window.oohalive.preview(0.37)
      const exported = window.oohalive.frame(0.37, { width: preview.width, height: preview.height })
      let worst = 0
      for (let i = 0; i < preview.rgba.length; i++) worst = Math.max(worst, Math.abs(preview.rgba[i] - exported.rgba[i]))
      return worst
    })
    assert.ok(same <= 1, `preview and export differ by ${same}`)
  })
})
