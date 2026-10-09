export const MAX_EDGE = 1600

/** Largest size that fits the limit without upscaling and keeps the aspect ratio. */
export function fitWithin(width, height, limit = MAX_EDGE) {
  const scale = Math.min(1, limit / Math.max(width, height))
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

function toCanvas(source, sourceWidth, sourceHeight, limit) {
  const { width, height } = fitWithin(sourceWidth, sourceHeight, limit)
  const canvas = Object.assign(document.createElement('canvas'), { width, height })
  const ctx = canvas.getContext('2d')
  ctx.imageSmoothingQuality = 'high'
  // The GIF has no alpha, so a transparent PNG sits on white instead of turning black.
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, width, height)
  ctx.drawImage(source, 0, 0, width, height)
  return canvas
}

/** Decode a file with its EXIF rotation applied, capped so a 50 megapixel photo stays cheap. */
export async function readPhoto(blob, limit = MAX_EDGE) {
  // Browsers that predate the 'from-image' value already apply EXIF rotation by default.
  const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' }).catch((error) => {
    if (error instanceof TypeError) return createImageBitmap(blob)
    throw error
  })
  try {
    return toCanvas(bitmap, bitmap.width, bitmap.height, limit)
  } finally {
    bitmap.close()
  }
}

export async function readPhotoUrl(url, limit = MAX_EDGE) {
  const image = new Image()
  image.src = url
  await image.decode()
  return toCanvas(image, image.naturalWidth, image.naturalHeight, limit)
}

/** A smaller copy for the GIF, so the export samples the photo one to one. */
export function scaleCanvas(canvas, limit) {
  return toCanvas(canvas, canvas.width, canvas.height, limit)
}
