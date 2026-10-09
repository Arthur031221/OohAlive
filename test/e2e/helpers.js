import { chromium, firefox, webkit } from 'playwright'
import { deflateSync } from 'node:zlib'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
export const appUrl = `file://${root}/dist/index.html`

const ENGINES = { chromium, firefox, webkit }
// Software GL keeps the WebGL tests identical on machines without a GPU.
const LAUNCH = { chromium: { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] } }

export const browserName = process.env.PW_BROWSER ?? 'chromium'

export async function launch(options = {}) {
  return ENGINES[browserName].launch({ ...LAUNCH[browserName], ...options })
}

/** Open the app and wait until the demo photo is on screen. */
export async function openApp(browser, contextOptions = {}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, acceptDownloads: true, ...contextOptions })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(appUrl)
  await page.waitForSelector('html[data-ready=true]')
  return { context, page, errors }
}

/** RGBA bytes of one frame, rendered by the app's own renderer at the given size. */
export async function frame(page, phase, size) {
  const base64 = await page.evaluate(
    ([phase, size]) => {
      const { rgba } = window.oohalive.frame(phase, size ?? undefined)
      let text = ''
      for (let i = 0; i < rgba.length; i += 0x8000) text += String.fromCharCode(...rgba.subarray(i, i + 0x8000))
      return btoa(text)
    },
    [phase, size ?? null],
  )
  return new Uint8Array(Buffer.from(base64, 'base64'))
}

/** Byte equality that never prints the buffers, which assert.deepEqual does on failure. */
export const same = (a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0

/** Largest per channel difference and the count of differing pixels between two RGBA buffers. */
export function diff(a, b, { skipAlpha = true } = {}) {
  let max = 0
  let pixels = 0
  for (let i = 0; i < a.length; i += 4) {
    let local = 0
    for (let c = 0; c < (skipAlpha ? 3 : 4); c++) local = Math.max(local, Math.abs(a[i + c] - b[i + c]))
    if (local > 0) pixels++
    max = Math.max(max, local)
  }
  return { max, pixels }
}

/** Mean squared error to PSNR in dB, over RGB. */
export function psnr(a, b) {
  let sum = 0
  let n = 0
  for (let i = 0; i < a.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const d = a[i + c] - b[i + c]
      sum += d * d
      n++
    }
  }
  return sum === 0 ? Infinity : 10 * Math.log10((255 * 255) / (sum / n))
}

// A PNG writer small enough to live in a test, so photos can be synthesised without a codec.
const CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
const crc32 = (buf) => {
  let c = 0xffffffff
  for (const byte of buf) c = CRC[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length)
  out.writeUInt32BE(data.length, 0)
  out.write(type, 4, 'latin1')
  data.copy(out, 8)
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length)
  return out
}

/** rgb is a Uint8Array of width*height*3. */
export function png(width, height, rgb) {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header.set([8, 2, 0, 0, 0], 8)
  const rows = Buffer.alloc((width * 3 + 1) * height)
  for (let y = 0; y < height; y++) {
    rows[y * (width * 3 + 1)] = 0
    Buffer.from(rgb.buffer, rgb.byteOffset + y * width * 3, width * 3).copy(rows, y * (width * 3 + 1) + 1)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/** Deterministic texture with detail at every scale, so any shift or smear shows up. */
export function texture(width, height) {
  const rgb = new Uint8Array(width * height * 3)
  let seed = 12345
  const random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296)
  for (let i = 0; i < rgb.length; i++) rgb[i] = Math.floor(random() * 256)
  return rgb
}

/** Press, drag and release on the photo, with points given as fractions of its width and height. */
export async function drag(page, from, to, { steps = 12 } = {}) {
  const box = await page.locator('#stage').boundingBox()
  const at = ([x, y]) => [box.x + x * box.width, box.y + y * box.height]
  await page.mouse.move(...at(from))
  await page.mouse.down()
  await page.mouse.move(...at(to), { steps })
  await page.mouse.up()
}

/** Image bytes (JPEG unless told otherwise) of a canvas drawn in the page, so the tests need no image encoder of their own. */
export async function jpegFromPage(page, width, height, paint, mime = 'image/jpeg') {
  const base64 = await page.evaluate(
    async ([width, height, paint, mime]) => {
      const canvas = Object.assign(document.createElement('canvas'), { width, height })
      new Function('ctx', 'width', 'height', paint)(canvas.getContext('2d'), width, height)
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, mime, 0.95))
      const bytes = new Uint8Array(await blob.arrayBuffer())
      let text = ''
      for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
      return btoa(text)
    },
    [width, height, paint, mime],
  )
  return Buffer.from(base64, 'base64')
}

/** Insert an EXIF block that says "rotate this photo": 6 is a phone held upright. */
export function withOrientation(jpeg, orientation) {
  const tiff = Buffer.from([
    0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08, // big endian, first IFD at 8
    0x00, 0x01, // one entry
    0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, 0x00, orientation, 0x00, 0x00, // Orientation, SHORT
    0x00, 0x00, 0x00, 0x00, // no next IFD
  ])
  const body = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff])
  const header = Buffer.from([0xff, 0xe1, (body.length + 2) >> 8, (body.length + 2) & 0xff])
  return Buffer.concat([jpeg.subarray(0, 2), header, body, jpeg.subarray(2)])
}
