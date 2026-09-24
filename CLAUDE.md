# Sekure — conventions

Stack and layout mirror `standalones/orkestrator-next`: electron-vite 5, React 19,
Tailwind v4 + shadcn (radix-vega), zustand, react-hook-form + zod, vitest, pnpm 11.

## Hard rules

- **Secrets never leave main.** `src/main/vault/VaultSession.ts` returns sanitized
  summaries only. Any new IPC that returns a protected value must be an explicit,
  per-field request like `vault:reveal`. Never put passwords in a snapshot, a log line or
  an event.
- **The preload is sandboxed.** `src/preload/index.ts` may import only `electron`, and
  only _types_ from `src/main/**/protocol.ts`. Runtime constants it needs get inlined by
  the bundler, so keep them in protocol files with no other imports.
- **Every IPC listener exposed to the renderer returns a disposer** (`subscribe()` in
  the preload).
- **The main bundle includes all deps** (`externalizeDeps: false`). CJS/UMD packages
  such as electron-updater and kdbxweb have no named ESM exports as externals, so keep
  runtime deps in `devDependencies`.
- Automated runs must never trigger `systemPreferences.promptTouchID` on a dev machine.
  Stub it to throw.
- **Auto-type values go through the clipboard only**, never argv, a log line or an event.
  `AutoTypeModule` restores the previous clipboard right after the paste. The injector
  in `src/main/autotype/injector.ts` takes an injected `exec`; tests stub it so they
  never send real keystrokes.
- Polling IPC (e.g. `vault:otp`) must **not** reset the idle auto-lock timer. Only user
  input does (`vault:activity`).
- **Search (`src/main/search`) indexes non-secret text only.** That means titles, types,
  groups, tags, hosts, usernames, custom-field *names* and the start of the notes. Embedding
  vectors stay in memory, are never written to disk, and are dropped on lock. The model is
  downloaded by main, pinned to a revision and checked with sha256 (`MODEL` in
  `search/protocol.ts`). Never widen the renderer CSP for it. `search:query` must not reset
  the idle timer.

## Layout

- `src/main/modules/*`: `AppModule`s registered with `AppManager`, wired over `IpcTransport`.
- `src/main/{vault,google,drive,sources,autotype,preferences}`: pure, electron-free logic plus `protocol.ts`
  types. It is unit-tested in node.
- `src/main/sources/VaultSource.ts` defines where a vault lives: `DriveSource` (API) or
  `LocalSource` (disk, id `local:<abs path>`). `VaultModule` only talks to a
  `VaultSource`, so adding a provider means adding a source, not touching the vault.
  Local ids contain slashes, so always build routes with `unlockPath()` in
  `lib/vaults.ts`.
- `src/main/vault/entryTypes.ts`: the Sekure entry-type registry (Passport, IBAN, …), which
  has no imports and is shared at runtime with the renderer. Typed values are ordinary,
  readable KDBX string fields, so other KeePass apps still work. The type lives in entry
  CustomData (`sekure.type = passport@1`), with `detectType` as a fallback. Main forces
  registry-`protected` fields to be protected. Subtitles come only from unprotected fields.
  Bump a type's `version` when you change its field layout.
- `PreferencesModule` keeps app preferences (brand color, auto-type) on the device
  **and** in the open vault's `Meta/CustomData` under `sekure.preferences`. Opening a
  vault imports them. Only non-secret settings may go there. The renderer writes
  `--brand-hue` / `--brand-chroma` only through `lib/brand.ts`.
- `SearchModule` runs `multilingual-e5-small` in a worker thread (`search/embedder.worker.ts`)
  through onnxruntime-web WASM and `@huggingface/tokenizers`. Both are pure JS/WASM, so
  nothing native gets bundled. The WASM is copied to `out/main/ort` by a plugin in
  `electron.vite.config.ts` and unpacked from the asar. `search/e5.int.test.ts` runs the real
  model when `SEKURE_MODEL_DIR` is set.
- `src/renderer/src/{pages,vault,components/ui}`: screens, vault widgets, shadcn primitives.

## Checks

`pnpm typecheck && pnpm exec eslint . --quiet && pnpm test`
