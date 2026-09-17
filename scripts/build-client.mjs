// Builds the browser half (`src/client`) into `lib/client.js` in the lazy-CJS
// wrapper the dsh web plugin route serves — the same
// `window.__ModuleLoader__.load({ id, factory: (require) => {...} })` shape the
// monorepo's `tsdown.client` preset emits. All `@deepseek-ai/*` and `react`
// imports stay external: the loader's `require` resolves them against the boot
// module graph, so the bundle never inlines a second React or a cross-plugin
// value import.
import { fileURLToPath } from 'node:url'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
const require = createRequire(import.meta.url)
// rolldown is not a direct dependency; reach it through tsdown, which owns it.
const tsdownRequire = createRequire(require.resolve('tsdown/package.json'))
const { rolldown } = tsdownRequire('rolldown')

const bundle = await rolldown({
  input: path.join(root, 'src/client/index.ts'),
  external: [/^@deepseek-ai\//, /^react(?:$|\/)/],
})
const generated = await bundle.generate({ format: 'cjs' })
await bundle.close()
const body = generated.output[0].code

const indented = body
  .split('\n')
  .map(line => (line.length > 0 ? `\t\t${line}` : line))
  .join('\n')

const wrapped = [
  'window.__ModuleLoader__.load({',
  `\tid: ${JSON.stringify(pkg.name)},`,
  '\tfactory: (require) => {',
  '\t\tvar module = { exports: {} };',
  '\t\tvar exports = module.exports;',
  '\t\tObject.defineProperty(exports, Symbol.toStringTag, { value: "Module" });',
  indented,
  '\t\treturn module.exports;',
  '\t}',
  '});',
  '',
].join('\n')

mkdirSync(path.join(root, 'lib'), { recursive: true })
writeFileSync(path.join(root, 'lib/client.js'), wrapped)
console.log('built lib/client.js (client bundle, ModuleLoader wrapper)')
