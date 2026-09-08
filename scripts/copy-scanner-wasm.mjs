/**
 * Put the barcode decoder's WebAssembly where our own server can serve it.
 *
 * zxing-wasm defaults to fetching this 1 MB file from a public CDN. A shop's
 * till must not depend on jsdelivr being reachable — behind a firewall, on a
 * bad connection, or simply on a day the CDN is slow, the scanner would fail
 * with nothing to explain it. Copying it into `public/` at build time means
 * it comes from the same origin as the app, is cached like anything else, and
 * works with no internet at all beyond the shop's own server.
 *
 * Runs from `prebuild`, so the copy can never drift from the installed
 * version — it is taken from node_modules, not committed.
 */
import { copyFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'

// Resolved by path rather than by `require.resolve`: the package publishes an
// `exports` map with no `./package.json` entry, so asking Node for it fails.
const source = join(
  process.cwd(),
  'node_modules',
  'zxing-wasm',
  'dist',
  'reader',
  'zxing_reader.wasm',
)
const target = join(process.cwd(), 'public', 'scanner', 'zxing_reader.wasm')

await mkdir(dirname(target), { recursive: true })
await copyFile(source, target)
console.log(`scanner: copied ${source} -> public/scanner/zxing_reader.wasm`)
