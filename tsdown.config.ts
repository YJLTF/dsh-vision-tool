import { defineConfig } from 'tsdown'

export default defineConfig({
  // Host half only. The browser card (src/client) is bundled separately by
  // `scripts/build-client.mjs` into the lazy-CJS ModuleLoader wrapper the web
  // plugin route serves — run as part of `pnpm build` / `prepare`.
  entry: ['src/index.ts'],
  format: ['esm'],
  // JS bundle only; declarations are emitted stably by `tsc --emitDeclarationOnly`
  // into `lib/types` (see `tsconfig.build.json`) so the exports map stays stable.
  dts: false,
  clean: true,
  outDir: 'lib',
  failOnWarn: false,
})