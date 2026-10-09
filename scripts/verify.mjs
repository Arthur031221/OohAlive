// Runs the built page in a real browser, downloads the GIF it makes and checks
// the file with an independent decoder. Prints the numbers the README quotes.
import { GifReader } from 'omggif'
import { createServer } from 'node:http'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { frame as renderedFrame, launch, psnr } from '../test/e2e/helpers.js'

const root = resolve(import.meta.dirname, '..')
const html = readFileSync(resolve(root, 'dist/index.html'))
const failures = []
const check = (ok, message) => {
  if (!ok) failures.push(message)
}

const requests = []
const server = createServer((req, res) => {
  requests.push(req.url)
  if (req.url !== '/') return res.writeHead(404).end()
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(html)
})
await new Promise((done) => server.listen(0, '127.0.0.1', done))

const browser = await launch()
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 }, acceptDownloads: true })).newPage()
await page.goto(`http://127.0.0.1:${server.address().port}/`)
await page.waitForSelector('html[data-ready=true]')

const started = Date.now()
const [download] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.click('#download')])
const path = await download.path()
const exportMs = Date.now() - started
const bytes = readFileSync(path)
if (process.argv[2]) writeFileSync(process.argv[2], bytes)
// What the shader draws at the same phases, to see what the file did to it.
const reference = []
for (let n = 0; n < 20; n++) reference.push(await renderedFrame(page, n / 20, { width: 480, height: 320 }))
const browserVersion = browser.version()
await browser.close()
server.close()

const gif = new GifReader(bytes)
const { width, height } = gif
// Frames after the first only carry changed pixels, so decode onto one running canvas.
const canvas = new Uint8ClampedArray(width * height * 4)
const frames = Array.from({ length: gif.numFrames() }, (_, n) => {
  gif.decodeAndBlitFrameRGBA(n, canvas)
  return canvas.slice()
})
const delays = new Set(Array.from({ length: gif.numFrames() }, (_, n) => gif.frameInfo(n).delay))

const meanDiff = (a, b) => {
  let sum = 0
  for (let i = 0; i < a.length; i += 4) sum += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2])
  return sum / ((a.length / 4) * 3)
}
const steps = frames.map((frame, n) => meanDiff(frame, frames[(n + 1) % frames.length]))
const wrap = steps.at(-1)
const typical = [...steps.slice(0, -1)].sort((a, b) => a - b)[Math.floor((steps.length - 1) / 2)]

// The boat is frozen in the starting scene, so its pixels must not change at all.
const boat = { x: Math.round(0.333 * width), y: Math.round(0.815 * height), r: 4 }
let boatChanges = 0
for (let dy = -boat.r; dy <= boat.r; dy++) {
  for (let dx = -boat.r; dx <= boat.r; dx++) {
    const i = ((boat.y + dy) * width + boat.x + dx) * 4
    for (let n = 1; n < frames.length; n++) {
      for (let c = 0; c < 3; c++) if (frames[n][i + c] !== frames[0][i + c]) boatChanges++
    }
  }
}
// A window of cloud under the first arrow, where the picture must be moving.
const cloud = { x0: Math.round(0.3 * width), x1: Math.round(0.55 * width), y0: Math.round(0.15 * height), y1: Math.round(0.3 * height) }
const cloudChange = frames.slice(1).map((frame) => {
  let sum = 0
  for (let y = cloud.y0; y < cloud.y1; y++) {
    for (let x = cloud.x0; x < cloud.x1; x++) {
      const i = (y * width + x) * 4
      sum += Math.abs(frame[i] - frames[0][i]) + Math.abs(frame[i + 1] - frames[0][i + 1]) + Math.abs(frame[i + 2] - frames[0][i + 2])
    }
  }
  return sum / ((cloud.x1 - cloud.x0) * (cloud.y1 - cloud.y0) * 3)
})

const worstPsnr = Math.min(...frames.map((f, n) => psnr(f, reference[n])))
check(worstPsnr > 30, `a GIF frame is only ${worstPsnr.toFixed(1)} dB from what the renderer drew`)
check(String.fromCharCode(...bytes.subarray(0, 6)) === 'GIF89a', 'not a GIF89a file')
check(width === 480 && height === 320, `size is ${width}x${height}, expected 480x320`)
check(gif.numFrames() === 20, `${gif.numFrames()} frames, expected 20`)
check(delays.size === 1 && delays.has(5), `frame delays ${[...delays]} (centiseconds), expected 5`)
check(gif.loopCount() === 0, `loop count ${gif.loopCount()}, expected 0 (forever)`)
check(wrap <= typical * 1.5, `the last frame jumps to the first by ${wrap.toFixed(2)}, a typical step is ${typical.toFixed(2)}`)
check(boatChanges === 0, `${boatChanges} channel values changed inside the frozen boat`)
check(Math.min(...cloudChange) > 0.5, `a frame is nearly identical to the first inside the clouds (${Math.min(...cloudChange).toFixed(2)})`)
check(requests.length === 1, `the page made ${requests.length} requests: ${requests.join(' ')}`)

const result = {
  browser: `Chromium ${browserVersion}, software WebGL`,
  gif: `${width}x${height}, ${gif.numFrames()} frames, ${delays.size === 1 ? 1000 / ([...delays][0] * 10) : '?'} fps, loop forever`,
  sizeKB: Math.round(bytes.length / 1024),
  exportSeconds: Number((exportMs / 1000).toFixed(1)),
  loopWrapStep: Number(wrap.toFixed(2)),
  typicalStep: Number(typical.toFixed(2)),
  worstFramePsnrDb: Number(worstPsnr.toFixed(1)),
  boatChangedValues: boatChanges,
  requestsAfterLoad: requests.length - 1,
}
console.log(JSON.stringify(result, null, 2))
if (failures.length) {
  console.error(`FAILED:\n- ${failures.join('\n- ')}`)
  process.exit(1)
}
console.log('verify: all checks passed')
