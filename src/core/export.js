// Render the loop with the same shader the preview uses, then encode it.
import { Renderer } from './renderer.js'
import { GIF, encodeGif, gifSize } from './gif.js'
import { scaleCanvas } from './photo.js'

let shared = null

/** One hidden renderer is reused, because browsers cap the number of WebGL contexts. */
function exportRenderer() {
  shared ??= new Renderer(document.createElement('canvas'))
  return shared
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

/** RGBA frames of the loop at the GIF size. Also used by tests and the verify script. */
export async function renderFrames({ photo, freeze, params, size, frames = GIF.frames, onProgress }) {
  const renderer = exportRenderer()
  renderer.setPhoto(size.width === photo.width ? photo : scaleCanvas(photo, Math.max(size.width, size.height)))
  renderer.setFreeze(freeze)
  renderer.resize(size.width, size.height)
  const out = []
  for (let i = 0; i < frames; i++) {
    renderer.draw(params, i / frames)
    out.push(renderer.read())
    onProgress?.(i + 1, frames)
    if (i % 4 === 3) await tick()
  }
  return out
}

/** Frame at one phase, for inspection. The pixel size may differ from the photo. */
export function renderOne({ photo, freeze, params, size, phase }) {
  const renderer = exportRenderer()
  renderer.setPhoto(size.width === photo.width ? photo : scaleCanvas(photo, Math.max(size.width, size.height)))
  renderer.setFreeze(freeze)
  renderer.resize(size.width, size.height)
  renderer.draw(params, phase)
  return renderer.read()
}

/** Resolves to a GIF Blob. Progress runs 0..1 over rendering and encoding. */
export async function exportGif({ photo, freeze, params, onProgress }) {
  const size = gifSize(photo.width, photo.height)
  // The editor stays live while the frames render, so keep the arrows as they were at the click.
  params = { ...params, arrows: params.arrows.map((arrow) => ({ ...arrow })) }
  const frames = await renderFrames({ photo, freeze, params, size, onProgress: (n, total) => onProgress?.((n / total) * 0.5) })
  let encoded = 0
  const bytes = await new Promise((resolve, reject) => {
    // Encode in the next task so the progress bar can paint between the two stages.
    setTimeout(() => {
      try {
        resolve(
          encodeGif(frames, size.width, size.height, {
            onFrame: () => onProgress?.(0.5 + (++encoded / frames.length) * 0.5),
          }),
        )
      } catch (error) {
        reject(error)
      }
    }, 0)
  })
  return new Blob([bytes], { type: 'image/gif' })
}
