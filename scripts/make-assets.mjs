// Builds the README pictures that are not a recording: the still photo for the
// before and after pair, and the 1200x675 social card.
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { appUrl, launch, root } from '../test/e2e/helpers.js'

const asset = (name) => resolve(root, 'assets', name)
const font = (file) => readFileSync(resolve(root, 'node_modules', file)).toString('base64')

// Same pixels the GIF starts from: the photo at the GIF size.
execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', asset('photos/yellow-clouds.jpg'), '-vf', 'scale=480:320:flags=lanczos', '-q:v', '3', asset('still.jpg')])

const browser = await launch()
const app = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2, colorScheme: 'dark' })
const appPage = await app.newPage()
await appPage.goto(appUrl)
await appPage.waitForSelector('html[data-ready=true]')
await appPage.evaluate(() => document.getElementById('hint').classList.add('gone'))
await appPage.waitForTimeout(700)
const shot = (await appPage.locator('#stage').screenshot()).toString('base64')
await app.close()

const html = `<!doctype html><meta charset="utf-8"><style>
@font-face{font-family:Fraunces;font-style:italic;font-weight:100 900;src:url(data:font/woff2;base64,${font('@fontsource-variable/fraunces/files/fraunces-latin-soft-italic.woff2')})}
@font-face{font-family:Fraunces;font-style:normal;font-weight:100 900;src:url(data:font/woff2;base64,${font('@fontsource-variable/fraunces/files/fraunces-latin-soft-normal.woff2')})}
@font-face{font-family:Sans;font-weight:500;src:url(data:font/woff2;base64,${font('@fontsource/instrument-sans/files/instrument-sans-latin-500-normal.woff2')})}
*{box-sizing:border-box;margin:0}
body{width:1200px;height:675px;overflow:hidden;background:#19161d;color:#f5eff8;font-family:Sans,sans-serif;position:relative}
.glow{position:absolute;inset:0;background:radial-gradient(60% 80% at 82% 52%,rgba(143,124,255,.34),transparent 70%),radial-gradient(40% 50% at 8% 110%,rgba(255,170,90,.16),transparent 70%)}
.copy{position:absolute;left:76px;top:0;bottom:0;width:480px;display:flex;flex-direction:column;justify-content:center;gap:26px}
.mark{width:64px;height:64px}
h1{font-family:Fraunces,serif;font-weight:640;font-size:112px;line-height:.95;letter-spacing:-.02em}
h1 i{font-weight:520;color:#a89aff}
p{font-size:31px;line-height:1.3;color:#cfc7da}
.fine{font-size:21px;color:#9a91a8;white-space:nowrap}
.photo{position:absolute;left:596px;top:132px;width:590px;height:393px;border-radius:30px;overflow:hidden;
  box-shadow:0 40px 90px -30px #000,0 0 0 1px rgba(255,255,255,.1);transform:rotate(2deg)}
.photo img{width:100%;height:100%;object-fit:cover;display:block}
</style>
<div class="glow"></div>
<div class="copy">
<svg class="mark" viewBox="0 0 64 64"><rect width="64" height="64" rx="16" fill="#8f7cff"/><path d="M12 26c8-8 16 8 24 0s10-4 14 0M44 18l9 8-9 8M12 44c8-8 16 8 24 0s10-4 16 0" fill="none" stroke="#130e2e" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></svg>
<h1><i>Ooh</i>Alive</h1>
<p>Draw an arrow on a photo and it starts to move.</p>
<div class="fine">Free GIF. No account. Nothing leaves your browser.</div>
</div>
<div class="photo"><img src="data:image/png;base64,${shot}"></div>`

const card = await browser.newPage({ viewport: { width: 1200, height: 675 } })
await card.setContent(html)
await card.evaluate(() => document.fonts.ready)
await card.screenshot({ path: asset('social-card.png') })
await browser.close()
console.log('wrote still.jpg and social-card.png')
