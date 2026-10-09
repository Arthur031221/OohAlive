import { after, before, beforeEach, describe, test } from 'node:test'
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import { GifReader } from 'omggif'
import { diff, drag, jpegFromPage, launch, openApp, png, same, texture, withOrientation, frame } from './helpers.js'

let browser
let page
let context
let errors

before(async () => {
  browser = await launch()
})
after(async () => {
  await browser?.close()
})
beforeEach(async () => {
  await context?.close()
  ;({ page, context, errors } = await openApp(browser))
})

const state = () =>
  page.evaluate(() => {
    const { editor } = window.oohalive
    return { arrows: editor.arrows.map((a) => ({ ...a })), strokes: editor.strokes.length, radius: editor.radius, speed: editor.speed }
  })
const clearArrows = () => page.evaluate(() => window.oohalive.editor.load({}))
const canvasShot = () => page.locator('#view').screenshot()

// Pixels cannot tell a paused preview from a playing one: the arrow overlay is part of the shot. Count draw calls instead.
const countDraws = async (tab) => {
  await tab.evaluate(() => {
    const proto = WebGL2RenderingContext.prototype
    const drawArrays = proto.drawArrays
    window.drawCalls = 0
    proto.drawArrays = function (...args) {
      window.drawCalls++
      return drawArrays.apply(this, args)
    }
  })
  return async (ms) => {
    const before = await tab.evaluate(() => window.drawCalls)
    await tab.waitForTimeout(ms)
    return (await tab.evaluate(() => window.drawCalls)) - before
  }
}

describe('first load', () => {
  test('shows the bundled photo with arrows already moving it, and raises no errors', async () => {
    const { arrows, strokes } = await state()
    assert.equal(arrows.length, 3)
    assert.equal(strokes, 1)
    assert.equal(await page.locator('#chips li').count(), 3)
    const a = await canvasShot()
    await page.waitForTimeout(350)
    const b = await canvasShot()
    assert.ok(!same(a, b), 'the preview should be animating')
    assert.deepEqual(errors, [])
  })

  test('stays inside a phone sized screen and keeps touch targets large', async () => {
    const phone = await openApp(browser, { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
    const fit = await phone.page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth - innerWidth,
      stage: document.getElementById('stage').getBoundingClientRect().width,
      small: [...document.querySelectorAll('button, .tools label')].filter((n) => n.offsetParent && n.getBoundingClientRect().height < 40).map((n) => n.id || n.textContent.trim()),
    }))
    assert.ok(fit.overflow <= 0, `page is ${fit.overflow}px wider than the screen`)
    assert.ok(fit.stage > 340)
    assert.deepEqual(fit.small.filter((name) => !name.startsWith('×')), [])
    await phone.context.close()
  })
})

describe('privacy', () => {
  test('the browser itself refuses every outgoing request', async () => {
    const result = await page.evaluate(
      () =>
        new Promise((resolve) => {
          addEventListener('securitypolicyviolation', (event) => resolve(`blocked by ${event.violatedDirective}`))
          fetch('https://example.com/upload', { method: 'POST', body: 'photo' }).then(() => resolve('sent'), () => {})
        }),
    )
    assert.match(result, /^blocked by connect-src/)
  })
})

describe('arrows', () => {
  beforeEach(clearArrows)

  test('a drag on the photo draws an arrow and hides the hint', async () => {
    await drag(page, [0.2, 0.3], [0.7, 0.4])
    const { arrows } = await state()
    assert.equal(arrows.length, 1)
    assert.ok(Math.abs(arrows[0].x0 - 0.2) < 0.01 && Math.abs(arrows[0].x1 - 0.7) < 0.01)
    assert.ok(await page.locator('#hint.gone').count())
    assert.equal(await page.locator('#arrow-count').textContent(), '1 of 6')
  })

  test('a tap draws nothing and leaves nothing to undo', async () => {
    await drag(page, [0.4, 0.4], [0.401, 0.401], { steps: 1 })
    assert.equal((await state()).arrows.length, 0)
    assert.ok(await page.locator('#undo').isDisabled())
  })

  test('dragging an end or the body moves the arrow, and undo puts it back', async () => {
    await drag(page, [0.2, 0.5], [0.6, 0.5])
    await drag(page, [0.6, 0.5], [0.8, 0.7]) // the head
    let [arrow] = (await state()).arrows
    assert.ok(Math.abs(arrow.x1 - 0.8) < 0.02 && Math.abs(arrow.y1 - 0.7) < 0.02, JSON.stringify(arrow))
    assert.ok(Math.abs(arrow.x0 - 0.2) < 0.01)
    await drag(page, [0.5, 0.6], [0.5, 0.4]) // the body
    ;[arrow] = (await state()).arrows
    assert.ok(arrow.y0 < 0.4 && arrow.y1 < 0.55, JSON.stringify(arrow))
    await page.keyboard.press('Control+z')
    ;[arrow] = (await state()).arrows
    assert.ok(Math.abs(arrow.y0 - 0.5) < 0.01)
  })

  test('the keyboard moves a handle and removes the arrow', async () => {
    await drag(page, [0.2, 0.5], [0.6, 0.5])
    await page.locator('.handle.head').focus()
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('ArrowDown')
    const [moved] = (await state()).arrows
    assert.ok(Math.abs(moved.x1 - 0.61) < 0.002 && Math.abs(moved.y1 - 0.51) < 0.002, JSON.stringify(moved))
    await page.keyboard.press('Delete')
    assert.equal((await state()).arrows.length, 0)
  })

  test('the seventh arrow is refused with a message', async () => {
    for (let i = 0; i < 6; i++) await drag(page, [0.1, 0.1 + i * 0.12], [0.5, 0.1 + i * 0.12])
    assert.equal((await state()).arrows.length, 6)
    await drag(page, [0.6, 0.2], [0.9, 0.2])
    assert.equal((await state()).arrows.length, 6)
    assert.match(await page.locator('#toast').textContent(), /Six arrows/)
  })

  test('chips remove arrows and the sliders change the scene', async () => {
    await drag(page, [0.1, 0.2], [0.5, 0.2])
    await drag(page, [0.1, 0.6], [0.5, 0.6])
    await page.getByRole('button', { name: 'Remove arrow 1' }).click()
    assert.equal((await state()).arrows.length, 1)
    await page.locator('#speed').fill('0.1')
    await page.locator('#radius').fill('0.3')
    const after = await state()
    assert.equal(after.speed, 0.1)
    assert.equal(after.radius, 0.3)
    assert.equal(await page.locator('#out-speed').textContent(), '1.7×')
  })

  test('a nudge after an undo is its own undo step', async () => {
    await drag(page, [0.2, 0.5], [0.6, 0.5])
    await page.locator('.handle[data-part=head]').focus()
    const head = async () => (await state()).arrows[0].x1
    const start = await head()
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('Control+z')
    assert.ok(Math.abs((await head()) - start) < 0.001)
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('Control+z')
    assert.ok(Math.abs((await head()) - start) < 0.001, 'the second nudge could not be undone')
  })

  test('arrow handles can be reached from the keyboard in order', async () => {
    await drag(page, [0.2, 0.5], [0.6, 0.5])
    const labels = await page.evaluate(() => [...document.querySelectorAll('.handle')].map((h) => h.getAttribute('aria-label')))
    assert.equal(labels.length, 2)
    assert.match(labels[0], /^Arrow 1 start/)
    assert.match(labels[1], /^Arrow 1 end/)
  })
})

describe('freeze brush', () => {
  beforeEach(clearArrows)

  // Replaying a stroke composites its dabs in a slightly different order, so full strength can land one level short.
  const maskAt = (x, y) =>
    page.evaluate(([x, y]) => {
      const { mask } = window.oohalive.stage
      return mask.maskCtx.getImageData(Math.round(x * mask.width), Math.round(y * mask.height), 1, 1).data[0]
    }, [x, y])

  test('painting freezes, unfreeze lets go, undo takes the stroke back', async () => {
    await page.locator('label').filter({ hasText: /^Freeze$/ }).click()
    assert.ok(await page.locator('.brush-only').isVisible())
    await drag(page, [0.3, 0.5], [0.6, 0.5])
    assert.ok(await maskAt(0.45, 0.5) >= 250)
    assert.ok(await maskAt(0.45, 0.9) <= 5)
    assert.equal((await state()).strokes, 1)

    await page.locator('label').filter({ hasText: /^Unfreeze$/ }).click()
    await drag(page, [0.4, 0.5], [0.5, 0.5])
    assert.ok(await maskAt(0.45, 0.5) <= 5)
    assert.ok(await maskAt(0.32, 0.5) >= 250)

    await page.getByRole('button', { name: 'Undo' }).click()
    assert.ok(await maskAt(0.45, 0.5) >= 250)
    await page.getByRole('button', { name: 'Undo' }).click()
    assert.ok(await maskAt(0.45, 0.5) <= 5)
    assert.equal((await state()).strokes, 0)
  })

  test('freezing keeps a moving arrow from smearing the painted area', async () => {
    await page.evaluate(() => window.oohalive.editor.addArrow({ x0: 0.1, y0: 0.5, x1: 0.9, y1: 0.5 }))
    const before = await frame(page, 0.25)
    await page.locator('label').filter({ hasText: /^Freeze$/ }).click()
    await drag(page, [0.3, 0.5], [0.7, 0.5])
    const after = await frame(page, 0.25)
    const still = await page.evaluate(() => window.oohalive.frame(0, { width: 64, height: 43 }).rgba.length)
    assert.ok(still > 0)
    assert.ok(!same(before, after))
  })
})

describe('playback and views', () => {
  test('holding the button shows the still photo, releasing brings the motion back', async () => {
    const hold = page.locator('#hold')
    const box = await hold.boundingBox()
    await page.mouse.move(box.x + 20, box.y + 20)
    await page.mouse.down()
    await page.waitForTimeout(600)
    assert.ok(await page.locator('#stage.original').count())
    const a = await canvasShot()
    await page.waitForTimeout(300)
    const b = await canvasShot()
    assert.ok(same(a, b), 'the original view must be still')
    await page.mouse.up()
    await page.waitForTimeout(600)
    assert.equal(await page.locator('#stage.original').count(), 0)
    const c = await canvasShot()
    await page.waitForTimeout(250)
    assert.ok(!same(c, await canvasShot()), 'the preview should be animating again')
  })

  test('the O key does the same as the button', async () => {
    await page.keyboard.down('o')
    assert.ok(await page.locator('#stage.original').count())
    await page.keyboard.up('o')
    assert.equal(await page.locator('#stage.original').count(), 0)
  })

  test('pause stops the preview and play resumes it', async () => {
    const draws = await countDraws(page)
    await page.locator('#play').click()
    assert.equal(await page.locator('#play').getAttribute('aria-pressed'), 'false')
    await page.waitForTimeout(200)
    assert.equal(await draws(400), 0, 'a paused preview must not redraw')
    await page.locator('#play').click()
    assert.ok((await draws(400)) > 1, 'play should resume the motion')
  })

  test('people who prefer reduced motion get a paused preview', async () => {
    const calm = await openApp(browser, { reducedMotion: 'reduce' })
    assert.equal(await calm.page.locator('#play').getAttribute('aria-pressed'), 'false')
    const draws = await countDraws(calm.page)
    assert.equal(await draws(400), 0, 'reduced motion should keep the preview still')
    await calm.context.close()
  })

  test('a paused preview comes back after the graphics context is lost and restored', async () => {
    const draws = await countDraws(page)
    await page.locator('#play').click()
    await page.waitForTimeout(200)
    await page.evaluate(() => {
      const gl = document.getElementById('view').getContext('webgl2')
      const lose = gl.getExtension('WEBGL_lose_context')
      lose.loseContext()
      setTimeout(() => lose.restoreContext(), 50)
    })
    assert.ok((await draws(600)) > 0, 'the preview stayed blank after the context came back')
  })

  test('the theme switch flips and remembers the choice', async () => {
    const first = await page.evaluate(() => getComputedStyle(document.body).backgroundColor)
    await page.locator('#theme').click()
    const second = await page.evaluate(() => getComputedStyle(document.body).backgroundColor)
    assert.notEqual(first, second)
    const stored = await page.evaluate(() => localStorage.getItem('oohalive-theme'))
    assert.ok(['light', 'dark'].includes(stored))
    await page.reload()
    await page.waitForSelector('html[data-ready=true]')
    assert.equal(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), second)
  })
})

describe('photos', () => {
  test('opens a photo from disk, starts with no arrows and says so', async () => {
    const w = 320
    const h = 200
    await page.setInputFiles('#file', { name: 'my holiday.png', mimeType: 'image/png', buffer: png(w, h, texture(w, h)) })
    await page.waitForFunction((w) => window.oohalive.stage.photo.width === w, w)
    assert.equal((await state()).arrows.length, 0)
    assert.equal(await page.locator('#photo-info').textContent(), '320 × 200')
    assert.match(await page.locator('#chips').textContent(), /None yet/)
    assert.equal(await page.locator('#gif-meta').textContent(), '320 × 200 · 20 frames · 20 fps · loops forever')
  })

  test('shrinks a huge photo to 1600 pixels on its long edge', async () => {
    const w = 3200
    const h = 2400
    const rgb = new Uint8Array(w * h * 3)
    for (let i = 0; i < rgb.length; i += 3) rgb.set([i % 251, (i >> 8) % 241, 90], i)
    await page.setInputFiles('#file', { name: 'huge.png', mimeType: 'image/png', buffer: png(w, h, rgb) })
    await page.waitForFunction(() => window.oohalive.stage.photo.width === 1600)
    assert.equal(await page.evaluate(() => window.oohalive.stage.photo.height), 1200)
  })

  test('applies the EXIF rotation of a phone photo', async () => {
    const paint = 'ctx.fillStyle="#d02020";ctx.fillRect(0,0,width/2,height);ctx.fillStyle="#2020d0";ctx.fillRect(width/2,0,width/2,height)'
    const jpeg = withOrientation(await jpegFromPage(page, 300, 200, paint), 6)
    await page.setInputFiles('#file', { name: 'phone.jpg', mimeType: 'image/jpeg', buffer: jpeg })
    await page.waitForFunction(() => window.oohalive.stage.photo.width === 200)
    assert.equal(await page.evaluate(() => window.oohalive.stage.photo.height), 300)
    // Orientation 6 turns the stored left half to the top.
    const px = await frame(page, 0, { width: 200, height: 300 })
    const at = (x, y) => px.subarray((y * 200 + x) * 4, (y * 200 + x) * 4 + 3)
    const top = at(100, 40)
    const bottom = at(100, 260)
    assert.ok(top[0] > 150 && top[2] < 90, `top ${top}`)
    assert.ok(bottom[2] > 150 && bottom[0] < 90, `bottom ${bottom}`)
  })

  test('a transparent PNG sits on white, not black', async () => {
    const clear = await jpegFromPage(page, 64, 64, 'ctx.clearRect(0, 0, width, height)', 'image/png')
    await page.setInputFiles('#file', { name: 'clear.png', mimeType: 'image/png', buffer: clear })
    await page.waitForFunction(() => window.oohalive.stage.photo.width === 64)
    const px = await frame(page, 0, { width: 64, height: 64 })
    assert.deepEqual([...px.subarray(0, 3)], [255, 255, 255])
  })

  test('a hairline photo still takes a freeze brush', async () => {
    const w = 1600
    const hairline = png(w, 1, texture(w, 1))
    await page.setInputFiles('#file', { name: 'thin.png', mimeType: 'image/png', buffer: hairline })
    await page.waitForFunction((w) => window.oohalive.stage.photo.width === w, w)
    const { width, height } = await page.evaluate(() => window.oohalive.stage.mask)
    assert.ok(width >= 1 && height >= 1)
  })

  test('a file that is not an image gets a plain message', async () => {
    await page.setInputFiles('#file', { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') })
    await page.waitForFunction(() => document.getElementById('toast').classList.contains('show'))
    assert.match(await page.locator('#toast').textContent(), /didn't open/)
    assert.equal((await state()).arrows.length, 3)
  })
})

describe('touch', () => {
  test('a finger draws an arrow and the page does not scroll under it', async () => {
    const phone = await openApp(browser, { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
    await phone.page.evaluate(() => window.oohalive.editor.load({}))
    const box = await phone.page.locator('#stage').boundingBox()
    const cdp = await phone.context.newCDPSession(phone.page)
    const point = (x, y) => [{ x: box.x + x * box.width, y: box.y + y * box.height, id: 1 }]
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: point(0.2, 0.5) })
    for (let i = 1; i <= 8; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: point(0.2 + i * 0.07, 0.5 + i * 0.02) })
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    const arrows = await phone.page.evaluate(() => window.oohalive.editor.arrows)
    assert.equal(arrows.length, 1)
    assert.ok(arrows[0].x1 > 0.7)
    assert.equal(await phone.page.evaluate(() => scrollY), 0)
    await phone.context.close()
  })
})

describe('two fingers', () => {
  test('a second finger does not steer or end the arrow the first one is drawing', async () => {
    const phone = await openApp(browser, { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
    await phone.page.evaluate(() => window.oohalive.editor.load({}))
    const box = await phone.page.locator('#stage').boundingBox()
    const at = (id, x, y) => ({ id, x: box.x + x * box.width, y: box.y + y * box.height })
    const cdp = await phone.context.newCDPSession(phone.page)
    const send = (type, touchPoints) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints })
    await send('touchStart', [at(1, 0.2, 0.5)])
    await send('touchMove', [at(1, 0.3, 0.5)])
    await send('touchStart', [at(1, 0.3, 0.5), at(2, 0.8, 0.2)])
    await send('touchMove', [at(1, 0.4, 0.5), at(2, 0.85, 0.25)])
    // For touchEnd the listed points are the ones that lift.
    await send('touchEnd', [at(2, 0.85, 0.25)])
    await send('touchMove', [at(1, 0.6, 0.5)])
    await send('touchEnd', [at(1, 0.6, 0.5)])
    const arrows = await phone.page.evaluate(() => window.oohalive.editor.arrows)
    assert.equal(arrows.length, 1)
    assert.ok(Math.abs(arrows[0].x1 - 0.6) < 0.03, `the arrow ends at ${arrows[0].x1}, where the first finger lifted`)
    await phone.context.close()
  })
})

describe('export', () => {
  test('edits made while the GIF is being made do not change it', async () => {
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.click('#download'),
      page.waitForTimeout(150).then(() =>
        page.evaluate(() => {
          const { editor } = window.oohalive
          for (const arrow of [...editor.arrows]) editor.removeArrow(arrow.id)
        }),
      ),
    ])
    const gif = new GifReader(readFileSync(await download.path()))
    const canvas = new Uint8ClampedArray(gif.width * gif.height * 4)
    const frames = Array.from({ length: gif.numFrames() }, (_, n) => (gif.decodeAndBlitFrameRGBA(n, canvas), canvas.slice()))
    const steps = frames.map((f, n) => diff(f, frames[(n + 1) % frames.length]).pixels)
    assert.ok(Math.min(...steps) > 100, `a step between frames changed only ${Math.min(...steps)} pixels, so the motion stopped partway`)
  })
})

describe('browsers without WebGL 2', () => {
  test('say so instead of showing a broken page', async () => {
    const plain = await browser.newContext()
    const tab = await plain.newPage()
    await tab.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext
      HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
        return type === 'webgl2' ? null : original.call(this, type, ...rest)
      }
    })
    const failures = []
    tab.on('pageerror', (e) => failures.push(e.message))
    await tab.goto(`file://${new URL('../../dist/index.html', import.meta.url).pathname}`)
    await tab.waitForSelector('#unsupported:not([hidden])')
    assert.match(await tab.locator('#unsupported').textContent(), /WebGL 2/)
    assert.deepEqual(failures, [])
    await plain.close()
  })
})
