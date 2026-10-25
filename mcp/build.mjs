// Baut den MCP-Server als eine Datei (mcp/bundle/server/index.cjs + SQLite-WebAssembly)
// und packt daraus das Claude-Desktop-Paket public/mcp/oe-rechnung.mcpb (wird mit der Web-App ausgeliefert).
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(root, 'mcp', 'bundle')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const src = readFileSync(join(root, 'mcp', 'server.ts'), 'utf8')
const version = /const VERSION = '([^']+)'/.exec(src)[1]

rmSync(out, { recursive: true, force: true })
mkdirSync(join(out, 'server'), { recursive: true })

await build({
  entryPoints: [join(root, 'mcp', 'server.ts')],
  outfile: join(out, 'server', 'index.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  minify: true,
  legalComments: 'external',
  logLevel: 'warning',
})
copyFileSync(join(root, 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm'), join(out, 'server', 'sql-wasm.wasm'))

// Werkzeugliste für die Anzeige in Claude Desktop aus dem Quelltext lesen
const tools = [...src.matchAll(/registerTool\('([a-z_]+)', \{\s*title: '([^']+)'/g)].map(([, name, description]) => ({ name, description }))

const manifest = {
  manifest_version: '0.3',
  name: 'oe-rechnung',
  display_name: 'Rechnungen (ZUGFeRD und XRechnung)',
  version,
  description: 'Rechnungen, Kunden und Artikel im Gespräch mit der KI verwalten. Die Daten bleiben in einer SQLite-Datei auf Ihrem Rechner.',
  long_description: 'Verbindet Claude mit Ihrer Rechnungsdatei aus der Web-App https://oem-mrks.github.io/oe-rechnung/. ' +
    'Claude richtet im Interview Ihre Firmenangaben ein, legt Kunden und Leistungen an, schreibt Rechnungsentwürfe, schreibt sie nach Ihrer Freigabe fest ' +
    'und speichert ZUGFeRD-PDFs oder XRechnungen in Ihrem Ordner. Es werden keine Daten an Dritte übertragen; der Server liest und schreibt nur die gewählte Datei und den Unterordner „Export“.',
  author: { name: 'Markus Oeffling', url: 'https://oemedia.de' },
  homepage: 'https://oem-mrks.github.io/oe-rechnung/',
  repository: { type: 'git', url: 'https://github.com/OEM-Mrks/oe-rechnung' },
  server: {
    type: 'node',
    entry_point: 'server/index.cjs',
    mcp_config: { command: 'node', args: ['${__dirname}/server/index.cjs', '--ordner', '${user_config.ordner}', '--datei', '${user_config.datei}'] },
  },
  user_config: {
    ordner: { type: 'directory', title: 'Ordner für Ihre Rechnungen', description: 'Hier liegt die Rechnungsdatei; PDFs und XRechnungen landen im Unterordner „Export“.', required: true, default: '${DOCUMENTS}/Rechnungen' },
    datei: { type: 'string', title: 'Name der Rechnungsdatei', description: 'Dieselbe .sqlite-Datei, die Sie in der Web-App öffnen. Gibt es sie noch nicht, wird sie angelegt.', required: false, default: 'Rechnungen.sqlite' },
  },
  tools,
  prompts_generated: true,
  keywords: ['rechnung', 'e-rechnung', 'zugferd', 'xrechnung', 'buchhaltung'],
  compatibility: { platforms: ['darwin', 'win32', 'linux'], runtimes: { node: '>=18.0.0' } },
}
writeFileSync(join(out, 'manifest.json'), JSON.stringify(manifest, null, 2))
writeFileSync(join(out, 'package.json'), JSON.stringify({ name: 'oe-rechnung-mcp', version, private: true, description: manifest.description, license: pkg.license || 'UNLICENSED' }, null, 2))

const target = join(root, 'public', 'mcp', 'oe-rechnung.mcpb')
mkdirSync(dirname(target), { recursive: true })
const mcpb = join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'mcpb.cmd' : 'mcpb')
execFileSync(mcpb, ['validate', join(out, 'manifest.json')], { stdio: 'inherit' })
execFileSync(mcpb, ['pack', out, target], { stdio: 'inherit' })
console.log('MCP-Paket: ' + target)
