'use strict';
// Lecture des journaux Claude Code (<dossier Claude>/projects/**/*.jsonl), dans un fil séparé.
// Seuls les fichiers modifiés sont relus, et un fichier qui grandit n'est relu qu'à partir
// de la fin déjà traitée.

const { parentPort, workerData } = require('worker_threads');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Emplacements possibles des journaux, dans l'ordre : dossier configuré, ~/.claude, ~/.config/claude.
const PROJECT_DIRS = [...new Set([
  path.join(workerData.claudeDir || path.join(os.homedir(), '.claude'), 'projects'),
  path.join(os.homedir(), '.claude', 'projects'),
  path.join(os.homedir(), '.config', 'claude', 'projects'),
])];
const CACHE_FILE = workerData.cacheFile;
const CACHE_VERSION = 1;

// Tarifs API Anthropic en $ par million de tokens (relevés au 2026-10-06) :
// [entrée, sortie, lecture cache]. Écriture cache : 1,25 x l'entrée (5 min), 2 x (1 h).
const PRICES_DATE = '2026-10-06';
const PRICES = {
  'claude-fable-5-1': [10, 50, 0.25],
  'claude-mythos-5-1': [10, 50, 0.25],
  'claude-fable-5': [10, 50, 1],
  'claude-mythos-5': [10, 50, 1],
  'claude-opus-5-5': [4, 20, 0.2],
  'claude-opus-5': [5, 25, 0.5],
  'claude-opus-4-8': [5, 25, 0.5],
  'claude-opus-4-7': [5, 25, 0.5],
  'claude-opus-4-6': [5, 25, 0.5],
  'claude-sonnet-5-5': [2, 10, 0.2],
  'claude-sonnet-5': [2, 10, 0.2],
  'claude-sonnet-4-6': [3, 15, 0.3],
  'claude-haiku-5-5': [0.1, 0.5, 0.01],
  'claude-haiku-4-5': [1, 5, 0.1],
};
// Haiku 5.5 change de grille au-delà de 100 000 tokens de prompt.
const HAIKU_55_LONG = [0.5, 2.5, 0.05];

/** [coût équivalent API, crédit] en $, ou null si le modèle n'a pas de tarif connu.
 *  Le crédit exclut la lecture du cache : c'est la mesure qui suit la limite d'abonnement. */
function costs(model, i, o, cw, cr, cw1h, fast) {
  let p = PRICES[model.replace(/-\d{8}$/, '')];
  if (!p) return null;
  if (model.startsWith('claude-haiku-5-5') && i + cw + cr > 100000) p = HAIKU_55_LONG;
  const [inp, out, read] = p;
  const m = (fast ? 2 : 1) / 1e6; // mode rapide : tarif doublé
  const credit = (i * inp + o * out + (cw - cw1h) * inp * 1.25 + cw1h * inp * 2) * m;
  return [credit + cr * read * m, credit];
}

// Une réponse de l'API est écrite sur plusieurs lignes (une par bloc de contenu),
// toutes avec le même message.id et le même usage : on dédoublonne par id.
const RE_HEAD = /"message":\{"model":"([^"]+)","id":"([^"]+)"/;
const RE_TITLE = /"(?:customTitle|aiTitle)":"((?:[^"\\]|\\.)*)"/;

/** Dernière occurrence de "key":"..." : les clés de premier niveau suivent le contenu. */
function lastStr(line, key) {
  const i = line.lastIndexOf(`"${key}":"`);
  if (i < 0) return null;
  const start = i + key.length + 4;
  const end = line.indexOf('"', start);
  return end > 0 ? line.slice(start, end) : null;
}

function jsonStr(raw) {
  try { return JSON.parse(`"${raw}"`); } catch { return raw; }
}

/** Objet JSON qui commence à s[start] (accolades équilibrées, chaînes respectées). */
function objectAt(s, start) {
  let depth = 0, inStr = false;
  for (let k = start; k < s.length; k++) {
    const c = s.charCodeAt(k);
    if (inStr) {
      if (c === 92) k++;
      else if (c === 34) inStr = false;
    } else if (c === 34) inStr = true;
    else if (c === 123) depth++;
    else if (c === 125 && --depth === 0) return s.slice(start, k + 1);
  }
  return null;
}

/** [msg_id, [ts, modèle, session, entrée, sortie, écr_cache, lect_cache, écr_cache_1h, rapide]] */
function parseLine(line) {
  if (!line.includes('"usage"') || !line.includes('"assistant"')) return null;
  let model, mid, usage, ts, session;
  const head = RE_HEAD.exec(line.slice(0, 600));
  if (head) {
    [, model, mid] = head;
    const u = line.lastIndexOf('"usage":{');
    if (u < 0) return null;
    try { usage = JSON.parse(objectAt(line, u + 8)); } catch { return null; }
    ts = lastStr(line, 'timestamp');
    session = lastStr(line, 'sessionId');
  } else {
    // Format inattendu : lecture complète, plus lente mais sûre.
    let d;
    try { d = JSON.parse(line); } catch { return null; }
    const msg = d.message;
    if (d.type !== 'assistant' || !msg || typeof msg !== 'object') return null;
    model = msg.model; mid = msg.id || d.requestId; usage = msg.usage;
    ts = d.timestamp; session = d.sessionId;
  }
  if (!model || model.startsWith('<') || !mid || !usage || typeof usage !== 'object') return null;
  const t = Math.floor(Date.parse(ts) / 1000);
  if (!Number.isFinite(t)) return null;
  const n = (v) => Number(v) || 0;
  return [mid, [
    t, model, session || '',
    n(usage.input_tokens), n(usage.output_tokens),
    n(usage.cache_creation_input_tokens), n(usage.cache_read_input_tokens),
    n(usage.cache_creation && usage.cache_creation.ephemeral_1h_input_tokens),
    usage.speed === 'fast' ? 1 : 0,
  ]];
}

/** Lit les lignes complètes de [offset, size) et renvoie la position après la dernière. */
function readLines(file, offset, size, onLine) {
  const fd = fs.openSync(file, 'r');
  const CHUNK = 8 << 20;
  let pos = offset, carry = null;
  try {
    while (pos < size) {
      const len = Math.min(CHUNK, size - pos);
      let buf = Buffer.allocUnsafe(len);
      const got = fs.readSync(fd, buf, 0, len, pos);
      if (got <= 0) break;
      buf = buf.subarray(0, got);
      pos += got;
      if (carry) { buf = Buffer.concat([carry, buf]); carry = null; }
      const last = buf.lastIndexOf(10);
      if (last < 0) { carry = buf; continue; }
      for (const line of buf.toString('utf8', 0, last).split('\n')) if (line) onLine(line);
      if (last + 1 < buf.length) carry = buf.subarray(last + 1);
    }
  } finally {
    fs.closeSync(fd);
  }
  return pos - (carry ? carry.length : 0);
}

function parseInto(file, entry, size) {
  entry.off = readLines(file, entry.off, size, (line) => {
    if (entry.cwd === null && line.includes('"cwd":"')) {
      const raw = lastStr(line, 'cwd');
      if (raw) entry.cwd = jsonStr(raw);
    }
    if (line.includes('"customTitle"') || line.includes('"aiTitle"')) {
      const m = RE_TITLE.exec(line);
      const sid = lastStr(line, 'sessionId');
      if (m && sid) entry.titles[sid] = jsonStr(m[1]);
      return;
    }
    const r = parseLine(line);
    if (!r) return;
    const [mid, rec] = r;
    const old = entry.msgs[mid];
    if (!old) entry.msgs[mid] = rec;
    else for (let k = 3; k < 9; k++) if (rec[k] > old[k]) old[k] = rec[k]; // lignes partielles : maxima
  });
}

/** Les sous-agents sont dans <session>/subagents/ : on les rattache à la session mère. */
function fileSession(file) {
  const dir = path.dirname(file);
  return path.basename(dir) === 'subagents' ? path.basename(path.dirname(dir)) : path.basename(file, '.jsonl');
}

/** Nom lisible du dossier de départ de la session (deux derniers niveaux). */
function projectName(cwd, file) {
  if (cwd) {
    let parts = cwd.split(/[\\/]/).filter(Boolean);
    const ci = parts.indexOf('.claude');
    if (ci >= 0 && parts.includes('worktrees')) parts = parts.slice(0, ci); // worktree -> projet d'origine
    if (parts.includes('scratch-workspaces') || parts.includes('Temp')) return '(brouillons)';
    const di = parts.indexOf('Desktop');
    if (di >= 0) parts = parts.slice(di);
    if (parts.length) return parts.slice(-2).join(' / ');
  }
  const root = PROJECT_DIRS.find((d) => file.startsWith(d + path.sep));
  return root ? path.relative(root, file).split(path.sep)[0] : path.basename(path.dirname(file));
}

function loadCache() {
  try {
    const d = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    if (d.version === CACHE_VERSION) return d.files;
  } catch { /* cache absent ou illisible : on repart de zéro */ }
  return {};
}

function saveCache(files) {
  const tmp = CACHE_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify({ version: CACHE_VERSION, files }));
  fs.renameSync(tmp, CACHE_FILE);
}

let cache = null;

function scan() {
  const t0 = Date.now();
  if (!cache) cache = loadCache();
  const files = {};
  let reparsed = 0;
  const list = [];
  for (const dir of PROJECT_DIRS) {
    try {
      for (const f of fs.readdirSync(dir, { recursive: true })) if (f.endsWith('.jsonl')) list.push(path.join(dir, f));
    } catch { /* dossier absent */ }
  }
  for (const file of list) {
    let st;
    try { st = fs.statSync(file); } catch { continue; }
    let e = cache[file];
    if (!e || e.mtime !== st.mtimeMs || e.size !== st.size) {
      if (!e || st.size < e.size) e = { off: 0, msgs: {}, titles: {}, cwd: null };
      try { parseInto(file, e, st.size); } catch { continue; }
      e.mtime = st.mtimeMs;
      e.size = st.size;
      reparsed++;
    }
    files[file] = e;
  }
  // Journaux effacés depuis (Claude Code les supprime au bout de 30 jours par défaut) :
  // on garde ce qu'on en avait lu, pour que l'historique ne fonde pas.
  let archived = 0;
  for (const [file, e] of Object.entries(cache)) {
    if (!files[file] && Object.keys(e.msgs).length) {
      files[file] = e;
      archived++;
    }
  }
  if (reparsed || Object.keys(files).length !== Object.keys(cache).length) saveCache(files);
  cache = files;

  const sessionProj = {};
  for (const [file, e] of Object.entries(files)) {
    if (e.cwd && path.basename(path.dirname(file)) !== 'subagents') {
      sessionProj[path.basename(file, '.jsonl')] = projectName(e.cwd, file);
    }
  }
  // Dédoublonnage global : une session reprise ou dupliquée recopie l'historique.
  const seen = new Map();
  const titles = {};
  for (const [file, e] of Object.entries(files)) {
    Object.assign(titles, e.titles);
    const proj = sessionProj[fileSession(file)] || projectName(e.cwd, file);
    for (const [mid, rec] of Object.entries(e.msgs)) if (!seen.has(mid)) seen.set(mid, [proj, rec]);
  }

  const models = new Map(), projects = new Map(), sessions = new Map();
  const idx = (m, k) => { if (!m.has(k)) m.set(k, m.size); return m.get(k); };
  const hours = new Map(), sess = new Map(), unpriced = new Set();
  for (const [proj, [t, model, sid, i, o, cw, cr, cw1h, fast]] of seen.values()) {
    const mi = idx(models, model), pi = idx(projects, proj), si = idx(sessions, sid);
    let c = costs(model, i, o, cw, cr, cw1h, fast);
    if (!c) { unpriced.add(model); c = [0, 0]; }
    const vals = [1, i, o, cw, cr, c[0], c[1]];
    const h = t - (t % 3600);
    const hk = `${h}|${mi}|${pi}`, sk = `${si}|${h}|${mi}|${pi}`;
    let row = hours.get(hk);
    if (!row) hours.set(hk, (row = [h, mi, pi, 0, 0, 0, 0, 0, 0, 0]));
    let srow = sess.get(sk);
    if (!srow) sess.set(sk, (srow = [si, h, mi, pi, 0, 0, 0, 0, 0, 0, 0]));
    for (let k = 0; k < 7; k++) { row[3 + k] += vals[k]; srow[4 + k] += vals[k]; }
  }
  const round = (row, from) => { for (let k = from; k < row.length; k++) row[k] = Math.round(row[k] * 1e4) / 1e4; return row; };

  return {
    generated: Math.floor(Date.now() / 1000),
    scanSeconds: Math.round((Date.now() - t0) / 100) / 10,
    filesReparsed: reparsed,
    filesTotal: list.length,
    filesArchived: archived,
    messages: seen.size,
    pricesDate: PRICES_DATE,
    unpricedModels: [...unpriced].sort(),
    models: [...models.keys()],
    projects: [...projects.keys()],
    sessions: [...sessions.keys()].map((s) => [s, titles[s] || '']),
    // [heure_utc, modèle, projet, nb, entrée, sortie, écr_cache, lect_cache, coût_$, crédit_$]
    hours: [...hours.values()].map((r) => round(r, 8)),
    // [session, heure_utc, modèle, projet, nb, entrée, sortie, écr_cache, lect_cache, coût_$, crédit_$]
    sessionHours: [...sess.values()].map((r) => round(r, 9)),
  };
}

parentPort.on('message', () => {
  try {
    parentPort.postMessage({ ok: true, data: scan() });
  } catch (err) {
    parentPort.postMessage({ ok: false, error: String((err && err.stack) || err) });
  }
});
