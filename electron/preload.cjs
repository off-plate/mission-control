/* The only surface the page gets. contextIsolation is on and node is off, so the
   renderer cannot reach the filesystem or spawn anything; it can ask for exactly
   these four native affordances and nothing else.

   `window.mc` existing is also how the shared React code knows it is on the
   desktop. There is no separate desktop bundle to branch on. */
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('mc', {
  desktop: true,
  platform: process.platform,
  /* Dock badge: how many things are actually asking for him right now. */
  badge: (count) => ipcRenderer.invoke('mc:badge', Number(count) || 0),
  /* A real macOS notification. Unlike the web one, this survives the window
     being closed, which is the reason it exists. */
  notify: (title, body) => ipcRenderer.invoke('mc:notify', { title, body }),
  openAtLogin: {
    get: () => ipcRenderer.invoke('mc:login-item-get'),
    set: (enabled) => ipcRenderer.invoke('mc:login-item', enabled),
  },
})
