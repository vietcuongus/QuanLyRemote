const { Client } = require('ssh2');
const fs = require('node:fs/promises');
const crypto = require('node:crypto');
const path = require('node:path');
const { StringDecoder } = require('node:string_decoder');
const { remotePath, fileName, fingerprint } = require('./core.cjs');

const call = (object, method, ...args) => new Promise((resolve, reject) => object[method](...args, (err, value) => err ? reject(err) : resolve(value)));

class Sessions {
  constructor({ emit, verifyHost, onConnected = () => {}, readyTimeout = 20000 }) {
    this.emit = emit;
    this.verifyHost = verifyHost;
    this.onConnected = onConnected;
    this.readyTimeout = readyTimeout;
    this.sessions = new Map();
    this.transfers = new Map();
  }

  async connect(profile, secret = '', mode = 'terminal', geometry = {}) {
    const id = crypto.randomUUID();
    const client = new Client();
    const entry = { id, profile, client, stream: null, sftp: null, sftpPromise: null, closed: false, status: 'connecting' };
    this.sessions.set(id, entry);
    const event = (type, details = {}) => this.emit({ type, sessionId: id, profileId: profile.id, ...details });
    event('status', { status: 'connecting', mode });
    try {
      const config = {
        host: profile.host, port: profile.port, username: profile.username,
        readyTimeout: this.readyTimeout, keepaliveInterval: 15000, keepaliveCountMax: 3,
        hostHash: 'sha256',
        hostVerifier: (hash, done) => {
          Promise.resolve(this.verifyHost(`${profile.host}:${profile.port}`, fingerprint(hash))).then(accepted => done(!entry.closed && accepted), () => done(false));
        },
      };
      if (profile.auth === 'key') {
        if (!profile.keyPath) throw new Error('Vui lòng chọn file khóa SSH.');
        config.privateKey = await fs.readFile(profile.keyPath);
        if (secret) config.passphrase = secret;
      } else if (profile.auth === 'agent') {
        config.agent = process.env.SSH_AUTH_SOCK || (process.platform === 'win32' ? '\\\\.\\pipe\\openssh-ssh-agent' : undefined);
        if (!config.agent) throw new Error('Chưa tìm thấy SSH agent.');
      } else config.password = secret;

      if (entry.closed) throw new Error('Kết nối đã hủy.');
      await new Promise((resolve, reject) => {
        let settled = false;
        const fail = (error) => {
          if (!settled) { settled = true; reject(error); }
          else event('error', { message: error.message });
          this.disconnect(id);
        };
        client.on('error', fail);
        client.on('close', () => {
          if (!settled) { settled = true; reject(new Error('Kết nối đã đóng trước khi đăng nhập hoàn tất.')); }
          entry.closed = true;
          entry.status = 'disconnected';
          this.cancelSessionTransfers(id);
          this.sessions.delete(id);
          event('status', { status: 'disconnected' });
        });
        client.once('ready', () => { settled = true; resolve(); });
        client.connect(config);
      });
      if (mode === 'terminal') await this.openShell(id, geometry);
      else await this.sftp(id);
      if (entry.closed) throw new Error('Kết nối đã đóng.');
      entry.status = 'connected';
      this.onConnected(profile.id);
      event('status', { status: 'connected', mode });
      return { id, profileId: profile.id, mode };
    } catch (error) {
      this.disconnect(id);
      event('error', { message: error.message });
      throw error;
    }
  }

  get(id) {
    const entry = this.sessions.get(id);
    if (!entry || entry.closed) throw new Error('Phiên đã đóng. Hãy kết nối lại.');
    return entry;
  }

  async openShell(id, geometry = {}) {
    const entry = this.get(id);
    if (entry.stream) return;
    if (entry.shellPromise) return entry.shellPromise;
    entry.shellPromise = (async () => {
      const cols = Math.max(20, Math.min(500, Number(geometry.cols) || 100));
      const rows = Math.max(5, Math.min(300, Number(geometry.rows) || 30));
      entry.stream = await call(entry.client, 'shell', { term: 'xterm-256color', cols, rows });
      const decoder = new StringDecoder('utf8'), errorDecoder = new StringDecoder('utf8');
      entry.stream.on('data', data => this.emit({ type: 'data', sessionId: id, data: decoder.write(data) }));
      entry.stream.stderr.on('data', data => this.emit({ type: 'data', sessionId: id, data: errorDecoder.write(data) }));
      entry.stream.on('error', error => this.emit({ type: 'error', sessionId: id, message: error.message }));
      entry.stream.once('close', () => this.disconnect(id));
    })();
    try { await entry.shellPromise; } finally { entry.shellPromise = null; }
  }

  write(id, data) {
    if (typeof data !== 'string' || data.length > 1024 * 1024) throw new Error('Dữ liệu terminal không hợp lệ.');
    const stream = this.get(id).stream;
    if (!stream || this.get(id).status !== 'connected') throw new Error('Terminal chưa sẵn sàng.');
    stream.write(data);
  }

  resize(id, cols, rows) {
    if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 1 || cols > 500 || rows < 1 || rows > 300) return;
    this.get(id).stream?.setWindow(rows, cols, 0, 0);
  }

  async sftp(id) {
    const entry = this.get(id);
    if (entry.sftp) return entry.sftp;
    if (!entry.sftpPromise) entry.sftpPromise = call(entry.client, 'sftp').then(value => {
      entry.sftp = value;
      value.on('error', error => this.emit({ type: 'error', sessionId: id, message: error.message }));
      value.on('close', () => { entry.sftp = null; entry.sftpPromise = null; });
      return value;
    }).catch(error => { entry.sftpPromise = null; throw error; });
    return entry.sftpPromise;
  }

  async list(id, directory = '.') {
    const sftp = await this.sftp(id);
    const location = await call(sftp, 'realpath', remotePath(directory));
    const files = await call(sftp, 'readdir', location);
    return { path: location, entries: files.filter(f => f.filename !== '.' && f.filename !== '..').map(f => ({ name: f.filename, path: path.posix.join(location, f.filename), directory: f.attrs.isDirectory(), symlink: f.attrs.isSymbolicLink(), size: f.attrs.size, modified: f.attrs.mtime * 1000, mode: f.attrs.mode })) };
  }

  async mkdir(id, directory, name) { return call(await this.sftp(id), 'mkdir', path.posix.join(remotePath(directory), fileName(name))); }
  async rename(id, oldPath, name) { const original = remotePath(oldPath); return call(await this.sftp(id), 'rename', original, path.posix.join(path.posix.dirname(original), fileName(name))); }
  async remove(id, target, directory) {
    const value = remotePath(target);
    if (['/', '.', '..'].includes(value)) throw new Error('Không thể xóa thư mục gốc.');
    return call(await this.sftp(id), directory ? 'rmdir' : 'unlink', value);
  }

  async transfer(id, direction, local, remote) {
    if (!['upload', 'download'].includes(direction)) throw new Error('Kiểu truyền file không hợp lệ.');
    const entry = this.get(id);
    const sftp = await this.sftp(id);
    const transferId = crypto.randomUUID();
    const target = remotePath(remote);
    const name = direction === 'upload' ? path.basename(local) : path.posix.basename(target);
    let input, output, staging;
    const report = (status, details = {}) => this.emit({ type: 'transfer', sessionId: id, id: transferId, name, direction, status, ...details });
    try {
      let total;
      if (direction === 'upload') {
        const stat = await fs.stat(local);
        if (!stat.isFile()) throw new Error('Chỉ hỗ trợ truyền file.');
        total = stat.size;
        staging = `${target}.qlr-${transferId}.part`;
        input = require('node:fs').createReadStream(local);
        output = sftp.createWriteStream(staging, { flags: 'wx', mode: 0o600 });
      } else {
        const stat = await call(sftp, 'stat', target);
        if (!stat.isFile()) throw new Error('Chỉ hỗ trợ tải file.');
        total = stat.size;
        staging = `${local}.qlr-${transferId}.part`;
        input = sftp.createReadStream(target);
        output = require('node:fs').createWriteStream(staging, { flags: 'wx', mode: 0o600 });
      }
      let transferred = 0, lastReport = 0;
      const transfer = { sessionId: id, input, output, cancelled: false };
      this.transfers.set(transferId, transfer);
      report('running', { transferred, total });
      input.on('data', data => {
        transferred += data.length;
        if (Date.now() - lastReport > 150) { report('running', { transferred, total }); lastReport = Date.now(); }
      });
      const { pipeline } = require('node:stream/promises');
      await pipeline(input, output);
      if (entry.closed || transfer.cancelled) throw new Error('Truyền file đã hủy.');
      if (direction === 'upload') {
        // OpenSSH atomic replacement where supported; standard rename is the safe fallback.
        try { await call(sftp, 'ext_openssh_rename', staging, target); }
        catch (error) {
          if (error.code !== 8 && error.message !== 'Server does not support this extended request') throw error;
          await call(sftp, 'rename', staging, target);
        }
      } else await fs.rename(staging, local);
      report('completed', { transferred: total, total });
      return { id: transferId, name, status: 'completed' };
    } catch (error) {
      input?.destroy(); output?.destroy();
      if (staging) {
        if (direction === 'download') await fs.unlink(staging).catch(() => {});
        else if (!entry.closed) await call(sftp, 'unlink', staging).catch(() => {});
      }
      const cancelled = this.transfers.get(transferId)?.cancelled || entry.closed;
      report(cancelled ? 'cancelled' : 'failed', { message: error.message });
      if (!cancelled) throw error;
      return { id: transferId, name, status: 'cancelled' };
    } finally { this.transfers.delete(transferId); }
  }

  cancelTransfer(id) {
    const transfer = this.transfers.get(id);
    if (transfer) { transfer.cancelled = true; transfer.input.destroy(new Error('Truyền file đã hủy.')); transfer.output.destroy(); }
  }
  cancelSessionTransfers(id) { for (const [key, transfer] of this.transfers) if (transfer.sessionId === id) this.cancelTransfer(key); }
  disconnect(id) {
    const entry = this.sessions.get(id);
    if (!entry) return;
    entry.closed = true;
    this.cancelSessionTransfers(id);
    this.sessions.delete(id);
    entry.stream?.destroy();
    entry.client.end();
    entry.client.destroy();
  }
  closeAll() { for (const id of this.sessions.keys()) this.disconnect(id); }
}

module.exports = { Sessions, call };
