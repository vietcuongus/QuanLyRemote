import React, { useEffect, useRef, useState } from 'react';
import { Terminal as XTerminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import '@xterm/xterm/css/xterm.css';
import { ArrowUp, Upload, Download, RefreshCw, Folder, File, FolderPlus, Pencil, Trash2, Search, X, Copy, ClipboardPaste, Eraser, ChevronRight, ArrowDown, HardDrive, Globe, FolderOpen } from 'lucide-react';
import { bytes, shortDate, terminalBus } from './utils';
import { Spinner, TextDialog } from './components';

export const terminalInstances = new Map();

export function TerminalPane({ session, active, settings, t, notify }) {
  const container = useRef(), instance = useRef(), fit = useRef(), search = useRef();
  const [searching, setSearching] = useState(false), [query, setQuery] = useState(''), [matches, setMatches] = useState(null);
  const notifyRef = useRef(notify); notifyRef.current = notify;
  const activeRef = useRef(active); activeRef.current = active;
  const pasteClipboard = async () => {
    const term = instance.current;
    if (!term || term.options.disableStdin || !activeRef.current) return;
    try {
      const text = await window.remote.readClipboard();
      // A tab can close, disconnect or become inactive while IPC is in flight.
      if (instance.current !== term || term.options.disableStdin || !activeRef.current) return;
      term.paste(text); term.focus();
    } catch (error) { notifyRef.current(error.message, 'error'); }
  };
  const copySelection = async () => {
    try { const text = instance.current?.getSelection(); if (text) await window.remote.copyText(text); }
    catch (error) { notifyRef.current(error.message, 'error'); }
  };
  useEffect(() => {
    const term = new XTerminal({
      cursorBlink: true, cursorStyle: 'bar', fontSize: settings.fontSize,
      fontFamily: '"Cascadia Code", "Cascadia Mono", Consolas, monospace', lineHeight: 1.3,
      scrollback: 10000, allowProposedApi: false,
      theme: { background: '#0c1016', foreground: '#cbd5e1', cursor: '#5eead4', selectionBackground: '#2d4d54', black: '#15202b', red: '#fb7185', green: '#5eead4', yellow: '#fbbf24', blue: '#60a5fa', magenta: '#c084fc', cyan: '#22d3ee', white: '#e2e8f0', brightBlack: '#66758a' },
    });
    const fitter = new FitAddon(), finder = new SearchAddon();
    term.loadAddon(fitter); term.loadAddon(finder); term.open(container.current);
    instance.current = term; fit.current = fitter; search.current = finder;
    terminalInstances.set(session.id, term);
    term.write(terminalBus.read(session.id));
    const unsubscribe = terminalBus.subscribe(session.id, data => term.write(data));
    const input = term.onData(data => { window.remote.write(session.id, data).catch(error => notifyRef.current(error.message, 'error')); });
    const resize = term.onResize(({ cols, rows }) => { window.remote.resize(session.id, cols, rows).catch(() => {}); });
    finder.onDidChangeResults(result => setMatches(result.resultCount ? `${result.resultIndex + 1}/${result.resultCount}` : '0/0'));
    term.attachCustomKeyEventHandler(e => {
      const key = e.key.toLowerCase();
      const paste = !e.altKey && !e.metaKey && ((e.ctrlKey && key === 'v') || (e.shiftKey && !e.ctrlKey && key === 'insert'));
      const copy = !e.altKey && !e.metaKey && e.ctrlKey && key === 'c' && (e.shiftKey || term.hasSelection());
      if (paste || copy) {
        e.preventDefault(); e.stopPropagation();
        if (e.type === 'keydown') void (paste ? pasteClipboard() : copySelection());
        return false;
      }
      if (e.ctrlKey && e.key.toLowerCase() === 'f') { if (e.type === 'keydown') setSearching(true); return false; }
      if (e.ctrlKey && ['k', 'n', 'w', 'tab'].includes(e.key.toLowerCase())) return false;
      return true;
    });
    const observer = new ResizeObserver(() => { if (container.current?.offsetWidth) { try { fitter.fit(); } catch {} } });
    observer.observe(container.current);
    return () => { observer.disconnect(); unsubscribe(); input.dispose(); resize.dispose(); terminalInstances.delete(session.id); instance.current = null; term.dispose(); };
  }, [session.id]);
  useEffect(() => { if (instance.current) instance.current.options.fontSize = settings.fontSize; }, [settings.fontSize]);
  useEffect(() => { if (instance.current) instance.current.options.disableStdin = session.status !== 'connected'; }, [session.status]);
  useEffect(() => { if (active) { const timer = setTimeout(() => { try { fit.current?.fit(); instance.current?.focus(); } catch {} }, 50); return () => clearTimeout(timer); } }, [active]);
  return <div className="terminal-pane">
    <div className="terminal-toolbar"><span><span className={`status-dot ${session.status}`} />{session.profile.username}@{session.profile.host}<span className="terminal-badge">SSH {session.profile.port}</span></span><div>{searching && <div className="terminal-search"><input autoFocus placeholder={t.search} value={query} onChange={e => { setQuery(e.target.value); search.current?.findNext(e.target.value, { incremental: true }); }} onKeyDown={e => { if (e.key === 'Enter') e.shiftKey ? search.current?.findPrevious(query) : search.current?.findNext(query); if (e.key === 'Escape') { setSearching(false); instance.current?.focus(); } }} /><small>{matches}</small><button aria-label="Previous match" className="icon-button" onClick={() => search.current?.findPrevious(query)}><ArrowUp size={14} /></button><button aria-label="Next match" className="icon-button" onClick={() => search.current?.findNext(query)}><ArrowDown size={14} /></button><button aria-label="Close search" className="icon-button" onClick={() => { setSearching(false); search.current?.clearDecorations(); }}><X size={14} /></button></div>}<button className="icon-button" title="Ctrl F" aria-label={t.search} onClick={() => setSearching(v => !v)}><Search size={16} /></button><button className="icon-button" title={t.copy + ' (Ctrl+C / Ctrl+Shift+C)'} aria-label={t.copy} onClick={copySelection}><Copy size={16} /></button><button className="icon-button" title={t.paste + ' (Ctrl+V / Ctrl+Shift+V / Shift+Insert)'} aria-label={t.paste} disabled={session.status !== 'connected'} onClick={pasteClipboard}><ClipboardPaste size={16} /></button><button className="icon-button" title={t.clear} aria-label={t.clear} onClick={() => instance.current?.clear()}><Eraser size={16} /></button></div></div>
    <div className="terminal-container" ref={container} />
    <footer className="terminal-footer"><span><span className={`status-dot ${session.status}`} />{t[session.status] || session.status}</span><span>xterm-256color <span className="divider">/</span> UTF-8 <span className="divider">/</span> {settings.fontSize}px</span></footer>
  </div>;
}

function FilePane({ kind, data, selected, onSelect, onOpen, onGo, busy, t, children, language, error }) {
  const [address, setAddress] = useState('');
  useEffect(() => { setAddress(data.path || ''); }, [data.path]);
  const entries = [...data.entries].sort((a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name));
  const Icon = kind === 'local' ? HardDrive : Globe;
  return <section className="file-pane"><header><div><Icon size={18} /><strong>{kind === 'local' ? t.localFiles : t.remoteFiles}</strong><span className="count-badge">{entries.length}</span></div>{children}</header><form className="path-bar" onSubmit={e => { e.preventDefault(); onGo(address); }}><button type="button" className="icon-button" aria-label={t.back} onClick={() => onGo(data.parent || (data.path.replace(/\/[^/]+\/?$/, '') || '/'))}><ArrowUp size={16} /></button><FolderOpen size={15} /><input aria-label={`${kind} path`} value={address} placeholder={kind === 'remote' ? '.' : 'C:\\Users'} onChange={e => setAddress(e.target.value)} /><button className="icon-button" aria-label="Go"><ChevronRight size={16} /></button><button type="button" className="icon-button" aria-label={t.refresh} onClick={() => onGo(data.path)}>{busy ? <Spinner /> : <RefreshCw size={15} />}</button></form><div className="file-list"><table><thead><tr><th>{t.fileName}</th><th>{t.size}</th><th>{t.modified}</th></tr></thead><tbody>{entries.map(file => <tr key={file.path} tabIndex={0} aria-selected={selected?.path === file.path} className={selected?.path === file.path ? 'selected' : ''} onClick={() => onSelect(file)} onDoubleClick={() => onOpen(file)} onKeyDown={e => { if (e.key === 'Enter') onOpen(file); if (e.key === ' ') { e.preventDefault(); onSelect(file); } }}><td>{file.directory ? <Folder size={17} className="folder-icon" /> : <File size={17} className="file-icon" />}<span title={file.name}>{file.name}</span>{file.symlink && <small>↗</small>}</td><td>{file.directory ? '—' : bytes(file.size)}</td><td>{shortDate(file.modified, language)}</td></tr>)}</tbody></table>{error && <div className="file-error" role="alert">{error}</div>}{!entries.length && !busy && !error && <div className="file-empty"><FolderOpen size={30} /><p>{t.emptyFolder}</p></div>}{busy && <div className="file-loading"><Spinner /></div>}</div><footer><span>{entries.length} {language === 'vi' ? 'mục' : 'items'}</span><span>{selected ? selected.name : '—'}</span></footer></section>;
}

export function FilesPane({ session, localHome, t, language, notify, transfers }) {
  const [local, setLocal] = useState({ path: localHome, entries: [] }), [remote, setRemote] = useState({ path: '.', entries: [] });
  const [localBusy, setLocalBusy] = useState(false), [remoteBusy, setRemoteBusy] = useState(false);
  const [localError, setLocalError] = useState(''), [remoteError, setRemoteError] = useState('');
  const [localSelected, setLocalSelected] = useState(null), [remoteSelected, setRemoteSelected] = useState(null);
  const [dialog, setDialog] = useState(null), [working, setWorking] = useState(false);
  const requests = useRef({ local: 0, remote: 0 });
  const connected = session.status === 'connected';
  const loadLocal = async directory => {
    const request = ++requests.current.local;
    setLocalBusy(true); setLocalError('');
    try { const result = await window.remote.listLocal(directory); if (request === requests.current.local) { setLocal(result); setLocalSelected(null); } }
    catch (error) { if (request === requests.current.local) setLocalError(error.message); }
    finally { if (request === requests.current.local) setLocalBusy(false); }
  };
  const loadRemote = async directory => {
    const request = ++requests.current.remote;
    setRemoteBusy(true); setRemoteError('');
    try { const result = await window.remote.listRemote(session.id, directory); if (request === requests.current.remote) { setRemote(result); setRemoteSelected(null); } }
    catch (error) { if (request === requests.current.remote) setRemoteError(error.message); }
    finally { if (request === requests.current.remote) setRemoteBusy(false); }
  };
  useEffect(() => { loadLocal(localHome); if (connected) loadRemote('.'); }, [session.id, connected]);
  const completed = transfers.filter(tr => tr.sessionId === session.id && tr.status === 'completed').length;
  useEffect(() => { if (completed && connected) { loadLocal(local.path); loadRemote(remote.path); } }, [completed]);
  const run = async callback => { setWorking(true); try { await callback(); } catch (e) { notify(e.message, 'error'); } finally { setWorking(false); } };
  const upload = selectedPath => run(async () => { await window.remote.upload(session.id, remote.path, selectedPath); await loadRemote(remote.path); });
  const download = file => run(async () => { await window.remote.download(session.id, file.path, local.path); await loadLocal(local.path); });
  const running = transfers.filter(tr => tr.sessionId === session.id && tr.status === 'running');
  return <div className="files-view"><div className="files-toolbar"><div><span className="secure-label"><span className={`status-dot ${session.status}`} />SFTP</span><span className="muted">{session.profile.host}</span></div><div><button className="button secondary" disabled={!connected || working || !localSelected || localSelected.directory || localSelected.symlink} onClick={() => upload(localSelected.path)}><Upload size={16} />{t.upload}</button><button className="button secondary" disabled={!connected || working || !remoteSelected || remoteSelected.directory} onClick={() => download(remoteSelected)}><Download size={16} />{t.download}</button></div></div><div className="dual-pane"><FilePane kind="local" data={local} selected={localSelected} onSelect={setLocalSelected} onGo={loadLocal} onOpen={file => file.directory && loadLocal(file.path)} busy={localBusy} error={localError} t={t} language={language}><button className="icon-button" title={t.chooseFolder} aria-label={t.chooseFolder} onClick={() => run(async () => { const result = await window.remote.chooseDirectory(); if (result) await loadLocal(result); })}><FolderOpen size={17} /></button></FilePane><div className="pane-transfer-divider"><ArrowUp size={16} /><ArrowDown size={16} /></div><FilePane kind="remote" data={remote} selected={remoteSelected} onSelect={setRemoteSelected} onGo={loadRemote} onOpen={file => file.directory ? loadRemote(file.path) : connected && download(file)} busy={remoteBusy} error={remoteError} t={t} language={language}><div><button className="icon-button" disabled={!connected || working} title={t.upload} aria-label={`${t.upload} files`} onClick={() => upload()}><Upload size={16} /></button><button className="icon-button" disabled={!connected || working} title={t.newFolder} aria-label={t.newFolder} onClick={() => setDialog({ type: 'mkdir' })}><FolderPlus size={17} /></button><button className="icon-button" disabled={!connected || working || !remoteSelected} title={t.rename} aria-label={t.rename} onClick={() => setDialog({ type: 'rename', file: remoteSelected })}><Pencil size={15} /></button><button className="icon-button danger-hover" disabled={!connected || working || !remoteSelected} title={t.delete} aria-label={`${t.delete} remote file`} onClick={() => run(async () => { await window.remote.removeRemote(session.id, remoteSelected.path, remoteSelected.directory); await loadRemote(remote.path); })}><Trash2 size={15} /></button></div></FilePane></div>{running.length > 0 && <div className="inline-transfers">{running.map(tr => <div key={tr.id}><Upload size={14} /><span>{tr.name}</span><div className="progress"><i style={{ width: `${tr.total ? tr.transferred / tr.total * 100 : 0}%` }} /></div><small>{bytes(tr.transferred)} / {bytes(tr.total)}</small><button className="icon-button" aria-label={t.cancel} onClick={() => window.remote.cancelTransfer(tr.id).catch(e => notify(e.message, 'error'))}><X size={14} /></button></div>)}</div>}{dialog && <TextDialog title={dialog.type === 'mkdir' ? t.newFolder : t.rename} label={t.fileName} initial={dialog.file?.name || ''} t={t} onClose={() => setDialog(null)} onSubmit={async name => { if (dialog.type === 'mkdir') await window.remote.mkdir(session.id, remote.path, name); else await window.remote.rename(session.id, dialog.file.path, name); await loadRemote(remote.path); }} />}</div>;
}
