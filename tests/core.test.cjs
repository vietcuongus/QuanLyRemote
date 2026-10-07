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

test('working tabs preserve order, duplicates by profile, view and focus across restart without storing secrets', t => {
  const { store, directory } = createStore(t);
  const saved = store.save(profile, { secret: 'restore-sensitive-value', remember: true }).profiles[0];
  store.sessionLayout({ tabs: [{ id: 'tab-a', profileId: saved.id, view: 'terminal', password: 'must-not-save', terminalOutput: 'must-not-save' }, { id: 'tab-b', profileId: saved.id, view: 'files' }], activeTab: 'tab-b' });
  const restarted = new Store(directory, mockEncryption);
  assert.deepEqual(restarted.snapshot().sessionLayout, { tabs: [{ id: 'tab-a', profileId: saved.id, view: 'terminal' }, { id: 'tab-b', profileId: saved.id, view: 'files' }], activeTab: 'tab-b' });
  assert.equal(restarted.secret(saved.id), 'restore-sensitive-value');
  assert.equal(fs.readFileSync(store.file, 'utf8').includes('must-not-save'), false);
  assert.equal(store.export().includes('sessionLayout'), false);
});

test('closed tabs and deleted profiles leave the working layout while disconnects can remain restorable', t => {
  const { store, directory } = createStore(t);
  const saved = store.save(profile).profiles[0];
  store.rememberSession({ id: 'tab-a', profileId: saved.id, view: 'terminal' });
  store.rememberSession({ id: 'tab-b', profileId: saved.id, view: 'files' });
  store.closeSession('tab-a');
  assert.deepEqual(new Store(directory, mockEncryption).snapshot().sessionLayout.tabs.map(tab => tab.id), ['tab-b']);
  store.remove(saved.id);
  assert.deepEqual(store.snapshot().sessionLayout, { tabs: [], activeTab: 'home' });
});

test('old workspaces gain restore defaults without rewriting their contents or losing profiles', t => {
  const { directory } = createStore(t);
  const file = path.join(directory, 'workspace.json');
  const original = JSON.stringify({ version: 1, profiles: [profile], settings: { theme: 'light', fontSize: 18 } });
  fs.writeFileSync(file, original);
  const loaded = new Store(directory, mockEncryption);
  assert.equal(loaded.snapshot().settings.restoreSessions, true);
  assert.deepEqual(loaded.snapshot().sessionLayout.tabs, []);
  assert.equal(loaded.snapshot().profiles.length, 1);
  assert.equal(fs.readFileSync(file, 'utf8'), original);
});

test('invalid working layouts do not mutate saved state; stale and RDP tabs are filtered out', t => {
  const { store } = createStore(t);
  const saved = store.save(profile).profiles[0];
  const rdp = store.save({ ...profile, id: 'rdp-fixture', protocol: 'rdp' }).profiles.at(-1);
  store.rememberSession({ id: 'valid-tab', profileId: saved.id, view: 'terminal' });
  const before = fs.readFileSync(store.file, 'utf8');
  for (const invalid of [null, { tabs: 'bad' }, { tabs: [{ id: 'bad', profileId: saved.id, view: 'other' }] }, { tabs: [{ id: 'same', profileId: saved.id, view: 'terminal' }, { id: 'same', profileId: saved.id, view: 'files' }] }]) assert.throws(() => store.sessionLayout(invalid));
  assert.equal(fs.readFileSync(store.file, 'utf8'), before);
  store.sessionLayout({ tabs: [{ id: 'missing', profileId: 'removed-profile', view: 'files' }, { id: 'rdp-tab', profileId: rdp.id, view: 'terminal' }], activeTab: 'missing' });
  assert.deepEqual(store.snapshot().sessionLayout, { tabs: [], activeTab: 'home' });
  store.settings({ restoreSessions: false });
  assert.equal(store.snapshot().settings.restoreSessions, false);
});
