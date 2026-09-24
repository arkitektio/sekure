import { copyFileSync, mkdirSync } from 'fs'
import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { CONTENT_SECURITY_POLICY, DEV_CONNECT_SRC } from './src/main/scheme'

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

/**
 * Write the renderer CSP into index.html. The dev server's HMR websocket is
 * allowed only under `electron-vite dev`, never in a build.
 */
function injectCsp(): Plugin {
  let serving = false
  return {
    name: 'sekure:csp',
    configResolved(config) {
      serving = config.command === 'serve'
    },
    transformIndexHtml(html) {
      // frame-ancestors only works as a header (sent by the app:// handler);
      // in a <meta> tag Chromium ignores it with a console warning.
      const meta = CONTENT_SECURITY_POLICY.replace(/; frame-ancestors [^;]*/, '')
      const csp = serving
        ? meta.replace("connect-src 'self'", `connect-src 'self' ${DEV_CONNECT_SRC}`)
        : meta
      if (!html.includes('%SEKURE_CSP%')) throw new Error('index.html lost its CSP placeholder')
      return html.replace('%SEKURE_CSP%', csp)
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
    plugins: [injectCsp(), react(), tailwindcss()],
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src/renderer/src')
      }
    }
  }
})
