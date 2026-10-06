import React, { useEffect, useRef, useState } from 'react';
import { X, Terminal, FolderOpen, Monitor, ChevronRight, Search, LockKeyhole, KeyRound, Fingerprint, Check, Eye, EyeOff, LoaderCircle } from 'lucide-react';

export function ProtocolIcon({ protocol = 'ssh', size = 20 }) { const Icon = protocol === 'rdp' ? Monitor : protocol === 'sftp' ? FolderOpen : Terminal; return <Icon size={size} />; }
export function Spinner() { return <LoaderCircle size={16} className="spin" />; }

export function Modal({ title, subtitle, children, onClose, className = '' }) {
  const ref = useRef();
  useEffect(() => {
    const previous = document.activeElement;
    const focusable = () => [...ref.current.querySelectorAll('button:not(:disabled), input, select, textarea, [tabindex="0"]')].filter(el => el.offsetParent !== null);
    (ref.current.querySelector('[autofocus]') || focusable()[1] || focusable()[0])?.focus();
    const handler = e => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); }
      if (e.key === 'Tab') {
        const list = focusable(), first = list[0], last = list.at(-1);
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
      }
    };
    ref.current.addEventListener('keydown', handler);
    return () => { ref.current?.removeEventListener('keydown', handler); previous?.focus(); };
  }, []);
  return <div className="overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}><section ref={ref} className={`modal ${className}`} role="dialog" aria-modal="true" aria-label={title}><header className="modal-header"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div><button className="icon-button" onClick={onClose} aria-label="Close dialog"><X size={20} /></button></header>{children}</section></div>;
}

export function ProfileForm({ profile, isNew, t, groups, onSave, onClose, encryptionAvailable }) {
  const [draft, setDraft] = useState(() => ({ id: crypto.randomUUID(), name: '', host: '', username: 'root', protocol: 'ssh', port: 22, group: 'Personal', auth: 'password', keyPath: '', tags: [], note: '', favorite: false, ...profile }));
  const [secret, setSecret] = useState('');
  const [remember, setRemember] = useState(Boolean(profile?.secretSaved));
  const [clearSecret, setClearSecret] = useState(false);
  const [showSecret, setShowSecret] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const update = (key, value) => setDraft(s => ({ ...s, [key]: value }));
  const submit = async (connect) => {
    setError(''); setBusy(true);
    try {
      const changedAuth = profile && (profile.auth !== draft.auth || profile.keyPath !== draft.keyPath || profile.host !== draft.host || profile.username !== draft.username || profile.port !== Number(draft.port));
      const credential = secret || clearSecret || changedAuth || isNew ? { secret, remember } : remember !== Boolean(profile.secretSaved) ? { remember } : {};
      await onSave(draft, credential, connect);
    } catch (err) { setError(err.message); setBusy(false); }
  };
  return <Modal title={isNew ? t.newConnection : t.edit} subtitle="SSH · SFTP · Remote Desktop" onClose={busy ? () => {} : onClose} className="profile-modal">
    <form onSubmit={e => { e.preventDefault(); submit(false); }}>
      <div className="modal-body">
        <div className="protocol-picker">{['ssh', 'sftp', 'rdp'].map(p => <button type="button" key={p} className={draft.protocol === p ? 'selected' : ''} onClick={() => { if (p === 'rdp') { setSecret(''); setClearSecret(true); setRemember(false); } setDraft(s => ({ ...s, protocol: p, port: p === 'rdp' ? 3389 : s.port === 3389 ? 22 : s.port })); }}><ProtocolIcon protocol={p} /><div><strong>{p.toUpperCase()}</strong><span>{p === 'ssh' ? 'Secure shell' : p === 'sftp' ? 'File transfer' : 'Remote desktop'}</span></div>{draft.protocol === p && <Check size={15} />}</button>)}</div>
        <div className="form-grid">
          <label className="span-two">{t.name}<input required maxLength={80} autoFocus placeholder="Production server" value={draft.name} onChange={e => update('name', e.target.value)} /></label>
          <label>{t.host}<input required placeholder="192.168.1.10 / example.com" value={draft.host} onChange={e => update('host', e.target.value)} /></label>
          <label>{t.port}<input required type="number" min={1} max={65535} value={draft.port} onChange={e => update('port', e.target.value)} /></label>
          <label>{t.username}<input required={draft.protocol !== 'rdp'} placeholder="root" value={draft.username} onChange={e => update('username', e.target.value)} /></label>
          <label>{t.group}<input list="profile-groups" maxLength={60} value={draft.group} onChange={e => update('group', e.target.value)} /><datalist id="profile-groups">{groups.map(g => <option key={g} value={g} />)}</datalist></label>
        </div>
        {draft.protocol !== 'rdp' && <>
          <div className="form-section-label">{t.authentication}</div>
          <div className="segmented auth-picker">{[['password', LockKeyhole, t.authPassword], ['key', KeyRound, t.authKey], ['agent', Fingerprint, t.authAgent]].map(([value, Icon, label]) => <button type="button" key={value} className={draft.auth === value ? 'selected' : ''} onClick={() => { if (draft.auth !== value) setSecret(''); update('auth', value); }}><Icon size={15} />{label}</button>)}</div>
          {draft.auth === 'key' && <label className="field key-field">{t.privateKey}<div className="input-action"><input required value={draft.keyPath} onChange={e => update('keyPath', e.target.value)} placeholder="C:\\Users\\you\\.ssh\\id_ed25519" /><button type="button" className="button secondary" onClick={async () => { try { const result = await window.remote?.chooseKey(); if (result) update('keyPath', result); } catch (e) { setError(e.message); } }}><FolderOpen size={16} />{t.choose}</button></div><small>{t.keyHint}</small></label>}
          {draft.auth !== 'agent' && <><label className="field">{draft.auth === 'key' ? t.passphrase : t.password}<div className="password-field"><input type={showSecret ? 'text' : 'password'} value={secret} autoComplete="new-password" placeholder={profile?.hasSecret ? t.keepSecret : '••••••••'} onChange={e => setSecret(e.target.value)} /><button type="button" className="icon-button" aria-label={showSecret ? 'Hide password' : 'Show password'} onClick={() => setShowSecret(v => !v)}>{showSecret ? <EyeOff size={16} /> : <Eye size={16} />}</button></div></label><label className="checkbox"><input type="checkbox" checked={remember} disabled={!encryptionAvailable} onChange={e => setRemember(e.target.checked)} /><span><LockKeyhole size={14} />{t.remember}</span></label>{profile?.hasSecret && <label className="checkbox"><input type="checkbox" checked={clearSecret} onChange={e => setClearSecret(e.target.checked)} /><span>{t.delete} {t.password.toLowerCase()}</span></label>}</>}
        </>}
        {draft.protocol === 'rdp' && <div className="info-box"><Monitor size={18} /><span>Windows Remote Desktop (mstsc). {t.username}: {draft.username || '—'}. {t.language === 'Language' ? 'Windows will ask for credentials in its own window.' : 'Windows sẽ yêu cầu tài khoản trong cửa sổ Remote Desktop.'}</span></div>}
        <div className="form-grid extra-fields"><label>{t.tags}<input maxLength={200} value={draft.tags.join(', ')} onChange={e => update('tags', e.target.value.split(',').map(s => s.trim()))} placeholder="production, linux, web" /></label><label>{t.note}<input maxLength={500} value={draft.note} onChange={e => update('note', e.target.value)} placeholder="…" /></label></div>
        {error && <div className="error-box" role="alert">{error}</div>}
      </div>
      <footer className="modal-footer"><button type="button" className="button ghost" onClick={onClose} disabled={busy}>{t.cancel}</button><div><button type="submit" className="button secondary" disabled={busy}>{busy && <Spinner />}{t.save}</button><button type="button" className="button primary" disabled={busy || !draft.host || !draft.name} onClick={() => { const form = document.querySelector('.profile-modal form'); if (form.reportValidity()) submit(true); }}>{t.saveConnect}<ChevronRight size={16} /></button></div></footer>
    </form>
  </Modal>;
}

export function CredentialDialog({ profile, t, onConnect, onClose }) {
  const [secret, setSecret] = useState('');
  return <Modal title={t.enterCredential} subtitle={`${profile.username}@${profile.host}:${profile.port}`} onClose={onClose} className="small-modal"><form onSubmit={e => { e.preventDefault(); onConnect(secret); }}><div className="modal-body"><div className="credential-icon"><LockKeyhole size={24} /></div><label className="field">{profile.auth === 'key' ? t.passphrase : t.password}<input type="password" autoFocus autoComplete="off" value={secret} onChange={e => setSecret(e.target.value)} /></label><p className="muted">{t.secretHint}</p></div><footer className="modal-footer"><button type="button" className="button ghost" onClick={onClose}>{t.cancel}</button><button type="submit" className="button primary">{t.connect}<ChevronRight size={16} /></button></footer></form></Modal>;
}

export function CommandPalette({ profiles, actions, t, onConnect, onClose }) {
  const [query, setQuery] = useState(''), [selected, setSelected] = useState(0);
  const matches = [...profiles.map(p => ({ id: p.id, title: p.name, subtitle: `${p.username}@${p.host}`, protocol: p.protocol, run: () => onConnect(p) })), ...actions].filter(a => `${a.title} ${a.subtitle || ''}`.toLowerCase().includes(query.toLowerCase())).slice(0, 10);
  useEffect(() => { setSelected(0); }, [query]);
  return <Modal title={t.help} onClose={onClose} className="palette"><div className="palette-input"><Search size={20} /><input autoFocus placeholder={t.search} value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelected(s => Math.min(s + 1, matches.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSelected(s => Math.max(s - 1, 0)); }
    else if (e.key === 'Enter' && matches[selected]) { onClose(); matches[selected].run(); }
  }} /><kbd>ESC</kbd></div><div className="palette-results">{matches.map((item, i) => <button key={item.id} className={selected === i ? 'selected' : ''} onMouseEnter={() => setSelected(i)} onClick={() => { onClose(); item.run(); }}><span className="palette-item-icon">{item.protocol ? <ProtocolIcon protocol={item.protocol} size={18} /> : item.icon}</span><span><strong>{item.title}</strong><small>{item.subtitle}</small></span><ChevronRight size={16} /></button>)}{!matches.length && <p className="palette-empty">{t.noConnections}</p>}</div><footer className="palette-footer"><span><kbd>↑</kbd><kbd>↓</kbd> Navigate</span><span><kbd>↵</kbd> Open</span></footer></Modal>;
}

export function TextDialog({ title, label, initial = '', multiline = false, t, onSubmit, onClose }) {
  const [value, setValue] = useState(initial), [busy, setBusy] = useState(false), [error, setError] = useState('');
  return <Modal title={title} onClose={onClose} className="small-modal"><form onSubmit={async e => { e.preventDefault(); setBusy(true); try { await onSubmit(value); onClose(); } catch (e) { setError(e.message); setBusy(false); } }}><div className="modal-body"><label className="field">{label}{multiline ? <textarea autoFocus required rows={5} value={value} onChange={e => setValue(e.target.value)} /> : <input autoFocus required value={value} onChange={e => setValue(e.target.value)} />}</label>{error && <div className="error-box">{error}</div>}</div><footer className="modal-footer"><button type="button" className="button ghost" onClick={onClose}>{t.cancel}</button><button className="button primary" disabled={busy}>{busy && <Spinner />}{t.done}</button></footer></form></Modal>;
}
