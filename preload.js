const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('launcher', {
    minimize:    ()        => ipcRenderer.send('window-minimize'),
    maximize:    ()        => ipcRenderer.send('window-maximize'),
    close:       ()        => ipcRenderer.send('window-close'),
    getVersions: ()        => ipcRenderer.invoke('get-versions'),
    launch:      (opts)    => ipcRenderer.invoke('launch', opts),
    openMods:    ()        => ipcRenderer.send('open-mods'),
    openMcDir:   ()        => ipcRenderer.send('open-mc-dir'),
    onStatus:    (cb)      => ipcRenderer.on('launch-status', (_, msg) => cb(msg)),
});
