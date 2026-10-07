const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { normalizeProfile, normalizeSettings, normalizeSessionLayout, normalizeSnippet, parseImport } = require('./core.cjs');

class Store {
  constructor(directory, encryption) {
    this.directory = directory;
    this.file = path.join(directory, 'workspace.json');
    this.encryption = encryption;
    this.temporarySecrets = new Map();
    this.data = { version: 1, profiles: [], secrets: {}, hosts: {}, snippets: [], settings: normalizeSettings(), sessionLayout: normalizeSessionLayout() };
    fs.mkdirSync(directory, { recursive: true });
    if (fs.existsSync(this.file)) {
      const loaded = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (loaded.version !== 1 || !Array.isArray(loaded.profiles) || loaded.profiles.length > 2000) throw new Error('Không thể đọc workspace. Hãy khôi phục từ bản sao lưu.');
      const record = (value, maximum) => {
        if (value === undefined) return {};
        if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length > maximum || Object.entries(value).some(([key, item]) => key.length > 1024 || typeof item !== 'string' || item.length > 24000 || /[\x00-\x1f]/.test(key))) throw new Error('Dữ liệu workspace không hợp lệ. File gốc được giữ nguyên.');
        return Object.fromEntries(Object.entries(value));
      };
      if (loaded.snippets !== undefined && (!Array.isArray(loaded.snippets) || loaded.snippets.length > 2000)) throw new Error('Dữ liệu lệnh đã lưu không hợp lệ.');
      this.data = { version: 1, profiles: loaded.profiles.map(normalizeProfile), secrets: record(loaded.secrets, 2000), hosts: record(loaded.hosts, 10000), snippets: (loaded.snippets || []).map(normalizeSnippet), settings: normalizeSettings(loaded.settings) };
      this.data.sessionLayout = normalizeSessionLayout(loaded.sessionLayout, this.data.profiles);
    }
  }

  persist() {
    const temporary = `${this.file}.${crypto.randomUUID()}.tmp`;
    try {
      fs.writeFileSync(temporary, JSON.stringify(this.data, null, 2), { encoding: 'utf8', mode: 0o600 });
      fs.renameSync(temporary, this.file);
    } finally {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
  }

  snapshot() {
    return {
      profiles: this.data.profiles.map(p => ({ ...p, hasSecret: Boolean(this.data.secrets[p.id] || this.temporarySecrets.has(p.id)), secretSaved: Boolean(this.data.secrets[p.id]) })),
      snippets: this.data.snippets,
      settings: this.data.settings,
      sessionLayout: { tabs: this.data.sessionLayout.tabs.map(tab => ({ ...tab })), activeTab: this.data.sessionLayout.activeTab },
      knownHosts: Object.entries(this.data.hosts).map(([address, key]) => ({ address, fingerprint: key })),
      encryptionAvailable: this.encryption.isEncryptionAvailable(),
    };
  }

  find(id) {
    const profile = this.data.profiles.find(p => p.id === id);
    if (!profile) throw new Error('Không tìm thấy kết nối.');
    return profile;
  }

  save(input, credential = {}) {
    const profile = normalizeProfile(input);
    const old = this.data.profiles.find(p => p.id === profile.id);
    if (old) profile.lastConnected = old.lastConnected;
    if (credential.secret === undefined && typeof credential.remember === 'boolean') credential = { ...credential, secret: this.secret(profile.id) };
    if (credential.secret !== undefined) {
      if (typeof credential.secret !== 'string' || credential.secret.length > 16000) throw new Error('Mật khẩu không hợp lệ.');
      if (credential.remember && credential.secret) {
        if (!this.encryption.isEncryptionAvailable()) throw new Error('Windows chưa sẵn sàng mã hóa. Bỏ chọn lưu mật khẩu để tiếp tục.');
        const encrypted = this.encryption.encryptString(credential.secret).toString('base64');
        this.data.secrets[profile.id] = encrypted;
        this.temporarySecrets.delete(profile.id);
      } else {
        delete this.data.secrets[profile.id];
        if (credential.secret) this.temporarySecrets.set(profile.id, credential.secret);
        else this.temporarySecrets.delete(profile.id);
      }
    }
    const index = this.data.profiles.findIndex(p => p.id === profile.id);
    if (index < 0) this.data.profiles.push(profile);
    else this.data.profiles[index] = profile;
    this.persist();
    return this.snapshot();
  }

  secret(id) {
    if (this.temporarySecrets.has(id)) return this.temporarySecrets.get(id);
    const encrypted = this.data.secrets[id];
    if (!encrypted) return '';
    try { return this.encryption.decryptString(Buffer.from(encrypted, 'base64')); }
    catch { throw new Error('Không giải mã được mật khẩu trên tài khoản Windows này. Hãy nhập lại.'); }
  }

  remove(id) {
    this.find(id);
    this.data.profiles = this.data.profiles.filter(p => p.id !== id);
    delete this.data.secrets[id];
    this.temporarySecrets.delete(id);
    this.data.sessionLayout = normalizeSessionLayout(this.data.sessionLayout, this.data.profiles);
    this.persist();
    return this.snapshot();
  }

  markConnected(id) {
    const profile = this.data.profiles.find(p => p.id === id);
    if (profile) { profile.lastConnected = new Date().toISOString(); this.persist(); }
  }

  hostKey(address) { return this.data.hosts[address]; }
  trustHost(address, key) { this.data.hosts[address] = key; this.persist(); }
  forgetHost(address) { delete this.data.hosts[address]; this.persist(); return this.snapshot(); }
  settings(input) { this.data.settings = normalizeSettings(input); this.persist(); return this.snapshot(); }

  sessionLayout(input) {
    const layout = normalizeSessionLayout(input, this.data.profiles);
    if (JSON.stringify(layout) !== JSON.stringify(this.data.sessionLayout)) {
      this.data.sessionLayout = layout;
      this.persist();
    }
    return this.snapshot().sessionLayout;
  }

  rememberSession(tab) {
    const layout = this.data.sessionLayout;
    if (layout.tabs.some(item => item.id === tab.id)) return;
    this.sessionLayout({ tabs: [...layout.tabs, tab], activeTab: tab.id });
  }

  closeSession(id) {
    const layout = this.data.sessionLayout;
    this.sessionLayout({ tabs: layout.tabs.filter(tab => tab.id !== id), activeTab: layout.activeTab === id ? 'home' : layout.activeTab });
  }

  saveSnippet(input) {
    const snippet = normalizeSnippet(input);
    const index = this.data.snippets.findIndex(s => s.id === snippet.id);
    if (index < 0) this.data.snippets.push(snippet); else this.data.snippets[index] = snippet;
    this.persist();
    return this.snapshot();
  }

  removeSnippet(id) { this.data.snippets = this.data.snippets.filter(s => s.id !== id); this.persist(); return this.snapshot(); }
  export() { return JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), profiles: this.data.profiles, snippets: this.data.snippets }, null, 2); }
  import(text) {
    const { profiles, snippets } = parseImport(text);
    if (profiles.length + this.data.profiles.length > 2000) throw new Error('Workspace chỉ hỗ trợ tối đa 2000 kết nối.');
    if (snippets.length + this.data.snippets.length > 2000) throw new Error('Workspace chỉ hỗ trợ tối đa 2000 lệnh.');
    this.data.profiles.push(...profiles);
    this.data.snippets.push(...snippets);
    this.persist();
    return this.snapshot();
  }
}

module.exports = { Store };
