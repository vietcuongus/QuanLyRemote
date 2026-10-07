import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Activity, ArrowDownToLine, ArrowRight, ArrowUpFromLine, ArrowUpRight, Check, ChevronDown, ChevronRight, CircleHelp, Clock3, CloudOff, Code2, Command, Copy, Download, Ellipsis, Folder, FolderOpen, Globe2, Grid2X2, HardDrive, Heart, Home, KeyRound, Layers3, List, LoaderCircle, LockKeyhole, Maximize2, Minus, Monitor, Network, Plus, Search, Server, Settings2, ShieldCheck, Sparkles, Star, Terminal, Trash2, Upload, X, Zap } from 'lucide-react';
import { dictionary, sampleProfiles, shortDate, bytes, terminalBus } from './utils';
import { CommandPalette, CredentialDialog, Modal, ProfileForm, ProtocolIcon, Spinner } from './components';
import { FilesPane, TerminalPane, terminalInstances } from './SessionView';

const initial = { profiles: [], snippets: [], settings: { theme: 'dark', language: 'vi', fontSize: 14, confirmClose: true, restoreSessions: true }, sessionLayout: { tabs: [], activeTab: 'home' }, knownHosts: [], encryptionAvailable: false, version: '1.0.0', localHome: '' };
const navigation = [['overview', Home], ['favorites', Star], ['recent', Clock3], ['snippets', Code2], ['transfers', ArrowDownToLine]];

function ConnectionCard({ profile, t, status, probe, onConnect, onEdit, onDuplicate, onFavorite, onDelete, onProbe, onFiles, list }) {
  const [menu, setMenu] = useState(false);
  const ref = useRef();
  useEffect(() => {
    if (!menu) return;
    const close = e => { if (!ref.current?.contains(e.target)) setMenu(false); };
    const key = e => { if (e.key === 'Escape') setMenu(false); };
    document.addEventListener('mousedown', close); document.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', key); };
  }, [menu]);
  return <article className={`connection-card ${list ? 'list-card' : ''}`} onDoubleClick={onConnect}>
    <div className="card-top"><div className={`protocol-icon ${profile.protocol}`}><ProtocolIcon protocol={profile.protocol} /></div><div className="card-actions"><button className={`icon-button favorite-button ${profile.favorite ? 'favorited' : ''}`} title={t.favorites} aria-label={`${t.favorites} ${profile.name}`} onClick={onFavorite}><Star size={16} fill={profile.favorite ? 'currentColor' : 'none'} /></button><div className="dropdown-wrap" ref={ref}><button className={`icon-button ${menu ? 'open' : ''}`} title={t.edit} aria-label={`Actions ${profile.name}`} onClick={() => setMenu(v => !v)}><Ellipsis size={18} /></button>{menu && <div className="dropdown"><button onClick={() => { setMenu(false); onEdit(); }}><Settings2 size={15} />{t.edit}</button><button onClick={() => { setMenu(false); onDuplicate(); }}><Copy size={15} />{t.duplicate}</button>{profile.protocol !== 'rdp' && <button onClick={() => { setMenu(false); onFiles(); }}><FolderOpen size={15} />{t.files}</button>}<button onClick={() => { setMenu(false); onProbe(); }}><Activity size={15} />{t.onlineCheck}</button><div className="dropdown-separator" /><button className="danger" onClick={() => { setMenu(false); onDelete(); }}><Trash2 size={15} />{t.delete}</button></div>}</div></div></div>
    <div className="card-information"><div className="card-title"><h3 title={profile.name}>{profile.name}</h3><span className={`protocol-label ${profile.protocol}`}>{profile.protocol.toUpperCase()}</span></div><p className="card-host">{profile.username && <>{profile.username}<span>@</span></>}{profile.host}{profile.port !== (profile.protocol === 'rdp' ? 3389 : 22) && <span>:{profile.port}</span>}</p><div className="card-tags"><span className="group-tag"><Folder size={11} />{profile.group}</span>{profile.tags.filter(Boolean).slice(0, 2).map(tag => <span key={tag}>{tag}</span>)}</div></div>
    <div className="card-bottom"><span className="card-status" title={profile.lastConnected ? shortDate(profile.lastConnected, t.language === 'Language' ? 'en' : 'vi') : undefined}>{probe?.checking ? <Spinner /> : <span className={`status-dot ${status || 'idle'}`} />}{status === 'connected' ? t.connected : status === 'connecting' ? t.connecting : probe?.reachable === true ? `${probe.latency} ms · TCP` : probe?.reachable === false ? 'Unreachable' : t.notConnected}</span><button className="connect-button" disabled={status === 'connecting'} onClick={onConnect}>{t.connect}<ArrowUpRight size={14} /></button></div>
  </article>;
}

function SnippetEditor({ snippet, t, onClose, onSave }) {
  const [name, setName] = useState(snippet?.name || ''), [command, setCommand] = useState(snippet?.command || ''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  return <Modal title={snippet ? t.edit : t.addSnippet} onClose={onClose} className="snippet-modal"><form onSubmit={async e => { e.preventDefault(); setBusy(true); try { await onSave({ id: snippet?.id, name, command }); onClose(); } catch (e) { setError(e.message); setBusy(false); } }}><div className="modal-body"><label className="field">{t.name}<input required autoFocus value={name} maxLength={80} onChange={e => setName(e.target.value)} placeholder="Check disk usage" /></label><label className="field">{t.command}<textarea required rows={7} maxLength={12000} className="code-input" value={command} onChange={e => setCommand(e.target.value)} placeholder="df -h" /></label><p className="muted">{t.snippetHint}</p>{error && <div className="error-box">{error}</div>}</div><footer className="modal-footer"><button type="button" className="button ghost" onClick={onClose}>{t.cancel}</button><button className="button primary" disabled={busy}>{busy ? <Spinner /> : <Check size={16} />}{t.saved}</button></footer></form></Modal>;
}

export default function App() {
  const [workspace, setWorkspace] = useState(initial), [loaded, setLoaded] = useState(false);
  const [route, setRoute] = useState('overview'), [group, setGroup] = useState(''), [filter, setFilter] = useState('all'), [query, setQuery] = useState(''), [sort, setSort] = useState('name'), [list, setList] = useState(false);
  const [demo, setDemo] = useState(!window.remote), [profileDialog, setProfileDialog] = useState(null), [credentialDialog, setCredentialDialog] = useState(null), [palette, setPalette] = useState(false), [snippetDialog, setSnippetDialog] = useState(null);
  const [sessions, setSessions] = useState([]), [activeTab, setActiveTab] = useState('home'), [transfers, setTransfers] = useState([]), [probes, setProbes] = useState({}), [toasts, setToasts] = useState([]), [quickHost, setQuickHost] = useState(''), [quickUser, setQuickUser] = useState('root');
  const restoredIdsRef = useRef(new Set());
  const workspaceRef = useRef(workspace), sessionsRef = useRef(sessions), activeRef = useRef(activeTab), toastTimers = useRef(new Set());
  workspaceRef.current = workspace; sessionsRef.current = sessions; activeRef.current = activeTab;
  const t = dictionary[workspace.settings.language];
  const language = workspace.settings.language;
  const notify = (message, kind = 'success') => {
    const id = crypto.randomUUID();
    setToasts(s => [...s.slice(-3), { id, message, kind }]);
    const timer = setTimeout(() => { setToasts(s => s.filter(item => item.id !== id)); toastTimers.current.delete(timer); }, kind === 'error' ? 8000 : 3500);
    toastTimers.current.add(timer);
  };
  const api = () => { if (!window.remote) throw new Error(t.noDesktop); return window.remote; };
  const run = async (callback, success) => { try { const result = await callback(); if (success) notify(success); return result; } catch (e) { notify(e.message, 'error'); return null; } };
  const updateWorkspace = data => { if (data) setWorkspace(s => ({ ...s, ...data })); };

  useEffect(() => {
    if (!window.remote) { setLoaded(true); return; }
    let disposed = false;
    window.remote.load().then(async data => {
      if (disposed) return;
      workspaceRef.current = data; setWorkspace(data);
      const tabs = data.settings.restoreSessions ? (data.sessionLayout?.tabs || []) : [];
      const restored = tabs.map(tab => {
        const profile = data.profiles.find(profile => profile.id === tab.profileId);
        return profile && { id: tab.id, profile, view: tab.view, terminalOpened: tab.view === 'terminal', status: 'disconnected', needsCredential: profile.auth === 'password' && !profile.hasSecret };
      }).filter(Boolean);
      restoredIdsRef.current = new Set(restored.map(tab => tab.id));
      sessionsRef.current = restored; setSessions(restored);
      setActiveTab(restored.some(tab => tab.id === data.sessionLayout?.activeTab) ? data.sessionLayout.activeTab : 'home');
      setLoaded(true);
      let next = 0;
      const worker = async () => {
        while (next < restored.length && !disposed) {
          const tab = restored[next++];
          if (tab.needsCredential || !sessionsRef.current.some(current => current.id === tab.id)) continue;
          try { await window.remote.connect(tab.profile.id, undefined, tab.view === 'files' ? 'sftp' : 'terminal', tab.id); }
          catch (error) { if (!disposed && sessionsRef.current.some(current => current.id === tab.id)) notify(tab.profile.name + ': ' + error.message, 'error'); }
        }
      };
      await Promise.all(Array.from({ length: Math.min(3, restored.length) }, worker));
    }).catch(e => { if (!disposed) { notify(e.message, 'error'); setLoaded(true); } });
    const unsubscribe = window.remote.onEvent(event => {
      if (event.type === 'data') terminalBus.push(event.sessionId, event.data);
      if (event.type === 'status') {
        setSessions(current => {
          const exists = current.some(s => s.id === event.sessionId);
          if (exists) return current.map(s => s.id === event.sessionId ? { ...s, status: event.status, needsCredential: event.status === 'connected' ? false : s.needsCredential } : s);
          if (event.status !== 'connecting') return current;
          const profile = workspaceRef.current.profiles.find(p => p.id === event.profileId);
          return profile ? [...current, { id: event.sessionId, profile, status: event.status, view: event.mode === 'sftp' ? 'files' : 'terminal', terminalOpened: event.mode === 'terminal' }] : current;
        });
        if (event.status === 'connecting' && !restoredIdsRef.current.delete(event.sessionId)) setActiveTab(event.sessionId);
        if (event.status === 'connected') window.remote.load().then(updateWorkspace).catch(() => {});
      }
      if (event.type === 'error') {
        terminalBus.push(event.sessionId, `\r\n\x1b[31m${event.message.replace(/[\x00-\x1f\x7f]/g, '')}\x1b[0m\r\n`);
      }
      if (event.type === 'transfer') setTransfers(current => {
        const existing = current.some(tr => tr.id === event.id);
        return existing ? current.map(tr => tr.id === event.id ? { ...tr, ...event } : tr) : [event, ...current].slice(0, 200);
      });
    });
    return () => { disposed = true; unsubscribe(); for (const timer of toastTimers.current) clearTimeout(timer); };
  }, []);

  useEffect(() => {
    if (!loaded || !window.remote) return;
    const layout = { tabs: sessions.map(session => ({ id: session.id, profileId: session.profile.id, view: session.view })), activeTab };
    window.remote.saveSessionLayout(layout).catch(error => notify(error.message, 'error'));
  }, [loaded, sessions.map(session => session.id + ':' + session.view).join('|'), activeTab]);

  useEffect(() => { document.documentElement.dataset.theme = workspace.settings.theme; document.documentElement.lang = language; }, [workspace.settings.theme, language]);
  const profiles = demo ? sampleProfiles : workspace.profiles;
  const groups = useMemo(() => [...new Set(profiles.map(p => p.group))].sort(), [profiles]);
  const connectedCount = sessions.filter(s => s.status === 'connected').length;
  const stats = [[Server, profiles.length, t.total, 'mint'], [Activity, connectedCount, t.active, 'blue'], [Layers3, groups.length, t.groupCount, 'purple'], [Star, profiles.filter(p => p.favorite).length, t.favoriteCount, 'amber']];
  const recent = profiles.filter(p => p.lastConnected).sort((a, b) => b.lastConnected.localeCompare(a.lastConnected)).slice(0, 4);
  const matches = profiles.filter(p => (!group || p.group === group) && (filter === 'all' || p.protocol === filter) && (route !== 'favorites' || p.favorite) && (route !== 'recent' || p.lastConnected) && `${p.name} ${p.host} ${p.username} ${p.group} ${p.tags.join(' ')}`.toLowerCase().includes(query.toLowerCase())).sort((a, b) => sort === 'recent' || route === 'recent' ? (b.lastConnected || '').localeCompare(a.lastConnected || '') || a.name.localeCompare(b.name) : sort === 'group' ? a.group.localeCompare(b.group) || a.name.localeCompare(b.name) : a.name.localeCompare(b.name));

  const navigate = (newRoute, newGroup = '') => { setRoute(newRoute); setGroup(newGroup); setActiveTab('home'); setQuery(''); setFilter('all'); };
  const connect = async (profile, mode, secret, tabId) => {
    if (demo || profile.id.startsWith('demo-')) { notify(t.sampleHint, 'info'); return; }
    if (!window.remote) { notify(t.noDesktop, 'error'); return; }
    if (profile.protocol === 'rdp') { await run(() => api().rdp(profile.id), language === 'vi' ? 'Đã mở Windows Remote Desktop.' : 'Windows Remote Desktop opened.'); return; }
    const desiredMode = mode || (profile.protocol === 'sftp' ? 'sftp' : 'terminal');
    if (profile.auth === 'password' && !profile.hasSecret && secret === undefined) { setCredentialDialog({ profile, mode: desiredMode, tabId }); return; }
    const already = sessionsRef.current.find(s => s.profile.id === profile.id && s.status === 'connecting');
    if (already) { setActiveTab(already.id); return; }
    await run(() => api().connect(profile.id, secret, desiredMode, tabId));
  };
  const closeSession = async id => {
    const session = sessionsRef.current.find(s => s.id === id);
    if (session?.status === 'connected' && workspaceRef.current.settings.confirmClose) {
      if (!window.confirm(language === 'vi' ? `Ngắt phiên “${session.profile.name}”? Tác vụ đang chạy sẽ dừng.` : `Disconnect “${session.profile.name}”? Running tasks will stop.`)) return;
    }
    await run(() => api().disconnect(id));
    setSessions(s => s.filter(item => item.id !== id));
    terminalBus.clear(id);
    if (activeRef.current === id) setActiveTab('home');
  };
  const sessionView = async (id, view) => {
    const session = sessionsRef.current.find(s => s.id === id);
    if (view === 'terminal' && !session.terminalOpened) {
      const result = await run(() => api().openShell(id));
      if (result === null) return;
    }
    setSessions(s => s.map(item => item.id === id ? { ...item, view, terminalOpened: item.terminalOpened || view === 'terminal' } : item));
  };
  useEffect(() => {
    const keydown = e => {
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && e.key.toLowerCase() === 'k') { e.preventDefault(); setPalette(v => !v); }
      if (profileDialog || credentialDialog || snippetDialog || palette) return;
      if (ctrl && e.key.toLowerCase() === 'n') { e.preventDefault(); setProfileDialog({}); }
      if (ctrl && e.key === '1') { e.preventDefault(); setActiveTab('home'); }
      if (ctrl && e.key.toLowerCase() === 'w' && activeRef.current !== 'home') { e.preventDefault(); closeSession(activeRef.current); }
      if (ctrl && e.shiftKey && e.key.toLowerCase() === 'f' && activeRef.current !== 'home') { e.preventDefault(); sessionView(activeRef.current, 'files'); }
      if (ctrl && e.key === 'Tab') {
        e.preventDefault(); const ids = ['home', ...sessionsRef.current.map(s => s.id)]; const index = ids.indexOf(activeRef.current); setActiveTab(ids[(index + (e.shiftKey ? ids.length - 1 : 1)) % ids.length]);
      }
    };
    window.addEventListener('keydown', keydown); return () => window.removeEventListener('keydown', keydown);
  }, [profileDialog, credentialDialog, snippetDialog, palette, language]);

  const saveProfile = async (draft, credential, shouldConnect) => {
    const data = await api().saveProfile(draft, credential);
    workspaceRef.current = { ...workspaceRef.current, ...data };
    updateWorkspace(data); setDemo(false); setProfileDialog(null); notify(t.saved);
    if (shouldConnect) {
      const saved = data.profiles.find(p => p.id === draft.id);
      // The save response includes secret presence, never the secret itself.
      if (saved.protocol === 'rdp') await run(() => api().rdp(saved.id));
      else if (saved.auth === 'password' && !saved.hasSecret) setCredentialDialog({ profile: saved, mode: saved.protocol === 'sftp' ? 'sftp' : 'terminal' });
      else await run(() => api().connect(saved.id, undefined, saved.protocol === 'sftp' ? 'sftp' : 'terminal'));
    }
  };
  const modifyProfile = (profile, action) => {
    if (demo) { if (action === 'edit' || action === 'duplicate') setProfileDialog({ ...profile, id: undefined, name: `${profile.name} (copy)`, hasSecret: false }); else notify(t.sampleHint, 'info'); return; }
    if (action === 'edit') setProfileDialog(profile);
    if (action === 'duplicate') setProfileDialog({ ...profile, id: undefined, name: `${profile.name} (copy)`, hasSecret: false, secretSaved: false, lastConnected: null });
    if (action === 'favorite') run(async () => updateWorkspace(await api().favorite(profile.id)));
    if (action === 'delete') run(async () => updateWorkspace(await api().deleteProfile(profile.id)));
    if (action === 'probe') run(async () => {
      setProbes(s => ({ ...s, [profile.id]: { checking: true } }));
      try { const result = await api().probe(profile.id); setProbes(s => ({ ...s, [profile.id]: result })); }
      finally { setProbes(s => ({ ...s, [profile.id]: { ...s[profile.id], checking: false } })); }
    });
  };
  const changeSettings = patch => run(async () => {
    const settings = { ...workspace.settings, ...patch };
    if (!window.remote) { setWorkspace(s => ({ ...s, settings })); return; }
    updateWorkspace(await api().settings(settings));
  });
  const importConfig = () => run(async () => { const data = await api().import(); if (data) { updateWorkspace(data); setDemo(false); notify(t.saved); } });
  const exportConfig = () => run(async () => { const output = await api().export(); if (output) notify(t.saved); });
  const quickConnect = e => {
    e.preventDefault();
    let host = quickHost.trim(), port = 22;
    const parsed = host.match(/^([^:]+):(\d+)$/); if (parsed) { host = parsed[1]; port = Number(parsed[2]); }
    setProfileDialog({ name: host, host, port, username: quickUser, protocol: 'ssh', group: 'Personal', auth: 'password' });
  };

  if (!loaded) return <div className="app-loading"><div className="brand-symbol"><Terminal size={28} /></div><Spinner /><span>QuanLyRemote</span></div>;

  const currentTitle = group || t[route];
  const title = route === 'overview' && !group ? t.yourConnections : currentTitle;
  const activeSession = sessions.find(s => s.id === activeTab);
  const isConnectionRoute = ['overview', 'favorites', 'recent'].includes(route);
  const commands = [
    { id: 'new', title: t.newConnection, subtitle: 'Ctrl N', icon: <Plus size={18} />, run: () => setProfileDialog({}) },
    ...navigation.map(([id, Icon]) => ({ id: `nav-${id}`, title: t[id], icon: <Icon size={18} />, run: () => navigate(id) })),
    { id: 'nav-settings', title: t.settings, icon: <Settings2 size={18} />, run: () => navigate('settings') },
    { id: 'import', title: t.import, icon: <Download size={18} />, run: importConfig },
  ];

  return <div className="app-shell">
    <div className="titlebar"><div className="titlebar-brand"><span className="tiny-logo"><Terminal size={13} /></span>QuanLyRemote<span className="version-chip">v{workspace.version}</span></div><div className="titlebar-center"><LockKeyhole size={11} />{t.localOnly}</div><div className="window-buttons"><button aria-label="Minimize" onClick={() => window.remote?.windowControl('minimize')}><Minus size={14} /></button><button aria-label="Maximize" onClick={() => window.remote?.windowControl('maximize')}><Maximize2 size={12} /></button><button className="window-close" aria-label="Close app" onClick={() => window.remote?.windowControl('close')}><X size={16} /></button></div></div>
    <div className="app-body"><aside className="sidebar"><a className="brand" href="#" onClick={e => { e.preventDefault(); navigate('overview'); }}><span className="brand-symbol"><Terminal size={23} strokeWidth={2.5} /></span><span>remote<span className="brand-dot">.</span><small>YOUR CONNECTION HUB</small></span></a><button className="workspace-switch" onClick={() => navigate('overview')}><span className="workspace-avatar">VC</span><span><strong>{t.localWorkspace}</strong><small>QuanLyRemote</small></span><ChevronDown size={15} /></button><button className="sidebar-search" onClick={() => setPalette(true)}><Search size={16} /><span>{language === 'vi' ? 'Tìm nhanh…' : 'Jump to…'}</span><kbd>Ctrl K</kbd></button><nav className="main-nav">{navigation.map(([id, Icon]) => <button key={id} className={activeTab === 'home' && route === id && !group ? 'selected' : ''} onClick={() => navigate(id)}><Icon size={18} /><span>{t[id]}</span>{id === 'favorites' && profiles.some(p => p.favorite) && <span className="nav-count">{profiles.filter(p => p.favorite).length}</span>}{id === 'transfers' && transfers.some(tr => tr.status === 'running') && <span className="nav-count mint-text">{transfers.filter(tr => tr.status === 'running').length}</span>}</button>)}</nav><div className="sidebar-section-title"><span>{t.groups}</span><button className="icon-button" aria-label={t.newConnection} title={t.newConnection} onClick={() => setProfileDialog({})}><Plus size={14} /></button></div><div className="group-nav">{groups.map((g, i) => <button key={g} className={group === g && activeTab === 'home' ? 'selected' : ''} onClick={() => navigate('overview', g)}><span className={`group-dot group-${i % 4}`} /><span>{g}</span><small>{profiles.filter(p => p.group === g).length}</small></button>)}{!groups.length && <button onClick={() => setProfileDialog({})}><Folder size={16} /><span>Personal</span><small>0</small></button>}</div><div className="sidebar-bottom"><div className="private-note"><ShieldCheck size={18} /><div><strong>{language === 'vi' ? 'Workspace riêng tư' : 'Private by design'}</strong><p>{t.localOnly}</p></div><span className="status-dot connected" /></div><button className={activeTab === 'home' && route === 'settings' ? 'selected settings-link' : 'settings-link'} onClick={() => navigate('settings')}><Settings2 size={18} /><span>{t.settings}</span><kbd>⚙</kbd></button></div></aside>
    <div className="main-shell"><div className="tabbar"><button className={`workspace-tab ${activeTab === 'home' ? 'selected' : ''}`} onClick={() => setActiveTab('home')}><Grid2X2 size={15} />Workspace</button><div className="session-tabs">{sessions.map(s => <div key={s.id} className={`session-tab ${activeTab === s.id ? 'selected' : ''}`}><button onClick={() => setActiveTab(s.id)}><span className={`status-dot ${s.status}`} /><span>{s.profile.name}</span></button><button className="tab-close" aria-label={`${t.close} ${s.profile.name}`} onClick={() => closeSession(s.id)}><X size={13} /></button></div>)}</div><button className="tab-new icon-button" title={t.newConnection} aria-label={t.newConnection} onClick={() => setPalette(true)}><Plus size={16} /></button><div className="workspace-indicator"><span className="status-dot connected" />LOCAL</div></div>
    <div className="home-view" hidden={activeTab !== 'home'}>
      <header className="page-header"><div className="breadcrumbs"><Home size={14} /><ChevronRight size={12} /><span>Workspace</span><ChevronRight size={12} /><strong>{currentTitle}</strong></div><div className="header-actions"><span className="workspace-label"><span className="status-dot connected" />PERSONAL WORKSPACE</span><button className="icon-button" title={t.help} aria-label={t.help} onClick={() => setPalette(true)}><CircleHelp size={18} /></button><span className="user-avatar">VC</span></div></header>
      {demo && <div className="demo-banner"><Sparkles size={15} /><strong>{t.demo}</strong><span>{t.sampleHint}</span><button onClick={() => setDemo(false)}>{t.exitDemo}<X size={14} /></button></div>}
      <div className={`page-content ${!isConnectionRoute ? 'full-content' : ''}`}>
      {isConnectionRoute && <><main className="connections-main"><div className="hero"><div className="eyebrow"><span />CONNECTION WORKSPACE</div><h1>{route === 'overview' && !group ? <>{t.welcome}<br /><span>{t.welcomeAccent}</span></> : <>{currentTitle}<span className="heading-dot">.</span></>}</h1><p>{t.subtitle}</p><div className="hero-buttons"><button className="button primary" onClick={() => setProfileDialog({})}><Plus size={16} />{t.newConnection}</button><button className="button ghost" onClick={importConfig}><Download size={15} />{t.import}</button></div><div className="hero-decoration" aria-hidden="true"><div className="orbit orbit-one" /><div className="orbit orbit-two" /><div className="decor-server"><Server size={32} /></div><span className="decor-node node-terminal"><Terminal size={18} /></span><span className="decor-node node-folder"><FolderOpen size={18} /></span><span className="decor-node node-lock"><LockKeyhole size={16} /></span><span className="orbit-dot dot-one" /><span className="orbit-dot dot-two" /></div></div><div className="stats-grid">{stats.map(([Icon, count, label, color]) => <div className="stat" key={label}><span className={`stat-icon ${color}`}><Icon size={18} /></span><div><strong>{count.toString().padStart(2, '0')}</strong><span>{label}</span></div></div>)}</div><section className="connection-section"><div className="section-heading"><div><h2>{title}</h2><span className="count-badge">{matches.length}</span></div><div><select className="sort-select" aria-label="Sort connections" value={sort} onChange={e => setSort(e.target.value)}><option value="name">{t.sortName}</option><option value="recent">{t.sortRecent}</option><option value="group">{t.sortGroup}</option></select><div className="view-switch"><button className={!list ? 'selected' : ''} title="Grid view" aria-label="Grid view" onClick={() => setList(false)}><Grid2X2 size={15} /></button><button className={list ? 'selected' : ''} title="List view" aria-label="List view" onClick={() => setList(true)}><List size={17} /></button></div></div></div><div className="connections-toolbar"><div className="protocol-filters">{['all', 'ssh', 'sftp', 'rdp'].map(p => <button key={p} className={filter === p ? 'selected' : ''} onClick={() => setFilter(p)}>{p === 'all' ? t.all : p.toUpperCase()}<span>{profiles.filter(profile => (!group || profile.group === group) && (p === 'all' || profile.protocol === p) && (route !== 'favorites' || profile.favorite) && (route !== 'recent' || profile.lastConnected)).length}</span></button>)}</div><div className="search-field"><Search size={16} /><input value={query} aria-label={t.search} placeholder={t.search} onChange={e => setQuery(e.target.value)} />{query && <button className="icon-button" aria-label="Clear search" onClick={() => setQuery('')}><X size={14} /></button>}</div></div>{matches.length > 0 ? <div className={`connections-grid ${list ? 'connections-list' : ''}`}>{matches.map(profile => <ConnectionCard key={profile.id} profile={profile} t={t} list={list} status={sessions.find(s => s.profile.id === profile.id && ['connected', 'connecting'].includes(s.status))?.status} probe={probes[profile.id]} onConnect={() => connect(profile)} onFiles={() => connect(profile, 'sftp')} onEdit={() => modifyProfile(profile, 'edit')} onDuplicate={() => modifyProfile(profile, 'duplicate')} onFavorite={() => modifyProfile(profile, 'favorite')} onDelete={() => modifyProfile(profile, 'delete')} onProbe={() => modifyProfile(profile, 'probe')} />)}</div> : <div className="empty-state connection-empty"><div className="empty-illustration"><Server size={34} /><span><Plus size={13} /></span></div><h3>{profiles.length ? t.noConnections : t.firstTitle}</h3><p>{profiles.length ? t.noConnectionsHint : t.firstHint}</p><button className="button primary" onClick={() => setProfileDialog({})}><Plus size={16} />{t.newConnection}</button>{!profiles.length && <button className="empty-demo-link" onClick={() => setDemo(true)}>{t.sample}<ArrowRight size={14} /></button>}</div>}</section><div className="connection-footer"><ShieldCheck size={13} /><span>{t.securityHint}</span><span className="footer-key">Ctrl K</span></div></main><aside className="right-panel"><section className="quick-connect"><div className="panel-title"><Zap size={16} /><h3>{t.quickConnect}</h3><span className="beta-badge">SSH</span></div><p>{t.quickHint}</p><form onSubmit={quickConnect}><label>{t.host}<input required aria-label="Quick host" placeholder="192.168.1.10" value={quickHost} onChange={e => setQuickHost(e.target.value)} /></label><label>{t.username}<input required aria-label="Quick username" placeholder="root" value={quickUser} onChange={e => setQuickUser(e.target.value)} /></label><button className="button primary" type="submit">{t.connect}<ArrowRight size={15} /></button></form><div className="quick-note"><LockKeyhole size={11} />{language === 'vi' ? 'Xác thực ở bước tiếp theo' : 'Authenticate in the next step'}</div></section><section className="recent-panel"><div className="panel-title"><Clock3 size={16} /><h3>{t.recent}</h3><button className="icon-button" aria-label={t.recent} onClick={() => navigate('recent')}><ArrowUpRight size={14} /></button></div>{recent.length ? recent.map(profile => <button className="recent-item" key={profile.id} onClick={() => connect(profile)}><span className={`small-protocol-icon ${profile.protocol}`}><ProtocolIcon protocol={profile.protocol} size={16} /></span><span><strong>{profile.name}</strong><small>{shortDate(profile.lastConnected, language)}</small></span><ChevronRight size={14} /></button>) : <div className="recent-empty"><Clock3 size={22} /><p>{t.noRecent}</p></div>}</section><section className="shortcuts-panel"><div className="panel-title"><Command size={16} /><h3>{t.shortcuts}</h3></div>{[[t.newConnection, 'Ctrl N'], [t.search.split('…')[0], 'Ctrl K'], [t.files, 'Ctrl ⇧ F'], [t.close, 'Ctrl W']].map(([label, shortcut]) => <div className="shortcut-row" key={shortcut}><span>{label}</span><kbd>{shortcut}</kbd></div>)}</section><div className="right-panel-bottom"><div className="terminal-art"><Terminal size={18} /><span>connect. build. repeat.</span><span className="blinking-cursor">▏</span></div><p>Made for your workflow.</p><span>QuanLyRemote · v{workspace.version}</span></div></aside></>}

      {route === 'settings' && <main className="settings-page"><div className="simple-page-heading"><div className="eyebrow">YOUR WORKSPACE, YOUR WAY</div><h1>{t.settings}<span className="heading-dot">.</span></h1><p>{t.securityHint}</p></div><section className="settings-card"><h2><Settings2 size={19} />{t.appearance}</h2><div className="settings-row"><div><strong>{t.appearance}</strong><p>{language === 'vi' ? 'Chọn không gian làm việc phù hợp với bạn.' : 'Choose your workspace appearance.'}</p></div><div className="theme-options">{['dark', 'light'].map(theme => <button key={theme} className={workspace.settings.theme === theme ? 'selected' : ''} onClick={() => changeSettings({ theme })}><span className={`theme-preview ${theme}`}><i /><b /><em /></span>{t[theme]}{workspace.settings.theme === theme && <Check size={14} />}</button>)}</div></div><div className="settings-row"><strong>{t.language}</strong><select aria-label={t.language} value={language} onChange={e => changeSettings({ language: e.target.value })}><option value="vi">Tiếng Việt</option><option value="en">English</option></select></div><div className="settings-row"><strong>{t.fontSize}</strong><select aria-label={t.fontSize} value={workspace.settings.fontSize} onChange={e => changeSettings({ fontSize: Number(e.target.value) })}>{[11, 12, 13, 14, 15, 16, 18, 20, 22].map(size => <option key={size} value={size}>{size} px</option>)}</select></div></section><section className="settings-card"><h2><ShieldCheck size={19} />{t.security}</h2><div className="settings-row"><div><strong>{t.restoreSessions}</strong><p>{t.restoreSessionsHint}</p></div><button className={`toggle ${workspace.settings.restoreSessions ? 'on' : ''}`} role="switch" aria-checked={workspace.settings.restoreSessions} aria-label={t.restoreSessions} onClick={() => changeSettings({ restoreSessions: !workspace.settings.restoreSessions })}><span /></button></div><div className="settings-row"><div><strong>{t.confirmClose}</strong><p>SSH / SFTP</p></div><button className={`toggle ${workspace.settings.confirmClose ? 'on' : ''}`} role="switch" aria-checked={workspace.settings.confirmClose} aria-label={t.confirmClose} onClick={() => changeSettings({ confirmClose: !workspace.settings.confirmClose })}><span /></button></div><div className="encryption-status"><LockKeyhole size={18} /><div><strong>Windows DPAPI</strong><p>{workspace.encryptionAvailable ? language === 'vi' ? 'Mã hóa sẵn sàng. Mật khẩu gắn với tài khoản Windows của bạn.' : 'Encryption available. Secrets are tied to your Windows account.' : language === 'vi' ? 'Chưa khả dụng. Bạn vẫn có thể dùng mật khẩu cho từng phiên.' : 'Unavailable. Session-only credentials still work.'}</p></div><span className={`status-dot ${workspace.encryptionAvailable ? 'connected' : 'idle'}`} /></div><h3 className="known-hosts-title">{t.knownHosts}<span className="count-badge">{workspace.knownHosts.length}</span></h3>{!workspace.knownHosts.length && <p className="muted">{t.noHosts}</p>}{workspace.knownHosts.map(host => <div className="known-host" key={host.address}><div><strong>{host.address}</strong><code>{host.fingerprint}</code></div><button className="button ghost danger" onClick={() => run(async () => updateWorkspace(await api().forgetHost(host.address)))}>{t.forget}</button></div>)}</section><section className="settings-card"><h2><HardDrive size={19} />{t.backup}</h2><p className="muted">{t.backupHint}</p><div className="backup-actions"><button className="button secondary" onClick={importConfig}><Download size={16} />{t.import}</button><button className="button secondary" onClick={exportConfig}><Upload size={16} />{t.export}</button></div></section><p className="app-about">QuanLyRemote v{workspace.version} · Electron + React + ssh2 · MIT</p></main>}

      {route === 'snippets' && <main className="snippets-page"><div className="simple-page-heading"><div className="eyebrow">LESS TYPING, MORE DOING</div><div className="heading-with-button"><h1>{t.snippets}<span className="heading-dot">.</span></h1><button className="button primary" onClick={() => setSnippetDialog({})}><Plus size={16} />{t.addSnippet}</button></div><p>{t.snippetHint}</p></div>{!workspace.snippets.length ? <div className="empty-state large-empty"><div className="empty-illustration"><Code2 size={34} /></div><h3>{t.noSnippets}</h3><p>df -h <span className="divider">/</span> docker ps <span className="divider">/</span> systemctl status nginx</p><button className="button primary" onClick={() => setSnippetDialog({})}><Plus size={16} />{t.addSnippet}</button></div> : <div className="snippet-grid">{workspace.snippets.map(snippet => <article className="snippet-card" key={snippet.id}><header><Code2 size={18} /><h3>{snippet.name}</h3><button className="icon-button" aria-label={`${t.edit} ${snippet.name}`} onClick={() => setSnippetDialog(snippet)}><Settings2 size={16} /></button><button className="icon-button danger-hover" aria-label={`${t.delete} ${snippet.name}`} onClick={() => { if (window.confirm(`${t.delete} “${snippet.name}”?`)) run(async () => updateWorkspace(await api().deleteSnippet(snippet.id))); }}><Trash2 size={16} /></button></header><pre>{snippet.command}</pre><footer><button className="button secondary" onClick={() => run(async () => { await api().copyText(snippet.command); notify(t.saved); })}><Copy size={14} />{t.copy}</button><select aria-label={t.pasteTerminal} defaultValue="" onChange={async e => { const id = e.target.value; e.target.value = ''; if (!id) return; await sessionView(id, 'terminal'); setActiveTab(id); setTimeout(() => { const term = terminalInstances.get(id); if (term) { term.paste(snippet.command); term.focus(); } else notify(t.terminalHint, 'error'); }, 100); }}><option value="" disabled>{t.pasteTerminal}…</option>{sessions.filter(s => s.status === 'connected').map(s => <option key={s.id} value={s.id}>{s.profile.name}</option>)}</select></footer></article>)}</div>}</main>}

      {route === 'transfers' && <main className="transfers-page"><div className="simple-page-heading"><div className="eyebrow">SECURE FILE TRANSFERS</div><div className="heading-with-button"><h1>{t.transfers}<span className="heading-dot">.</span></h1><button className="button secondary" onClick={() => setTransfers(s => s.filter(tr => tr.status === 'running'))}><EraserIcon />{t.clear}</button></div><p>{t.transferHint}</p></div>{!transfers.length ? <div className="empty-state large-empty"><div className="empty-illustration"><ArrowDownToLine size={34} /></div><h3>{t.noTransfers}</h3><p>{t.noTransfersHint}</p><button className="button primary" onClick={() => navigate('overview')}><FolderOpen size={16} />{t.browse}</button></div> : <div className="transfer-list">{transfers.map(tr => <article className="transfer-row" key={tr.id}><span className={`transfer-icon ${tr.direction}`}>{tr.direction === 'upload' ? <ArrowUpFromLine size={20} /> : <ArrowDownToLine size={20} />}</span><div className="transfer-details"><strong>{tr.name}</strong><small>{sessions.find(s => s.id === tr.sessionId)?.profile.name || 'SFTP'} · {t[tr.direction]}</small><div className="progress"><i className={tr.status === 'failed' ? 'failed' : ''} style={{ width: `${tr.status === 'completed' ? 100 : tr.total ? tr.transferred / tr.total * 100 : 0}%` }} /></div>{tr.message && <small className={tr.status === 'failed' ? 'danger' : ''}>{tr.message}</small>}</div><div className="transfer-state"><span className={tr.status === 'completed' ? 'mint-text' : tr.status === 'failed' ? 'danger' : ''}>{tr.status === 'running' && <Spinner />}{tr.status === 'completed' && <Check size={14} />}{t[tr.status]}</span><small>{bytes(tr.transferred || 0)} / {bytes(tr.total || 0)}</small></div>{tr.status === 'running' && <button className="icon-button" aria-label={t.cancel} onClick={() => run(() => api().cancelTransfer(tr.id))}><X size={17} /></button>}</article>)}</div>}</main>}
      </div>
    </div>
    {sessions.map(s => <div className="session-view" key={s.id} hidden={activeTab !== s.id}><header className="session-header"><div><span className={`protocol-icon ${s.profile.protocol}`}><ProtocolIcon protocol={s.profile.protocol} size={18} /></span><span><strong>{s.profile.name}</strong><small>{s.profile.username}@{s.profile.host}</small></span><span className={`connection-state ${s.status}`}><span className={`status-dot ${s.status}`} />{t[s.status]}</span></div><div className="session-view-switch"><button className={s.view === 'terminal' ? 'selected' : ''} disabled={s.status === 'connecting'} onClick={() => sessionView(s.id, 'terminal')}><Terminal size={15} />{t.terminal}</button><button className={s.view === 'files' ? 'selected' : ''} disabled={s.status !== 'connected'} onClick={() => sessionView(s.id, 'files')}><FolderOpen size={15} />{t.files}</button></div><div><button className="button secondary" onClick={() => connect(workspace.profiles.find(p => p.id === s.profile.id) || s.profile, s.view === 'files' ? 'sftp' : 'terminal', undefined, s.id)} disabled={s.status === 'connecting'}>{t.reconnect}</button><button className="icon-button danger-hover" title={t.close} aria-label={`${t.close} session`} onClick={() => closeSession(s.id)}><X size={18} /></button></div></header>{s.status === 'connecting' && <div className="connecting-banner"><Spinner /><span>{t.connecting} · {s.profile.host}:{s.profile.port}</span><button className="button ghost" onClick={() => closeSession(s.id)}>{t.cancel}</button></div>}{s.status === 'disconnected' && <div className="disconnected-banner"><CloudOff size={17} /><span>{s.needsCredential ? t.sessionCredentialHint : t.disconnected + '. ' + t.reconnect + '.'}</span></div>}{s.terminalOpened && <div className="terminal-view-wrapper" hidden={s.view !== 'terminal'}><TerminalPane session={s} active={activeTab === s.id && s.view === 'terminal'} settings={workspace.settings} t={t} notify={notify} /></div>}{s.view === 'files' && <FilesPane session={s} localHome={workspace.localHome} t={t} language={language} notify={notify} transfers={transfers} />}</div>)}
    <footer className="app-statusbar"><span><span className="status-dot connected" />{t.localOnly}</span><span>{connectedCount} {language === 'vi' ? 'phiên đang mở' : 'open sessions'}<span className="statusbar-divider" />SSH · SFTP · RDP</span><button onClick={() => setPalette(true)}><Command size={11} />{t.help}</button></footer></div></div>
    <div className="toast-container" aria-live="polite">{toasts.map(toast => <div key={toast.id} className={`toast ${toast.kind}`} role={toast.kind === 'error' ? 'alert' : 'status'}>{toast.kind === 'success' ? <Check size={17} /> : toast.kind === 'error' ? <ShieldCheck size={17} /> : <Sparkles size={17} />}<span>{toast.message}</span><button className="icon-button" aria-label="Dismiss notification" onClick={() => setToasts(s => s.filter(item => item.id !== toast.id))}><X size={14} /></button></div>)}</div>
    {profileDialog && <ProfileForm key={profileDialog.id || 'new'} isNew={!profileDialog.id} profile={profileDialog.id ? profileDialog : { ...profileDialog, id: crypto.randomUUID() }} t={t} groups={[...new Set(['Personal', ...groups])]} encryptionAvailable={workspace.encryptionAvailable} onClose={() => setProfileDialog(null)} onSave={saveProfile} />}
    {credentialDialog && <CredentialDialog profile={credentialDialog.profile} t={t} onClose={() => setCredentialDialog(null)} onConnect={secret => { const { profile, mode, tabId } = credentialDialog; setCredentialDialog(null); connect(profile, mode, secret, tabId); }} />}
    {palette && <CommandPalette profiles={profiles} actions={commands} t={t} onConnect={connect} onClose={() => setPalette(false)} />}
    {snippetDialog && <SnippetEditor snippet={snippetDialog.id ? snippetDialog : null} t={t} onClose={() => setSnippetDialog(null)} onSave={async snippet => updateWorkspace(await api().saveSnippet(snippet))} />}
  </div>;
}

function EraserIcon() { return <Trash2 size={15} />; }
