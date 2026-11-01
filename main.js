'use strict';
// Suivi tokens : icône dans la zone de notification, aperçu au clic, tableau de bord,
// lancement au démarrage de Windows. Tout reste local : aucune requête réseau.

const {
  app, BrowserWindow, Tray, Menu, nativeImage, nativeTheme, screen, ipcMain, powerMonitor, session,
} = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Worker } = require('worker_threads');
const Week = require('./ui/week.js');

const SCAN_EVERY_MS = 2 * 60 * 1000;
const POPUP_WIDTH = 380;
const STARTED_HIDDEN = process.argv.includes('--hidden');
const CLAUDE_DIR = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const APP_ICON = path.join(__dirname, 'assets', process.platform === 'win32' ? 'icon.ico' : 'icon.png');
// Vérification visuelle : SUIVI_SNAPSHOT=<dossier> photographie l'aperçu et le tableau de bord
// puis quitte, avec une configuration temporaire et sans toucher au démarrage de Windows.
const SNAPSHOT_DIR = process.env.SUIVI_SNAPSHOT;
if (SNAPSHOT_DIR) app.setPath('userData', path.join(SNAPSHOT_DIR, 'userdata'));

// Rien de personnel ici : forfait, date de réinitialisation et relevés viennent de
// ~/.claude.json quand Claude Code les y a laissés, sinon des réglages de l'app.
const DEFAULT_CONFIG = {
  plan: '',
  resetAnchor: null,
  anchorLearnedAt: 0,
  calibrations: [],
  autostart: true,
};

let config, data = null, week = null, scanError = null;
let tray = null, popup = null, dash = null, worker = null;
let scanning = false, scanQueued = false, lastScanAt = 0, lastPopupHide = 0;

const configFile = () => path.join(app.getPath('userData'), 'config.json');

function loadConfig() {
  try {
    config = { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(configFile(), 'utf8')) };
  } catch {
    config = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  }
}

function saveConfig() {
  fs.mkdirSync(path.dirname(configFile()), { recursive: true });
  fs.writeFileSync(configFile(), JSON.stringify(config, null, 2));
}

// ---------- Lecture des journaux ----------

function startWorker() {
  worker = new Worker(path.join(__dirname, 'scanner.js'), {
    workerData: { cacheFile: path.join(app.getPath('userData'), 'cache.json'), claudeDir: CLAUDE_DIR },
  });
  worker.on('message', (msg) => {
    scanning = false;
    lastScanAt = Date.now();
    if (msg.ok) {
      data = msg.data;
      scanError = null;
      importClaudeUsage();
      freezeCalibrations();
      recompute();
    } else {
      scanError = msg.error;
      broadcast();
    }
    if (scanQueued) { scanQueued = false; scan(); }
  });
  worker.on('error', (err) => {
    scanning = false;
    scanError = String(err);
    broadcast();
    setTimeout(startWorker, 10000);
  });
}

function scan() {
  if (!worker) return;
  if (scanning) { scanQueued = true; return; }
  scanning = true;
  worker.postMessage('scan');
}

/** Dernier % hebdomadaire mis en cache par Claude Code, dans le premier fichier qui en a un. */
function readCachedUsage() {
  const files = [path.join(os.homedir(), '.claude.json')];
  if (process.env.CLAUDE_CONFIG_DIR) files.unshift(path.join(CLAUDE_DIR, '.claude.json'));
  for (const f of files) {
    try {
      const u = JSON.parse(fs.readFileSync(f, 'utf8')).cachedUsageUtilization;
      if (u) return u;
    } catch { /* fichier suivant */ }
  }
  return null;
}

/** Claude Code garde parfois en cache le dernier % hebdomadaire lu : on s'en sert comme relevé,
 *  et sa date de réinitialisation cale les semaines. */
function importClaudeUsage() {
  const u = readCachedUsage();
  const sd = u && u.utilization && u.utilization.seven_day;
  if (!sd || typeof sd.utilization !== 'number' || !sd.resets_at || !u.fetchedAtMs) return;
  const at = Math.floor(u.fetchedAtMs / 1000);
  const resetAt = Math.round(Date.parse(sd.resets_at) / 3.6e6) * 3600;
  if (config.calibrations.some((c) => Math.abs(c.at - at) < 120)) return;
  config.calibrations.push({ at, pct: sd.utilization, windowStart: resetAt - Week.W, source: 'claude.json' });
  config.calibrations.sort((a, b) => a.at - b.at);
  if (at > (config.anchorLearnedAt || 0)) { config.resetAnchor = resetAt; config.anchorLearnedAt = at; }
  saveConfig();
}

/** Le crédit d'un relevé est figé au premier calcul : les vieux journaux finissent supprimés. */
function freezeCalibrations() {
  let changed = false;
  for (const c of config.calibrations) {
    if (c.credit == null && data.hours.length) {
      c.credit = Week.creditBetween(data.hours, c.windowStart, c.at);
      changed = true;
    }
  }
  if (changed) saveConfig();
}

function recompute() {
  if (data) week = Week.compute(data.hours, config, Date.now() / 1000);
  updateTray();
  broadcast();
}

function snapshot() {
  return {
    data, week, config, scanError, scanning,
    autostart: getAutostart(),
    now: Math.floor(Date.now() / 1000),
  };
}

function broadcast() {
  const s = snapshot();
  for (const w of [popup, dash]) if (w && !w.isDestroyed()) w.webContents.send('state', s);
}

// ---------- Icône de la zone de notification : une flamme qui se remplit ----------

// Contour de la flamme du logo (assets/logo.svg), en courbes de Bézier cubiques.
const FLAME = [
  [530, 226],
  [568, 312, 694, 390, 694, 574], [694, 706, 612, 796, 512, 796], [412, 796, 330, 706, 330, 588],
  [330, 498, 378, 436, 426, 388], [432, 450, 456, 490, 490, 506], [472, 420, 484, 312, 530, 226],
];
const FLAME_TOP = 226, FLAME_BOTTOM = 796;

const flamePolygon = (() => {
  const pts = [FLAME[0]];
  let [x0, y0] = FLAME[0];
  for (const [x1, y1, x2, y2, x3, y3] of FLAME.slice(1)) {
    for (let i = 1; i <= 16; i++) {
      const t = i / 16, u = 1 - t;
      pts.push([
        u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3,
        u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3,
      ]);
    }
    [x0, y0] = [x3, y3];
  }
  return pts;
})();

function insideFlame(x, y) {
  let inside = false;
  for (let i = 0, j = flamePolygon.length - 1; i < flamePolygon.length; j = i++) {
    const [xi, yi] = flamePolygon[i], [xj, yj] = flamePolygon[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

const STATE_RGB = {
  ok: [255, 107, 61], warn: [255, 59, 48], out: [255, 45, 85], uncalibrated: [255, 107, 61],
};

/** Flamme anti-crénelée (BGRA prémultiplié), remplie par le bas selon la part utilisée. */
function flameBitmap(size, pct, state, dark) {
  const buf = Buffer.alloc(size * size * 4);
  const scale = (size * 0.96) / (FLAME_BOTTOM - FLAME_TOP);
  const level = FLAME_BOTTOM - Math.max(0, Math.min(1, (pct || 0) / 100)) * (FLAME_BOTTOM - FLAME_TOP);
  const fill = STATE_RGB[state] || STATE_RGB.ok;
  const track = dark ? [255, 255, 255, 0.42] : [0, 0, 0, 0.36];
  const SS = 4;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = 512 + (px + (sx + 0.5) / SS - size / 2) / scale;
          const y = FLAME_TOP + (py + (sy + 0.5) / SS - size * 0.02) / scale;
          if (!insideFlame(x, y)) continue;
          const [cr, cg, cb, ca] = y >= level ? [...fill, 1] : track;
          r += cr * ca; g += cg * ca; b += cb * ca; a += ca;
        }
      }
      const n = SS * SS, o = (py * size + px) * 4;
      buf[o] = b / n; buf[o + 1] = g / n; buf[o + 2] = r / n; buf[o + 3] = (255 * a) / n;
    }
  }
  return buf;
}

function trayImage(pct, state, dark) {
  const img = nativeImage.createEmpty();
  for (const scale of [1, 1.25, 1.5, 2]) {
    const size = Math.round(16 * scale);
    img.addRepresentation({ scaleFactor: scale, width: size, height: size, buffer: flameBitmap(size, pct, state, dark) });
  }
  return img;
}

const planName = () => (config.plan ? `Claude ${config.plan}` : 'Claude');
const fmtPct = (v) => `${v < 10 ? v.toFixed(1).replace('.', ',') : Math.round(v)} %`;

function tooltipText() {
  if (!week) return 'Suivi tokens : lecture des journaux…';
  const reset = new Date(week.end * 1000).toLocaleString('fr-FR', { weekday: 'short', hour: 'numeric' });
  if (week.pct == null) return `${planName()} : à calibrer (clic)\nRéinitialisation ${week.anchorKnown ? reset : 'à renseigner'}`;
  const lines = [`${planName()} : ≈ ${fmtPct(week.pct)} de la semaine`];
  lines.push(week.exhaustAt
    ? `À court ≈ ${new Date(week.exhaustAt * 1000).toLocaleString('fr-FR', { weekday: 'short', hour: 'numeric' })}`
    : `Fin de semaine prévue ≈ ${fmtPct(week.projEndPct)}`);
  lines.push(`Réinitialisation ${reset}`);
  return lines.join('\n');
}

function updateTray() {
  if (!tray) return;
  tray.setImage(trayImage(week && week.pct, week ? week.state : 'uncalibrated', nativeTheme.shouldUseDarkColors));
  tray.setToolTip(tooltipText().slice(0, 127));
}

// ---------- Fenêtres ----------

const webPreferences = {
  preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, spellcheck: false,
};

function createPopup() {
  popup = new BrowserWindow({
    width: POPUP_WIDTH, height: 560, show: false, frame: false, resizable: false,
    maximizable: false, minimizable: false, fullscreenable: false, skipTaskbar: true, alwaysOnTop: true,
    backgroundMaterial: 'acrylic', backgroundColor: '#00000000', icon: APP_ICON, webPreferences,
  });
  popup.loadFile(path.join(__dirname, 'ui', 'popup.html'));
  popup.on('blur', () => { popup.hide(); lastPopupHide = Date.now(); });
}

function placePopup() {
  const tb = tray.getBounds();
  const area = screen.getDisplayNearestPoint({ x: tb.x, y: tb.y }).workArea;
  const [w, h] = popup.getSize();
  const x = area.x + area.width - w - 12;
  const bottom = tb.y > area.y + area.height / 2 || tb.height === 0;
  const y = bottom ? area.y + area.height - h - 12 : area.y + 12;
  popup.setPosition(Math.round(x), Math.round(y));
}

function togglePopup() {
  if (popup.isVisible()) { popup.hide(); return; }
  if (Date.now() - lastPopupHide < 300) return; // le clic sur l'icône vient de fermer l'aperçu
  placePopup();
  popup.show();
  popup.focus();
  if (Date.now() - lastScanAt > 30000) scan();
}

function openDashboard() {
  if (dash && !dash.isDestroyed()) { dash.show(); dash.focus(); return; }
  const dark = nativeTheme.shouldUseDarkColors;
  dash = new BrowserWindow({
    width: 1240, height: 880, minWidth: 760, minHeight: 560, show: false, title: 'Suivi tokens',
    icon: APP_ICON, backgroundMaterial: 'acrylic', backgroundColor: '#00000000',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#00000000', symbolColor: dark ? '#ffffff' : '#1d1d1f', height: 44 },
    webPreferences,
  });
  dash.setMenu(null);
  dash.loadFile(path.join(__dirname, 'ui', 'dashboard.html'));
  dash.once('ready-to-show', () => dash.show());
}

// ---------- Démarrage avec Windows ----------

// Electron met lui-même les arguments entre guillemets dans la clé Run.
function loginItem() {
  const args = app.isPackaged ? ['--hidden'] : [app.getAppPath(), '--hidden'];
  return { path: process.execPath, args, name: 'Suivi tokens' };
}

function getAutostart() {
  return app.getLoginItemSettings(loginItem()).openAtLogin;
}

/** Le choix est gardé dans la config et réappliqué à chaque lancement (chemin toujours à jour). */
function setAutostart(on) {
  app.setLoginItemSettings({ ...loginItem(), openAtLogin: on });
  config.autostart = on;
  saveConfig();
  updateMenu();
  broadcast();
}

function updateMenu() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Aperçu', click: togglePopup },
    { label: 'Tableau de bord', click: openDashboard },
    { label: 'Actualiser', click: scan },
    { type: 'separator' },
    { label: 'Lancer au démarrage de Windows', type: 'checkbox', checked: getAutostart(), click: (i) => setAutostart(i.checked) },
    { type: 'separator' },
    { label: 'Quitter', click: () => app.quit() },
  ]));
}

// ---------- Aucune sortie réseau ----------

/** Les pages ne chargent que des fichiers locaux ; toute autre requête est annulée. */
function lockDownNetwork() {
  app.on('web-contents-created', (_e, wc) => {
    wc.setWindowOpenHandler(() => ({ action: 'deny' }));
    wc.on('will-navigate', (e) => e.preventDefault());
  });
  session.defaultSession.webRequest.onBeforeRequest((details, cb) => {
    cb({ cancel: !/^(file|devtools|data|blob):/i.test(details.url) });
  });
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
}
app.commandLine.appendSwitch('disable-background-networking');
app.commandLine.appendSwitch('disable-component-update');

// ---------- Échanges avec les fenêtres ----------

ipcMain.handle('state', () => snapshot());
ipcMain.on('refresh', () => scan());
ipcMain.on('open-dashboard', () => { if (popup) popup.hide(); openDashboard(); });
ipcMain.on('hide-popup', () => popup && popup.hide());
ipcMain.on('set-autostart', (_e, on) => setAutostart(!!on));
ipcMain.on('quit', () => app.quit());
ipcMain.on('popup-height', (_e, h) => {
  if (!popup || !Number.isFinite(h)) return;
  popup.setSize(POPUP_WIDTH, Math.max(200, Math.min(900, Math.ceil(h))));
  if (popup.isVisible()) placePopup();
});

ipcMain.on('calibrate', (_e, pct) => {
  pct = Number(pct);
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) return;
  const now = Math.floor(Date.now() / 1000);
  const [windowStart] = Week.windowAt(Week.anchorOf(config, now), now);
  config.calibrations.push({ at: now, pct, windowStart, source: 'manuel' });
  saveConfig();
  scan(); // le crédit sera figé avec les journaux à jour
});

ipcMain.on('delete-calibration', (_e, at) => {
  config.calibrations = config.calibrations.filter((c) => c.at !== at);
  saveConfig();
  recompute();
});

ipcMain.on('set-reset', (_e, ms) => {
  const t = Math.round(Number(ms) / 1000);
  if (!Number.isFinite(t)) return;
  config.resetAnchor = t;
  config.anchorLearnedAt = Math.floor(Date.now() / 1000);
  saveConfig();
  recompute();
});

ipcMain.on('set-plan', (_e, plan) => {
  config.plan = String(plan || '').slice(0, 30);
  saveConfig();
  recompute();
});

function takeSnapshots() {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const shoot = async (win, name) => {
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(SNAPSHOT_DIR, name), img.toPNG());
  };
  (async () => {
    while (!data) await wait(500);
    for (const dark of [true, false]) {
      const png = trayImage(week.pct, week.state, dark).toPNG({ scaleFactor: 2 });
      fs.writeFileSync(path.join(SNAPSHOT_DIR, `icone-${dark ? 'sombre' : 'clair'}.png`), png);
    }
    openDashboard();
    placePopup();
    popup.showInactive();
    await wait(2500);
    await shoot(popup, 'apercu.png');
    await shoot(dash, 'tableau-de-bord.png');
    dash.webContents.executeJavaScript('document.querySelector("main").scrollTop = 99999');
    await wait(600);
    await shoot(dash, 'tableau-de-bord-bas.png');
    app.exit(0);
  })();
}

// ---------- Cycle de vie ----------

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => openDashboard());
  app.on('window-all-closed', () => { /* l'app reste dans la zone de notification */ });
  app.setAppUserModelId('Suivi tokens');

  app.whenReady().then(() => {
    lockDownNetwork();
    loadConfig();
    if (!SNAPSHOT_DIR) setAutostart(config.autostart);
    tray = new Tray(trayImage(null, 'uncalibrated', nativeTheme.shouldUseDarkColors));
    tray.on('click', togglePopup);
    tray.on('double-click', openDashboard);
    updateMenu();
    updateTray();
    createPopup();
    startWorker();
    scan();
    if (SNAPSHOT_DIR) takeSnapshots();
    else if (!STARTED_HIDDEN) openDashboard();

    setInterval(scan, SCAN_EVERY_MS);
    setInterval(recompute, 60 * 1000); // le temps avance même sans nouvelle consommation
    powerMonitor.on('resume', scan);
    nativeTheme.on('updated', () => {
      updateTray();
      if (dash && !dash.isDestroyed()) {
        dash.setTitleBarOverlay({ color: '#00000000', symbolColor: nativeTheme.shouldUseDarkColors ? '#ffffff' : '#1d1d1f' });
      }
    });
  });
}
