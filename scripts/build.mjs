// Bundles the app into one self-contained dist/index.html: script, styles,
// fonts and the demo photo are all inlined, so the page works from a double
// click, from GitHub Pages and offline.
import { build } from 'esbuild'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const read = (...parts) => readFileSync(resolve(root, ...parts))

const bundle = await build({
  entryPoints: [resolve(root, 'src/app/main.js')],
  bundle: true,
  minify: true,
  format: 'iife',
  target: ['chrome110', 'firefox110', 'safari16'],
  loader: { '.jpg': 'dataurl' },
  write: false,
  legalComments: 'none',
})
// "</script" inside a string would end the inline script early.
const script = bundle.outputFiles[0].text.replaceAll('</script', '<\\/script')

const face = (family, file, { style = 'normal', weight }) =>
  `@font-face{font-family:'${family}';font-style:${style};font-weight:${weight};font-display:swap;` +
  `src:url(data:font/woff2;base64,${read(file).toString('base64')}) format('woff2')}`
const fonts = [
  face('Fraunces', 'node_modules/@fontsource-variable/fraunces/files/fraunces-latin-soft-normal.woff2', { weight: '100 900' }),
  face('Fraunces', 'node_modules/@fontsource-variable/fraunces/files/fraunces-latin-soft-italic.woff2', { weight: '100 900', style: 'italic' }),
  ...[400, 500, 600].map((weight) =>
    face('Instrument Sans', `node_modules/@fontsource/instrument-sans/files/instrument-sans-latin-${weight}-normal.woff2`, { weight }),
  ),
].join('\n')

const css = `${fonts}\n${read('src/app/styles.css')}`
const html = read('src/app/index.html').toString().replace('<!--STYLE-->', () => css).replace('<!--SCRIPT-->', () => script)

mkdirSync(resolve(root, 'dist'), { recursive: true })
writeFileSync(resolve(root, 'dist/index.html'), html)
console.log(`dist/index.html ${(html.length / 1024).toFixed(0)} KB`)
