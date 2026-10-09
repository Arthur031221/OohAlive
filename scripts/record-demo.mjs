// Records the real page while a scripted pointer uses it, then turns the
// video into assets/demo.gif. Needs ffmpeg on the PATH.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { appUrl, launch, root } from '../test/e2e/helpers.js'

const SIZE = { width: 1100, height: 660 }
const out = resolve(root, 'assets/demo.gif')
const waterfall = resolve(root, 'assets/photos/waterfall.jpg')

// The recording has no mouse pointer, so the page draws one.
const POINTER = `(() => {
  const dot = document.createElement('div')
  dot.style.cssText = 'position:fixed;z-index:99999;left:-60px;top:-60px;width:24px;height:24px;margin:-12px 0 0 -12px;' +
    'border-radius:50%;border:2px solid #fff;background:rgba(24,18,48,.6);box-shadow:0 2px 10px rgba(0,0,0,.4);' +
    'pointer-events:none;transition:transform .12s,background .12s'
  addEventListener('DOMContentLoaded', () => document.body.append(dot))
  addEventListener('pointermove', (e) => { dot.style.left = e.clientX + 'px'; dot.style.top = e.clientY + 'px' }, true)
  addEventListener('pointerdown', () => { dot.style.transform = 'scale(.7)'; dot.style.background = 'rgba(143,124,255,.9)' }, true)
  addEventListener('pointerup', () => { dot.style.transform = ''; dot.style.background = 'rgba(24,18,48,.6)' }, true)
})()`

const tmp = mkdtempSync(join(tmpdir(), 'oohalive-demo-'))
const browser = await launch()
const context = await browser.newContext({ viewport: SIZE, recordVideo: { dir: tmp, size: SIZE }, acceptDownloads: true })
await context.addInitScript(POINTER)
const page = await context.newPage()
const began = Date.now()
await page.goto(appUrl)
await page.waitForSelector('html[data-ready=true]')
const readyAt = (Date.now() - began) / 1000

const wait = (ms) => page.waitForTimeout(ms)
let at = { x: 40, y: 40 }
async function glide(to, ms = 600) {
  const from = at
  const start = Date.now()
  for (let t = 0; t < 1; ) {
    t = Math.min(1, (Date.now() - start) / ms)
    const ease = t * t * (3 - 2 * t)
    await page.mouse.move(from.x + (to.x - from.x) * ease, from.y + (to.y - from.y) * ease)
  }
  at = to
}
const center = async (locator) => {
  const box = await locator.boundingBox()
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}
const onStage = async (fx, fy) => {
  const box = await page.locator('#stage').boundingBox()
  return { x: box.x + fx * box.width, y: box.y + fy * box.height }
}
async function drag(points, ms = 700) {
  await glide(await onStage(...points[0]), 350)
  await page.mouse.down()
  for (const p of points.slice(1)) await glide(await onStage(...p), ms / (points.length - 1))
  await page.mouse.up()
}

await wait(2600)

// The starting scene already moves. Hold the button to compare with the original.
await glide(await center(page.locator('#hold')), 450)
await page.mouse.down()
await wait(1200)
await page.mouse.up()
await wait(600)

// A new photo, with nothing moving yet.
await glide(await center(page.locator('#open')), 450)
const chooser = page.waitForEvent('filechooser')
await page.mouse.click(at.x, at.y)
await (await chooser).setFiles(waterfall)
await page.waitForFunction(() => window.oohalive.stage.photo.width === 1280)
await wait(900)

await drag([[0.52, 0.34], [0.5, 0.62], [0.52, 0.86]], 600)
await wait(1000)
await drag([[0.27, 0.25], [0.3, 0.38], [0.33, 0.52]], 400)
await wait(600)

// Keep the rock on the right still.
await glide(await center(page.locator('label').filter({ hasText: /^Freeze$/ })), 400)
await page.mouse.click(at.x, at.y)
await wait(200)
await drag([[0.66, 0.5], [0.72, 0.62], [0.8, 0.7], [0.86, 0.58], [0.78, 0.46]], 800)
await wait(1000)

const download = page.waitForEvent('download')
await glide(await center(page.locator('#download')), 450)
await page.mouse.click(at.x, at.y)
await download
await wait(2600)

const video = await page.video().path()
await context.close()
await browser.close()

mkdirSync(resolve(root, 'assets'), { recursive: true })
const filters = 'fps=12,scale=720:-1:flags=lanczos'
const palette = join(tmp, 'palette.png')
const trim = ['-ss', String(Math.max(0, readyAt + 1).toFixed(2)), '-i', video]
execFileSync('ffmpeg', ['-y', '-v', 'error', ...trim, '-vf', `${filters},palettegen=max_colors=112:stats_mode=diff`, palette])
execFileSync('ffmpeg', ['-y', '-v', 'error', ...trim, '-i', palette, '-lavfi', `${filters}[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle`, '-loop', '0', out])
rmSync(tmp, { recursive: true, force: true })
console.log(`wrote ${out}`)
