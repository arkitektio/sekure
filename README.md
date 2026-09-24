# Sekure

Open, edit and unlock your **KeePass (`.kdbx`) vaults from disk**, with **Touch ID** on
macOS and **image/PDF attachments** on any entry.

- Reads and writes KDBX 3 and KDBX 4 (Argon2d/Argon2id, AES/ChaCha20), so it works with
  files from KeePassXC, KeePass, Strongbox and KeeWeb.
- **Local files only, no accounts.** Open any `.kdbx` on this computer, including one in
  a synced folder (Google Drive for desktop, Dropbox, iCloud Drive): the sync client
  uploads your saves. Saves are atomic: the file is written to an fsynced temp copy
  (same permissions) and renamed over the original. Only if a sync provider refuses the
  rename is it written in place, after a `.<name>.bak` copy.
- The vault is decrypted **in memory only** and re-encrypted before it is written.
- **Conflict-safe saves.** If the file changed since you opened it (another device, or
  a newer copy synced onto disk), Sekure merges both versions with KeePass merge rules
  instead of overwriting. Files are compared by mtime and size.
- Touch ID quick unlock, TOTP codes, a password generator, the ⌘K command palette, and a
  clipboard that auto-clears after 30 s. The vault auto-locks when idle, on sleep and on
  screen lock.

## Development

```bash
pnpm install
pnpm dev
```

| Command          | What it does                                              |
| ---------------- | --------------------------------------------------------- |
| `pnpm dev`       | electron-vite dev with HMR                                |
| `pnpm test`      | vitest (vault crypto, sources, search, UI)                |
| `pnpm typecheck` | tsc for main+preload and renderer                         |
| `pnpm lint`      | eslint (flat config) + prettier                           |
| `pnpm build:mac` | build and package (`dmg` + `zip`), signed/notarized in CI |

Set `SEKURE_USER_DATA=/some/dir` to run with an isolated profile. This is useful for
e2e runs or for a second dev instance. Release builds ignore it.

## Auto-type

Press **⌘⌥⇧K** (Ctrl+Alt+Shift+K on Windows/Linux) in any app to open a search popup
over the focused window. Pick an entry, then a field (password, username, one-time code, URL
or a custom field), and Sekure pastes it into the input you were typing in. If the vault is
locked, the popup unlocks the most recent vault first. You can change the shortcut with
the keyboard button in the title bar.

How it works: main reveals the value, puts it on the clipboard, re-focuses the original
window and sends the paste keystroke. It restores the previous clipboard about 400 ms
later. The value never appears on a command line.

- **macOS** uses `osascript`/System Events and needs Accessibility access for Sekure
  (in dev: for Electron or your terminal). Without it, the value is copied, a notification
  asks you to press ⌘V, and the clipboard clears after 30 s.
- **Windows** uses PowerShell `SendKeys`.
- **Linux** uses `xdotool` on X11. On Wayland it uses `wtype` if installed, and global
  shortcuts depend on the compositor. Otherwise it falls back to the clipboard.
- For those ~400 ms, a clipboard manager can see the value. If the previous clipboard
  held a value Sekure copied, it is cleared instead of restored.

## Appearance and synced settings

Settings (gear in the title bar) lets you pick the brand color: the hue and intensity
behind every accent, as in orkestrator. Both it and the auto-type settings are kept on
this device and also written into the open vault (KDBX `Meta/CustomData`, key
`sekure.preferences`). Save the vault, and any device that opens it takes over the same
color and shortcut. Other KeePass apps ignore the key.

A vault never turns auto-type on for a device, and a shortcut it carries is applied only
if it needs ⌘/Ctrl and does not take over a common combination (⌘V, ⌘Q, Enter, …).

## Security model

- **All secrets live in the main process.** The renderer is sandboxed, has
  `contextIsolation` on, and has no Node. It receives only a sanitized tree (titles,
  usernames, URLs, flags) and requests a password or protected field one at a time
  (`vault:reveal` / `vault:copy`). Titles, usernames, URLs or notes marked protected in
  KeePass are treated the same way. Revealed values mask again after 30 s or when the
  window loses focus.
- IPC is accepted only from the top frame of Sekure's own windows. Every web permission
  (clipboard read, notifications, devices…) is denied.
- Clipboard writes happen in main and are cleared after 30 s, but only if the clipboard
  still holds the copied value.
- Attachments are decrypted on demand into `blob:` URLs, which are revoked when the
  preview unmounts. SVG attachments are never rendered inline.
- Secrets Sekure keeps (the Touch ID quick-unlock secret) are encrypted with Electron
  `safeStorage` (the macOS Keychain). On Linux, Sekure refuses to store secrets when no
  keyring is available (Electron's `basic_text` fallback is not encryption).
- Release builds flip the Electron fuses (`RunAsNode`, `NODE_OPTIONS`, `--inspect` off;
  asar integrity and `onlyLoadAppFromAsar` on) and exit if started with a debugging
  switch, so another local process cannot run code as Sekure and read its secrets.
- Vault headers asking for extreme key derivation (Argon2 over 1 GiB / 100 iterations,
  AES-KDF over 10⁸ rounds) are rejected before the KDF runs.
- If an automatic lock cannot save open edits (offline, disk full), Sekure still locks
  and keeps them in an encrypted recovery copy in its data folder (`recovery/`).
- **Touch ID** uses KeePassXC-style quick unlock. The master password is sealed with
  `safeStorage` and released only after `systemPreferences.promptTouchID()` succeeds.
  The Keychain item itself is not bound to biometry, so Touch ID is enforced by the app
  rather than by the Secure Enclave. Future hardening would be a native Keychain item
  with `kSecAccessControlBiometryCurrentSet`. If the master password changes elsewhere,
  the stored secret is dropped automatically. Main keeps the password it just used to
  open the vault for enabling Touch ID; the renderer never sends it twice.
- CSP (`CONTENT_SECURITY_POLICY` in `src/main/scheme.ts`, also sent as a header):
  `connect-src 'self'`, no remote images, `base-uri`/`form-action 'none'`. The dev
  server's websocket is allowed only in `pnpm dev`. Network traffic (updates, model
  downloads) goes through main. Navigation and new windows are denied, and entry links go through main, which
  opens only `http(s)` URLs in the system browser.

## Releases

Releases follow the same pipeline as orkestrator:

- Conventional commits on `main` (stable) or `next` (`-rc` prereleases) trigger
  `semantic-release`, which creates a GitHub release with the built-in `GITHUB_TOKEN`.
- The same workflow then calls `publishall.yaml` for the new tag, which builds, signs and
  notarizes for macOS, Windows and Linux. electron-updater picks the release up. (A
  release made with the built-in token triggers no workflows, so no personal token is
  needed.)

Required repository secrets: `APPLE_ID`, `APPLE_ID_PASSWORD`, `APPLE_TEAM_ID`,
`CSC_LINK` (base64 `.p12`), `CSC_KEY_PASSWORD`.

Workflow actions are pinned to commit SHAs (Dependabot keeps them current), and secrets
are scoped to the build steps.

> **Windows and Linux updates are not signature-checked yet.** Only macOS updates are
> verified against the code signature. Before shipping Windows to users, add a code
> signing certificate and set `win.signtoolOptions.publisherName` in
> `electron-builder.yml`, so electron-updater verifies each download.

> Local `electron-builder --dir` builds are only ad-hoc signed. With hardened runtime
> enabled they fail macOS library validation ("different Team IDs"). For a local smoke
> test, add `-c.mac.hardenedRuntime=false -c.mac.notarize=false`.
