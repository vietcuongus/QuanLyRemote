const { app, BrowserWindow, ipcMain, dialog, safeStorage, protocol, net, session } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const os = require('node:os');
const tcp = require('node:net');
const { spawn } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const { Store } = require('./store.cjs');
const { Sessions } = require('./sessions.cjs');
const { fileName } = require('./core.cjs');

protocol.registerSchemesAsPrivileged([{ scheme: 'qlremote', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
const development = !app.isPackaged && process.env.QLR_DEV_URL === 'http://127.0.0.1:5173';
if (process.env.QLR_DATA_DIR) app.setPath('userData', path.resolve(process.env.QLR_DATA_DIR));
let window, store, sessions;
let forceClose = false;

const trusted = event => {
  if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error('Untrusted caller.');
  const url = event.senderFrame.url;
  if (!(development ? url.startsWith('http://127.0.0.1:5173/') : url === 'qlremote://workspace/index.html')) throw new Error('Untrusted origin.');
};

function handle(channel, callback) {
  ipcMain.handle(channel, async (event, ...args) => {
    try { trusted(event); return { ok: true, value: await callback(...args) }; }
    catch (error) { return { ok: false, error: error.message }; }
  });
}

const emit = event => { if (window && !window.isDestroyed()) window.webContents.send('session:event', event); };

async function verifyHost(address, key) {
  const known = store.hostKey(address);
  if (known === key) return true;
  if (known) {
    await dialog.showMessageBox(window, { type: 'error', title: 'Khóa máy chủ đã thay đổi', message: `Dừng kết nối tới ${address}`, detail: `Khóa đã lưu: ${known}\nKhóa nhận được: ${key}\n\nXác minh với quản trị viên. Nếu máy chủ thực sự đổi khóa, xóa khóa cũ trong Cài đặt rồi kết nối lại.`, buttons: ['Đóng'] });
    return false;
  }
  const result = await dialog.showMessageBox(window, { type: 'question', title: 'Xác minh máy chủ SSH', message: `Bạn có tin cậy ${address}?`, detail: `Dấu vân tay khóa máy chủ:\n${key}\n\nĐối chiếu với quản trị viên trước khi tin cậy. Khóa được lưu để kiểm tra các lần kết nối sau.`, buttons: ['Hủy', 'Tin cậy & kết nối'], defaultId: 0, cancelId: 0, noLink: true });
  if (result.response !== 1) return false;
  store.trustHost(address, key);
  return true;
}

const localPath = value => {
  if (typeof value !== 'string' || /[\x00-\x1f]/.test(value) || value.length > 4096) throw new Error('Đường dẫn không hợp lệ.');
  return path.resolve(value || os.homedir());
};

function registerHandlers() {
  handle('workspace:load', () => ({ ...store.snapshot(), version: app.getVersion(), localHome: os.homedir(), platform: process.platform }));
  handle('profile:save', (profile, credential) => store.save(profile, credential));
  handle('profile:delete', async id => {
    const profile = store.find(id);
    const { response } = await dialog.showMessageBox(window, { type: 'question', message: `Xóa kết nối “${profile.name}”?`, detail: 'Cấu hình và mật khẩu đã lưu sẽ bị xóa. File trên máy chủ không bị ảnh hưởng.', buttons: ['Hủy', 'Xóa'], defaultId: 0, cancelId: 0 });
    return response === 1 ? store.remove(id) : store.snapshot();
  });
  handle('profile:favorite', id => { const profile = store.find(id); return store.save({ ...profile, favorite: !profile.favorite }); });
  handle('settings:save', settings => store.settings(settings));
  handle('host:forget', async address => {
    const { response } = await dialog.showMessageBox(window, { type: 'warning', message: `Xóa khóa đã tin cậy của ${address}?`, detail: 'Lần kết nối tiếp theo sẽ yêu cầu xác minh lại dấu vân tay.', buttons: ['Hủy', 'Xóa khóa'], defaultId: 0, cancelId: 0 });
    return response === 1 ? store.forgetHost(address) : store.snapshot();
  });
  handle('snippet:save', input => store.saveSnippet(input));
  handle('snippet:delete', id => store.removeSnippet(id));
  handle('workspace:export', async () => {
    const { canceled, filePath } = await dialog.showSaveDialog(window, { title: 'Xuất cấu hình — không chứa mật khẩu', defaultPath: 'QuanLyRemote-backup.json', filters: [{ name: 'JSON', extensions: ['json'] }] });
    if (canceled) return null;
    await fs.writeFile(filePath, store.export(), 'utf8');
    return filePath;
  });
  handle('workspace:import', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(window, { title: 'Nhập cấu hình QuanLyRemote', properties: ['openFile'], filters: [{ name: 'JSON', extensions: ['json'] }] });
    if (canceled) return null;
    const stat = await fs.stat(filePaths[0]);
    if (stat.size > 5 * 1024 * 1024) throw new Error('File quá lớn (tối đa 5 MB).');
    return store.import(await fs.readFile(filePaths[0], 'utf8'));
  });
  handle('dialog:key', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(window, { title: 'Chọn khóa SSH (OpenSSH / PEM)', properties: ['openFile'] });
    return canceled ? null : filePaths[0];
  });
  handle('session:connect', async (profileId, secret, mode) => {
    const profile = store.find(profileId);
    if (!['terminal', 'sftp'].includes(mode)) throw new Error('Chế độ không hợp lệ.');
    if (profile.protocol === 'rdp') throw new Error('Dùng chức năng Remote Desktop cho kết nối RDP.');
    if (secret !== undefined && (typeof secret !== 'string' || secret.length > 16000)) throw new Error('Mật khẩu không hợp lệ.');
    return sessions.connect(profile, secret === undefined ? store.secret(profile.id) : secret, mode);
  });
  handle('session:shell', (id, geometry) => sessions.openShell(id, geometry));
  handle('session:disconnect', id => sessions.disconnect(id));
  handle('session:write', (id, data) => sessions.write(id, data));
  handle('session:resize', (id, cols, rows) => sessions.resize(id, cols, rows));
  handle('sftp:list', (id, directory) => sessions.list(id, directory));
  handle('sftp:mkdir', (id, directory, name) => sessions.mkdir(id, directory, name));
  handle('sftp:rename', (id, target, name) => sessions.rename(id, target, name));
  handle('sftp:delete', async (id, target, directory) => {
    const { response } = await dialog.showMessageBox(window, { type: 'warning', message: `Xóa ${path.posix.basename(target)} trên máy chủ?`, detail: directory ? 'Chỉ xóa được thư mục rỗng. Thao tác không thể hoàn tác.' : 'Thao tác không thể hoàn tác.', buttons: ['Hủy', 'Xóa'], defaultId: 0, cancelId: 0 });
    if (response !== 1) return false;
    await sessions.remove(id, target, Boolean(directory));
    return true;
  });
  handle('local:list', async directory => {
    const location = localPath(directory);
    const items = await fs.readdir(location, { withFileTypes: true });
    const entries = await Promise.all(items.map(async item => {
      const target = path.join(location, item.name);
      const stat = await fs.lstat(target).catch(() => null);
      return stat ? { name: item.name, path: target, directory: stat.isDirectory(), symlink: stat.isSymbolicLink(), size: stat.size, modified: stat.mtimeMs } : null;
    }));
    return { path: location, parent: path.dirname(location), entries: entries.filter(Boolean) };
  });
  handle('local:choose', async () => {
    const result = await dialog.showOpenDialog(window, { properties: ['openDirectory'] });
    return result.canceled ? null : result.filePaths[0];
  });
  handle('transfer:upload', async (id, directory, selectedPath) => {
    sessions.get(id);
    let files;
    if (selectedPath) files = [localPath(selectedPath)];
    else {
      const result = await dialog.showOpenDialog(window, { title: 'Chọn file tải lên', properties: ['openFile', 'multiSelections'] });
      if (result.canceled) return [];
      files = result.filePaths;
    }
    const results = [];
    for (const file of files) {
      const target = path.posix.join(directory, fileName(path.basename(file)));
      const sftp = await sessions.sftp(id);
      const { call } = require('./sessions.cjs');
      const exists = await call(sftp, 'lstat', target).then(() => true, error => { if (error.code === 2) return false; throw error; });
      if (exists) {
        const { response } = await dialog.showMessageBox(window, { type: 'warning', message: `Ghi đè “${path.basename(file)}” trên máy chủ?`, buttons: ['Bỏ qua', 'Ghi đè'], defaultId: 0, cancelId: 0 });
        if (response !== 1) continue;
      }
      results.push(await sessions.transfer(id, 'upload', file, target));
    }
    return results;
  });
  handle('transfer:download', async (id, target, suggestedDirectory) => {
    sessions.get(id);
    const name = fileName(path.posix.basename(target));
    const result = await dialog.showSaveDialog(window, { title: 'Lưu file từ máy chủ', defaultPath: path.join(localPath(suggestedDirectory), name) });
    if (result.canceled) return null;
    return sessions.transfer(id, 'download', result.filePath, target);
  });
  handle('transfer:cancel', id => sessions.cancelTransfer(id));
  handle('remote:rdp', async id => {
    if (process.platform !== 'win32') throw new Error('Remote Desktop yêu cầu Windows.');
    const profile = store.find(id);
    if (profile.protocol !== 'rdp') throw new Error('Chọn kết nối RDP.');
    const host = tcp.isIP(profile.host) === 6 ? `[${profile.host}]` : profile.host;
    const child = spawn('mstsc.exe', [`/v:${host}:${profile.port}`], { shell: false, detached: true, stdio: 'ignore', windowsHide: false });
    await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
    child.unref();
    store.markConnected(id);
    return true;
  });
  handle('profile:probe', id => new Promise(resolve => {
    const profile = store.find(id);
    const start = performance.now();
    const socket = tcp.createConnection({ host: profile.host, port: profile.port });
    let settled = false;
    const finish = reachable => { if (!settled) { settled = true; socket.destroy(); resolve({ reachable, latency: reachable ? Math.round(performance.now() - start) : null }); } };
    socket.setTimeout(5000);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  }));
  handle('window:control', action => {
    if (action === 'minimize') window.minimize();
    else if (action === 'maximize') window.isMaximized() ? window.unmaximize() : window.maximize();
    else if (action === 'close') window.close();
  });
}

async function createWindow() {
  if (process.platform === 'win32') app.setAppUserModelId('io.vietcuongus.quanlyremote');
  try { store = new Store(app.getPath('userData'), safeStorage); }
  catch (error) { dialog.showErrorBox('Không thể mở QuanLyRemote', `${error.message}\n\nDữ liệu: ${app.getPath('userData')}\nFile gốc được giữ nguyên.`); app.quit(); return; }
  sessions = new Sessions({ emit, verifyHost, onConnected: id => store.markConnected(id) });
  const dist = path.join(app.getAppPath(), 'dist');
  protocol.handle('qlremote', request => {
    const url = new URL(request.url);
    if (url.host !== 'workspace') return new Response('Forbidden', { status: 403 });
    const target = path.resolve(dist, `.${decodeURIComponent(url.pathname)}`);
    if (!target.startsWith(`${dist}${path.sep}`)) return new Response('Forbidden', { status: 403 });
    return net.fetch(pathToFileURL(target).toString());
  });
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  window = new BrowserWindow({
    width: 1440, height: 940, minWidth: 1024, minHeight: 680,
    backgroundColor: '#0c1016', frame: false, show: false,
    title: 'QuanLyRemote', icon: path.join(app.getAppPath(), 'build/icon.ico'),
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  registerHandlers();
  window.once('ready-to-show', () => window.show());
  window.on('close', async event => {
    if (!forceClose && store.data.settings.confirmClose && sessions.sessions.size > 0) {
      event.preventDefault();
      const { response } = await dialog.showMessageBox(window, { type: 'question', message: 'Đóng các phiên đang kết nối?', detail: 'Terminal và tác vụ truyền file đang chạy sẽ dừng.', buttons: ['Ở lại', 'Đóng ứng dụng'], defaultId: 0, cancelId: 0 });
      if (response !== 1) return;
      forceClose = true;
      sessions.closeAll();
      window.close();
    } else sessions.closeAll();
  });
  await window.loadURL(development ? 'http://127.0.0.1:5173/' : 'qlremote://workspace/index.html');
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (window) { if (window.isMinimized()) window.restore(); window.focus(); } });
  app.whenReady().then(createWindow).catch(error => { dialog.showErrorBox('QuanLyRemote', error.message); app.quit(); });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', () => sessions?.closeAll());
}
