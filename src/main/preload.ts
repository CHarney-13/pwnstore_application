import { contextBridge } from 'electron';

contextBridge.exposeInMainWorld('pwnstore', {
  platform: process.platform,
});
