/* On-device OCR with Tesseract.js (github.com/naptha/tesseract.js, Apache-2.0).

   Why this is the default rather than a cloud model: it needs no API key, no
   account and no network round trip with a photo of a personal journal in it.
   The image never leaves the machine. It also cannot be rate limited or
   withdrawn, and it works offline once the language data is cached.

   What it is good at: printed and clearly separated handwriting. Measured
   around 2% character error on neat writing.
   What it is bad at: joined-up cursive, where it drops to roughly 40% error,
   because it segments characters and connected letters defeat that. When the
   result looks like nonsense, that is why, and the Groq reader is the answer. */

import { createWorker, type Worker } from 'tesseract.js'

export type OcrLang = 'ces+eng' | 'ces' | 'eng'

export interface OcrResult {
  text: string
  /** 0-100 from Tesseract. Low means it struggled, usually cursive. */
  confidence: number
}

let worker: Worker | null = null
let workerLang: OcrLang | null = null

/* One worker, reused. Spinning one up downloads the language data, so throwing
   it away between pages would re-pay that cost every time. */
async function getWorker(lang: OcrLang, onProgress?: (pct: number) => void): Promise<Worker> {
  if (worker && workerLang === lang) return worker
  if (worker) { await worker.terminate(); worker = null; workerLang = null }
  worker = await createWorker(lang, 1, {
    logger: (m: { status: string; progress: number }) => {
      if (onProgress && (m.status === 'recognizing text' || m.status.startsWith('loading') || m.status.startsWith('initializ')))
        onProgress(Math.round(m.progress * 100))
    },
  })
  workerLang = lang
  return worker
}

export async function readImage(dataUrl: string, lang: OcrLang = 'ces+eng', onProgress?: (pct: number) => void): Promise<OcrResult> {
  const w = await getWorker(lang, onProgress)
  const { data } = await w.recognize(dataUrl)
  return { text: (data.text ?? '').trim(), confidence: Math.round(data.confidence ?? 0) }
}

/** Free the worker and its language data. */
export async function releaseOcr(): Promise<void> {
  if (worker) { await worker.terminate(); worker = null; workerLang = null }
}
