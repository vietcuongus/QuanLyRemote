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
  renderer isolation and 1024px layout.
- The same desktop checks can target `release/win-unpacked/QuanLyRemote.exe`,
  exercising the packaged runtime, assets and bundled dependencies.
- `npm run dist`: produces NSIS setup and portable x64 executables.
- `npm run test:portable`: starts the actual portable wrapper, checks the production
  UI, empty initial workspace and Windows encryption, then closes it.
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
