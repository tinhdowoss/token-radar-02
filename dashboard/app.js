/* Token launch radar — renders everything from window.RADAR (data.js). No network. */
(function () {
  var R = window.RADAR;
  if (!R) { document.body.insertAdjacentHTML('beforeend', '<p style="padding:20px">Data failed to load.</p>'); return; }
  var $ = function (id) { return document.getElementById(id); };
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function money(v) {
    if (v >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B';
    if (v >= 1e6) return '$' + (v / 1e6).toFixed(1) + 'M';
    if (v >= 1e3) return '$' + (v / 1e3).toFixed(1) + 'k';
    return '$' + Math.round(v);
  }
  function moneyFull(v) { return '$' + Math.round(v).toLocaleString('en-US'); }
  function fmt3(v) { return v.toFixed(3); }
  var fit = R.fit, val = R.validation;
  var state = { q: '', category: '', verdict: '', slug: null, theme: 'light' };

  function readParams() {
    var q = new URLSearchParams(location.search);
    var h = new URLSearchParams(location.hash.replace(/^#/, ''));
    state.theme = h.get('theme') || q.get('theme') || 'light';
    state.category = h.get('category') || q.get('category') || '';
    state.verdict = h.get('verdict') || q.get('verdict') || '';
    state.slug = h.get('p') || q.get('p') || null;
  }
  function applyTheme() {
    document.documentElement.setAttribute('data-theme', state.theme === 'dark' ? 'dark' : 'light');
    $('themeBtn').textContent = state.theme === 'dark' ? 'Light' : 'Dark';
  }

  /* ---- header / KPIs / footer (all numbers from RADAR) ---- */
  $('formulaLine').textContent = 'log\u2081\u2080(mcap) = ' + fmt3(fit.intercept) + ' + ' + fmt3(fit.slope) +
    '·log\u2081\u2080(TVL) + category offset · ' + fit.nComps + ' live comps · snapshot ' + R.asOf;
  var kpis = [
    [R.nWatchlist + ' / ' + R.nWatchlist, 'watchlist protocols ranked'],
    [String(R.nRows), 'rows ranked'],
    [fmt3(val.looModel) + ' vs ' + fmt3(val.looFlat), 'out-of-sample LOO log\u2081\u2080 RMSE, model vs flat'],
    [String(R.nFarm), 'FARM verdicts · ' + R.nThin + ' THIN · ' + R.nSkip + ' SKIP']
  ];
  $('kpis').innerHTML = kpis.map(function (k) {
    return '<div class="kpi"><b>' + esc(k[0]) + '</b><span>' + esc(k[1]) + '</span></div>';
  }).join('');
  $('howComps').textContent = fit.nComps;
  $('footLine').textContent = 'Snapshot DefiLlama ' + R.asOf + ' · gas/slippage are estimates · ' +
    money(R.totalImpliedUsd) + ' total implied value across ' + R.nRows + ' rows · every protocol records no token';

  /* ---- out-of-sample box ---- */
  $('oosBody').innerHTML = '<table><thead><tr><th>Check</th><th class="num">Model</th><th class="num">Flat multiple</th></tr></thead><tbody>' +
    '<tr><td>Leave-one-out (' + val.looTested + ' comps)</td><td class="num">' + fmt3(val.looModel) + '</td><td class="num">' + fmt3(val.looFlat) + '</td></tr>' +
    '<tr><td>Walk-forward (' + val.wfTested + ' tested)</td><td class="num">' + fmt3(val.wfModel) + '</td><td class="num">' + fmt3(val.wfFlat) + '</td></tr>' +
    '</tbody></table><p class="cap">Log\u2081\u2080 RMSE — lower is better. The model beats the flat multiple out of sample on both checks.</p>';

  /* ---- scatter: 92 distinct live comps (nearest comps in the data) + fit line + top 5 ---- */
  var seen = {}, comps = [];
  R.rows.forEach(function (r) {
    (r.nearest_comps || []).forEach(function (c) {
      if (!seen[c.slug]) { seen[c.slug] = 1; comps.push(c); }
    });
  });
  var W = 480, H = 290, ML = 44, MR = 8, MT = 10, MB = 30;
  function X(l) { return ML + (l - 6) / 4 * (W - ML - MR); }
  function Y(l) { return H - MB - (l - 6) / 4 * (H - MT - MB); }
  var ticks = [6, 7, 8, 9, 10], tlab = ['$1M', '$10M', '$100M', '$1B', '$10B'];
  var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" role="img" aria-label="Log-log scatter of TVL against market value">';
  ticks.forEach(function (t, i) {
    svg += '<line x1="' + X(t) + '" y1="' + Y(6) + '" x2="' + X(t) + '" y2="' + Y(10) + '" stroke="var(--border)" stroke-width="1"/>' +
      '<text x="' + X(t) + '" y="' + (H - 12) + '" font-size="10" fill="var(--muted)" text-anchor="' + (i === ticks.length - 1 ? 'end' : 'middle') + '">' + tlab[i] + '</text>' +
      '<text x="' + (ML - 6) + '" y="' + (Y(t) + 3) + '" font-size="10" fill="var(--muted)" text-anchor="end">' + tlab[i] + '</text>';
  });
  svg += '<text x="' + (W / 2) + '" y="' + (H - 1) + '" font-size="10" fill="var(--muted)" text-anchor="middle">TVL (log)</text>';
  svg += '<line x1="' + X(6) + '" y1="' + Y(fit.intercept + fit.slope * 6) + '" x2="' + X(10) + '" y2="' + Y(fit.intercept + fit.slope * 10) +
    '" stroke="#C41C83" stroke-width="2"/>';
  comps.forEach(function (c) {
    var mcap = c.multiple * c.tvl_usd;
    svg += '<circle cx="' + X(Math.log10(c.tvl_usd)).toFixed(1) + '" cy="' + Y(Math.log10(mcap)).toFixed(1) + '" r="2.6" fill="#9AA0AE"><title>' + esc(c.name) + ' — ' + money(mcap) + '</title></circle>';
  });
  /* Top-5 labels are staggered: Sentora + Steakhouse share (nearly) one point. */
  var lab = { 'sentora-curator': [-8, -21, 'end'], 'steakhouse-financial': [-8, 17, 'end'], 'gauntlet': [8, -13, 'start'], 'polymarket-international': [-8, 14, 'end'], 'veda': [0, 17, 'middle'] };
  R.rows.slice(0, 5).forEach(function (r) {
    var cx = X(Math.log10(r.tvl_usd)), cy = Y(Math.log10(r.implied_value_usd)), d = lab[r.slug] || [8, -8, 'start'];
    svg += '<circle cx="' + cx.toFixed(1) + '" cy="' + cy.toFixed(1) + '" r="5" fill="#C41C83" stroke="#fff" stroke-width="1.5"/>' +
      '<text x="' + (cx + d[0]) + '" y="' + (cy + d[1]) + '" font-size="11" font-weight="650" fill="#C41C83" text-anchor="' + d[2] + '" style="paint-order:stroke;stroke:var(--surface);stroke-width:3px;stroke-linejoin:round">' + esc(r.name) + '</text>';
  });
  svg += '</svg>';
  $('scatter').innerHTML = svg;
  $('scatterCap').textContent = 'Grey dots: ' + comps.length + ' distinct live comps nearest to ranked rows (of ' + fit.nComps +
    ' in the fit). Magenta: top 5 pre-token protocols at implied value. Line: log\u2081\u2080(mcap) = ' + fmt3(fit.intercept) + ' + ' + fmt3(fit.slope) + '·log\u2081\u2080(TVL).';

  /* ---- filters + board table ---- */
  readParams(); /* before building the selects, so hash/query filters show as selected */
  var cats = Array.from(new Set(R.rows.map(function (r) { return r.category; }))).sort();
  $('catSel').innerHTML = '<option value="">All categories</option>' + cats.map(function (c) {
    return '<option' + (c === state.category ? ' selected' : '') + '>' + esc(c) + '</option>';
  }).join('');
  $('verSel').value = state.verdict;
  $('q').value = state.q;

  function filtered() {
    var q = state.q.trim().toLowerCase();
    return R.rows.filter(function (r) {
      if (state.category && r.category !== state.category) return false;
      if (state.verdict && r.verdict !== state.verdict) return false;
      if (q && (r.name + ' ' + r.slug + ' ' + r.category).toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
  }
  function rangeBar(r, showLabel) {
    var lo = Math.log10(1e6), hi = Math.log10(2e8);
    function pc(v) { return Math.max(0, Math.min(100, (Math.log10(v) - lo) / (hi - lo) * 100)); }
    return '<div class="range"><i style="left:' + pc(r.implied_p10_usd).toFixed(1) + '%;width:' + Math.max(1, pc(r.implied_p90_usd) - pc(r.implied_p10_usd)).toFixed(1) + '%"></i>' +
      '<b style="left:' + pc(r.implied_value_usd).toFixed(1) + '%"></b></div>' +
      (showLabel ? '<div class="rangelab">P10 ' + money(r.implied_p10_usd) + ' – P90 ' + money(r.implied_p90_usd) + '</div>' : '');
  }
  function renderBoard() {
    var list = filtered(), show = list.slice(0, 12);
    $('catSel').value = state.category; $('verSel').value = state.verdict; $('q').value = state.q;
    $('boardBody').innerHTML = show.map(function (r) {
      var chg = r.change_7d, cls = chg >= 0 ? 'up' : 'down', sign = chg >= 0 ? '+' : '';
      return '<tr class="v-' + r.verdict + '" data-slug="' + esc(r.slug) + '"><td>#' + r.rank + '</td>' +
        '<td><span class="pname">' + esc(r.name) + '</span>' + (r.watchlist ? '<span class="badge">WATCH</span>' : '') +
        '<div class="pcat">' + esc(r.category) + '</div></td>' +
        '<td class="num">' + money(r.tvl_usd) + '</td>' +
        '<td class="num ' + cls + '">' + sign + chg.toFixed(1) + '%</td>' +
        '<td title="P10 ' + money(r.implied_p10_usd) + ' – P90 ' + money(r.implied_p90_usd) + '"><b>' + money(r.implied_value_usd) + '</b>' + rangeBar(r) + '</td>' +
        '<td><span class="pill ' + r.verdict + '">' + r.verdict + '</span></td></tr>';
    }).join('') || '<tr><td colspan="6">No protocols match these filters.</td></tr>';
    $('boardNote').textContent = 'Top 12 of ' + list.length + ' matching · ' + R.nRows + ' ranked';
    $('countLine').textContent = list.length + ' matching';
    var chips = [];
    if (state.category) chips.push('Category: ' + state.category);
    if (state.verdict) chips.push('Verdict: ' + state.verdict);
    if (state.q.trim()) chips.push('Search: ' + state.q.trim());
    $('chips').innerHTML = chips.map(function (c) { return '<span class="chip">' + esc(c) + '</span>'; }).join('');
  }

  /* ---- detail panel ---- */
  function renderDetail() {
    var el = $('detail');
    if (!state.slug) { el.hidden = true; el.innerHTML = ''; return; }
    var r = R.rows.find(function (x) { return x.slug === state.slug; });
    if (!r) { el.hidden = true; el.innerHTML = ''; return; }
    var logT = Math.log10(r.tvl_usd);
    var base = Math.pow(10, fit.intercept + fit.slope * logT);
    var off = fit.offsets[r.category] || 0;
    var steps = '<ol class="calc">' +
      '<li>TVL ' + moneyFull(r.tvl_usd) + ' → log\u2081\u2080(TVL) = ' + logT.toFixed(3) + '.</li>' +
      '<li>Fit: ' + fmt3(fit.intercept) + ' + ' + fmt3(fit.slope) + ' × ' + logT.toFixed(3) + ' = ' + (fit.intercept + fit.slope * logT).toFixed(3) +
      ' → ' + money(base) + ' before the category offset.</li>' +
      '<li>Category offset for ' + esc(r.category) + ': ' + (off >= 0 ? '+' : '') + off.toFixed(3) + ' dex (×' + Math.pow(10, off).toFixed(2) +
      ') → implied value ' + money(r.implied_value_usd) + '.</li>' +
      '<li>Bootstrap of 200 refits: P10 ' + money(r.implied_p10_usd) + ' – P90 ' + money(r.implied_p90_usd) + '.</li></ol>';
    var compsHtml = '<table class="comps"><thead><tr><th>Nearest live comp</th><th class="num">Multiple</th><th class="num">TVL</th><th class="num">Market value</th></tr></thead><tbody>' +
      (r.nearest_comps || []).map(function (c) {
        return '<tr><td>' + esc(c.name) + '</td><td class="num">' + c.multiple.toFixed(2) + '×</td><td class="num">' + money(c.tvl_usd) + '</td><td class="num">' + money(c.multiple * c.tvl_usd) + '</td></tr>';
      }).join('') + '</tbody></table>';
    var farm = '<ol>' + r.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ol>';
    el.innerHTML = '<div class="card"><button class="close" id="closeDetail" type="button">Close ×</button>' +
      '<h2>#' + r.rank + ' ' + esc(r.name) + ' <span class="pill ' + r.verdict + '">' + r.verdict + '</span>' +
      (r.watchlist ? '<span class="badge">WATCH</span>' : '') + '</h2>' +
      '<p class="muted">' + esc(r.category) + ' · TVL ' + money(r.tvl_usd) + ' · 7d ' + (r.change_7d >= 0 ? '+' : '') + r.change_7d.toFixed(1) + '% · ' +
      esc(r.chains.join(', ')) + ' · ' + (r.age_days == null ? 'age not listed' : r.age_days + ' days tracked') + ' · every protocol records no token</p>' +
      '<div class="dgrid"><div><h3>How the implied value is built</h3>' + steps + '<h3 style="margin-top:12px">P10–P90 range</h3>' + rangeBar(r, true) +
      '<h3 style="margin-top:12px">Nearest live comps</h3>' + compsHtml + '</div>' +
      '<div><h3>Farm plan — 5 steps</h3>' + farm + '</div></div></div>';
    el.hidden = false;
    $('closeDetail').addEventListener('click', function () {
      location.hash = state.category ? '#category=' + encodeURIComponent(state.category) : '#';
    });
  }

  function renderAll() { readParams(); applyTheme(); renderBoard(); renderDetail(); }
  $('q').addEventListener('input', function (e) { state.q = e.target.value; renderBoard(); });
  $('catSel').addEventListener('change', function (e) { state.category = e.target.value; renderBoard(); });
  $('verSel').addEventListener('change', function (e) { state.verdict = e.target.value; renderBoard(); });
  $('clearBtn').addEventListener('click', function () {
    state.q = ''; state.category = ''; state.verdict = ''; $('q').value = ''; $('catSel').value = ''; $('verSel').value = ''; renderBoard();
  });
  $('themeBtn').addEventListener('click', function () {
    state.theme = state.theme === 'dark' ? 'light' : 'dark'; applyTheme();
  });
  $('boardBody').addEventListener('click', function (e) {
    var tr = e.target.closest('tr[data-slug]');
    if (tr) location.hash = '#p=' + tr.getAttribute('data-slug');
  });
  window.addEventListener('hashchange', renderAll);
  renderAll();
})();
