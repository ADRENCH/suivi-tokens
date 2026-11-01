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
// % de la semaine arrondi à l'unité, comme Claude l'affiche.
const fmtWeekPct = (v) => (v == null ? '?' : `${Math.round(v)} %`);
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
  const pace = `${fmtPct(w.perDayPct)} par jour en moyenne depuis ${dateFr(w.start, { weekday: 'long' })}`;
  const early = w.elapsedH < 12 ? ' Semaine tout juste commencée : estimation encore fragile.' : '';
  if (w.exhaustAt) {
    const before = inRel(w.end - w.exhaustAt).replace('dans ', '');
    return `À ce rythme (${pace}), crédits épuisés vers <b>${whenShort(w.exhaustAt)}</b>, ${before} avant la réinitialisation.${early}`;
  }
  return `À ce rythme (${pace}), tu finiras la semaine vers <b>${fmtPct(w.projEndPct)}</b>.${early}`;
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

/** Consommation cumulée de la semaine, en % de la limite : réel jusqu'à maintenant,
 *  puis prolongement au rythme moyen depuis la réinitialisation. */
function drawWeekChart(box, w, { height = 140, axis = true } = {}) {
  const N = 168;
  const scale = w.limit ? 100 / w.limit.value : 1;
  const unit = w.limit ? (v) => fmtPct(v) : (v) => fmtUsd(v);
  const now = w.elapsedH;
  // Points réels : fin de chaque heure écoulée, le dernier à l'instant présent.
  const pts = w.actualCum.map((v, i) => [i === w.nowK ? now : i + 1, v * scale]);
  pts.unshift([0, 0]);
  const used = w.used * scale, projEnd = w.projEnd * scale;
  const at = (k) => (k <= now ? null : used + (projEnd - used) * ((k - now) / (N - now)));
  const top = Math.max(used, Math.min(projEnd, w.limit ? 200 : projEnd));
  const yMax = w.limit ? Math.max(100, Math.ceil(top / 25) * 25) : Math.ceil((top * 1.08 || 1) / niceStep(top / 3)) * niceStep(top / 3);
  const step = niceStep(yMax / 4);

  const W = Math.max(box.clientWidth, 200), Hh = height;
  const padL = axis ? 40 : 6, padR = 8, padT = 8, padB = 20;
  const iw = W - padL - padR, ih = Hh - padT - padB;
  const x = (k) => padL + (k / N) * iw;
  const y = (v) => padT + ih - (v / yMax) * ih;
  const state = w.state === 'uncalibrated' ? 'ok' : w.state;
  const clip = `wclip${Math.random().toString(36).slice(2, 8)}`;

  let s = `<svg viewBox="0 0 ${W} ${Hh}" width="100%" height="${Hh}" role="img" aria-label="Consommation cumulée de la semaine">`;
  s += `<defs><linearGradient id="wfill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="var(--accent)" stop-opacity=".28"/><stop offset="1" stop-color="var(--accent)" stop-opacity="0"/></linearGradient>`;
  s += `<clipPath id="${clip}"><rect x="${padL}" y="${padT}" width="${iw}" height="${ih}"/></clipPath></defs>`;
  if (axis) {
    for (let v = 0; v <= yMax + 1e-9; v += step) {
      s += `<line x1="${padL}" x2="${W - padR}" y1="${y(v)}" y2="${y(v)}" stroke="var(--grid)"/>`;
      s += `<text x="${padL - 6}" y="${y(v) + 3.5}" text-anchor="end">${unit(v)}</text>`;
    }
  }
  for (let d = 0; d < 7; d++) {
    if (d) s += `<line x1="${x(d * 24)}" x2="${x(d * 24)}" y1="${padT}" y2="${padT + ih}" stroke="var(--grid)"/>`;
    const lab = dateFr(w.start + (d * 24 + 12) * 3600, { weekday: 'short' }).replace('.', '');
    const today = d === Math.floor(now / 24);
    s += `<text x="${x(d * 24 + 12)}" y="${Hh - 5}" text-anchor="middle" ${today ? 'style="fill:var(--text);font-weight:600"' : ''}>${lab}</text>`;
  }
  if (w.limit) {
    s += `<line x1="${padL}" x2="${W - padR}" y1="${y(100)}" y2="${y(100)}" stroke="var(--state-out)" stroke-opacity=".55" stroke-dasharray="3 3"/>`;
    const ly = y(100) < padT + 12 ? y(100) + 13 : y(100) - 4;
    s += `<text x="${W - padR}" y="${ly}" text-anchor="end" style="fill:var(--state-out);opacity:.8">limite</text>`;
  }
  const line = pts.map(([k, v], i) => `${i ? 'L' : 'M'}${x(k).toFixed(1)},${y(v).toFixed(1)}`).join('');
  s += `<g clip-path="url(#${clip})">`;
  s += `<path d="${line}L${x(now)},${y(0)}Z" fill="url(#wfill)"/>`;
  s += `<path d="M${x(now)},${y(used)}L${x(N)},${y(projEnd)}" stroke="var(--state-${state})" stroke-width="2" stroke-dasharray="4 4" fill="none"/>`;
  s += `<path d="${line}" fill="none" stroke="var(--accent)" stroke-width="2.4" stroke-linejoin="round"/>`;
  s += `</g>`;
  s += `<circle cx="${x(now)}" cy="${y(Math.min(used, yMax))}" r="4" fill="var(--accent)" stroke="var(--glass-strong)" stroke-width="2"/>`;
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
    const k = Math.max(0, Math.min(N, ((e.clientX - r.left - padL) / iw) * N));
    let row;
    if (k <= now) {
      const p = pts.find(([pk]) => pk >= k) || pts[pts.length - 1];
      row = ['var(--accent)', 'Réel', p[1]];
    } else row = [`var(--state-${state})`, 'Prévu', at(k)];
    tip.innerHTML = `<b>${dateFr(w.start + Math.round(k) * 3600, { weekday: 'long', hour: 'numeric' })}</b>` +
      `<div class="row"><span><i class="dot" style="background:${row[0]}"></i>${row[1]}</span><span>${unit(row[2])}</span></div>`;
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
