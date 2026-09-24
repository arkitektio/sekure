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
- **Register IPC only through `IpcTransport`.** It rejects senders that are not the top
  frame of our own origin (`isTrustedSender`). Never call `ipcMain` directly. Treat every
  argument as untrusted: validate ids, paths, URLs and settings in main (see
  `lib/urls.ts`, `vault/settings.ts`, `SourcesModule.resolve`).
- **The CSP lives in `CONTENT_SECURITY_POLICY` (`src/main/scheme.ts`).** It is injected
  into `index.html` at build time and sent as a header. Never add remote hosts; fetch in
  main instead (like the avatar).
- **The main bundle includes all deps** (`externalizeDeps: false`). CJS/UMD packages
  such as electron-updater and kdbxweb have no named ESM exports as externals, so keep
  runtime deps in `devDependencies`.
- Automated runs must never trigger `systemPreferences.promptTouchID` on a dev machine.
  Stub it to throw. When driving the real app, untick "Unlock with Touch ID next time"
  before unlocking.
- **Vault files are untrusted input.** KDF parameters are capped before the KDF runs
  (`checkKdfParameters`). Preferences imported from a vault never enable auto-type, and
  a shortcut must pass `isSafeGlobalShortcut`. Protected standard fields (Title,
  UserName, URL, Notes) stay out of snapshots, the same way passwords do.
- **Vaults are local files only.** There is no cloud account or API integration (Google
  Drive support was removed). A synced folder works because its client syncs the file.
- **Auto-type values go through the clipboard only**, never argv, a log line or an event.
  `AutoTypeModule` restores the previous clipboard right after the paste. The injector
  in `src/main/autotype/injector.ts` takes an injected `exec`; tests stub it so they
  never send real keystrokes.
- Polling IPC (e.g. `vault:otp`) must **not** reset the idle auto-lock timer. Only user
  input does (`vault:activity`).
- **Deidentify (`src/main/deidentify`, `DeidentifyModule`) keeps vault secrets in main.**
  `VaultSession.findSecrets` returns positions and entry/field *names* only. Credential
  spans reach the popup as locked segments with no `text`. Placeholders for
  `CREDENTIAL`/`SECRET` are never added to the re-identify mapping. The captured text and
  the mapping live in memory only, are never logged (counts only), and are cleared on lock
  and after 30 minutes unused. Nothing is shown until the vault is unlocked, so the hard
  check always runs. The selection is read through the clipboard, which is restored
  afterwards.
- **Search (`src/main/search`) indexes non-secret text only.** That means titles, types,
  groups, tags, hosts, usernames, custom-field _names_ and the start of the notes. Embedding
  vectors stay in memory, are never written to disk, and are dropped on lock. The model
  ships inside the signed app. It is pinned to a revision (`MODEL` in `search/protocol.ts`),
  fetched and sha256-checked at build time by `bundleSearchModel` in
  `electron.vite.config.ts` (cached in `.cache/models`), and unpacked from the asar. The
  worker checks every file against its pin again before running it (`loadE5({ spec })`).
  It is never downloaded at run time. Never widen the renderer CSP for it. `search:query` must not reset
  the idle timer.

## Layout

- `src/main/modules/*`: `AppModule`s registered with `AppManager`, wired over `IpcTransport`.
- `src/main/{vault,sources,autotype,preferences}`: pure, electron-free logic plus `protocol.ts`
  types. It is unit-tested in node.
- `src/main/sources/VaultSource.ts` defines where a vault lives: `LocalSource` (disk, id
  `local:<abs path>`). `VaultModule` only talks to a
  `VaultSource`, so adding a provider means adding a source, not touching the vault.
  Local ids contain slashes, so always build routes with `unlockPath()` in
  `lib/vaults.ts`.
- `src/main/vault/entryTypes.ts`: the Sekure entry-type registry (Passport, IBAN, …), which
  has no imports and is shared at runtime with the renderer. Typed values are ordinary,
  readable KDBX string fields, so other KeePass apps still work. The type lives in entry
  CustomData (`sekure.type = passport@1`), with `detectType` as a fallback. Main forces
  registry-`protected` fields to be protected. Subtitles come only from unprotected fields.
  Bump a type's `version` when you change its field layout.
- Types sit in `ENTRY_TYPE_GROUPS` (nested "+" menu), with `keywords` for search. `ID_FORMATS`
  recognises well-known numbers (IBAN, tax IDs, SSNs, VAT, VIN, …) with checksums, and
  `suggestNewEntries` turns a search query into prefilled "Add …" rows. Semantic "Add …"
  comes from `search/TypeIndex.ts` (registry text only) through `search:suggestTypes`,
  which, like `search:query`, must not reset the idle timer.
- `PreferencesModule` keeps app preferences (brand color, auto-type) on the device
  **and** in the open vault's `Meta/CustomData` under `sekure.preferences`. Opening a
  vault imports them. Only non-secret settings may go there. The renderer writes
  `--brand-hue` / `--brand-chroma` only through `lib/brand.ts`.
- `SearchModule` runs `multilingual-e5-small` in a worker thread (`search/embedder.worker.ts`)
  through onnxruntime-web WASM and `@huggingface/tokenizers`. Both are pure JS/WASM, so
  nothing native gets bundled. The WASM is copied to `out/main/ort` by a plugin in
  `electron.vite.config.ts` and unpacked from the asar. `search/e5.int.test.ts` runs the real
  model when `SEKURE_MODEL_DIR` is set (after a build:
  `.cache/models/multilingual-e5-small/<revision>`).
- Models (bundled or downloaded) share `src/main/models` (`ModelSpec`, sha256-checked `ensureModel`,
  `WorkerClient`/`serveModel`). The PII model is GLiNER multi-PII **fp16**: its int8 export
  finds nothing. `deidentify/gliner.int.test.ts` runs it when `SEKURE_GLINER_DIR` is set.
  Floating popups (auto-type, deidentify) are built with `modules/popup.ts`.
- `src/renderer/src/{pages,vault,components/ui}`: screens, vault widgets, shadcn primitives.
- `AppUpdater` (electron-updater, GitHub releases) owns one `UpdateState` (`updater/protocol.ts`)
  and broadcasts it. It is registered in every build but only packaged builds check (dev
  reports `disabled`). The rail and welcome strip show `UpdateReady`, and Settings has
  `UpdateSettings`. A restart saves a dirty vault first and aborts if the save fails.
- The open vault is laid out like orkestrator-next (`vault/layout/VaultLayout.tsx`):
  - A rail holds the search pill (`SearchPalette.tsx`, a palette anchored to the pill), a tile
    row (`RailTiles`: Home, All entries, New entry), the open tabs, and the `VaultSwitcher`
    footer. The active tab sits in an inset card.
  - Groups and categories live on the Home page (`vault/pages/HomePage.tsx`), not in the rail.
    New tabs open on Home.
  - People: Person entries (type `personalDetails`, labelled "Person"). Other entries link to them
    through entry CustomData `sekure.people` (comma-separated uuids), which main validates
    (`VaultSession.setPeople` / `EntryInput.people`). Snapshots carry the uuids only. Search indexes
    the linked people's names (plain text). `person:<uuid>` scopes a list and `@name` narrows search.
  - "+", ⌘N and the New entry tile open the new-entry wizard (`vault/pages/CreatePage.tsx`,
    page `create`), which asks for a type and then opens the form. Every registry type needs a
    one-line `description` for it.
  - Other routes use `app/WelcomeLayout.tsx`: a drag strip over the same inset card. The start
    screen (`pages/Home.tsx`) shows recent vaults as cards, like orkestrator's welcome.
  - Tabs (`vault/tabs.ts`, pure, in `stores/vault.ts`) hold page ids only: entry uuids and scopes,
    never titles or values. They are never persisted and reset on lock.
  - Glass (vibrancy or acrylic) is a device setting owned by `WindowManager` (`window:setGlass`).
    Content cards stay opaque; only `.rail-glass-surface` is translucent.

## Checks

`pnpm typecheck && pnpm exec eslint . --quiet && pnpm test`
