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

  /** Limite hebdomadaire en $ de crédit : somme des crédits / somme des % relevés.
   *  Les % de Claude sont arrondis à l'unité, d'où la fourchette. */
  function estimateLimit(calibrations) {
    const ok = calibrations.filter((c) => c.pct >= 1 && c.credit > 0).slice(-6);
    if (!ok.length) return null;
    const sc = ok.reduce((s, c) => s + c.credit, 0);
    const sp = ok.reduce((s, c) => s + c.pct, 0);
    return {
      value: (sc / sp) * 100,
      low: (sc / (sp + 0.5 * ok.length)) * 100,
      high: (sc / Math.max(0.5, sp - 0.5 * ok.length)) * 100,
      points: ok.length,
    };
  }

  const sum = (a) => a.reduce((s, v) => s + v, 0);

  function compute(hours, cfg, now) {
    const [start, end] = windowAt(anchorOf(cfg, now), now);
    const limit = estimateLimit(cfg.calibrations || []);
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
