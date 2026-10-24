import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vitest/config'

// Alles bleibt im Browser: keine externen Skripte, keine Verbindungen zu fremden Servern.
// Nur im Build, weil der Dev-Server eigene Inline-Skripte einfügt. GitHub Pages kann keine Header setzen, daher als <meta>.
const CSP = "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; " +
  "frame-src blob:; object-src 'none'; connect-src 'self'; base-uri 'self'; form-action 'none'"
const csp: Plugin = {
  name: 'csp-meta',
  apply: 'build',
  transformIndexHtml: () => [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP }, injectTo: 'head-prepend' }],
}

// base "./": läuft unter eigener Domain genauso wie unter user.github.io/repo/
export default defineConfig({
  base: './',
  plugins: [react(), csp],
  build: { target: 'es2022', chunkSizeWarningLimit: 1100 },
  test: { include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'] },
})
