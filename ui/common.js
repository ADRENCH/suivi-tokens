'use strict';
// Formats, anneau et graphique de la semaine, communs à l'aperçu et au tableau de bord.

const $ = (s, el = document) => el.querySelector(s);
const fmtN = new Intl.NumberFormat('fr-FR');
const fmtC = new Intl.NumberFormat('fr-FR', { notation: 'compact', maximumFractionDigits: 1 });
const fmt = (v) => (Math.abs(v) < 10000 ? fmtN.format(Math.round(v)) : fmtC.format(v));
const usd = (o) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'USD', currencyDisplay: 'narrowSymbol', ...o });
const usdSmall = usd({ maximumFractionDigits: 2 });
const usdMid = usd({ maximumFractionDigits: 0 });
const usdBig = usd({ notation: 'compact', maximumFractionDigits: 1 });
const fmtUsd = (v) => (v < 100 ? usdSmall : v < 10000 ? usdMid : usdBig).format(v);
const fmtPct = (v) => (v == null ? '—' : `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: v < 10 ? 1 : 0 }).format(v)} %`);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function modelLabel(id) {
  const m = id.replace(/^claude-/, '').replace(/-\d{8}$/, '').match(/^([a-z]+)-(\d+)(?:-(\d+))?/);
  if (!m) return id;
  return m[1][0].toUpperCase() + m[1].slice(1) + ' ' + m[2] + (m[3] ? '.' + m[3] : '');
}

const dateFr = (t, o) => new Date(t * 1000).toLocaleString('fr-FR', o);
const whenShort = (t) => dateFr(t, { weekday: 'short', hour: 'numeric' });

function inRel(sec) {
  if (sec <= 0) return 'maintenant';
  const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60);
  if (d) return `dans ${d} j ${h} h`;
  if (h) return `dans ${h} h ${String(m).padStart(2, '0')}`;
  return `dans ${m} min`;
}

const STATE_LABEL = {
  ok: 'Dans les clous', warn: 'À court avant la réinitialisation', out: 'Limite atteinte', uncalibrated: 'À calibrer',
};

/** Phrase de projection à partir du résultat de Week.compute. */
function projectionText(w) {
  if (!w.anchorKnown) return 'Indique dans les réglages la date de réinitialisation affichée par Claude (Réglages › Utilisation), puis le % utilisé.';
  if (w.state === 'uncalibrated') return 'Tape le % affiché dans Claude (Réglages › Utilisation) pour estimer ta limite.';
  if (w.state === 'out') return 'Limite hebdomadaire atteinte selon l’estimation. Recale avec le % de Claude si besoin.';
  const basis = w.weeksInProfile ? `d’après tes ${w.weeksInProfile} dernières semaines` : 'au rythme de cette semaine';
  if (w.exhaustAt) {
    const early = w.end - w.exhaustAt;
    return `À ton rythme habituel, crédits épuisés vers <b>${whenShort(w.exhaustAt)}</b>, ${inRel(early).replace('dans ', '')} avant la réinitialisation (${basis}).`;
  }
  return `À ton rythme habituel, tu finiras la semaine vers <b>${fmtPct(w.projEndPct)}</b> (${basis}).`;
}

/** Anneau : part utilisée, avec un repère pour le temps écoulé dans la semaine. */
function ringSVG(pct, state, elapsed, size = 150, sw = 13) {
  const c = size / 2, r = (size - sw) / 2, C = 2 * Math.PI * r;
  const f = pct == null ? 0 : Math.max(0, Math.min(1, pct / 100));
  const a = elapsed * 2 * Math.PI - Math.PI / 2;
  const mx = c + r * Math.cos(a), my = c + r * Math.sin(a);
  return `<svg class="ring" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" aria-hidden="true">
    <circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="var(--track)" stroke-width="${sw}"/>
    ${f > 0 ? `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="var(--state-${state})" stroke-width="${sw}"
      stroke-linecap="round" stroke-dasharray="${Math.max(0.01, C * f)} ${C}" transform="rotate(-90 ${c} ${c})"/>` : ''}
    <circle cx="${mx}" cy="${my}" r="${sw / 2 - 3}" fill="var(--text)" opacity=".55"><title>Temps écoulé dans la semaine</title></circle>
  </svg>`;
}

function niceStep(v) {
  const p = Math.pow(10, Math.floor(Math.log10(v || 1)));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}

/** Courbe cumulée de la semaine : réel, prévision et semaine type, en % de la limite. */
function drawWeekChart(box, w, { height = 140, axis = true } = {}) {
  const N = 168;
  const scale = w.limit ? 100 / w.limit.value : 1;
  const unit = w.limit ? (v) => fmtPct(v) : (v) => fmtUsd(v);
  const actual = w.actualCum.map((v) => v * scale);
  const proj = w.proj.map((v) => (v == null ? null : v * scale));
  const typical = w.typicalCum.map((v) => v * scale);
  const top = Math.max(w.limit ? 100 : 0, ...actual, ...proj.filter((v) => v != null), ...typical) * 1.08 || 1;
  const step = niceStep(top / 3);
  const yMax = Math.ceil(top / step) * step;

  const W = Math.max(box.clientWidth, 200), Hh = height;
  const padL = axis ? 40 : 6, padR = 8, padT = 8, padB = 20;
  const iw = W - padL - padR, ih = Hh - padT - padB;
  const x = (k) => padL + (k / N) * iw;
  const y = (v) => padT + ih - (Math.min(v, yMax) / yMax) * ih;
  const line = (arr, from = 0) => arr.map((v, i) => (v == null ? '' : `${i === from || arr[i - 1] == null ? 'M' : 'L'}${x(i + 1).toFixed(1)},${y(v).toFixed(1)}`)).join('');

  let s = `<svg viewBox="0 0 ${W} ${Hh}" width="100%" height="${Hh}" role="img" aria-label="Consommation cumulée de la semaine">`;
  s += `<defs><linearGradient id="wfill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="var(--accent)" stop-opacity=".28"/><stop offset="1" stop-color="var(--accent)" stop-opacity="0"/></linearGradient></defs>`;
  if (axis) {
    for (let v = 0; v <= yMax + 1e-9; v += step) {
      s += `<line x1="${padL}" x2="${W - padR}" y1="${y(v)}" y2="${y(v)}" stroke="var(--grid)"/>`;
      s += `<text x="${padL - 6}" y="${y(v) + 3.5}" text-anchor="end">${unit(v)}</text>`;
    }
  }
  for (let d = 0; d < 7; d++) {
    if (d) s += `<line x1="${x(d * 24)}" x2="${x(d * 24)}" y1="${padT}" y2="${padT + ih}" stroke="var(--grid)"/>`;
    const lab = dateFr(w.start + (d * 24 + 12) * 3600, { weekday: 'short' }).replace('.', '');
    const today = d === Math.floor(w.nowK / 24);
    s += `<text x="${x(d * 24 + 12)}" y="${Hh - 5}" text-anchor="middle" ${today ? 'style="fill:var(--text);font-weight:600"' : ''}>${lab}</text>`;
  }
  if (w.limit) {
    s += `<line x1="${padL}" x2="${W - padR}" y1="${y(100)}" y2="${y(100)}" stroke="var(--state-out)" stroke-opacity=".55" stroke-dasharray="3 3"/>`;
    s += `<text x="${W - padR}" y="${y(100) - 4}" text-anchor="end" style="fill:var(--state-out);opacity:.8">limite</text>`;
  }
  s += `<path d="${line(typical)}" fill="none" stroke="var(--text-3)" stroke-width="1.5" stroke-opacity=".7"/>`;
  const last = actual.length;
  if (last) {
    s += `<path d="${line(actual)}L${x(last)},${y(0)}L${x(1)},${y(0)}Z" fill="url(#wfill)" stroke="none"/>`;
  }
  s += `<path d="${line(proj, w.nowK)}" fill="none" stroke="var(--state-${w.state === 'uncalibrated' ? 'ok' : w.state})" stroke-width="2" stroke-dasharray="4 4"/>`;
  s += `<path d="${line(actual)}" fill="none" stroke="var(--accent)" stroke-width="2.4" stroke-linejoin="round"/>`;
  if (last) s += `<circle cx="${x(last)}" cy="${y(actual[last - 1])}" r="4" fill="var(--accent)" stroke="var(--glass-strong)" stroke-width="2"/>`;
  if (w.exhaustAt) {
    const kx = x((w.exhaustAt - w.start) / 3600);
    s += `<line x1="${kx}" x2="${kx}" y1="${padT}" y2="${padT + ih}" stroke="var(--state-warn)" stroke-dasharray="2 3"/>`;
  }
  s += `<rect class="hit" x="${padL}" y="${padT}" width="${iw}" height="${ih}" fill="transparent"/>`;
  s += `</svg><div class="tip"></div>`;
  box.innerHTML = s;
  box.style.position = 'relative';

  const tip = $('.tip', box);
  const hit = $('.hit', box);
  hit.addEventListener('mousemove', (e) => {
    const r = box.getBoundingClientRect();
    const k = Math.max(0, Math.min(N - 1, Math.round(((e.clientX - r.left - padL) / iw) * N) - 1));
    const rows = [];
    if (k < actual.length) rows.push(['var(--accent)', 'Réel', actual[k]]);
    if (proj[k] != null && k >= w.nowK) rows.push([`var(--state-${w.state === 'uncalibrated' ? 'ok' : w.state})`, 'Prévu', proj[k]]);
    rows.push(['var(--text-3)', 'Semaine type', typical[k]]);
    tip.innerHTML = `<b>${dateFr(w.start + (k + 1) * 3600, { weekday: 'long', hour: 'numeric' })}</b>` +
      rows.map(([c, l, v]) => `<div class="row"><span><i class="dot" style="background:${c}"></i>${l}</span><span>${unit(v)}</span></div>`).join('');
    tip.style.display = 'block';
    let left = e.clientX - r.left + 12;
    if (left + tip.offsetWidth > r.width) left = e.clientX - r.left - tip.offsetWidth - 12;
    tip.style.left = `${left}px`;
    tip.style.top = `${Math.max(0, e.clientY - r.top - tip.offsetHeight - 8)}px`;
  });
  hit.addEventListener('mouseleave', () => (tip.style.display = 'none'));
}

const planName = (cfg) => (cfg.plan ? `Claude · ${cfg.plan}` : 'Claude');
const resetLabel = (w, o) => (w.anchorKnown ? dateFr(w.end, o) : 'à renseigner');

/** Crédit et tokens d'aujourd'hui (minuit local). */
function todayTotals(data) {
  const d = new Date(); d.setHours(0, 0, 0, 0);
  const t0 = d.getTime() / 1000;
  const a = { tokens: 0, cost: 0, credit: 0 };
  for (const r of data.hours) {
    if (r[0] + 3600 <= t0) continue;
    a.tokens += r[4] + r[5] + r[6] + r[7];
    a.cost += r[8];
    a.credit += r[9];
  }
  return a;
}
