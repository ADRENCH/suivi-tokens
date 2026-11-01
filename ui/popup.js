'use strict';
let S = null;

function render() {
  if (!S) return;
  const w = S.week;
  $('#plan').textContent = planName(S.config);
  $('#err').hidden = !S.scanError;
  $('#err').textContent = S.scanError ? 'Erreur de lecture des journaux : ' + S.scanError.split('\n')[0] : '';
  if (!w) return reportHeight();

  $('#ring').innerHTML = ringSVG(w.pct, w.state, w.elapsed, 128, 12);
  $('#pct').textContent = w.pct == null ? '?' : fmtPct(w.pct);
  const st = $('#state');
  st.querySelector('.dot').style.background = `var(--state-${w.state})`;
  st.querySelector('span').textContent = STATE_LABEL[w.state];
  $('#left').textContent = w.pct == null ? 'à calibrer' : `≈ ${fmtPct(Math.max(0, 100 - w.pct))}`;
  $('#reset').textContent = resetLabel(w, { weekday: 'long', hour: 'numeric' });
  $('#resetIn').textContent = w.anchorKnown ? inRel(w.end - S.now) : '';
  $('#projText').innerHTML = projectionText(w);
  drawWeekChart($('#chart'), w, { height: 118, axis: false });

  const t = todayTotals(S.data);
  const lim = w.limit && w.limit.value;
  $('#todayPct').textContent = lim ? fmtPct((t.credit / lim) * 100) : fmtUsd(t.credit);
  $('#todaySub').textContent = `${fmt(t.tokens)} tokens · ${fmtUsd(t.cost)} API`;
  $('#typPct').textContent = `${lim ? fmtPct(w.perDayPct) : fmtUsd(w.perDay)} / jour`;
  $('#typSub').textContent = `depuis ${dateFr(w.start, { weekday: 'long', hour: 'numeric' })}`;
  reportHeight();
}

function reportHeight() {
  window.api.popupHeight($('#root').getBoundingClientRect().height);
}

$('#refresh').addEventListener('click', () => window.api.refresh());
$('#openDash').addEventListener('click', () => window.api.openDashboard());
$('#calForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const v = Number($('#calInput').value);
  if (Number.isFinite(v)) window.api.calibrate(v);
  $('#calInput').value = '';
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') window.api.hidePopup(); });

window.api.onState((s) => { S = s; render(); });
window.api.getState().then((s) => { S = s; render(); });
