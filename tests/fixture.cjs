const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { Server, utils } = require('ssh2');
const { STATUS_CODE, flagsToString } = utils.sftp;

async function createFixture(options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qlr-ssh-fixture-'));
  fs.mkdirSync(path.join(root, 'projects'));
  fs.writeFileSync(path.join(root, 'readme.txt'), 'SSH/SFTP integration fixture\nTiếng Việt ✓\n');
  fs.writeFileSync(path.join(root, 'projects', 'config.json'), '{"fixture":true}\n');
  const hostKey = options.hostKey || crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs1', format: 'pem' });
  const userKey = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs1', format: 'pem' });
  const parsedUserKey = utils.parseKey(userKey);
  const keyPath = path.join(root, 'identity.pem'); fs.writeFileSync(keyPath, userKey);
  const connections = new Set(), state = { input: '', geometry: null, auth: [] };
  const server = new Server({ hostKeys: [hostKey] }, client => {
    connections.add(client);
    client.on('error', () => {});
    client.once('close', () => connections.delete(client));
    client.on('authentication', ctx => {
      state.auth.push(ctx.method);
      if (ctx.username === 'tester' && ctx.method === 'password' && ctx.password === 'fixture-only-password') ctx.accept();
      else if (ctx.username === 'tester' && ctx.method === 'publickey' && ctx.key.data.equals(parsedUserKey.getPublicSSH()) && (!ctx.signature || parsedUserKey.verify(ctx.blob, ctx.signature, ctx.hashAlgo) === true)) ctx.accept();
      else ctx.reject(['password', 'publickey']);
    });
    client.on('ready', () => client.on('session', accept => {
      const session = accept();
      session.on('pty', (acceptPty, _reject, info) => { state.geometry = info; acceptPty(); });
      session.on('window-change', (acceptChange, _reject, info) => { state.geometry = info; acceptChange?.(); });
      session.on('shell', acceptShell => {
        const stream = acceptShell();
        stream.write('\x1b[32mQuanLyRemote integration server\x1b[0m\r\nWelcome, tester.\r\n$ ');
        let line = '';
        stream.on('data', data => {
          const value = data.toString(); state.input += value;
          for (const char of value) {
            if (char === '\r' || char === '\n') {
              stream.write('\r\n');
              if (line.includes('unicode')) {
                const text = Buffer.from('Tiếng Việt ✓\r\n$ ');
                stream.write(text.subarray(0, 3)); setTimeout(() => stream.write(text.subarray(3)), 20);
              } else stream.write('$ ');
              line = '';
            } else { line += char; stream.write(char); }
          }
        });
        stream.on('error', () => {});
      });
      session.on('sftp', acceptSftp => attachSftp(acceptSftp(), root, options));
    }));
  });
  server.on('error', () => {});
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  return {
    root, hostKey, keyPath, state, port,
    profile: { id: 'fixture-server', name: 'Integration server', host: '127.0.0.1', port, username: 'tester', protocol: 'ssh', auth: 'password', group: 'Tests', tags: [] },
    async close() {
      for (const client of connections) client.end();
      await new Promise(resolve => server.close(resolve));
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

function attachSftp(sftp, root, options) {
  const handles = new Map(); let counter = 0;
  const local = remote => {
    const result = path.resolve(root, `.${path.posix.resolve('/', remote)}`);
    if (result !== root && !result.startsWith(`${root}${path.sep}`)) throw new Error('Out of fixture root');
    return result;
  };
  const attrs = stat => ({ mode: stat.mode, uid: 0, gid: 0, size: stat.size, atime: Math.floor(stat.atimeMs / 1000), mtime: Math.floor(stat.mtimeMs / 1000) });
  const handler = (name, callback) => sftp.on(name, (requestId, ...args) => {
    try { callback(requestId, ...args); }
    catch (error) { sftp.status(requestId, error.code === 'ENOENT' ? STATUS_CODE.NO_SUCH_FILE : STATUS_CODE.FAILURE); }
  });
  const newHandle = value => { const buffer = Buffer.alloc(4); buffer.writeUInt32BE(++counter); handles.set(counter, value); return buffer; };
  const getHandle = handle => { const value = handles.get(handle.readUInt32BE()); if (!value) throw new Error('Invalid handle'); return value; };
  handler('REALPATH', (id, target) => {
    const absolute = local(target); fs.statSync(absolute);
    const filename = '/' + path.relative(root, absolute).split(path.sep).join('/');
    sftp.name(id, [{ filename, longname: filename, attrs: attrs(fs.statSync(absolute)) }]);
  });
  handler('STAT', (id, target) => sftp.attrs(id, attrs(fs.statSync(local(target)))));
  handler('LSTAT', (id, target) => sftp.attrs(id, attrs(fs.lstatSync(local(target)))));
  handler('FSTAT', (id, handle) => sftp.attrs(id, attrs(fs.fstatSync(getHandle(handle).fd))));
  handler('OPENDIR', (id, target) => {
    const directory = local(target);
    sftp.handle(id, newHandle({ type: 'directory', directory, read: false }));
  });
  handler('READDIR', (id, handle) => {
    const entry = getHandle(handle);
    if (entry.read) { sftp.status(id, STATUS_CODE.EOF); return; }
    entry.read = true;
    const names = fs.readdirSync(entry.directory).map(name => ({ filename: name, longname: name, attrs: attrs(fs.lstatSync(path.join(entry.directory, name))) }));
    if (names.length) sftp.name(id, names); else sftp.status(id, STATUS_CODE.EOF);
  });
  handler('OPEN', (id, target, flags, attributes) => sftp.handle(id, newHandle({ type: 'file', fd: fs.openSync(local(target), flagsToString(flags), attributes.mode || 0o600) })));
  handler('READ', (id, handle, offset, length) => {
    const fd = getHandle(handle).fd;
    const send = () => {
      try {
        const buffer = Buffer.alloc(length); const count = fs.readSync(fd, buffer, 0, length, offset);
        if (count) sftp.data(id, buffer.subarray(0, count)); else sftp.status(id, STATUS_CODE.EOF);
      } catch { if (!sftp.destroyed) sftp.status(id, STATUS_CODE.FAILURE); }
    };
    if (options.slowRead) setTimeout(send, 30); else send();
  });
  handler('WRITE', (id, handle, offset, data) => { fs.writeSync(getHandle(handle).fd, data, 0, data.length, offset); sftp.status(id, STATUS_CODE.OK); });
  handler('CLOSE', (id, handle) => { const entry = getHandle(handle); if (entry.type === 'file') fs.closeSync(entry.fd); handles.delete(handle.readUInt32BE()); sftp.status(id, STATUS_CODE.OK); });
  handler('MKDIR', (id, target) => { fs.mkdirSync(local(target)); sftp.status(id, STATUS_CODE.OK); });
  handler('RMDIR', (id, target) => { fs.rmdirSync(local(target)); sftp.status(id, STATUS_CODE.OK); });
  handler('REMOVE', (id, target) => { fs.unlinkSync(local(target)); sftp.status(id, STATUS_CODE.OK); });
  handler('RENAME', (id, source, target) => { fs.renameSync(local(source), local(target)); sftp.status(id, STATUS_CODE.OK); });
  handler('EXTENDED', id => sftp.status(id, STATUS_CODE.OP_UNSUPPORTED));
  sftp.on('error', () => {});
  sftp.on('close', () => { for (const value of handles.values()) if (value.type === 'file') { try { fs.closeSync(value.fd); } catch {} } handles.clear(); });
}

module.exports = { createFixture };
