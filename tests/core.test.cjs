const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { normalizeProfile, normalizeSettings, fileName, remotePath, parseImport } = require('../electron/core.cjs');
const { Store } = require('../electron/store.cjs');

const profile = { name: 'Production', host: 'server.example.com', username: 'deploy', protocol: 'ssh', port: 22, tags: ['api', 'api', 'web'] };
const mockEncryption = {
  isEncryptionAvailable: () => true,
  encryptString: value => Buffer.from(`encrypted:${Buffer.from(value).toString('base64')}`),
  decryptString: value => Buffer.from(value.toString().slice(10), 'base64').toString(),
};
const createStore = t => { const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qlr-store-test-')); t.after(() => fs.rmSync(directory, { recursive: true, force: true })); return { store: new Store(directory, mockEncryption), directory }; };

test('profiles accept IPv4, IPv6 and DNS; reject invalid endpoints and unsupported protocols', () => {
  for (const host of ['localhost', '192.168.1.2', '::1', 'server.example.com']) assert.equal(normalizeProfile({ ...profile, host }).host, host);
  for (const host of ['https://host', 'host:22', 'host & command', 'host\n']) assert.throws(() => normalizeProfile({ ...profile, host }));
  for (const port of [0, -1, 0.1, 65536, 'abc']) assert.throws(() => normalizeProfile({ ...profile, port }));
  assert.throws(() => normalizeProfile({ ...profile, protocol: 'telnet' }));
  assert.throws(() => normalizeProfile({ ...profile, auth: 'unsupported' }));
  assert.throws(() => normalizeProfile({ ...profile, name: '' }));
  assert.deepEqual(normalizeProfile(profile).tags, ['api', 'web']);
});

test('settings and remote paths enforce bounds without banning spaces in filenames', () => {
  assert.equal(normalizeSettings({ theme: 'bad', fontSize: 300 }).theme, 'dark');
  assert.equal(normalizeSettings({ fontSize: 300 }).fontSize, 14);
  assert.equal(fileName('báo cáo.txt'), 'báo cáo.txt');
  for (const value of ['..', '.', '', 'a/b', 'a\\b', 'nul\0']) assert.throws(() => fileName(value));
  assert.equal(remotePath('/home/user/../data'), '/home/data');
  assert.throws(() => remotePath('/home/\0'));
});

test('saved credentials are encrypted, omitted from snapshots and exports, and survive restart', t => {
  const { store, directory } = createStore(t);
  const snapshot = store.save(profile, { secret: 'unique-sensitive-value', remember: true });
  const id = snapshot.profiles[0].id;
  assert.equal(snapshot.profiles[0].hasSecret, true);
  assert.equal(store.secret(id), 'unique-sensitive-value');
  assert.equal(JSON.stringify(snapshot).includes('unique-sensitive-value'), false);
  assert.equal(fs.readFileSync(store.file, 'utf8').includes('unique-sensitive-value'), false);
  assert.equal(store.export().includes('encrypted:'), false);
  assert.equal(new Store(directory, mockEncryption).secret(id), 'unique-sensitive-value');
});

test('temporary credentials never reach disk and disappear after restart', t => {
  const { store, directory } = createStore(t);
  const snapshot = store.save(profile, { secret: 'temporary-sensitive-value', remember: false });
  const id = snapshot.profiles[0].id;
  assert.equal(store.secret(id), 'temporary-sensitive-value');
  assert.equal(snapshot.profiles[0].secretSaved, false);
  assert.equal(fs.readFileSync(store.file, 'utf8').includes('temporary-sensitive-value'), false);
  assert.equal(new Store(directory, mockEncryption).secret(id), '');
});

test('unavailable encryption rejects remembering a password without adding a profile', t => {
  const { directory } = createStore(t);
  const store = new Store(directory, { ...mockEncryption, isEncryptionAvailable: () => false });
  assert.throws(() => store.save(profile, { secret: 'fixture', remember: true }));
  assert.equal(store.snapshot().profiles.length, 0);
});

test('editing retains credentials; explicit removal and profile deletion clear credentials', t => {
  const { store } = createStore(t);
  const saved = store.save(profile, { secret: 'sensitive', remember: true }).profiles[0];
  store.save({ ...saved, name: 'Renamed' });
  assert.equal(store.secret(saved.id), 'sensitive');
  store.save(saved, { remember: false });
  assert.equal(store.secret(saved.id), 'sensitive');
  assert.equal(store.snapshot().profiles[0].secretSaved, false);
  store.save(saved, { remember: true });
  assert.equal(store.snapshot().profiles[0].secretSaved, true);
  store.save(saved, { secret: '', remember: false });
  assert.equal(store.secret(saved.id), '');
  store.save(saved, { secret: 'sensitive', remember: true });
  store.remove(saved.id);
  assert.equal(store.secret(saved.id), '');
  assert.equal(store.snapshot().profiles.length, 0);
});

test('host pins persist and can be deliberately forgotten', t => {
  const { store, directory } = createStore(t);
  store.trustHost('example.com:22', 'SHA256:fixture');
  const restarted = new Store(directory, mockEncryption);
  assert.equal(restarted.hostKey('example.com:22'), 'SHA256:fixture');
  restarted.forgetHost('example.com:22');
  assert.equal(restarted.hostKey('example.com:22'), undefined);
});

test('imports validate every profile before mutation, generate new IDs, ignore secrets and host pins', t => {
  const { store } = createStore(t);
  store.save(profile);
  const exported = store.export();
  const imported = store.import(exported);
  assert.equal(imported.profiles.length, 2);
  assert.notEqual(imported.profiles[0].id, imported.profiles[1].id);
  assert.throws(() => store.import(JSON.stringify({ version: 1, profiles: [profile, { ...profile, host: 'bad host' }] })));
  assert.equal(store.snapshot().profiles.length, 2);
  const data = { version: 1, profiles: [{ ...profile, password: 'secret', hasSecret: true }], secrets: { bad: 'secret' }, hosts: { bad: 'key' } };
  const snapshot = store.import(JSON.stringify(data));
  assert.equal(snapshot.profiles.at(-1).hasSecret, false);
  assert.deepEqual(snapshot.knownHosts, []);
  assert.throws(() => parseImport('{}'));
});

test('snippets preserve multiline commands and reject empty content', t => {
  const { store, directory } = createStore(t);
  store.saveSnippet({ name: 'Disk', command: 'df -h\nfree -m' });
  assert.equal(new Store(directory, mockEncryption).snapshot().snippets[0].command, 'df -h\nfree -m');
  assert.throws(() => store.saveSnippet({ name: 'bad', command: '' }));
  store.import(store.export());
  assert.equal(store.snapshot().snippets.length, 2);
  assert.notEqual(store.snapshot().snippets[0].id, store.snapshot().snippets[1].id);
  assert.equal(store.snapshot().snippets[1].command, 'df -h\nfree -m');
});

test('corrupt workspace is reported without replacing the original file', t => {
  const { directory } = createStore(t);
  const file = path.join(directory, 'workspace.json'); fs.writeFileSync(file, 'broken-json');
  assert.throws(() => new Store(directory, mockEncryption));
  assert.equal(fs.readFileSync(file, 'utf8'), 'broken-json');
  for (const invalid of [{ version: 1, profiles: [], secrets: null }, { version: 1, profiles: [], snippets: 'invalid' }]) {
    const original = JSON.stringify(invalid); fs.writeFileSync(file, original);
    assert.throws(() => new Store(directory, mockEncryption));
    assert.equal(fs.readFileSync(file, 'utf8'), original);
  }
});
