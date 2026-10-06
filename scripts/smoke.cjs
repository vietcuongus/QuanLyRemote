const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { utils } = require('ssh2');
const { createFixture } = require('../tests/fixture.cjs');
const { Store } = require('../electron/store.cjs');

async function main() {
  const root = path.resolve(__dirname, '..');
  const artifacts = path.join(root, 'artifacts'); fs.mkdirSync(artifacts, { recursive: true });
  const directory = fs.mkdtempSync(path.join(artifacts, 'desktop-smoke-'));
  const fixture = await createFixture();
  let app;
  const errors = [], steps = [];
  try {
    const env = { ...process.env, QLR_DATA_DIR: directory }; delete env.ELECTRON_RUN_AS_NODE;
    const executablePath = process.env.QLR_SMOKE_EXE;
    app = await electron.launch({ args: executablePath ? [] : ['.'], ...(executablePath ? { executablePath: path.resolve(executablePath) } : {}), cwd: root, env, timeout: 30000 });
    const page = await app.firstWindow();
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.locator('.empty-demo-link').waitFor();
    assert.equal(await page.locator('.stat strong').first().textContent(), '00');
    steps.push('Empty production workspace renders with no fabricated connections.');
    await page.screenshot({ path: path.join(artifacts, '01-empty-workspace.png'), animations: 'disabled' });

    await page.locator('.empty-demo-link').click();
    assert.equal(await page.locator('.connection-card').count(), 6);
    await page.screenshot({ path: path.join(artifacts, '02-workspace-preview.png'), animations: 'disabled' });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1024, 768));
    await page.screenshot({ path: path.join(artifacts, '02b-workspace-1024.png'), animations: 'disabled' });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 940));
    await page.getByRole('button', { name: 'SSH 4', exact: true }).click();
    assert.equal(await page.locator('.connection-card').count(), 4);
    await page.locator('.search-field input').fill('staging');
    assert.equal(await page.locator('.connection-card').count(), 1);
    await page.locator('.search-field input').fill('');
    await page.locator('.demo-banner button').click();
    steps.push('Sample preview is labelled; protocol filters and search work.');

    await page.keyboard.press('Control+n');
    await page.getByRole('dialog').waitFor();
    const form = page.locator('.profile-modal');
    await form.getByLabel('Tên kết nối', { exact: true }).fill('Local SSH integration');
    await form.getByLabel('Địa chỉ máy chủ', { exact: true }).fill('127.0.0.1');
    await form.getByLabel('Cổng', { exact: true }).fill(String(fixture.port));
    await form.getByLabel('Tên đăng nhập', { exact: true }).fill('tester');
    await form.getByLabel('Mật khẩu', { exact: true }).fill('fixture-only-password');
    await form.getByLabel('Lưu mật khẩu được mã hóa trên máy này').check();
    await page.screenshot({ path: path.join(artifacts, '03-connection-editor.png'), animations: 'disabled' });
    await form.getByRole('button', { name: 'Lưu kết nối', exact: true }).click();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    assert.equal(await page.locator('.connection-card').count(), 1);
    const saved = JSON.parse(fs.readFileSync(path.join(directory, 'workspace.json'), 'utf8'));
    assert.equal(JSON.stringify(saved).includes('fixture-only-password'), false);
    assert.ok(saved.secrets[saved.profiles[0].id]);
    steps.push('Connection form saves a profile and DPAPI-encrypted credentials; no plaintext secret on disk.');

    // Trust only the test fixture's actual key. No global bypass of host verification.
    const fingerprint = 'SHA256:' + crypto.createHash('sha256').update(utils.parseKey(fixture.hostKey).getPublicSSH()).digest('base64').replace(/=+$/, '');
    await app.evaluate(({ dialog }, fingerprint) => {
      const original = dialog.showMessageBox;
      dialog.showMessageBox = async (...args) => {
        const options = args.at(-1);
        if (options.title === 'Xác minh máy chủ SSH' && options.detail.includes(fingerprint)) return { response: 1 };
        return original(...args);
      };
    }, fingerprint);
    await page.locator('.connect-button').click();
    await page.locator('.session-header .connection-state.connected').waitFor({ timeout: 15000 });
    const windowSettings = await app.evaluate(({ BrowserWindow }) => {
      const prefs = BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences();
      return { sandbox: prefs.sandbox, contextIsolation: prefs.contextIsolation, nodeIntegration: prefs.nodeIntegration };
    });
    assert.deepEqual(windowSettings, { sandbox: true, contextIsolation: true, nodeIntegration: false });
    await page.evaluate(() => {
      window.__smokeOutput = '';
      window.__smokeStop = window.remote.onEvent(event => { if (event.type === 'data') window.__smokeOutput += event.data; });
    });
    await page.locator('.terminal-container .xterm-helper-textarea').focus();
    await page.keyboard.type('unicode'); await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.__smokeOutput.includes('Tiếng Việt ✓'));
    await page.evaluate(() => { window.__smokeStop(); delete window.__smokeStop; delete window.__smokeOutput; });
    assert.ok(fixture.state.input.includes('unicode'));
    await page.screenshot({ path: path.join(artifacts, '04-ssh-terminal.png'), animations: 'disabled' });
    steps.push('Actual desktop SSH connects through verified host-key dialog, runs interactive terminal I/O and displays UTF-8.');

    await page.getByRole('button', { name: 'File SFTP', exact: true }).click();
    await page.locator('.file-pane').nth(1).getByText('readme.txt', { exact: true }).waitFor();
    const uploadPath = path.join(directory, 'desktop-upload.txt');
    const downloadPath = path.join(directory, 'desktop-download.txt');
    const fileContents = 'Desktop file transfer ✓\n'; fs.writeFileSync(uploadPath, fileContents);
    await app.evaluate(({ dialog }, { directory, uploadPath, downloadPath }) => {
      const originalOpen = dialog.showOpenDialog, originalSave = dialog.showSaveDialog;
      dialog.showOpenDialog = async (...args) => {
        const options = args.at(-1);
        if (options.title === 'Chọn file tải lên') return { canceled: false, filePaths: [uploadPath] };
        if (options.properties?.includes('openDirectory')) return { canceled: false, filePaths: [directory] };
        return originalOpen(...args);
      };
      dialog.showSaveDialog = async (...args) => {
        if (args.at(-1).title === 'Lưu file từ máy chủ') return { canceled: false, filePath: downloadPath };
        return originalSave(...args);
      };
    }, { directory, uploadPath, downloadPath });
    await page.locator('.file-pane').first().getByRole('button', { name: 'Chọn thư mục', exact: true }).click();
    await page.locator('.file-pane').first().getByText('desktop-upload.txt', { exact: true }).waitFor();
    await page.locator('.file-pane').nth(1).getByRole('button', { name: 'Tải lên files', exact: true }).click();
    await page.locator('.file-pane').nth(1).getByText('desktop-upload.txt', { exact: true }).waitFor();
    assert.equal(fs.readFileSync(path.join(fixture.root, 'desktop-upload.txt'), 'utf8'), fileContents);
    await page.locator('.file-pane').nth(1).getByText('desktop-upload.txt', { exact: true }).click();
    await page.locator('.files-toolbar').getByRole('button', { name: 'Tải xuống', exact: true }).click();
    await page.locator('.file-pane').first().getByText('desktop-download.txt', { exact: true }).waitFor();
    assert.equal(fs.readFileSync(downloadPath, 'utf8'), fileContents);
    await page.screenshot({ path: path.join(artifacts, '05-sftp-browser.png'), animations: 'disabled' });
    await page.getByRole('button', { name: 'Thư mục mới', exact: true }).click();
    await page.getByRole('dialog').getByLabel('Tên', { exact: true }).fill('desktop-created');
    await page.getByRole('dialog').getByRole('button', { name: 'Xong' }).click();
    await page.locator('.file-pane').nth(1).getByText('desktop-created', { exact: true }).waitFor();
    assert.ok(fs.existsSync(path.join(fixture.root, 'desktop-created')));
    steps.push('Dual-pane SFTP lists files, uploads, downloads and creates an actual remote directory from the UI.');

    await page.keyboard.press('Control+1');
    await page.locator('.main-nav').getByRole('button', { name: 'Lệnh đã lưu', exact: true }).click();
    await page.locator('.simple-page-heading').getByRole('button', { name: 'Thêm lệnh' }).click();
    await page.getByRole('dialog').getByLabel('Tên kết nối', { exact: true }).fill('Disk usage');
    await page.getByRole('dialog').getByLabel('Nội dung lệnh', { exact: true }).fill('df -h');
    await page.getByRole('dialog').getByRole('button', { name: 'Đã lưu' }).click();
    await page.locator('.snippet-card').waitFor();
    assert.equal(await page.locator('.snippet-card pre').textContent(), 'df -h');
    await page.locator('.settings-link').click();
    await page.getByRole('button', { name: 'Sáng', exact: true }).click();
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');
    await page.screenshot({ path: path.join(artifacts, '06-settings-light.png'), animations: 'disabled' });
    await page.getByLabel('Ngôn ngữ', { exact: true }).selectOption('en');
    await page.getByRole('heading', { name: 'Settings.', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Dark', exact: true }).click();
    await page.keyboard.press('Control+k');
    await page.locator('.palette-input input').fill('Local SSH');
    assert.equal(await page.locator('.palette-results > button').count(), 1);
    await page.screenshot({ path: path.join(artifacts, '07-command-palette.png'), animations: 'disabled' });
    await page.keyboard.press('Escape');
    steps.push('Saved commands, theme persistence, English UI and keyboard command palette work.');

    await page.evaluate(async () => {
      const data = await window.remote.load();
      await window.remote.settings({ ...data.settings, confirmClose: false });
    });
    assert.deepEqual(errors, []);
    steps.push('No renderer errors. Sandbox, context isolation and disabled Node integration verified.');
    fs.writeFileSync(path.join(artifacts, executablePath ? 'packaged-smoke.json' : 'desktop-smoke.json'), JSON.stringify({ passed: true, steps, errors, security: windowSettings }, null, 2));
    console.log(JSON.stringify({ passed: true, checks: steps.length, steps }, null, 2));
  } finally {
    if (app) await app.close();
    await fixture.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
