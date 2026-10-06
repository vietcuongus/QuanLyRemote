const { contextBridge, ipcRenderer } = require('electron');

const invoke = async (channel, ...args) => {
  const result = await ipcRenderer.invoke(channel, ...args);
  if (!result.ok) throw new Error(result.error);
  return result.value;
};

contextBridge.exposeInMainWorld('remote', {
  load: () => invoke('workspace:load'),
  saveProfile: (profile, credential) => invoke('profile:save', profile, credential),
  deleteProfile: id => invoke('profile:delete', id),
  favorite: id => invoke('profile:favorite', id),
  settings: settings => invoke('settings:save', settings),
  forgetHost: address => invoke('host:forget', address),
  saveSnippet: snippet => invoke('snippet:save', snippet),
  deleteSnippet: id => invoke('snippet:delete', id),
  export: () => invoke('workspace:export'),
  import: () => invoke('workspace:import'),
  chooseKey: () => invoke('dialog:key'),
  connect: (id, secret, mode) => invoke('session:connect', id, secret, mode),
  openShell: (id, geometry) => invoke('session:shell', id, geometry),
  disconnect: id => invoke('session:disconnect', id),
  write: (id, data) => invoke('session:write', id, data),
  resize: (id, cols, rows) => invoke('session:resize', id, cols, rows),
  listRemote: (id, directory) => invoke('sftp:list', id, directory),
  mkdir: (id, directory, name) => invoke('sftp:mkdir', id, directory, name),
  rename: (id, target, name) => invoke('sftp:rename', id, target, name),
  removeRemote: (id, target, directory) => invoke('sftp:delete', id, target, directory),
  listLocal: directory => invoke('local:list', directory),
  chooseDirectory: () => invoke('local:choose'),
  upload: (id, directory, selectedPath) => invoke('transfer:upload', id, directory, selectedPath),
  download: (id, target, directory) => invoke('transfer:download', id, target, directory),
  cancelTransfer: id => invoke('transfer:cancel', id),
  rdp: id => invoke('remote:rdp', id),
  probe: id => invoke('profile:probe', id),
  windowControl: action => invoke('window:control', action),
  onEvent: callback => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('session:event', listener);
    return () => ipcRenderer.removeListener('session:event', listener);
  },
});
