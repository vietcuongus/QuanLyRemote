const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Sessions } = require('../electron/sessions.cjs');
const { createFixture } = require('./fixture.cjs');

async function setup(t, options = {}) {
  const fixture = await createFixture(options);
  const events = [], pins = new Map();
  const manager = new Sessions({ emit: event => events.push(event), verifyHost: (address, key) => { if (pins.has(address)) return pins.get(address) === key; pins.set(address, key); return true; }, readyTimeout: 3000 });
  t.after(async () => { manager.closeAll(); await fixture.close(); });
  return { fixture, manager, events, pins };
}
async function until(callback, timeout = 5000) {
  const start = Date.now(); while (!callback()) { if (Date.now() - start > timeout) throw new Error('Timed out waiting for fixture event'); await new Promise(resolve => setTimeout(resolve, 10)); }
}

test('password SSH uses verified host keys, opens PTY, streams UTF-8, writes and resizes', async t => {
  const { fixture, manager, events, pins } = await setup(t);
  const session = await manager.connect(fixture.profile, 'fixture-only-password');
  await until(() => events.some(e => e.type === 'data'));
  assert.match([...pins.values()][0], /^SHA256:/);
  assert.ok(events.some(e => e.status === 'connected'));
  manager.write(session.id, 'unicode\r');
  await until(() => events.filter(e => e.type === 'data').map(e => e.data).join('').includes('Tiếng Việt ✓'));
  const text = events.filter(e => e.type === 'data').map(e => e.data).join('');
  assert.equal(text.includes('�'), false);
  assert.equal(fixture.state.input, 'unicode\r');
  manager.resize(session.id, 120, 40);
  await until(() => fixture.state.geometry?.cols === 120);
  assert.equal(fixture.state.geometry.rows, 40);
  manager.disconnect(session.id);
  assert.equal(manager.sessions.size, 0);
  assert.throws(() => manager.write(session.id, 'test'));
});

test('incorrect password fails without retaining a live session', async t => {
  const { fixture, manager } = await setup(t);
  await assert.rejects(manager.connect(fixture.profile, 'wrong-password'), /authentication|Authentication/);
  assert.equal(manager.sessions.size, 0);
});

test('rejected or changed host key blocks authentication and cleans up', async t => {
  const { fixture, manager, pins } = await setup(t);
  pins.set(`${fixture.profile.host}:${fixture.port}`, 'SHA256:different-key');
  await assert.rejects(manager.connect(fixture.profile, 'fixture-only-password'), /verification|Verifier|Handshake/i);
  assert.equal(fixture.state.auth.length, 0);
  assert.equal(manager.sessions.size, 0);
});

test('OpenSSH private-key authentication works and missing key fails clearly', async t => {
  const { fixture, manager } = await setup(t);
  const session = await manager.connect({ ...fixture.profile, auth: 'key', keyPath: fixture.keyPath });
  assert.ok(fixture.state.auth.includes('publickey'));
  manager.disconnect(session.id);
  const encryptedPath = path.join(fixture.root, 'encrypted.pem');
  const privateKey = require('node:crypto').createPrivateKey(fs.readFileSync(fixture.keyPath));
  fs.writeFileSync(encryptedPath, privateKey.export({ type: 'pkcs1', format: 'pem', cipher: 'aes-256-cbc', passphrase: 'fixture-passphrase' }));
  const encryptedSession = await manager.connect({ ...fixture.profile, auth: 'key', keyPath: encryptedPath }, 'fixture-passphrase');
  manager.disconnect(encryptedSession.id);
  await assert.rejects(manager.connect({ ...fixture.profile, auth: 'key', keyPath: encryptedPath }, 'wrong-passphrase'));
  await assert.rejects(manager.connect({ ...fixture.profile, auth: 'key', keyPath: '' }), /khóa SSH/);
  assert.equal(manager.sessions.size, 0);
});

test('SFTP lists actual files, creates folders, renames files and deletes empty directories', async t => {
  const { fixture, manager } = await setup(t);
  const session = await manager.connect(fixture.profile, 'fixture-only-password', 'sftp');
  const listed = await manager.list(session.id);
  assert.equal(listed.path, '/');
  assert.ok(listed.entries.some(e => e.name === 'projects' && e.directory));
  assert.ok(listed.entries.some(e => e.name === 'readme.txt' && !e.directory));
  await manager.mkdir(session.id, '/', 'new folder');
  assert.equal(fs.statSync(path.join(fixture.root, 'new folder')).isDirectory(), true);
  await manager.rename(session.id, '/readme.txt', 'renamed.txt');
  assert.equal(fs.existsSync(path.join(fixture.root, 'renamed.txt')), true);
  await manager.remove(session.id, '/renamed.txt', false);
  await manager.remove(session.id, '/new folder', true);
  assert.equal(fs.existsSync(path.join(fixture.root, 'new folder')), false);
  await assert.rejects(manager.remove(session.id, '/', true), /gốc/);
  await assert.rejects(manager.mkdir(session.id, '/', '../escape'), /không hợp lệ/);
});

test('upload and download preserve binary data and report progress, using staging files', async t => {
  const { fixture, manager, events } = await setup(t);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qlr-transfer-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const upload = path.join(directory, 'binary.dat'), download = path.join(directory, 'download.dat');
  const contents = require('node:crypto').randomBytes(180000);
  fs.writeFileSync(upload, contents);
  const session = await manager.connect(fixture.profile, 'fixture-only-password', 'sftp');
  await manager.transfer(session.id, 'upload', upload, '/binary.dat');
  assert.deepEqual(fs.readFileSync(path.join(fixture.root, 'binary.dat')), contents);
  await manager.transfer(session.id, 'download', download, '/binary.dat');
  assert.deepEqual(fs.readFileSync(download), contents);
  assert.equal(events.filter(e => e.type === 'transfer' && e.status === 'completed').length, 2);
  assert.ok(events.some(e => e.type === 'transfer' && e.transferred > 0));
  assert.equal(fs.readdirSync(fixture.root).some(name => name.endsWith('.part')), false);
  assert.equal(fs.readdirSync(directory).some(name => name.endsWith('.part')), false);
});

test('cancelling a download preserves the original destination and removes partial files', async t => {
  const { fixture, manager, events } = await setup(t, { slowRead: true });
  fs.writeFileSync(path.join(fixture.root, 'large.bin'), Buffer.alloc(512 * 1024, 7));
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qlr-cancel-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const destination = path.join(directory, 'original.bin'); fs.writeFileSync(destination, 'original');
  const session = await manager.connect(fixture.profile, 'fixture-only-password', 'sftp');
  const promise = manager.transfer(session.id, 'download', destination, '/large.bin');
  await until(() => events.some(e => e.type === 'transfer' && e.status === 'running'));
  const transfer = events.find(e => e.type === 'transfer' && e.status === 'running');
  manager.cancelTransfer(transfer.id);
  const result = await promise;
  assert.equal(result.status, 'cancelled');
  assert.equal(fs.readFileSync(destination, 'utf8'), 'original');
  assert.equal(fs.readdirSync(directory).some(name => name.endsWith('.part')), false);
  assert.equal(manager.transfers.size, 0);
});

test('failed downloads leave the existing destination untouched', async t => {
  const { fixture, manager } = await setup(t);
  const destination = path.join(fixture.root, 'existing-local.txt'); fs.writeFileSync(destination, 'original');
  const session = await manager.connect(fixture.profile, 'fixture-only-password', 'sftp');
  await assert.rejects(manager.transfer(session.id, 'download', destination, '/missing.txt'));
  assert.equal(fs.readFileSync(destination, 'utf8'), 'original');
});

test('a SFTP-first session can open its terminal without creating another SSH connection', async t => {
  const { fixture, manager } = await setup(t);
  const session = await manager.connect(fixture.profile, 'fixture-only-password', 'sftp');
  assert.equal(manager.get(session.id).stream, null);
  await Promise.all([manager.openShell(session.id), manager.openShell(session.id)]);
  assert.ok(manager.get(session.id).stream);
  assert.equal(manager.sessions.size, 1);
});

test('disconnect during connection rejects the pending operation', async t => {
  const { fixture, manager, events } = await setup(t);
  const connecting = manager.connect(fixture.profile, 'fixture-only-password');
  const id = events.find(e => e.status === 'connecting').sessionId;
  manager.disconnect(id);
  await assert.rejects(connecting);
  assert.equal(manager.sessions.size, 0);
});

test('reconnecting a saved tab replaces its transport without old close or error callbacks ending the new session', async t => {
  const { fixture, manager, events } = await setup(t);
  const session = await manager.connect(fixture.profile, 'fixture-only-password', 'terminal', {}, 'stable-work-tab');
  const previous = manager.get(session.id);
  manager.disconnect(session.id);
  const pending = manager.connect(fixture.profile, 'fixture-only-password', 'terminal', {}, session.id);
  previous.client.emit('error', new Error('Late error from old transport'));
  const reconnected = await pending;
  assert.equal(reconnected.id, session.id);
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(manager.get(session.id).status, 'connected');
  manager.write(session.id, 'replacement-transport\r');
  await until(() => fixture.state.input.includes('replacement-transport\r'));
  assert.equal(events.filter(event => event.type === 'status' && event.status === 'connected').length, 2);
  await assert.rejects(manager.connect(fixture.profile, 'fixture-only-password', 'terminal', {}, session.id), /đã được kết nối/);
});
