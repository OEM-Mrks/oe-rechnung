// Dateien für eine Rechnung erzeugen. Die PDF-Bibliotheken werden erst beim ersten Bedarf geladen.
import { calc } from './calc'
import { buildCii } from './einvoice/cii'
import type { InvoiceData, Sender } from './types'
import { download, safeFileName } from './util'

export function fileBase(no: string): string {
  return 'Rechnung_' + (safeFileName(no) || 'Entwurf')
}
export async function pdfBlob(inv: InvoiceData, no: string, s: Sender, einvoice: boolean): Promise<Blob> {
  const { invoicePdf } = await import('./pdf/invoice')
  const bytes = await invoicePdf(inv, no, s, einvoice)
  return new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/pdf' })
}
export async function downloadPdf(inv: InvoiceData, no: string, s: Sender, einvoice: boolean): Promise<void> {
  download(await pdfBlob(inv, no, s, einvoice), fileBase(no) + '.pdf')
}
export function xrechnungXml(inv: InvoiceData, no: string, s: Sender): string {
  return buildCii(inv, no, s, calc(inv), 'xrechnung')
}
export function downloadXRechnung(inv: InvoiceData, no: string, s: Sender): void {
  download(new Blob([xrechnungXml(inv, no, s)], { type: 'application/xml' }), fileBase(no) + '_XRechnung.xml')
}
