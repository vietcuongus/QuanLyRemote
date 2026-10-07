const net = require('node:net');
const path = require('node:path');
const crypto = require('node:crypto');

const DEFAULT_SETTINGS = Object.freeze({ theme: 'dark', language: 'vi', fontSize: 14, confirmClose: true, restoreSessions: true });

function boundedString(value, name, max = 200, required = false) {
  if (typeof value !== 'string' || value.length > max || /[\x00-\x1f]/.test(value)) throw new Error(`${name} không hợp lệ.`);
  const result = value.trim();
  if (required && !result) throw new Error(`Vui lòng nhập ${name}.`);
  return result;
}

function normalizeProfile(input) {
  if (!input || typeof input !== 'object') throw new Error('Kết nối không hợp lệ.');
  const protocol = input.protocol || 'ssh';
  if (!['ssh', 'sftp', 'rdp'].includes(protocol)) throw new Error('Giao thức không được hỗ trợ.');
  const host = boundedString(input.host, 'địa chỉ máy chủ', 253, true);
  if (!net.isIP(host) && !/^(?=.{1,253}$)[a-zA-Z0-9](?:[a-zA-Z0-9._-]*[a-zA-Z0-9])?$/.test(host)) throw new Error('Nhập IP hoặc tên miền, không kèm giao thức hay cổng.');
  const port = Number(input.port === undefined || input.port === '' ? (protocol === 'rdp' ? 3389 : 22) : input.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Cổng phải từ 1 đến 65535.');
  const auth = input.auth || 'password';
  if (!['password', 'key', 'agent'].includes(auth)) throw new Error('Kiểu xác thực không hợp lệ.');
  const tags = Array.isArray(input.tags) ? input.tags.slice(0, 12).map(t => boundedString(t, 'nhãn', 32)).filter(Boolean) : [];
  return {
    id: input.id ? boundedString(input.id, 'ID', 80, true) : crypto.randomUUID(),
    name: boundedString(input.name, 'tên kết nối', 80, true),
    host, port, protocol, auth,
    username: boundedString(input.username || '', 'tên đăng nhập', 120, protocol !== 'rdp'),
    group: boundedString(input.group || 'Personal', 'nhóm', 60),
    tags: [...new Set(tags)],
    keyPath: boundedString(input.keyPath || '', 'đường dẫn khóa', 1024),
    favorite: Boolean(input.favorite),
    note: boundedString(input.note || '', 'ghi chú', 500),
    lastConnected: typeof input.lastConnected === 'string' && Number.isFinite(Date.parse(input.lastConnected)) ? input.lastConnected : null,
  };
}

function normalizeSettings(input = {}) {
  return {
    theme: ['dark', 'light'].includes(input.theme) ? input.theme : DEFAULT_SETTINGS.theme,
    language: ['vi', 'en'].includes(input.language) ? input.language : DEFAULT_SETTINGS.language,
    fontSize: Number.isInteger(input.fontSize) && input.fontSize >= 11 && input.fontSize <= 22 ? input.fontSize : DEFAULT_SETTINGS.fontSize,
    confirmClose: input.confirmClose !== false,
    restoreSessions: input.restoreSessions !== false,
  };
}

function normalizeSessionLayout(input = { tabs: [], activeTab: 'home' }, profiles = []) {
  if (!input || !Array.isArray(input.tabs) || input.tabs.length > 500) throw new Error('Danh sách phiên làm việc không hợp lệ.');
  const allowed = new Set(profiles.filter(profile => profile.protocol !== 'rdp').map(profile => profile.id));
  const ids = new Set(), tabs = [];
  for (const tab of input.tabs) {
    if (!tab || !['terminal', 'files'].includes(tab.view)) throw new Error('Chế độ phiên không hợp lệ.');
    const id = boundedString(tab.id, 'ID phiên', 80, true);
    const profileId = boundedString(tab.profileId, 'ID kết nối', 80, true);
    if (ids.has(id)) throw new Error('ID phiên trùng nhau.');
    ids.add(id);
    if (allowed.has(profileId)) tabs.push({ id, profileId, view: tab.view });
  }
  return { tabs, activeTab: tabs.some(tab => tab.id === input.activeTab) ? input.activeTab : 'home' };
}

function remotePath(value) {
  if (typeof value !== 'string' || value.length > 4096 || /[\x00-\x1f]/.test(value)) throw new Error('Đường dẫn từ xa không hợp lệ.');
  return path.posix.normalize(value || '.');
}

function fileName(value) {
  if (typeof value !== 'string' || !value || value === '.' || value === '..' || /[\\/\x00-\x1f]/.test(value) || value.length > 255) throw new Error('Tên file không hợp lệ.');
  return value;
}

function fingerprint(hex) {
  return `SHA256:${Buffer.from(hex, 'hex').toString('base64').replace(/=+$/, '')}`;
}

function parseImport(text) {
  if (typeof text !== 'string' || Buffer.byteLength(text) > 5 * 1024 * 1024) throw new Error('File cấu hình quá lớn (tối đa 5 MB).');
  const data = JSON.parse(text);
  if (data.version !== 1 || !Array.isArray(data.profiles) || data.profiles.length > 2000) throw new Error('File cấu hình QuanLyRemote v1 không hợp lệ.');
  const profiles = data.profiles.map(p => normalizeProfile({ ...p, id: crypto.randomUUID(), lastConnected: null }));
  if (data.snippets !== undefined && (!Array.isArray(data.snippets) || data.snippets.length > 2000)) throw new Error('Danh sách lệnh không hợp lệ.');
  const snippets = (data.snippets || []).map(s => normalizeSnippet({ ...s, id: crypto.randomUUID() }));
  return { profiles, snippets };
}

function normalizeSnippet(input) {
  if (!input || typeof input.command !== 'string' || !input.command.trim() || input.command.length > 12000 || input.command.includes('\0')) throw new Error('Nhập nội dung lệnh (tối đa 12000 ký tự).');
  return { id: input.id ? boundedString(input.id, 'ID', 80, true) : crypto.randomUUID(), name: boundedString(input.name, 'tên lệnh', 80, true), command: input.command };
}

module.exports = { DEFAULT_SETTINGS, normalizeProfile, normalizeSettings, normalizeSessionLayout, normalizeSnippet, remotePath, fileName, fingerprint, parseImport };
