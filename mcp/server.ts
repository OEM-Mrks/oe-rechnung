// Lokaler MCP-Server: Eine KI (Claude Desktop, Claude Code, LM Studio …) bedient die Rechnungsdatei des Nutzers.
// Läuft auf dem Rechner des Nutzers, liest und schreibt nur die angegebene SQLite-Datei und den Export-Ordner.
//   node server.cjs --ordner ~/Rechnungen [--datei Rechnungen.sqlite]
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { filePath, init, INSTRUCTIONS, PROMPTS, TOOLS, VERSION } from './core'

function arg(name: string): string {
  const i = process.argv.indexOf('--' + name)
  return i > -1 ? process.argv[i + 1] || '' : ''
}
function expand(p: string): string {
  const x = p.replace(/^~(?=$|\/|\\)/, homedir())
  return isAbsolute(x) ? x : resolve(x)
}
const DIR = expand(arg('ordner') || process.env.OE_RECHNUNG_ORDNER || join(homedir(), 'Rechnungen'))

const server = new McpServer({ name: 'oe-rechnung', version: VERSION }, { instructions: INSTRUCTIONS })
for (const t of TOOLS) server.registerTool(t.name, t.config, t.cb)
for (const p of PROMPTS) server.registerPrompt(p.name, p.config, p.cb)

async function main() {
  await init({ file: join(DIR, arg('datei') || process.env.OE_RECHNUNG_DATEI || 'Rechnungen.sqlite'), exportDir: join(DIR, 'Export'), wasmDir: dirname(process.argv[1]) })
  await server.connect(new StdioServerTransport())
  console.error('oe-rechnung MCP ' + VERSION + ' bereit, Datei: ' + filePath())
}
main().catch((e) => { console.error(e); process.exit(1) })
