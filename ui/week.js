'use strict';
// Semaine d'abonnement : consommation depuis la dernière réinitialisation, limite estimée
// à partir des relevés (% affiché par Claude) et projection au rythme moyen de la semaine
// en cours. Partagé entre le processus principal (icône) et les fenêtres.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Week = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const H = 3600, N = 168, W = N * H;
  const CREDIT = 9; // colonne du crédit dans les lignes horaires

  /** Fenêtre [début, fin) qui contient t ; les réinitialisations tombent à anchor + k semaines. */
  function windowAt(anchor, t) {
    const end = anchor + (Math.floor((t - anchor) / W) + 1) * W;
    return [end - W, end];
  }

  /** Réinitialisation de référence ; inconnue, on prend lundi 0 h en attendant qu'elle soit renseignée. */
  function anchorOf(cfg, now) {
    if (cfg.resetAnchor != null) return cfg.resetAnchor;
    const d = new Date(now * 1000);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7));
    return d.getTime() / 1000;
  }

  /** Crédit consommé entre a et b (heures entamées comptées au prorata). */
  function creditBetween(hours, a, b) {
    let s = 0;
    for (const r of hours) {
      const h = r[0];
      if (h + H <= a || h >= b) continue;
      const f = (Math.min(b, h + H) - Math.max(a, h)) / H;
      s += r[CREDIT] * f;
    }
    return s;
  }

  /** Limite hebdomadaire en $ de crédit, à partir des relevés (% affiché par Claude).
   *  Claude arrondit à l'unité : un relevé p % avec un crédit c donne une limite comprise entre
   *  c / (p + 0,5) et c / (p − 0,5). On retient la plage compatible avec le plus de relevés
   *  (un relevé lu sur un affichage pas encore actualisé est ainsi écarté), en privilégiant
   *  ceux de la semaine en cours. */
  function estimateLimit(calibrations, windowStart) {
    const valid = calibrations.filter((c) => c.pct >= 1 && c.credit > 0);
    const current = valid.filter((c) => c.windowStart === windowStart);
    const pool = current.length ? current : valid.slice(-6);
    if (!pool.length) return null;
    const spans = pool.map((c) => [(c.credit / (c.pct + 0.5)) * 100, (c.credit / Math.max(0.5, c.pct - 0.5)) * 100]);
    const ratio = (pool.reduce((s, c) => s + c.credit, 0) / pool.reduce((s, c) => s + c.pct, 0)) * 100;

    // Balayage des bornes : segments où le nombre d'intervalles qui se recouvrent est maximal.
    const edges = spans.flatMap(([lo, hi]) => [[lo, 1], [hi, -1]]).sort((a, b) => a[0] - b[0] || b[1] - a[1]);
    let count = 0, best = 0, segs = [];
    edges.forEach(([v, d], i) => {
      count += d;
      const next = edges[i + 1];
      if (!next || d < 0) return;
      if (count > best) { best = count; segs = []; }
      if (count === best) segs.push([v, next[0]]);
    });
    if (!segs.length) segs = [[ratio, ratio]];
    const [low, high] = segs.reduce((a, s) => (Math.abs((s[0] + s[1]) / 2 - ratio) < Math.abs((a[0] + a[1]) / 2 - ratio) ? s : a));
    const value = (low + high) / 2;
    const kept = pool.filter((_, i) => spans[i][0] <= value && value <= spans[i][1]);
    return {
      value, low, high,
      points: kept.length,
      ignored: pool.filter((c) => !kept.includes(c)).map((c) => c.at),
      currentWeek: current.length > 0,
    };
  }

  const sum = (a) => a.reduce((s, v) => s + v, 0);

  function compute(hours, cfg, now) {
    const [start, end] = windowAt(anchorOf(cfg, now), now);
    const limit = estimateLimit(cfg.calibrations || [], start);
    const cur = new Array(N).fill(0);
    for (const r of hours) {
      const k = Math.floor((r[0] - start) / H);
      if (k >= 0 && k < N) cur[k] += r[CREDIT];
    }
    const used = sum(cur);
    const elapsedH = (now - start) / H;
    const nowK = Math.min(N - 1, Math.floor(elapsedH));

    // Rythme moyen depuis la réinitialisation, prolongé jusqu'à la fin de la semaine.
    const rate = used / Math.max(1, elapsedH); // $ de crédit par heure
    const projEnd = used + rate * (N - elapsedH);
    let exhaustAt = null;
    if (limit) {
      if (used >= limit.value) exhaustAt = now;
      else if (rate > 0) exhaustAt = now + ((limit.value - used) / rate) * H;
    }

    const actualCum = [];
    let c = 0;
    for (let k = 0; k <= nowK; k++) actualCum.push((c += cur[k]));
    const days = Array.from({ length: 7 }, (_, d) => ({
      start: start + d * 24 * H,
      actual: sum(cur.slice(d * 24, d * 24 + 24)),
      projected: rate * 24,
      past: (d + 1) * 24 <= elapsedH,
      today: d === Math.floor(elapsedH / 24),
    }));

    const pctOf = (v) => (limit ? (v / limit.value) * 100 : null);
    let state = 'uncalibrated';
    if (limit) state = used >= limit.value ? 'out' : exhaustAt && exhaustAt < end ? 'warn' : 'ok';
    return {
      start, end, now, nowK, elapsedH, elapsed: elapsedH / N, anchorKnown: cfg.resetAnchor != null,
      used, limit, pct: pctOf(used),
      rate, perDay: rate * 24, perDayPct: pctOf(rate * 24),
      projEnd, projEndPct: pctOf(projEnd),
      exhaustAt: exhaustAt && exhaustAt < end ? exhaustAt : null,
      actualCum, days, state,
    };
  }

  return { H, N, W, anchorOf, windowAt, creditBetween, estimateLimit, compute };
});
