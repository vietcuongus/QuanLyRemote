// Use Git's configured credential helper for the same user/repository; never print secrets.
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
function execute(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', windowsHide: true, ...options });
  if (result.error || result.status !== 0) throw new Error(result.error?.message || result.stderr || `${command} failed.`);
  return result.stdout.trim();
}
const credential = execute('git', ['credential', 'fill'], { input: 'protocol=https\nhost=github.com\npath=vietcuongus/QuanLyRemote.git\n\n' });
const values = Object.fromEntries(credential.split(/\r?\n/).map(line => { const index = line.indexOf('='); return [line.slice(0, index), line.slice(index + 1)]; }));
if (!values.password) throw new Error('Git credential helper did not provide GitHub authentication.');
const env = { ...process.env, GH_TOKEN: values.password };
if (process.argv.includes('--check')) {
  console.log(execute('gh', ['api', 'repos/vietcuongus/QuanLyRemote', '--jq', '{full_name: .full_name, can_push: .permissions.push}'], { env }));
} else {
  const release = path.join(root, 'release');
  const files = ['QuanLyRemote-1.0.0-x64-setup.exe', 'QuanLyRemote-1.0.0-x64-portable.exe'];
  for (const name of files) if (!fs.existsSync(path.join(release, name))) throw new Error(`Missing binary: ${name}`);
  const sums = files.map(name => `${crypto.createHash('sha256').update(fs.readFileSync(path.join(release, name))).digest('hex')}  ${name}`).join('\n') + '\n';
  fs.writeFileSync(path.join(release, 'SHA256SUMS.txt'), sums);
  const commit = execute('git', ['rev-parse', 'HEAD']);
  const url = execute('gh', ['release', 'create', 'v1.0.0', ...files.map(name => path.join(release, name)), path.join(release, 'SHA256SUMS.txt'), '--repo', 'vietcuongus/QuanLyRemote', '--target', commit, '--title', 'QuanLyRemote v1.0.0 — SSH, SFTP & Remote Desktop', '--notes-file', path.join(root, 'docs/RELEASE_NOTES.md')], { env });
  console.log(url);
}
