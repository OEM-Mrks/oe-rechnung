// Schrift Noto Sans (OFL, auf Latein gekürzt) und sRGB-Profil (CC0) als Base64, nur bei Bedarf geladen
import type { jsPDF } from 'jspdf'

export interface PdfAssets {
  regular: string
  bold: string
  icc: string
}
let cache: Promise<PdfAssets> | null = null
export function loadAssets(): Promise<PdfAssets> {
  if (!cache) {
    cache = import('./pdf-assets-v1.json').then((m) => m.default as PdfAssets)
    cache.catch(() => { cache = null })
  }
  return cache
}
export function addFonts(doc: jsPDF, a: PdfAssets): void {
  doc.addFileToVFS('NotoSans-Regular.ttf', a.regular); doc.addFont('NotoSans-Regular.ttf', 'NotoSans', 'normal')
  doc.addFileToVFS('NotoSans-Bold.ttf', a.bold); doc.addFont('NotoSans-Bold.ttf', 'NotoSans', 'bold')
}
