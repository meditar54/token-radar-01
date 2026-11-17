// Token Radar's dashboard, radar-2. It reads window.RADAR (written beside dashboard/ by main.ts)
// and renders the ranked board, a filterable table, a per-protocol detail view with the model's own
// breakdown and the protocol's farm plan, and a sandbox that re-ranks the board live. No network:
// every byte it shows is in data.js.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var state = { q: '', category: 'all', chain: 'all', tab: 'pre-token', sort: 'implied', dir: -1, selected: null, sandbox: null };

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, n)); }

  // The model in one function: the page recomputes a row from the snapshot figures and checks the
  // number board.json carries, so the page's code and the board's data are visibly the same arithmetic.
  // Size and category strength are recomputed here from TVL and the category median (not read from
  // the row's rounded display values), so the recompute is exact, bit for bit. The sandbox runs this
  // same function with different constants and re-ranks the board live.
  function impliedOf(row, model) {
    var sizeScore = clamp((Math.log10(Math.max(1, row.tvl_usd)) - Math.log10(model.size_floor_tvl)) / (Math.log10(model.size_top_tvl) - Math.log10(model.size_floor_tvl)), 0.05, 1);
    var sizeFactor = Math.pow(sizeScore, model.size_exponent);
    var growth = clamp(row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d, model.growth_floor, model.growth_cap);
    var growthMult = 1 + (growth / 100) * model.growth_weight;
    var age = row.age_days === null || row.age_days === undefined ? model.unknown_age_days : row.age_days;
    var maturity = model.maturity_floor + model.maturity_range * (Math.log10(1 + clamp(age, 0, model.maturity_days)) / Math.log10(1 + model.maturity_days));
    var catRel = clamp(Math.log10(Math.max(1, row.tvl_usd) / Math.max(1, row.category_median_tvl)), -1, 1);
    var catMult = 1 + model.category_weight * catRel;
    var chainMult = 1 + model.chain_weight * Math.min((row.chains || []).length, model.chain_max);
    return Math.max(1, Math.round(model.scale_usd * sizeFactor * growthMult * maturity * catMult * chainMult));
  }
  function factorsOf(row, model) {
    var sizeScore = clamp((Math.log10(Math.max(1, row.tvl_usd)) - Math.log10(model.size_floor_tvl)) / (Math.log10(model.size_top_tvl) - Math.log10(model.size_floor_tvl)), 0.05, 1);
    var sizeFactor = Math.pow(sizeScore, model.size_exponent);
    var growth = clamp(row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d, model.growth_floor, model.growth_cap);
    var growthMult = 1 + (growth / 100) * model.growth_weight;
    var age = row.age_days === null || row.age_days === undefined ? model.unknown_age_days : row.age_days;
    var maturity = model.maturity_floor + model.maturity_range * (Math.log10(1 + clamp(age, 0, model.maturity_days)) / Math.log10(1 + model.maturity_days));
    var catRel = clamp(Math.log10(Math.max(1, row.tvl_usd) / Math.max(1, row.category_median_tvl)), -1, 1);
    var catMult = 1 + model.category_weight * catRel;
    var chainMult = 1 + model.chain_weight * Math.min((row.chains || []).length, model.chain_max);
    return { sizeScore: sizeScore, sizeFactor: sizeFactor, growthPct: growth, growthMult: growthMult, maturity: maturity, catRel: catRel, catMult: catMult, chainMult: chainMult, age: age };
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('tab')) state.tab = params.get('tab');
    if (params.get('p')) state.selected = params.get('p');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.tab !== 'pre-token') params.set('tab', state.tab);
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  // The rows the board shows: the sandbox's re-rank when one is active, else the board's own order.
  function displayRows() {
    var list = DATA.rows.map(function (r) {
      return { row: r, implied: state.sandbox ? impliedOf(r, state.sandbox) : r.implied_value_usd };
    });
    list.sort(function (a, b) {
      return b.implied - a.implied || (a.row.slug < b.row.slug ? -1 : a.row.slug > b.row.slug ? 1 : 0);
    });
    return list.map(function (item, i) { return { row: item.row, implied: item.implied, displayRank: i + 1 }; });
  }
  function filteredRows() {
    var q = state.q.trim().toLowerCase();
    return displayRows().filter(function (item) {
      var r = item.row;
      if (state.category !== 'all' && (r.category || 'Other') !== state.category) return false;
      if (state.chain !== 'all' && !(r.chains || []).includes(state.chain)) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var ra = a.row, rb = b.row, av, bv;
      if (key === 'name') { av = ra.name.toLowerCase(); bv = rb.name.toLowerCase(); }
      else if (key === 'tvl') { av = ra.tvl_usd; bv = rb.tvl_usd; }
      else if (key === 'growth') { av = ra.change_7d === null ? -Infinity : ra.change_7d; bv = rb.change_7d === null ? -Infinity : rb.change_7d; }
      else if (key === 'age') { av = ra.age_days === null ? Infinity : ra.age_days; bv = rb.age_days === null ? Infinity : rb.age_days; }
      else if (key === 'cat') { av = ra.category_relative; bv = rb.category_relative; }
      else { av = a.implied; bv = b.implied; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return ra.slug < rb.slug ? -1 : ra.slug > rb.slug ? 1 : 0;
    });
  }

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'mark' }), el('span', { class: 'brand-name', text: 'Token Radar' })),
      el('div', { class: 'top-meta' },
        el('span', { text: 'Snapshot ' + DATA.as_of }),
        el('span', { text: 'DefiLlama protocol index' }),
        el('span', { text: DATA.model_version + ' model' })
      )
    );
  }

  function lede() {
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', { text: DATA.watchlist_size + ' watchlist protocols, ranked by implied value' }),
        el('p', { text: 'The watchlist is the floor: every protocol with at least $' + Math.round(DATA.floor_usd / 1e6) + 'M of TVL and no token on record. The early radar adds ' + DATA.early_size + ' pre-token protocols below that floor, every rankable one the snapshot holds. Implied value is a model, not a promise: a protocol on the list may still hold a token its record does not carry.' })
      ),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' }, el('span', { text: 'Watchlist covered' }), el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size })),
        el('div', { class: 'fact' }, el('span', { text: 'Pre-token rows scored' }), el('b', { text: String(DATA.board_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Early rows below the floor' }), el('b', { text: String(DATA.early_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Live-token protocols set aside' }), el('b', { text: String(DATA.live_size) }))
      )
    );
  }

  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chains = Array.from(new Set(DATA.rows.reduce(function (acc, r) { return acc.concat(r.chains || []); }, []))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var catSelect = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); })
    );
    catSelect.addEventListener('change', function () { state.category = catSelect.value; writeHash(); render(); });
    var chainSelect = el('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      el('option', { value: 'all', text: 'All chains' }),
      chains.map(function (c) { return el('option', { value: c, text: c, selected: c === state.chain ? 'selected' : null }); })
    );
    chainSelect.addEventListener('change', function () { state.chain = chainSelect.value; writeHash(); render(); });
    var pre = el('button', { type: 'button', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token', onclick: function () { state.tab = 'pre-token'; render(); } });
    var live = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: function () { state.tab = 'live'; render(); } });
    var badge = state.sandbox ? el('span', { class: 'sandbox-badge', text: 'Sandbox re-rank active' }) : null;
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), catSelect),
      el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), chainSelect),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Token status' }), el('div', { class: 'tabs' }, pre, live)),
      badge,
      el('span', { class: 'count', text: state.tab === 'pre-token' ? filteredRows().length + ' rows shown' : DATA.live.length + ' live-token protocols' })
    );
  }

  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = key === 'name' ? 1 : -1; } render(); } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' v' : ' ^' }) : null
      )
    );
  }

  function boardTable() {
    var list = sortedRows(filteredRows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category or chain to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; writeHash(); render(); } })
      ));
    }
    var max = list[0].implied || 1;
    var tbody = el('tbody');
    list.forEach(function (item) {
      var r = item.row;
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var catRel = r.category_relative;
      var catClass = catRel > 0.15 ? 'pos' : catRel < -0.15 ? 'neg' : '';
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num', text: String(state.sandbox ? item.displayRank : r.rank) }),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', { class: 'num ' + catClass, text: (catRel > 0 ? '+' : '') + catRel.toFixed(2) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((item.implied / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(item.implied) })
        )),
        el('td', null, el('span', { class: 'chip pre', text: 'no token' }))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Pre-token protocols, strongest implied value first. Select a row for its model breakdown and farm plan.' }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            sortHeader('cat', 'Vs category'),
            sortHeader('implied', 'Implied value'),
            el('th', { scope: 'col', text: 'Token' })
          )),
          tbody
        )
      )
    );
  }

  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', null, el('span', { class: 'chip live', text: 'live' })),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', null, el('span', { class: 'sub', text: r.mcap_usd ? 'market cap ' + fmtUsd(r.mcap_usd) : 'token trades, no cap recorded' }))
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'Note' }))),
          tbody
        )
      )
    );
  }

  function modelPanel() {
    var m = DATA.model;
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How implied value is computed' }),
      el('p', { class: 'sub', text: 'One function of the snapshot figures scores every row. Size is logarithmic, so a protocol ten times larger does not score ten times higher. No protocol name is special-cased, and no row is hand-picked.' }),
      el('div', { class: 'formula' },
        'implied = round( $' + (m.scale_usd / 1e9).toFixed(1) + 'B x size^' + m.size_exponent + ' x growth x maturity x category x chains )\n' +
        'size = clamp((log10(TVL) - log10($' + (m.size_floor_tvl / 1e6) + 'M)) / (log10($' + (m.size_top_tvl / 1e9) + 'B) - log10($' + (m.size_floor_tvl / 1e6) + 'M)), 0.05, 1)\n' +
        'growth = 1 + clamp(7d change, ' + m.growth_floor + '%, ' + m.growth_cap + '%) / 100 x ' + m.growth_weight + '\n' +
        'maturity = ' + m.maturity_floor + ' + ' + m.maturity_range + ' x log10(1 + age days) / log10(1 + ' + m.maturity_days + ')\n' +
        'category = 1 + ' + m.category_weight + ' x clamp(log10(TVL / category median TVL), -1, 1)\n' +
        'chains = 1 + ' + m.chain_weight + ' x min(chains, ' + m.chain_max + ')'
      ),
      el('div', { class: 'model-grid' },
        el('div', { class: 'factor' }, el('b', { text: 'Size (log TVL)' }), el('span', { text: 'A $1B protocol scores about 0.77; a $50M one about 0.44. Doubling TVL adds a little, never doubles the score.' })),
        el('div', { class: 'factor' }, el('b', { text: 'Growth (7 days)' }), el('span', { text: 'Clamped to -50%..+150% so one wild week cannot decide the board. A +20% week multiplies the value by 1.12.' })),
        el('div', { class: 'factor' }, el('b', { text: 'Maturity (age, no token)' }), el('span', { text: 'How long the protocol has run with no token, on a log scale. Two years scores 1.00; a month scores about 0.82.' })),
        el('div', { class: 'factor' }, el('b', { text: 'Vs category' }), el('span', { text: 'TVL against the median of its own category. A protocol twice its category median multiplies by 1.07.' })),
        el('div', { class: 'factor' }, el('b', { text: 'Chains' }), el('span', { text: 'A small lift per chain, capped at five: more chains means more places a launch can reach.' })),
        el('div', { class: 'factor' }, el('b', { text: 'Live tokens set aside' }), el('span', { text: 'Protocols whose token already trades are shown at their market cap, never ranked by this model.' }))
      ),
      el('p', { class: 'sub', text: 'Age is the time since the protocol was first listed, the best record of how long it has run with no token; an unlisted age uses ' + m.unknown_age_days + ' days. The early radar is every rankable pre-token protocol below the watchlist floor, by implied value.' })
    );
  }

  function sandboxPanel() {
    var m = state.sandbox || DATA.model;
    function numField(id, label, value, step) {
      var input = el('input', { type: 'number', id: id, value: String(value), step: String(step), 'aria-label': label });
      return el('div', { class: 'field' }, el('label', { for: id, text: label }), input);
    }
    var scaleB = el('input', { type: 'number', id: 'sb-scale', value: String(m.scale_usd / 1e9), step: '0.5', min: '0.1', 'aria-label': 'Scale in billions of dollars' });
    var note = el('p', { class: 'sandbox-note', id: 'sb-note', text: state.sandboxNote || (state.sandbox ? 'Sandbox active: the board below is re-ranked with these constants. The board file keeps the model above.' : 'Change a constant and apply it: the board re-ranks at once. Nothing here writes to the board file.') });
    var apply = el('button', { class: 'button primary', type: 'button', text: 'Apply and re-rank', onclick: function () {
      var read = function (id) { var v = parseFloat(document.getElementById(id).value); return isFinite(v) ? v : null; };
      var scale = read('sb-scale'), exp = read('sb-exp'), gw = read('sb-growth'), mf = read('sb-mat'), cw = read('sb-cat'), chw = read('sb-chain');
      if (scale === null || exp === null || gw === null || mf === null || cw === null || chw === null || scale <= 0 || exp <= 0) {
        note.textContent = 'One of the numbers is not usable: check each field and apply again.';
        return;
      }
      var before = {};
      DATA.rows.forEach(function (r) { before[r.slug] = r.rank; });
      state.sandbox = { scale_usd: scale * 1e9, size_floor_tvl: DATA.model.size_floor_tvl, size_top_tvl: DATA.model.size_top_tvl, size_exponent: exp, growth_weight: gw, growth_floor: DATA.model.growth_floor, growth_cap: DATA.model.growth_cap, maturity_floor: mf, maturity_range: DATA.model.maturity_range, maturity_days: DATA.model.maturity_days, unknown_age_days: DATA.model.unknown_age_days, category_weight: cw, chain_weight: chw, chain_max: DATA.model.chain_max };
      var moved = 0, best = null, bestMove = 0;
      displayRows().forEach(function (item) {
        var shift = before[item.row.slug] - item.displayRank;
        if (shift !== 0) moved++;
        if (Math.abs(shift) > Math.abs(bestMove)) { bestMove = shift; best = item.row; }
      });
      state.sandboxNote = moved + ' of ' + DATA.board_size + ' rows changed rank' + (best ? '; biggest mover: ' + best.name + ' ' + (bestMove > 0 ? 'rose ' + bestMove : 'fell ' + (-bestMove)) + ' places.' : '.');
      render();
    } });
    var reset = el('button', { class: 'button', type: 'button', text: 'Reset to the board model', onclick: function () { state.sandbox = null; state.sandboxNote = null; render(); } });
    return el('section', { class: 'panel sandbox' },
      el('h2', { text: 'Model sandbox: re-rank the board yourself' }),
      el('p', { class: 'sub', text: 'The same formula, your constants. The page recomputes every row from the snapshot figures and sorts again.' }),
      el('div', { class: 'sandbox-grid' },
        el('div', { class: 'field' }, el('label', { for: 'sb-scale', text: 'Scale ($B)' }), scaleB),
        numField('sb-exp', 'Size exponent', m.size_exponent, 0.1),
        numField('sb-growth', 'Growth weight', m.growth_weight, 0.05),
        numField('sb-mat', 'Maturity floor', m.maturity_floor, 0.05),
        numField('sb-cat', 'Category weight', m.category_weight, 0.02),
        numField('sb-chain', 'Chain weight', m.chain_weight, 0.005)
      ),
      el('div', { class: 'sandbox-actions' }, apply, reset),
      note
    );
  }

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); });

  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    var f = factorsOf(row, DATA.model);
    var recomputed = impliedOf(row, DATA.model);
    var head = el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + DATA.board_size }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    );
    var eq = el('div', { class: 'equation' },
      el('div', null, el('span', { text: 'TVL' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd) })),
      el('div', null, el('span', { text: 'Seven-day growth' }), el('b', { class: 'num', text: fmtPct(row.change_7d) })),
      el('div', null, el('span', { text: 'Age with no token' }), el('b', { class: 'num', text: fmtAge(row.age_days) })),
      el('div', null, el('span', { text: 'Size score (log TVL)' }), el('b', { class: 'num', text: f.sizeScore.toFixed(4) })),
      el('div', null, el('span', { text: 'Size factor (score ^ ' + DATA.model.size_exponent + ')' }), el('b', { class: 'num', text: f.sizeFactor.toFixed(4) })),
      el('div', null, el('span', { text: 'Growth multiplier' }), el('b', { class: 'num', text: f.growthMult.toFixed(4) })),
      el('div', null, el('span', { text: 'Maturity multiplier' }), el('b', { class: 'num', text: f.maturity.toFixed(4) })),
      el('div', null, el('span', { text: 'Vs category (log TVL / median)' }), el('b', { class: 'num', text: (f.catRel > 0 ? '+' : '') + f.catRel.toFixed(2) })),
      el('div', null, el('span', { text: 'Category multiplier' }), el('b', { class: 'num', text: f.catMult.toFixed(4) })),
      el('div', null, el('span', { text: 'Chain multiplier (' + (row.chains || []).length + ' chains)' }), el('b', { class: 'num', text: f.chainMult.toFixed(4) })),
      el('div', null, el('span', { text: 'Implied value' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) }))
    );
    var checkText = 'Model ' + DATA.model_version + ': the page recomputes this row as ' + fmtUsd(recomputed) + (recomputed === row.implied_value_usd ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.') + ' This is an estimate, not a price.';
    if (state.sandbox) {
      checkText += ' Under your sandbox constants it would be ' + fmtUsd(impliedOf(row, state.sandbox)) + '.';
    }
    dialog.appendChild(head);
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value' }),
      eq,
      el('p', { class: 'sub', text: checkText })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan' }),
      el('ol', { class: 'steps' }, (row.farm_steps || []).map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
      }))
    ));
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(lede());
    shell.appendChild(controls());
    shell.appendChild(state.tab === 'pre-token' ? boardTable() : liveTable());
    if (state.tab === 'pre-token') {
      shell.appendChild(modelPanel());
      shell.appendChild(sandboxPanel());
    }
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected) openDetail(state.selected);
  }

  readHash();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();
