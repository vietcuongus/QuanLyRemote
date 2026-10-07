const { chromium } = require('playwright');
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { utils } = require('ssh2');
const { createFixture } = require('../tests/fixture.cjs');

async function launch(root, directory, version) {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  const env = { ...process.env, QLR_DATA_DIR: directory }; delete env.ELECTRON_RUN_AS_NODE;
  const executable = path.join(root, `release/QuanLyRemote-${version}-x64-portable.exe`);
  assert.ok(fs.existsSync(executable), `Missing ${path.basename(executable)}`);
  const child = spawn(executable, [`--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1'], { cwd: root, env, windowsHide: true, stdio: 'ignore' });
  let browser, exited = false, spawnError;
  child.once('exit', () => { exited = true; }); child.once('error', error => { spawnError = error; });
  const close = async () => {
    if (browser) {
      const page = browser.contexts()[0].pages()[0];
      if (page) await page.evaluate(() => window.remote.windowControl('close')).catch(() => {});
      await browser.close().catch(() => {});
    }
    if (!exited) await new Promise(resolve => { const timer = setTimeout(resolve, 3000); child.once('exit', () => { clearTimeout(timer); resolve(); }); });
    if (!exited && Number.isInteger(child.pid) && child.pid > 0) spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
  };
  try {
    const deadline = Date.now() + 45000;
    while (!browser) {
      if (spawnError || exited || Date.now() > deadline) throw spawnError || new Error(`App ${version} did not start.`);
      try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 1000 }); }
      catch { await new Promise(resolve => setTimeout(resolve, 150)); }
    }
    const context = browser.contexts()[0], page = context.pages()[0] || await context.waitForEvent('page');
    await page.waitForFunction(() => Boolean(window.remote));
    return { page, close };
  } catch (error) { await close(); throw error; }
}

async function main() {
  const root = path.resolve(__dirname, '..'), artifacts = path.join(root, 'artifacts');
  const currentVersion = require('../package.json').version;
  fs.mkdirSync(artifacts, { recursive: true });
  const directory = fs.mkdtempSync(path.join(artifacts, 'upgrade-smoke-'));
  const fixture = await createFixture();
  let app;
  try {
    app = await launch(root, directory, '1.0.0');
    await app.page.evaluate(async ({ port }) => {
      for (let i = 0; i < 50; i++) await window.remote.saveProfile({ id: `upgrade-${i}`, name: `Upgrade server ${i}`, host: '127.0.0.1', port, username: 'tester', protocol: 'ssh', auth: 'password', group: `Group ${i % 5}`, tags: ['upgrade'], favorite: i % 3 === 0 }, { secret: 'fixture-only-password', remember: true });
      await window.remote.saveSnippet({ id: 'upgrade-snippet', name: 'Status', command: 'echo Tiếng Việt ✓\ndf -h' });
      await window.remote.settings({ theme: 'light', language: 'en', fontSize: 18, confirmClose: false });
    }, { port: fixture.port });
    const previous = await app.page.evaluate(() => window.remote.load());
    assert.equal(previous.version, '1.0.0');
    assert.equal(previous.profiles.length, 50);
    await app.close(); app = null;
    const workspacePath = path.join(directory, 'workspace.json');
    const data = JSON.parse(fs.readFileSync(workspacePath, 'utf8'));
    const fingerprint = 'SHA256:' + crypto.createHash('sha256').update(utils.parseKey(fixture.hostKey).getPublicSSH()).digest('base64').replace(/=+$/, '');
    // Pin only this disposable fixture's actual key, without a global verification bypass.
    data.hosts[`127.0.0.1:${fixture.port}`] = fingerprint;
    fs.writeFileSync(workspacePath, JSON.stringify(data, null, 2));
    const bytesBefore = fs.readFileSync(workspacePath);
    assert.equal(bytesBefore.includes(Buffer.from('fixture-only-password')), false);
    app = await launch(root, directory, currentVersion);
    const updated = await app.page.evaluate(() => window.remote.load());
    assert.equal(updated.version, currentVersion);
    assert.deepEqual(updated.profiles, previous.profiles);
    assert.deepEqual(updated.snippets, previous.snippets);
    assert.deepEqual(updated.settings, { restoreSessions: true, ...previous.settings });
    assert.deepEqual(fs.readFileSync(workspacePath), bytesBefore, 'Opening the update must preserve the original workspace byte for byte.');
    assert.equal(updated.knownHosts[0].fingerprint, fingerprint);
    assert.equal(updated.profiles.every(profile => profile.secretSaved), true);
    const connected = await app.page.evaluate(() => window.remote.connect('upgrade-0', undefined, 'terminal'));
    assert.equal(connected.profileId, 'upgrade-0');
    await app.page.evaluate(id => window.remote.write(id, 'upgrade-password-check\r'), connected.id);
    const deadline = Date.now() + 2500;
    while (!fixture.state.input.includes('upgrade-password-check\r') && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25));
    assert.ok(fixture.state.input.includes('upgrade-password-check\r'), 'Saved DPAPI password must authenticate an interactive SSH session after upgrade.');
    await app.page.evaluate(id => window.remote.disconnect(id), connected.id);
    const evidence = { passed: true, from: previous.version, to: updated.version, profilesPreserved: 50, savedPasswordsPreserved: 50, groupsPreserved: 5, snippetsPreserved: true, preferencesPreserved: true, hostPinsPreserved: true, workspaceUnchangedOnOpen: true, savedPasswordSSHLogin: true };
    fs.writeFileSync(path.join(artifacts, 'upgrade-smoke.json'), JSON.stringify(evidence, null, 2));
    console.log(JSON.stringify(evidence, null, 2));
  } finally {
    if (app) await app.close();
    await fixture.close();
    const resolved = path.resolve(directory);
    if (!resolved.startsWith(`${path.resolve(artifacts)}${path.sep}upgrade-smoke-`)) throw new Error('Refusing cleanup outside disposable upgrade workspace.');
    fs.rmSync(resolved, { recursive: true, force: true });
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
