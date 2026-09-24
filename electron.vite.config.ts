import { copyFileSync, mkdirSync } from 'fs'
import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/**
 * onnxruntime-web loads its WASM runtime at run time, so ship it next to the
 * main bundle (`out/main/ort`). electron-builder unpacks it from the asar.
 */
function copyOrtWasm(): Plugin {
  const files = ['ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm']
  return {
    name: 'sekure:copy-ort-wasm',
    writeBundle(options) {
      const out = resolve(options.dir ?? 'out/main', 'ort')
      mkdirSync(out, { recursive: true })
      for (const f of files) {
        copyFileSync(resolve(__dirname, 'node_modules/onnxruntime-web/dist', f), resolve(out, f))
      }
    }
  }
}

export default defineConfig({
  main: {
    plugins: [copyOrtWasm()],
    build: {
      // Bundle every dependency into out/main. The main bundle is ESM, and
      // CJS/UMD packages (electron-updater, kdbxweb) expose no named ESM
      // exports when loaded as externals. It also keeps node_modules out of
      // the packaged app.
      externalizeDeps: false
    }
  },
  preload: {
    build: {
      // A sandboxed preload cannot `import` — it must be a single CommonJS file.
      rollupOptions: { output: { format: 'cjs', entryFileNames: '[name].cjs' } }
    }
  },
  renderer: {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src/renderer/src')
      }
    }
  }
})
