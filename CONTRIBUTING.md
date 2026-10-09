# Contributing

The project is small on purpose: one WebGL shader, an editor model, a GIF writer and one HTML page.
Bug reports with a photo that behaves badly are the most useful thing you can send.

## Set up

```sh
git clone https://github.com/Arthur031221/OohAlive
cd OohAlive
npm ci
npm run build   # writes dist/index.html, the single file the site serves
npm test        # editor, freeze mask, photo sizing and GIF writer, in plain Node
npx playwright install chromium
npm run test:e2e
npm run verify  # downloads a real GIF from the built page and checks the file
```

Node 22 or newer. The e2e tests run Chromium with software WebGL, so they pass on a machine without a GPU.

## Where things live

| Path | What it does |
| --- | --- |
| `src/core/renderer.js` | The WebGL 2 flow shader. Preview and export both call `draw()`. |
| `src/core/editor.js` | Arrows, freeze strokes, sliders and undo. No DOM. |
| `src/core/freeze.js` | The freeze mask and the brush. |
| `src/core/gif.js` | The GIF writer: one palette, ordered dither, unchanged pixels left transparent. |
| `src/core/photo.js`, `export.js` | Photo decoding with EXIF rotation, and rendering the loop for export. |
| `src/app/` | The page: stage, controls, theme. |
| `scripts/` | `build.mjs` bundles the single file, `verify.mjs` checks a real download, `record-demo.mjs` and `make-assets.mjs` make the README pictures. |

## Rules for a pull request

- `npm test`, `npm run test:e2e` and `npm run verify` pass. Commit the rebuilt `dist/index.html`, CI checks that it is current.
- A bug fix comes with a test that fails without it. Compare buffers with `same()` from `test/e2e/helpers.js`, never `assert.deepEqual`: on a mismatch it tries to print the whole image.
- Nothing may leave the page. The app makes no network requests and `verify` fails if it does.
- Keep `src/core` free of the DOM where it can be.
- Photos added to the repository must be CC0 or your own, with the source noted in `assets/photos/README.md`.
