// src/components/shop/silhouette-cutout.ts
/**
 * Cuts a person out of a photo, in the customer's browser, with Google's free MediaPipe
 * person-segmentation model (Apache-2.0). Nothing leaves the phone until the finished
 * silhouette card is uploaded. The model (~16 MB) and its runtime load from public CDNs the
 * first time someone makes a silhouette, then the browser caches them.
 */
import { maskToAlpha, personBox, personShare, type Box } from '@lib/silhouette'

const VERSION = '0.10.21' // keep in step with package.json
const WASM = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VERSION}/wasm`
/** Six classes: 0 background, 1 hair, 2 body skin, 3 face skin, 4 clothes, 5 other. */
const MODEL = 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite'
/** Long side the photo is shrunk to before cutting: plenty for a 2"×3" print, fast on a phone. */
const WORK_PX = 1200

export interface Cutout {
  /** Solid black person on transparent, WORK_PX on the long side. */
  canvas: HTMLCanvasElement
  /** Box around the person, in `canvas` pixels. */
  person: Box
}
export type CutoutProblem = 'nobody' | 'busy'

type Segmenter = { segment(img: HTMLCanvasElement): { confidenceMasks?: { width: number; height: number; getAsFloat32Array(): Float32Array }[]; close(): void } }
let segmenter: Promise<Segmenter> | null = null

function loadSegmenter(): Promise<Segmenter> {
  segmenter ??= (async () => {
    const { FilesetResolver, ImageSegmenter } = await import('@mediapipe/tasks-vision')
    const files = await FilesetResolver.forVisionTasks(WASM)
    return (await ImageSegmenter.createFromOptions(files, {
      baseOptions: { modelAssetPath: MODEL, delegate: 'CPU' },
      runningMode: 'IMAGE', outputConfidenceMasks: true, outputCategoryMask: false,
    })) as unknown as Segmenter
  })().catch((err) => { segmenter = null; throw err }) // let a retry load it again
  return segmenter
}

/** Start downloading the model early (e.g. when the order window opens). */
export function warmUpCutout(): void { void loadSegmenter().catch(() => undefined) }

export async function cutOut(img: HTMLImageElement): Promise<Cutout | CutoutProblem> {
  const k = Math.min(1, WORK_PX / Math.max(img.naturalWidth, img.naturalHeight))
  const w = Math.max(1, Math.round(img.naturalWidth * k))
  const h = Math.max(1, Math.round(img.naturalHeight * k))
  const src = document.createElement('canvas')
  src.width = w
  src.height = h
  src.getContext('2d')!.drawImage(img, 0, 0, w, h)

  const seg = await loadSegmenter()
  const result = seg.segment(src)
  let alpha: Uint8ClampedArray
  let mw: number
  let mh: number
  try {
    const bg = result.confidenceMasks?.[0]
    if (!bg) throw new Error('no mask')
    mw = bg.width
    mh = bg.height
    const b = bg.getAsFloat32Array()
    const person = new Float32Array(b.length)
    for (let i = 0; i < b.length; i++) person[i] = 1 - b[i]
    alpha = maskToAlpha(person)
  } finally { result.close() }

  const share = personShare(alpha)
  if (share < 0.02) return 'nobody'
  if (share > 0.85) return 'busy'

  // Paint the mask at its own size, then scale it to the working size (smooths the edge too).
  const m = document.createElement('canvas')
  m.width = mw
  m.height = mh
  const data = new ImageData(mw, mh)
  for (let i = 0; i < alpha.length; i++) data.data[i * 4 + 3] = alpha[i] // black, with alpha
  m.getContext('2d')!.putImageData(data, 0, 0)
  const out = document.createElement('canvas')
  out.width = w
  out.height = h
  const ctx = out.getContext('2d')!
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(m, 0, 0, w, h)
  const box = personBox(alpha, mw, mh)!
  const sx = w / mw
  const sy = h / mh
  return { canvas: out, person: { x: box.x * sx, y: box.y * sy, w: box.w * sx, h: box.h * sy } }
}
