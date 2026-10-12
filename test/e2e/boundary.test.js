import { test } from 'node:test'
import assert from 'node:assert/strict'
import { launch, openApp, png, frame, diff } from './helpers.js'

const W = 240
const H = 160

for (const kind of ['fence rails', 'hair beside frozen face']) {
  test(kind, async (t) => {
    // Synthetic photo with a real editor stroke, rendered by the shipped shader.
    const browser = await launch()
    try {
      const { page } = await openApp(browser)
      const rgb = new Uint8Array(W * H * 3)
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        let color
        if (kind === 'fence rails') color = y % 24 < 4 ? [218, 189, 117] : [32 + x % 20, 87 + y % 30, 44]
        else {
          const face = Math.hypot(x - W / 2, y - H / 2) < 9
          const hair = x >= W / 2 + 12 && x < W / 2 + 44 && y > 40 && y < 120
          color = face ? [196 + x % 9, 140 + y % 13, 105 + (x + y) % 7] : hair ? (x % 4 < 2 ? [27, 16, 12] : [114, 68, 28]) : [46, 92 + y % 20, 125 + x % 20]
        }
        rgb.set(color, (y * W + x) * 3)
      }
      await page.setInputFiles('#file', { name: 'boundary.png', mimeType: 'image/png', buffer: png(W, H, rgb) })
      await page.waitForFunction((w) => window.oohalive.stage.photo.width === w, W)
      const original = await frame(page, 0)
      assert.equal(diff(original, await frame(page, 0.43)).pixels, 0, 'no-arrow control changed')
      await page.evaluate((kind) => {
        const { editor } = window.oohalive
        editor.setParam('speed', 0.12)
        editor.setParam('radius', 0.16)
        editor.addArrow({ x0: 0.5, y0: 0.15, x1: 0.5, y1: 0.85 })
        editor.addStroke({ mode: 'paint', size: 0.15, points: kind === 'fence rails' ? [[0.5, 0.3], [0.5, 0.7]] : [[0.5, 0.5]] })
      }, kind)
      const frozen = await page.evaluate(([W, H]) => {
        const mask = window.oohalive.stage.mask.mask
        const data = mask.getContext('2d').getImageData(0, 0, mask.width, mask.height).data
        const indices = []
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
          const mx = (x + 0.5) * mask.width / W - 0.5
          const my = (y + 0.5) * mask.height / H - 0.5
          const x0 = Math.floor(mx)
          const y0 = Math.floor(my)
          // All four texels must be white, so bilinear sampling is fully frozen.
          const neighbors = [[x0, y0], [x0 + 1, y0], [x0, y0 + 1], [x0 + 1, y0 + 1]]
          if (neighbors.every(([mx, my]) => data[(my * mask.width + mx) * 4] === 255)) indices.push((y * W + x) * 4)
        }
        return indices
      }, [W, H])
      assert.ok(frozen.length > 100, 'fixture must include fully frozen pixels near the moving region')
      let frozenChanges = 0
      let movingChanges = 0
      let maxFrozenDifference = 0
      for (let n = 0; n < 20; n++) {
        const out = await frame(page, n / 20)
        movingChanges += diff(out, original).pixels
        for (const i of frozen) for (let c = 0; c < 3; c++) {
          const delta = Math.abs(out[i + c] - original[i + c])
          maxFrozenDifference = Math.max(maxFrozenDifference, delta)
          if (delta > 1) frozenChanges++
        }
      }
      t.diagnostic(JSON.stringify({ kind, frozenPixels: frozen.length, frozenChanges, maxFrozenDifference, movingChanges, frames: 20, runtime: process.version, fixture: 'synthetic' }))
      assert.ok(movingChanges > 100, 'moving-region control lost motion')
      assert.equal(frozenChanges, 0, 'fully frozen mask boundary changed')
    } finally {
      await browser.close()
    }
  })
}
