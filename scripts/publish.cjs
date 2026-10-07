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
// Use GitHub CLI's normal login, or GH_TOKEN supplied by the Actions runner.
const { version } = require('../package.json');
const env = process.env;
if (process.argv.includes('--check')) {
  console.log(execute('gh', ['api', 'repos/vietcuongus/QuanLyRemote', '--jq', '{full_name: .full_name, can_push: .permissions.push}'], { env }));
} else {
  const release = path.join(root, 'release');
  const files = [`QuanLyRemote-${version}-x64-setup.exe`, `QuanLyRemote-${version}-x64-portable.exe`];
  for (const name of files) if (!fs.existsSync(path.join(release, name))) throw new Error(`Missing binary: ${name}`);
  const sums = files.map(name => `${crypto.createHash('sha256').update(fs.readFileSync(path.join(release, name))).digest('hex')}  ${name}`).join('\n') + '\n';
  fs.writeFileSync(path.join(release, 'SHA256SUMS.txt'), sums);
  const commit = execute('git', ['rev-parse', 'HEAD']);
  const repo = 'vietcuongus/QuanLyRemote', tag = `v${version}`;
  const assets = [...files.map(name => path.join(release, name)), path.join(release, 'SHA256SUMS.txt')];
  const existing = spawnSync('gh', ['release', 'view', tag, '--repo', repo, '--json', 'url,assets'], { cwd: root, env, encoding: 'utf8', windowsHide: true });
  if (existing.error) throw existing.error;
  if (existing.status === 0) {
    const published = JSON.parse(existing.stdout);
    const missing = assets.filter(file => !published.assets.some(asset => asset.name === path.basename(file) && asset.size > 0));
    if (missing.length) execute('gh', ['release', 'upload', tag, ...missing, '--repo', repo], { env });
  } else {
    execute('gh', ['release', 'create', tag, ...assets, '--repo', repo, '--verify-tag', '--target', commit, '--title', `QuanLyRemote ${tag} — SSH, SFTP & Remote Desktop`, '--notes-file', path.join(root, 'docs/RELEASE_NOTES.md')], { env });
  }
  console.log(execute('gh', ['release', 'view', tag, '--repo', repo, '--json', 'url', '--jq', '.url'], { env }));
}
