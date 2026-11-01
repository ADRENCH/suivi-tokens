'use strict';
// Semaine d'abonnement : consommation depuis la dernière réinitialisation, limite estimée
// à partir des relevés (% affiché par Claude) et projection selon les semaines passées.
// Partagé entre le processus principal (icône) et les fenêtres.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Week = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const H = 3600, N = 168, W = N * H;
  const CREDIT = 9; // colonne du crédit dans les lignes horaires
  const PROFILE_WEEKS = 4;

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
    const past = Array.from({ length: PROFILE_WEEKS }, () => new Array(N).fill(0));
    for (const r of hours) {
      const k = Math.floor((r[0] - start) / H);
      if (k >= 0 && k < N) cur[k] += r[CREDIT];
      else if (k < 0 && k >= -PROFILE_WEEKS * N) {
        const w = Math.ceil(-k / N);
        past[w - 1][k + w * N] += r[CREDIT];
      }
    }
    const used = sum(cur);
    const elapsedH = (now - start) / H;
    const nowK = Math.min(N - 1, Math.floor(elapsedH));
    const frac = elapsedH - nowK;

    // Semaine type : moyenne heure par heure des semaines passées réellement travaillées.
    const minWeek = limit ? limit.value * 0.05 : 1;
    const weeks = past.filter((p) => sum(p) >= minWeek);
    let profile;
    if (weeks.length) profile = cur.map((_, k) => weeks.reduce((s, p) => s + p[k], 0) / weeks.length);
    else profile = new Array(N).fill(used / Math.max(1, elapsedH)); // faute d'historique : rythme actuel

    // Projection à partir de maintenant, heure par heure.
    const actualCum = [];
    let c = 0;
    for (let k = 0; k <= nowK; k++) actualCum.push((c += cur[k]));
    const proj = new Array(N).fill(null);
    let cum = used, exhaustAt = null;
    if (limit && used >= limit.value) exhaustAt = now;
    for (let k = nowK; k < N; k++) {
      const span = k === nowK ? 1 - frac : 1;
      const add = profile[k] * span;
      if (limit && exhaustAt === null && add > 0 && cum + add >= limit.value) {
        const t0 = k === nowK ? now : start + k * H;
        exhaustAt = t0 + ((limit.value - cum) / add) * span * H;
      }
      cum += add;
      proj[k] = cum;
    }
    let tc = 0;
    const typicalCum = profile.map((v) => (tc += v));
    const days = Array.from({ length: 7 }, (_, d) => ({
      start: start + d * 24 * H,
      actual: sum(cur.slice(d * 24, d * 24 + 24)),
      typical: sum(profile.slice(d * 24, d * 24 + 24)),
      past: (d + 1) * 24 <= elapsedH,
      today: d === Math.floor(elapsedH / 24),
    }));

    const pctOf = (v) => (limit ? (v / limit.value) * 100 : null);
    let state = 'uncalibrated';
    if (limit) state = used >= limit.value ? 'out' : exhaustAt && exhaustAt < end ? 'warn' : 'ok';
    return {
      start, end, now, nowK, elapsed: elapsedH / N, anchorKnown: cfg.resetAnchor != null,
      used, limit, pct: pctOf(used),
      projEnd: cum, projEndPct: pctOf(cum),
      exhaustAt: exhaustAt && exhaustAt < end ? exhaustAt : null,
      typicalWeek: sum(profile), typicalPct: pctOf(sum(profile)),
      weeksInProfile: weeks.length,
      cur, profile, actualCum, proj, typicalCum, days, state,
    };
  }

  return { H, N, W, anchorOf, windowAt, creditBetween, estimateLimit, compute };
});
