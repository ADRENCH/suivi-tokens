'use strict';
// Génère assets/icon.ico (Windows) et assets/icon.png à partir de assets/logo.svg.
// Lancer : npm run icon

const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const ASSETS = path.join(__dirname, '..', 'assets');
const SIZES = [16, 20, 24, 32, 40, 48, 64, 128, 256];
const RENDER = 1024;

/** Fichier .ico dont chaque image est un PNG (format accepté depuis Windows Vista). */
function icoFrom(pngs) {
  const head = Buffer.alloc(6);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(pngs.length, 4);
  const dir = Buffer.alloc(16 * pngs.length);
  let offset = head.length + dir.length;
  pngs.forEach(([size, png], i) => {
    const o = i * 16;
    dir[o] = size >= 256 ? 0 : size;
    dir[o + 1] = size >= 256 ? 0 : size;
    dir.writeUInt16LE(1, o + 4);
    dir.writeUInt16LE(32, o + 6);
    dir.writeUInt32LE(png.length, o + 8);
    dir.writeUInt32LE(offset, o + 12);
    offset += png.length;
  });
  return Buffer.concat([head, dir, ...pngs.map(([, png]) => png)]);
}

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const svg = fs.readFileSync(path.join(ASSETS, 'logo.svg'), 'utf8')
    .replace('<svg', `<svg width="${RENDER}" height="${RENDER}"`);
  const win = new BrowserWindow({
    width: RENDER, height: RENDER, show: false, frame: false, transparent: true,
    backgroundColor: '#00000000', webPreferences: { offscreen: true },
  });
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(
    `<html><body style="margin:0;background:transparent;overflow:hidden">${svg}</body></html>`));
  await new Promise((r) => setTimeout(r, 800)); // laisse le temps au premier rendu complet
  let big = await win.webContents.capturePage();
  const { width } = big.getSize();
  if (width !== RENDER) big = big.resize({ width: RENDER, height: RENDER, quality: 'best' });

  const pngs = SIZES.map((s) => [s, big.resize({ width: s, height: s, quality: 'best' }).toPNG()]);
  fs.writeFileSync(path.join(ASSETS, 'icon.ico'), icoFrom(pngs));
  fs.writeFileSync(path.join(ASSETS, 'icon.png'), pngs[pngs.length - 1][1]);
  console.log(`icon.ico (${SIZES.join(', ')} px) et icon.png écrits dans assets/`);
  app.exit(0);
});
