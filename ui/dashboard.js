'use strict';
// Lignes agrégées : [réponses, entrée, sortie, écriture cache, lecture cache, coût $, crédit $]
const METRICS = {
  cost:   { label: 'Coût équivalent API', f: (r) => r[5], fmt: fmtUsd },
  credit: { label: "Crédit d'abonnement", f: (r) => r[6], fmt: fmtUsd },
  total:  { label: 'Tokens au total', f: (r) => r[1] + r[2] + r[3] + r[4], fmt },
  out:    { label: 'Tokens de sortie', f: (r) => r[2], fmt },
  cr:     { label: 'Lecture cache', f: (r) => r[4], fmt },
  n:      { label: 'Réponses', f: (r) => r[0], fmt },
};
const SLOTS = 7;
const ZERO = () => [0, 0, 0, 0, 0, 0, 0];
const add = (a, r, o) => { for (let k = 0; k < 7; k++) a[k] += r[o + k]; return a; };

let S = null;
let series = null; // couleurs par modèle, stables quels que soient les filtres
const state = { period: '30d', model: '', project: '', metric: 'cost' };

function periodStart(p) {
  const now = Date.now() / 1000;
  if (p === '5h') return now - 5 * 3600;
  if (p === 'today') { const d = new Date(); d.setHours(0, 0, 0, 0); return d / 1000; }
  if (p === 'all') return 0;
  return now - parseInt(p, 10) * 86400;
}

// ---------- Semaine d'abonnement ----------

function renderWeek() {
  const w = S.week;
  $('#planLabel').textContent = `${planName(S.config)} · semaine en cours`;
  if (!w) return;
  $('#ring').innerHTML = ringSVG(w.pct, w.state, w.elapsed, 150, 13);
  $('#pct').textContent = w.pct == null ? '?' : fmtPct(w.pct);
  const st = $('#state');
  st.querySelector('.dot').style.background = `var(--state-${w.state})`;
  st.querySelector('span').textContent = STATE_LABEL[w.state];
  $('#left').textContent = w.pct == null ? 'à calibrer' : `≈ ${fmtPct(Math.max(0, 100 - w.pct))}`;
  $('#reset').textContent = resetLabel(w, { weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric' });
  $('#resetIn').textContent = w.anchorKnown ? inRel(w.end - S.now) : '';
  $('#projText').innerHTML = projectionText(w);
  $('#limitNote').textContent = w.limit
    ? `Limite estimée ≈ ${fmtUsd(w.limit.value)} de crédit par semaine (${fmtUsd(w.limit.low)} à ${fmtUsd(w.limit.high)}), d'après ${w.limit.points} relevé${w.limit.points > 1 ? 's' : ''}. Utilisé : ${fmtUsd(w.used)}.`
    : `Utilisé cette semaine : ${fmtUsd(w.used)} de crédit.`;
  drawWeekChart($('#weekChart'), w, { height: 220 });

  const lim = w.limit && w.limit.value;
  const show = (v) => (lim ? fmtPct((v / lim) * 100) : fmtUsd(v));
  const max = Math.max(...w.days.map((d) => Math.max(d.actual, d.typical)), 1e-9);
  $('#days').innerHTML = w.days.map((d) => {
    const future = !d.past && !d.today;
    const lab = dateFr(d.start + 43200, { weekday: 'short' }).replace('.', '');
    return `<div class="day ${d.today ? 'today' : ''} ${future ? 'future' : ''}" title="Réel ${show(d.actual)} · habituel ${show(d.typical)}">
      <div class="bars"><div class="ghost" style="height:${(d.typical / max) * 100}%"></div><div class="fill" style="height:${(d.actual / max) * 100}%"></div></div>
      <span class="val">${future ? show(d.typical) : show(d.actual)}</span><span class="lab">${lab}</span></div>`;
  }).join('');
}

// ---------- Historique ----------

function buildSeries() {
  const tot = S.data.models.map(() => 0);
  for (const r of S.data.hours) tot[r[1]] += r[8];
  const order = tot.map((v, i) => [v, i]).sort((a, b) => b[0] - a[0]).map((x) => x[1]);
  const group = [], list = [];
  order.forEach((mi, rank) => {
    if (rank < SLOTS) { group[mi] = rank; list.push({ label: modelLabel(S.data.models[mi]), color: `var(--s${rank + 1})` }); }
    else group[mi] = SLOTS;
  });
  if (order.length > SLOTS) list.push({ label: 'Autres', color: 'var(--s-other)' });
  series = { group, list };
}

function fillSelects() {
  const keep = (sel, v) => { sel.value = [...sel.options].some((o) => o.value === v) ? v : ''; };
  const ms = $('#fModel');
  ms.innerHTML = '<option value="">Tous les modèles</option>' + S.data.models.map((m, i) => [modelLabel(m), i])
    .sort().map(([l, i]) => `<option value="${i}">${esc(l)}</option>`).join('');
  keep(ms, state.model);
  const ps = $('#fProject');
  ps.innerHTML = '<option value="">Tous les projets</option>' + S.data.projects.map((p, i) => [p, i])
    .sort((a, b) => a[0].localeCompare(b[0], 'fr')).map(([p, i]) => `<option value="${i}">${esc(p)}</option>`).join('');
  keep(ps, state.project);
}

function filtered(rows, off) {
  const t0 = periodStart(state.period);
  return rows.filter((r) => r[off] + 3600 > t0 // heure entamée : comptée en entier
    && (state.model === '' || r[off + 1] === +state.model)
    && (state.project === '' || r[off + 2] === +state.project));
}

function groupBy(rows, key) {
  const g = new Map();
  for (const r of rows) { const k = key(r); g.set(k, add(g.get(k) || ZERO(), r, 3)); }
  return g;
}

function renderHistory() {
  const rows = filtered(S.data.hours, 0);
  const m = METRICS[state.metric];
  const T = rows.reduce((a, r) => add(a, r, 3), ZERO());
  renderKpis(T);
  renderChart(rows, m);
  renderTable('#tModels', groupBy(rows, (r) => r[1]), (k) =>
    `<span class="sq" style="background:${series.list[series.group[k]].color}"></span>${esc(modelLabel(S.data.models[k]))}`, m);
  renderTable('#tProjects', groupBy(rows, (r) => r[2]), (k) => esc(S.data.projects[k]), m);
  renderSessions(m);
}

function renderKpis(T) {
  const total = T[1] + T[2] + T[3] + T[4];
  const days = Math.max(1, (Date.now() / 1000 - periodStart(state.period)) / 86400);
  const perDay = state.period === 'all' || days < 2 ? 'au tarif public, hors abonnement' : `soit ${fmtUsd(T[5] / days)} par jour`;
  const cells = [
    ['hero', 'Coût équivalent API', fmtUsd(T[5]), usdSmall.format(T[5]), perDay],
    ['hero', 'Tokens au total', fmt(total), fmtN.format(total), `${fmtN.format(T[0])} réponses`],
    ['', "Crédit d'abonnement", fmtUsd(T[6]), usdSmall.format(T[6]), 'hors lecture du cache'],
    ['', 'Sortie', fmt(T[2]), fmtN.format(T[2]), 'texte et réflexion générés'],
    ['', 'Écriture cache', fmt(T[3]), fmtN.format(T[3]), `entrée hors cache : ${fmt(T[1])}`],
    ['', 'Lecture cache', fmt(T[4]), fmtN.format(T[4]), total ? `${Math.round((T[4] / total) * 100)} % du total` : '—'],
  ];
  $('#kpis').innerHTML = cells.map(([c, l, v, exact, h]) =>
    `<div class="glass kpi ${c}"><div class="label">${l}</div><div class="value" title="${exact}">${v}</div><div class="hint">${h}</div></div>`).join('');
}

function roundTop(x, y, w, h, r) {
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

function renderChart(rows, m) {
  const box = $('#chart');
  const now = Date.now() / 1000;
  const start = state.period === 'all' ? Math.min(...rows.map((r) => r[0]), now) : periodStart(state.period);
  const hourly = now - start <= 2 * 86400;
  $('#chartTitle').textContent = `${m.label} par ${hourly ? 'heure' : 'jour'}`;

  // Seaux en heure locale, y compris les seaux vides.
  const keyOf = (t) => { const d = new Date(t * 1000); hourly ? d.setMinutes(0, 0, 0) : d.setHours(0, 0, 0, 0); return d.getTime() / 1000; };
  const buckets = [], idx = new Map();
  for (let t = keyOf(start); t <= now;) {
    idx.set(t, buckets.length);
    buckets.push({ t, v: new Array(series.list.length).fill(0) });
    const d = new Date(t * 1000);
    hourly ? d.setHours(d.getHours() + 1) : d.setDate(d.getDate() + 1);
    t = d.getTime() / 1000;
  }
  for (const r of rows) {
    const i = idx.get(keyOf(r[0]));
    if (i !== undefined) buckets[i].v[series.group[r[1]]] += m.f(r.slice(3));
  }
  const used = series.list.map((_, s) => buckets.some((b) => b.v[s] > 0));
  $('#legend').innerHTML = series.list.map((s, i) => (used[i] ? `<span><i style="background:${s.color}"></i>${esc(s.label)}</span>` : '')).join('');

  const W = Math.max(box.clientWidth, 300), H = 260, padL = 54, padR = 6, padT = 8, padB = 24;
  const iw = W - padL - padR, ih = H - padT - padB;
  const max = Math.max(1e-9, ...buckets.map((b) => b.v.reduce((a, x) => a + x, 0)));
  const step = niceStep(max / 4);
  const yMax = Math.ceil(max / step) * step;
  const y = (v) => padT + ih - (v / yMax) * ih;
  const bw = iw / buckets.length;
  const barW = Math.max(1, Math.min(bw - 3, 22));

  let svg = `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img" aria-label="${esc(m.label)} par ${hourly ? 'heure' : 'jour'} et par modèle">`;
  for (let v = 0; v <= yMax + 1e-9; v += step) {
    svg += `<line x1="${padL}" x2="${W - padR}" y1="${y(v)}" y2="${y(v)}" stroke="var(--grid)"/>`;
    svg += `<text x="${padL - 8}" y="${y(v) + 3.5}" text-anchor="end">${m.fmt(v)}</text>`;
  }
  const labelEvery = Math.ceil(buckets.length / Math.max(1, Math.floor(iw / 64)));
  buckets.forEach((b, i) => {
    const x = padL + i * bw + (bw - barW) / 2;
    let acc = 0;
    const segs = b.v.map((v, s) => [v, s]).filter(([v]) => v > 0);
    segs.forEach(([v, s], j) => {
      const y0 = y(acc), y1 = y(acc + v);
      acc += v;
      const top = j === segs.length - 1;
      const h = Math.max(0, y0 - y1 - (top ? 0 : 1.5));
      if (h <= 0) return;
      svg += `<path d="${roundTop(x, y0 - h, barW, h, top ? Math.min(5, barW / 2, h) : 0)}" fill="${series.list[s].color}"/>`;
    });
    if (i % labelEvery === 0) {
      const d = new Date(b.t * 1000);
      const lab = hourly ? `${d.getHours()} h` : d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
      svg += `<text x="${padL + i * bw + bw / 2}" y="${H - 7}" text-anchor="middle">${lab}</text>`;
    }
    svg += `<rect class="hit" data-i="${i}" x="${padL + i * bw}" y="${padT}" width="${bw}" height="${ih}" fill="transparent"/>`;
  });
  svg += '</svg><div class="tip"></div>';
  box.innerHTML = svg;

  const tip = $('.tip', box);
  box.querySelectorAll('.hit').forEach((el) => {
    el.addEventListener('mousemove', (e) => {
      const b = buckets[+el.dataset.i];
      const when = hourly
        ? dateFr(b.t, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit' })
        : dateFr(b.t, { weekday: 'long', day: 'numeric', month: 'long' });
      const tot = b.v.reduce((a, x) => a + x, 0);
      tip.innerHTML = `<b>${when}</b>` + series.list.map((s, k) => (b.v[k]
        ? `<div class="row"><span><i class="dot" style="background:${s.color}"></i>${esc(s.label)}</span><span>${m.fmt(b.v[k])}</span></div>` : '')).join('') +
        `<div class="row" style="margin-top:4px;border-top:0.5px solid var(--hairline);padding-top:4px"><span>Total</span><span>${m.fmt(tot)}</span></div>`;
      tip.style.display = 'block';
      const r = box.getBoundingClientRect();
      let left = e.clientX - r.left + 14;
      if (left + tip.offsetWidth > r.width) left = e.clientX - r.left - tip.offsetWidth - 14;
      tip.style.left = `${left}px`;
      tip.style.top = `${Math.max(0, e.clientY - r.top - 20)}px`;
    });
    el.addEventListener('mouseleave', () => (tip.style.display = 'none'));
  });
}

const HEAD = '<th>Réponses</th><th>Sortie</th><th>Écr. cache</th><th>Lect. cache</th><th>Total</th><th>Crédit</th><th>Coût API</th>';
const cols = (a) => [a[0], a[2], a[3], a[4], a[1] + a[2] + a[3] + a[4]]
  .map((v) => `<td title="${fmtN.format(v)}">${fmt(v)}</td>`).join('') +
  `<td title="${usdSmall.format(a[6])}">${fmtUsd(a[6])}</td><td title="${usdSmall.format(a[5])}"><b>${fmtUsd(a[5])}</b></td>`;

function renderTable(sel, groups, name, m) {
  const list = [...groups].map(([k, a]) => [k, a, m.f(a)]).sort((x, y) => y[2] - x[2]);
  const total = list.reduce((s, x) => s + x[2], 0) || 1;
  $(sel).innerHTML = list.length
    ? `<table><thead><tr><th>Nom</th>${HEAD}</tr></thead><tbody>` + list.map(([k, a, v]) =>
      `<tr><td class="name">${name(k)}<div class="share" title="${Math.round((v / total) * 100)} %"><div style="width:${(v / total) * 100}%"></div></div></td>${cols(a)}</tr>`).join('') + '</tbody></table>'
    : '<div class="empty">Aucune donnée sur cette période.</div>';
}

function renderSessions(m) {
  const rows = filtered(S.data.sessionHours, 1); // [s, h, mi, pi, n, in, out, cw, cr, coût, crédit]
  const g = new Map();
  for (const r of rows) {
    let s = g.get(r[0]);
    if (!s) g.set(r[0], (s = { a: ZERO(), first: r[1], last: r[1], pi: r[3], models: new Map() }));
    add(s.a, r, 4);
    s.first = Math.min(s.first, r[1]);
    s.last = Math.max(s.last, r[1]);
    s.models.set(r[2], (s.models.get(r[2]) || 0) + r[9]);
  }
  const list = [...g].map(([k, s]) => [k, s, m.f(s.a)]).sort((x, y) => y[2] - x[2]).slice(0, 20);
  const day = (t) => dateFr(t, { day: 'numeric', month: 'short' });
  $('#tSessions').innerHTML = list.length
    ? `<table><thead><tr><th>Session</th><th>Modèle principal</th>${HEAD}</tr></thead><tbody>` + list.map(([k, s]) => {
      const [sid, title] = S.data.sessions[k];
      const main = [...s.models].sort((a, b) => b[1] - a[1])[0][0];
      const span = day(s.first) === day(s.last) ? day(s.first) : `${day(s.first)} → ${day(s.last)}`;
      return `<tr><td class="name" title="${esc(sid)}">${esc(title || '(sans titre)')}<span class="meta">${esc(S.data.projects[s.pi])} · ${span}</span></td>` +
        `<td><span class="sq" style="background:${series.list[series.group[main]].color}"></span>${esc(modelLabel(S.data.models[main]))}</td>${cols(s.a)}</tr>`;
    }).join('') + '</tbody></table>'
    : '<div class="empty">Aucune session sur cette période.</div>';
}

// ---------- Réglages ----------

function renderSettings() {
  const c = S.config;
  const cals = [...c.calibrations].sort((a, b) => b.at - a.at);
  $('#cals').innerHTML = cals.map((x) => {
    const src = x.source === 'claude.json' ? 'lu dans Claude Code' : 'saisi';
    const credit = x.credit == null ? 'en attente des journaux' : `${fmtUsd(x.credit)} de crédit → limite ≈ ${x.pct >= 1 ? fmtUsd((x.credit / x.pct) * 100) : '—'}`;
    return `<li><span class="num" style="width:44px;font-weight:600">${x.pct} %</span>
      <span class="w">${dateFr(x.at, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} · ${src}<span class="meta faint" style="display:block;font-size:11.5px">${credit}</span></span>
      <button type="button" data-at="${x.at}" title="Supprimer ce relevé" aria-label="Supprimer ce relevé">×</button></li>`;
  }).join('') || '<li class="faint">Aucun relevé.</li>';
  if (document.activeElement !== $('#resetInput') && S.week && S.week.anchorKnown) {
    const d = new Date(S.week.end * 1000);
    $('#resetInput').value = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  }
  if (document.activeElement !== $('#planInput')) $('#planInput').value = c.plan;
  $('#autostart').checked = S.autostart;
  const d = S.data;
  $('#info').textContent = d
    ? `${fmtN.format(d.messages)} réponses lues dans ${fmtN.format(d.filesTotal)} fichiers (${String(d.scanSeconds).replace('.', ',')} s). Actualisation toutes les 2 minutes.`
    : '';
  $('#priceNote').textContent = d ? `Tarifs du ${new Date(d.pricesDate).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}.` +
    (d.unpricedModels.length ? ` Sans tarif connu (comptés à 0 $) : ${d.unpricedModels.join(', ')}.` : '') : '';
}

// ---------- Rendu et événements ----------

function render() {
  if (!S) return;
  const d = S.data;
  $('#status').textContent = S.scanError ? 'Erreur de lecture des journaux' : d
    ? `${fmtN.format(d.messages)} réponses · mis à jour à ${dateFr(d.generated, { hour: '2-digit', minute: '2-digit' })}`
    : 'Lecture des journaux… (une minute la première fois)';
  renderSettings();
  if (!d) return;
  buildSeries();
  fillSelects();
  renderWeek();
  renderHistory();
}

$('#period').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  state.period = b.dataset.p;
  $('#period').querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', x === b));
  renderHistory();
});
$('#fModel').addEventListener('change', (e) => { state.model = e.target.value; renderHistory(); });
$('#fProject').addEventListener('change', (e) => { state.project = e.target.value; renderHistory(); });
$('#fMetric').addEventListener('change', (e) => { state.metric = e.target.value; renderHistory(); });
$('#refresh').addEventListener('click', () => window.api.refresh());
$('#calForm').addEventListener('submit', (e) => {
  e.preventDefault();
  window.api.calibrate(Number($('#calInput').value));
  $('#calInput').value = '';
});
$('#cals').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-at]');
  if (b) window.api.deleteCalibration(Number(b.dataset.at));
});
$('#resetForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const t = new Date($('#resetInput').value).getTime();
  if (Number.isFinite(t)) window.api.setReset(t);
  document.activeElement.blur();
});
$('#planForm').addEventListener('submit', (e) => {
  e.preventDefault();
  window.api.setPlan($('#planInput').value.trim());
  document.activeElement.blur();
});
$('#autostart').addEventListener('change', (e) => window.api.setAutostart(e.target.checked));
let rz;
window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(render, 120); });

window.api.onState((s) => { S = s; render(); });
window.api.getState().then((s) => { S = s; render(); });
