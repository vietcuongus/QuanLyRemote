const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const assert = require('node:assert/strict');

async function main() {
  const root = path.resolve(__dirname, '..'), artifacts = path.join(root, 'artifacts');
  const executable = path.join(root, 'release/QuanLyRemote-1.0.0-x64-portable.exe');
  assert.ok(fs.existsSync(executable), 'Build the portable executable first.');
  const directory = fs.mkdtempSync(path.join(artifacts, 'portable-smoke-'));
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port; await new Promise(resolve => server.close(resolve));
  const env = { ...process.env, QLR_DATA_DIR: directory }; delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(executable, [`--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1'], { env, cwd: root, windowsHide: true, stdio: 'ignore' });
  let browser, page, exited = false;
  child.once('exit', () => { exited = true; });
  const errors = []; child.on('error', error => errors.push(error.message));
  try {
    const start = Date.now();
    while (!browser) {
      if (errors.length || Date.now() - start > 45000) throw new Error(errors[0] || 'Portable app did not start within 45 seconds.');
      try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 1500 }); }
      catch { await new Promise(resolve => setTimeout(resolve, 200)); }
    }
    const context = browser.contexts()[0];
    page = context.pages()[0] || await context.waitForEvent('page', { timeout: 15000 });
    await page.locator('.empty-demo-link').waitFor();
    const workspace = await page.evaluate(() => window.remote.load());
    assert.equal(workspace.version, '1.0.0');
    assert.equal(workspace.profiles.length, 0);
    assert.equal(workspace.encryptionAvailable, true);
    await page.screenshot({ path: path.join(artifacts, '08-portable-executable.png'), animations: 'disabled' });
    await page.evaluate(() => window.remote.windowControl('close')).catch(error => {
      // Closing the app may destroy the IPC caller before its reply arrives.
      if (!error.message.includes('Target page, context or browser has been closed')) throw error;
    });
    fs.writeFileSync(path.join(artifacts, 'portable-smoke.json'), JSON.stringify({ passed: true, executable: path.basename(executable), version: workspace.version, encryptionAvailable: workspace.encryptionAvailable, initialProfiles: workspace.profiles.length }, null, 2));
    console.log('Portable .exe starts successfully; production UI and Windows encryption available.');
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (!exited) {
      await new Promise(resolve => { const timeout = setTimeout(resolve, 3000); child.once('exit', () => { clearTimeout(timeout); resolve(); }); });
      if (!exited) {
        const { spawnSync } = require('node:child_process');
        if (Number.isInteger(child.pid) && child.pid > 0) spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      }
    }
    const resolved = path.resolve(directory);
    if (!resolved.startsWith(`${path.resolve(artifacts)}${path.sep}portable-smoke-`)) throw new Error('Refusing cleanup outside artifacts.');
    fs.rmSync(resolved, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
