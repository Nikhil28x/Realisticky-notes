'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('noteAPI', {
  onInit: (cb) => ipcRenderer.on('note:init', (_, data) => cb(data)),
  onFanStatus: (cb) => ipcRenderer.on('fan:status', (_, data) => cb(data)),
  onStickinessUpdate: (cb) => ipcRenderer.on('stickiness:update', (_, data) => cb(data)),
  onFallStart: (cb) => ipcRenderer.on('note:fall-start', () => cb()),
  onLanded: (cb) => ipcRenderer.on('note:landed', (_, data) => cb(data)),
  onResticked: (cb) => ipcRenderer.on('note:resticked', () => cb()),

  textChanged: (id, text) => ipcRenderer.send('note:text-changed', { id, text }),
  close: (id) => ipcRenderer.send('note:close', { id }),
  restick: (id) => ipcRenderer.send('note:restick', { id }),
});
