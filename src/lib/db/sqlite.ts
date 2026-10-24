// sql.js im Browser laden (WebAssembly wird von Vite mitgebündelt, kein CDN)
import initSqlJs, { type SqlJsStatic } from 'sql.js'
import wasmUrl from 'sql.js/dist/sql-wasm-browser.wasm?url'

let p: Promise<SqlJsStatic> | null = null
export function sqlite(): Promise<SqlJsStatic> {
  if (!p) {
    p = initSqlJs({ locateFile: () => wasmUrl })
    p.catch(() => { p = null })
  }
  return p
}
