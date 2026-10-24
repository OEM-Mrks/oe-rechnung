// Ländercodes (ISO 3166-1) und Mengeneinheiten (UN/ECE Rec. 20) für die E-Rechnung

export const COUNTRIES: [string, string][] = [
  ['DE', 'Deutschland'], ['AT', 'Österreich'], ['CH', 'Schweiz'], ['LI', 'Liechtenstein'], ['LU', 'Luxemburg'],
  ['NL', 'Niederlande'], ['BE', 'Belgien'], ['FR', 'Frankreich'], ['IT', 'Italien'], ['ES', 'Spanien'],
  ['PT', 'Portugal'], ['PL', 'Polen'], ['CZ', 'Tschechien'], ['SK', 'Slowakei'], ['HU', 'Ungarn'],
  ['SI', 'Slowenien'], ['HR', 'Kroatien'], ['RO', 'Rumänien'], ['BG', 'Bulgarien'], ['GR', 'Griechenland'],
  ['DK', 'Dänemark'], ['SE', 'Schweden'], ['NO', 'Norwegen'], ['FI', 'Finnland'], ['IE', 'Irland'],
  ['EE', 'Estland'], ['LV', 'Lettland'], ['LT', 'Litauen'], ['MT', 'Malta'], ['CY', 'Zypern'],
  ['GB', 'Vereinigtes Königreich'], ['US', 'Vereinigte Staaten'],
]
const NAME: Record<string, string> = Object.fromEntries(COUNTRIES)
const ALIAS: Record<string, string> = {
  germany: 'DE', austria: 'AT', oesterreich: 'AT', switzerland: 'CH', france: 'FR', holland: 'NL',
  daenemark: 'DK', rumaenien: 'RO', 'großbritannien': 'GB', grossbritannien: 'GB', england: 'GB', uk: 'GB', usa: 'US',
}
for (const [code, name] of COUNTRIES) ALIAS[name.toLowerCase()] = code

export function countryName(code: string): string {
  return NAME[code] || code
}
// Freitext ("Österreich", "at") in einen Ländercode wandeln; leer = Deutschland, unbekannt = ""
export function countryCode(s: string): string {
  const n = String(s || '').trim()
  if (!n) return 'DE'
  if (/^[A-Za-z]{2}$/.test(n)) return n.toUpperCase()
  return ALIAS[n.toLowerCase()] || ''
}

export const UNIT_SUGGESTIONS = ['Stk', 'Std', 'Tag', 'Pauschal', 'Monat', 'km', 'm²', 'Seite', 'Lizenz']
const UNITS: Record<string, string> = {
  stk: 'H87', 'stück': 'H87', stueck: 'H87', std: 'HUR', h: 'HUR', stunde: 'HUR', stunden: 'HUR', tag: 'DAY', tage: 'DAY',
  woche: 'WEE', monat: 'MON', jahr: 'ANN', pauschal: 'LS', pausch: 'LS', km: 'KMT', m: 'MTR', 'm²': 'MTK', m2: 'MTK',
  'm³': 'MTQ', kg: 'KGM', g: 'GRM', t: 'TNE', l: 'LTR', min: 'MIN',
}
export function unitCode(u: string): string {
  return UNITS[String(u || '').trim().toLowerCase().replace(/\.$/, '')] || 'C62'
}

// Leitweg-ID der öffentlichen Verwaltung, z. B. 991-12345-67 oder 04011000-1234512345-06
export function isLeitwegId(s: string): boolean {
  return /^\d{2,12}(-[A-Z0-9]{1,30})?-\d{2}$/i.test(String(s || '').trim())
}
