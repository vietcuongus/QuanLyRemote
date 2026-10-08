const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { utils } = require('ssh2');
const { createFixture } = require('../tests/fixture.cjs');

async function main() {
  const root = path.resolve(__dirname, '..'), artifacts = path.join(root, 'artifacts');
  fs.mkdirSync(artifacts, { recursive: true });
  const directory = fs.mkdtempSync(path.join(artifacts, 'restore-smoke-'));
  const fixture = await createFixture(), offline = await createFixture();
  const offlinePort = offline.port; await offline.close();
  const fingerprint = 'SHA256:' + crypto.createHash('sha256').update(utils.parseKey(fixture.hostKey).getPublicSSH()).digest('base64').replace(/=+$/, '');
  let app, page;
  const errors = [], steps = [];
  const boot = async () => {
    const env = { ...process.env, QLR_DATA_DIR: directory }; delete env.ELECTRON_RUN_AS_NODE;
    const executablePath = process.env.QLR_SMOKE_EXE;
    app = await electron.launch({ args: executablePath ? [] : ['.'], ...(executablePath ? { executablePath: path.resolve(executablePath) } : {}), cwd: root, env, timeout: 30000 });
    page = await app.firstWindow();
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await app.evaluate(({ dialog }, fingerprint) => {
      const original = dialog.showMessageBox;
      dialog.showMessageBox = async (...args) => {
        const options = args.at(-1);
        if (options.title === 'Xác minh máy chủ SSH' && options.detail.includes(fingerprint)) return { response: 1 };
        return original(...args);
      };
    }, fingerprint);
    await page.locator('.app-shell').waitFor();
  };
  const close = async () => { if (app) { await app.close(); app = null; } };
  const loaded = () => page.evaluate(() => window.remote.load());
  try {
    await boot();
    await page.evaluate(async ({ profile, offlinePort }) => {
      await window.remote.saveProfile({ ...profile, id: 'restore-saved', name: 'Remembered SSH' }, { secret: 'fixture-only-password', remember: true });
      await window.remote.saveProfile({ ...profile, id: 'restore-password', name: 'Password required' });
      await window.remote.saveProfile({ ...profile, id: 'restore-offline', name: 'Offline SSH', port: offlinePort }, { secret: 'fixture-only-password', remember: true });
      await window.remote.settings({ theme: 'dark', language: 'vi', fontSize: 14, confirmClose: false, restoreSessions: true });
    }, { profile: fixture.profile, offlinePort });
    await page.reload(); await page.locator('.connection-card').first().waitFor();
    const first = await page.evaluate(() => window.remote.connect('restore-saved', undefined, 'terminal'));
    const second = await page.evaluate(() => window.remote.connect('restore-saved', undefined, 'terminal'));
    await page.locator('.session-tab').nth(1).locator('button').first().click();
    await page.locator('.session-view:not([hidden])').getByRole('button', { name: 'File SFTP', exact: true }).click();
    const password = await page.evaluate(() => window.remote.connect('restore-password', 'fixture-only-password', 'terminal'));
    await page.evaluate(async () => { try { await window.remote.connect('restore-offline', undefined, 'terminal'); } catch {} });
    await page.locator('.session-tab').nth(1).locator('button').first().click();
    await page.waitForFunction(({ first, second, password }) => window.remote.load().then(data => data.sessionLayout.tabs.length === 4 && data.sessionLayout.tabs[0].id === first && data.sessionLayout.tabs[1].id === second && data.sessionLayout.tabs[2].id === password && data.sessionLayout.tabs[1].view === 'files' && data.sessionLayout.activeTab === second), { first: first.id, second: second.id, password: password.id });
    // Native mouse drag must change live tab order and the persisted layout.
    const original = (await loaded()).sessionLayout;
    const originalIds = original.tabs.map(tab => tab.id);
    await page.locator('.session-tab').nth(2).locator('button').first().dragTo(page.locator('.session-tab').nth(0), { targetPosition: { x: 5, y: 20 } });
    await page.waitForFunction(({ password, second }) => window.remote.load().then(data => data.sessionLayout.tabs[0]?.id === password && data.sessionLayout.activeTab === second), { password: password.id, second: second.id }, { timeout: 3000 });
    assert.deepEqual((await loaded()).sessionLayout.tabs.map(tab => tab.id), [password.id, first.id, second.id, originalIds[3]]);
    assert.deepEqual(await page.locator('.session-tab > button:first-child').allTextContents(), ['Password required', 'Remembered SSH', 'Remembered SSH', 'Offline SSH']);
    // Move it right again and back left, then restart in the reordered layout.
    const targetBox = await page.locator('.session-tab').nth(2).boundingBox();
    await page.locator('.session-tab').nth(0).locator('button').first().dragTo(page.locator('.session-tab').nth(2), { targetPosition: { x: targetBox.width - 5, y: 20 } });
    await page.waitForFunction(ids => window.remote.load().then(data => data.sessionLayout.tabs.map(tab => tab.id).join() === ids.join()), originalIds, { timeout: 3000 });
    await page.locator('.session-tab').nth(2).locator('button').first().focus();
    await page.keyboard.press('Alt+Shift+ArrowLeft');
    await page.waitForFunction(({ first, password, second }) => window.remote.load().then(data => data.sessionLayout.tabs[0]?.id === first && data.sessionLayout.tabs[1]?.id === password && data.sessionLayout.tabs[2]?.id === second), { first: first.id, password: password.id, second: second.id }, { timeout: 3000 });
    await page.keyboard.press('Alt+Shift+ArrowRight');
    await page.waitForFunction(ids => window.remote.load().then(data => data.sessionLayout.tabs.map(tab => tab.id).join() === ids.join()), originalIds, { timeout: 3000 });
    await page.locator('.session-tab').nth(2).locator('button').first().dragTo(page.locator('.session-tab').nth(0), { targetPosition: { x: 5, y: 20 } });
    await page.waitForFunction(id => window.remote.load().then(data => data.sessionLayout.tabs[0]?.id === id), password.id, { timeout: 3000 });
    // Dropping outside the tab bar must neither close nor reorder sessions.
    const reordered = (await loaded()).sessionLayout;
    await page.locator('.session-tab').nth(0).locator('button').first().dragTo(page.locator('.session-tab').nth(0), { targetPosition: { x: 5, y: 20 } });
    assert.deepEqual((await loaded()).sessionLayout, reordered);
    await page.locator('.session-tab').nth(0).locator('button').first().dragTo(page.locator('.app-statusbar'), { targetPosition: { x: 30, y: 10 } });
    assert.deepEqual((await loaded()).sessionLayout, reordered);
    const before = (await loaded()).sessionLayout;
    assert.equal(JSON.stringify(before).includes('fixture-only-password'), false);
    steps.push('Mouse drag and keyboard reorder tabs left/right, preserving the active SFTP tab; drops outside the bar or onto the same tab do nothing. Reordered layout is saved for restart.');
    await close();
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(directory, 'workspace.json'), 'utf8')).sessionLayout, before);

    await boot();
    await page.waitForFunction(() => document.querySelectorAll('.session-tab .status-dot.connected').length === 2);
    assert.equal(await page.locator('.session-tab').count(), 4);
    assert.equal(await page.locator('.session-tab.selected button').first().textContent(), 'Remembered SSH');
    await page.locator('.session-view:not([hidden]) .file-pane').nth(1).getByText('readme.txt', { exact: true }).waitFor();
    assert.deepEqual((await loaded()).sessionLayout, before);
    await page.evaluate(id => window.remote.write(id, 'restored-ssh-check\r'), first.id);
    const deadline = Date.now() + 2500;
    while (!fixture.state.input.includes('restored-ssh-check\r') && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25));
    assert.ok(fixture.state.input.includes('restored-ssh-check\r'));
    steps.push('Restart auto-reconnects both saved-password transports, restores active SFTP and preserves IDs/order; missing password and offline server do not block working sessions.');

    await page.locator('.session-view:not([hidden])').getByRole('button', { name: 'Kết nối lại', exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('.session-tab .status-dot.connected').length === 2);
    assert.equal(await page.locator('.session-tab').count(), 4);
    assert.deepEqual((await loaded()).sessionLayout, before);
    await page.locator('.session-view:not([hidden]) .file-pane').nth(1).getByText('readme.txt', { exact: true }).waitFor();
    steps.push('Reconnecting an already connected SFTP tab preserves its ID/view and the replacement transport remains usable.');

    await page.locator('.session-tab').nth(0).locator('button').first().click();
    await page.getByText('Phiên đã khôi phục. Nhấn Kết nối lại để nhập mật khẩu.', { exact: true }).waitFor();
    await page.locator('.session-view:not([hidden])').getByRole('button', { name: 'Kết nối lại', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Mật khẩu', { exact: true }).fill('fixture-only-password');
    await dialog.getByRole('button', { name: 'Kết nối', exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('.session-tab .status-dot.connected').length === 3);
    assert.equal(await page.locator('.session-tab').count(), 4, 'Reconnect reuses the restored tab instead of adding a duplicate.');
    assert.equal((await loaded()).sessionLayout.tabs[0].id, password.id);
    await page.locator('.session-tab').nth(0).locator('.tab-close').click();
    await page.waitForFunction(() => window.remote.load().then(data => data.sessionLayout.tabs.length === 3));
    const closed = (await loaded()).sessionLayout;
    assert.equal(closed.tabs.some(tab => tab.id === password.id), false);
    steps.push('Password entry reconnects within the original tab; explicitly closed tabs are removed from the saved workspace.');
    await page.screenshot({ path: path.join(artifacts, '09-session-restoration.png'), animations: 'disabled' });
    await close();
    await boot();
    await page.waitForFunction(() => document.querySelectorAll('.session-tab .status-dot.connected').length === 2);
    assert.equal(await page.locator('.session-tab').count(), 3);
    assert.equal((await loaded()).sessionLayout.tabs.some(tab => tab.id === password.id), false);
    await page.keyboard.press('Control+1'); await page.locator('.settings-link').click();
    const toggle = page.getByRole('switch', { name: 'Khôi phục phiên khi mở ứng dụng', exact: true });
    assert.equal(await toggle.getAttribute('aria-checked'), 'true');
    await toggle.click();
    await page.waitForFunction(() => window.remote.load().then(data => data.settings.restoreSessions === false));
    await close(); await boot();
    await page.waitForFunction(() => window.remote.load().then(data => data.sessionLayout.tabs.length === 0));
    assert.equal(await page.locator('.session-tab').count(), 0);
    assert.equal((await loaded()).profiles.length, 3);
    steps.push('A second restart does not reopen closed tabs; disabling restore opens only Workspace and keeps all saved connections.');
    assert.deepEqual(errors, []);
    const result = { passed: true, checks: steps.length, steps, rendererErrors: errors };
    fs.writeFileSync(path.join(artifacts, process.env.QLR_SMOKE_EXE ? 'packaged-restore-smoke.json' : 'restore-smoke.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
  } finally {
    if (app) {
      await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1 }); }).catch(() => {});
      await close();
    }
    await fixture.close();
    const resolved = path.resolve(directory);
    if (!resolved.startsWith(`${path.resolve(artifacts)}${path.sep}restore-smoke-`)) throw new Error('Refusing cleanup outside disposable restore workspace.');
    fs.rmSync(resolved, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
