import { registerWslProcess } from './wsl-process.mjs';
registerWslProcess();
await import('../bridge/src/index.js');
