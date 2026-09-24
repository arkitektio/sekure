# Sekure

Open, edit and unlock your **KeePass (`.kdbx`) vaults straight from Google Drive or from
disk**, with **Touch ID** on macOS and **image/PDF attachments** on any entry.

- Reads and writes KDBX 3 and KDBX 4 (Argon2d/Argon2id, AES/ChaCha20), so it works with
  files from KeePassXC, KeePass, Strongbox and KeeWeb.
- **Two ways to reach Drive.**
  - Connect your Google account to browse and save through the Drive API.
  - Or open any local `.kdbx`, including one synced by **Google Drive for desktop**
    (`~/Library/CloudStorage/GoogleDrive-…`). Local files need no Google sign-in; the
    Drive client uploads your saves. Local saves are atomic: the file is written to a
    temp copy and renamed over the original, with a fallback for providers that refuse
    the rename.
- Your file stays in your Drive. It is downloaded, decrypted **in memory only**, and
  re-encrypted before upload.
- **Conflict-safe saves.** If the file changed since you opened it (another device, or
  a newer copy synced onto disk), Sekure merges both versions with KeePass merge rules
  instead of overwriting. Drive files are compared by `headRevisionId`, local files by
  mtime and size.
- Touch ID quick unlock, TOTP codes, a password generator, the ⌘K command palette, and a
  clipboard that auto-clears after 30 s. The vault auto-locks when idle, on sleep and on
  screen lock.

## Development

```bash
pnpm install
cp .env.example .env   # then fill in your Google OAuth client (see below)
pnpm dev
```

| Command          | What it does                                              |
| ---------------- | --------------------------------------------------------- |
| `pnpm dev`       | electron-vite dev with HMR                                |
| `pnpm test`      | vitest (vault crypto, OAuth, Drive client, Unlock UI)     |
| `pnpm typecheck` | tsc for main+preload and renderer                         |
| `pnpm lint`      | eslint (flat config) + prettier                           |
| `pnpm build:mac` | build and package (`dmg` + `zip`), signed/notarized in CI |

Set `SEKURE_USER_DATA=/some/dir` to run with an isolated profile. This is useful for
e2e runs or for a second dev instance.

## Google Cloud setup

1. Create a project at <https://console.cloud.google.com> and **enable the Google Drive
   API**.
2. **OAuth consent screen**: set the user type to _External_ and add the scopes
   `openid`, `email`, `profile` and `https://www.googleapis.com/auth/drive`. Leave it in
   **Testing** and add every user under **Test users** (100 max).
3. **Credentials**: create an OAuth client ID of type **Desktop app**. Put its ID and
   secret in `.env` as `MAIN_VITE_GOOGLE_CLIENT_ID` / `MAIN_VITE_GOOGLE_CLIENT_SECRET`.
   Google does not treat a desktop client secret as confidential. It is still kept out
   of git and injected at build time.

> **Testing-mode caveat:** Google expires refresh tokens of apps in _Testing_ after
> **7 days**, so users have to reconnect Drive weekly. When that happens, Sekure detects
> `invalid_grant` and returns to the Connect screen. Publishing the consent screen
> removes the expiry. `drive` is a _restricted_ scope, so a published app with more than
> 100 users needs Google's security verification.

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
- For those ~400 ms, a clipboard manager can see the value.

## Appearance and synced settings

Settings (gear in the title bar) lets you pick the brand color: the hue and intensity
behind every accent, as in orkestrator. Both it and the auto-type settings are kept on
this device and also written into the open vault (KDBX `Meta/CustomData`, key
`sekure.preferences`). Save the vault, and any device that opens it takes over the same
color and shortcut. Other KeePass apps ignore the key.

## Security model

- **All secrets live in the main process.** The renderer is sandboxed, has
  `contextIsolation` on, and has no Node. It receives only a sanitized tree (titles,
  usernames, URLs, flags) and requests a password or protected field one at a time
  (`vault:reveal` / `vault:copy`).
- Clipboard writes happen in main and are cleared after 30 s, but only if the clipboard
  still holds the copied value.
- Attachments are decrypted on demand into `blob:` URLs, which are revoked when the
  preview unmounts. SVG attachments are never rendered inline.
- The Google refresh token is encrypted with Electron `safeStorage` (the macOS Keychain).
- **Touch ID** uses KeePassXC-style quick unlock. The master password is sealed with
  `safeStorage` and released only after `systemPreferences.promptTouchID()` succeeds.
  The Keychain item itself is not bound to biometry, so Touch ID is enforced by the app
  rather than by the Secure Enclave. Future hardening would be a native Keychain item
  with `kSecAccessControlBiometryCurrentSet`. If the master password changes elsewhere,
  the stored secret is dropped automatically.
- CSP: `connect-src 'self'`. All Google traffic goes through main. Navigation and new
  windows are denied, and external links open in the system browser.

## Releases

Releases follow the same pipeline as orkestrator:

- Conventional commits on `main` (stable) or `next` (`-rc` prereleases) trigger
  `semantic-release`, which creates a GitHub release.
- `publishall.yaml` then builds, signs and notarizes for macOS, Windows and Linux.
  electron-updater picks the release up.

Required repository secrets: `PAT_TOKEN`, `APPLE_ID`, `APPLE_ID_PASSWORD`,
`APPLE_TEAM_ID`, `CSC_LINK` (base64 `.p12`), `CSC_KEY_PASSWORD`, `GOOGLE_CLIENT_ID`,
`GOOGLE_CLIENT_SECRET`.

> Local `electron-builder --dir` builds are only ad-hoc signed. With hardened runtime
> enabled they fail macOS library validation ("different Team IDs"). For a local smoke
> test, add `-c.mac.hardenedRuntime=false -c.mac.notarize=false`.
