# Validation scope

- `npm test`: 20 Node tests with real SSH transport on localhost. Password/key
  authentication, host-key rejection before login, PTY, input/resize, fragmented
  UTF-8, SFTP listing/mkdir/rename/delete, binary upload/download, progress,
  cancellation, preservation of existing files, failed-session cleanup. Storage
  checks encryption/session-only secrets, restart, import validation, snippet round
  trips and corrupt-data handling.
- `npm run test:desktop`: Playwright launches the production Electron UI. Checks
  labelled samples, search/filtering, forms, Windows DPAPI, interactive SSH,
  dual-pane SFTP upload/download/mkdir, snippets, dark/light, vi/en, command palette,
  renderer isolation and 1024px layout. Windows clipboard regression checks cover
  Ctrl+V, Ctrl+Shift+V, Shift+Insert, toolbar paste, Unicode, multiline normalization,
  bracketed paste, exactly-once delivery, empty clipboard, Ctrl+C interrupt and
  native paste in the terminal search field. The old v1.0.0 failed by sending SYN
  (`0x16`) instead of clipboard text; v1.0.1 passes with real SSH transport.
- The same desktop checks can target `release/win-unpacked/QuanLyRemote.exe`,
  exercising the packaged runtime, assets and bundled dependencies.
- `npm run dist`: produces NSIS setup and portable x64 executables.
- `npm run test:portable`: starts the actual portable wrapper, checks the production
  UI, empty initial workspace and Windows encryption, then closes it.
- `node scripts/upgrade-smoke.cjs`: launches portable v1.0.0 and the current version
  against the same disposable workspace. Preserves 50 profiles and DPAPI-encrypted
  passwords, five groups, a multiline snippet, preferences and a fixture host pin.
  Opening the update leaves workspace bytes unchanged; a saved password then
  authenticates a real SSH session and sends input. Requires both portable binaries
  in `release/`; evidence is `artifacts/upgrade-smoke.json`.
- `npm audit --omit=dev`: checks production dependencies before publication.

Evidence: artifacts/desktop-smoke.json, artifacts/packaged-smoke.json and screenshots.
Test workspaces are temporary and separate from personal app data. The disposable
SSH fixture uses a test password/key. The desktop test automates host-key confirmation
only when its fingerprint equals the fixture's actual key; production has no bypass.

These checks do not claim access to the owner's servers. RDP launches the Windows
client; actual RDP login needs a supplied server. SSH agent setup, unusual SFTP
implementations and disrupted external networks need environment-specific checks.

The release includes SHA256SUMS.txt. Verify using PowerShell:
`Get-FileHash <file.exe> -Algorithm SHA256`. Initial binaries are unsigned; app does
not disable Windows security checks or add antivirus exclusions.
