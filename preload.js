'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getState: () => ipcRenderer.invoke('state'),
  onState: (cb) => ipcRenderer.on('state', (_e, s) => cb(s)),
  refresh: () => ipcRenderer.send('refresh'),
  calibrate: (pct) => ipcRenderer.send('calibrate', pct),
  deleteCalibration: (at) => ipcRenderer.send('delete-calibration', at),
  setReset: (ms) => ipcRenderer.send('set-reset', ms),
  setPlan: (plan) => ipcRenderer.send('set-plan', plan),
  setAutostart: (on) => ipcRenderer.send('set-autostart', on),
  openDashboard: () => ipcRenderer.send('open-dashboard'),
  hidePopup: () => ipcRenderer.send('hide-popup'),
  popupHeight: (h) => ipcRenderer.send('popup-height', h),
  quit: () => ipcRenderer.send('quit'),
});
