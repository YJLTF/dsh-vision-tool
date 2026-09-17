import { defineConfig } from 'tsdown'

export default defineConfig({
  // Host half. The browser card (src/client) is shipped as source only: its
  // loadable bundle must be produced by the DeepSeek Harness monorepo build
  // (the `tsdown.client` preset + client module-loader), which is not
  // reproducible as a standalone build.
  entry: ['src/index.ts'],
  format: ['esm'],
  // JS bundle only; declarations are emitted stably by `tsc --emitDeclarationOnly`
  // into `lib/types` (see `tsconfig.build.json`) so the exports map stays stable.
  dts: false,
  clean: true,
  outDir: 'lib',
  failOnWarn: false,
})