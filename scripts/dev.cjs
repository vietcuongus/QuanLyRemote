const { spawn } = require('node:child_process');
const path = require('node:path');
const http = require('node:http');

const vite = spawn(process.execPath, [path.join(__dirname, '../node_modules/vite/bin/vite.js')], { stdio: 'inherit', windowsHide: true });
let desktop, attempts = 0;
const stop = () => { desktop?.kill(); vite.kill(); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);
vite.on('error', error => { console.error(error.message); process.exitCode = 1; stop(); });
vite.on('exit', code => { if (code) process.exitCode = code; desktop?.kill(); });
const poll = () => {
  if (++attempts > 100) { console.error('Vite failed to start.'); stop(); process.exitCode = 1; return; }
  const request = http.get('http://127.0.0.1:5173', response => {
    response.resume();
    if (response.statusCode !== 200) { setTimeout(poll, 150); return; }
    desktop = spawn(require('electron'), ['.'], { stdio: 'inherit', windowsHide: true, env: { ...process.env, QLR_DEV_URL: 'http://127.0.0.1:5173', ELECTRON_RUN_AS_NODE: '' } });
    desktop.on('error', error => { console.error(error.message); process.exitCode = 1; stop(); });
    desktop.on('exit', code => { vite.kill(); process.exitCode = code || 0; });
  });
  request.on('error', () => setTimeout(poll, 150));
};
poll();
