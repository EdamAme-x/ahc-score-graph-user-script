// ==UserScript==
// @name         AHC Score Graph
// @namespace    http://tampermonkey.net/
// @version      1.3
// @match        https://atcoder.jp/contests/*/submissions/me*
// @grant        none
// ==/UserScript==

(async function() {
  'use strict';

  document.querySelectorAll('#ahc-score-graph-container').forEach(el => el.remove());

  const contestId = location.pathname.split('/')[2];

  // --- localStorage helpers ---
  const CACHE_KEY = `ahc-score-graph:${contestId}`;

  function loadCache() {
    try {
      return JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
    } catch { return {}; }
  }

  function saveCache(patch) {
    const cur = loadCache();
    localStorage.setItem(CACHE_KEY, JSON.stringify({ ...cur, ...patch }));
  }

  // --- Chart.js 読み込み ---
  if (!window.Chart) {
    await new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js';
      s.onload = res; s.onerror = rej;
      document.head.appendChild(s);
    });
  }

  await new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/chartjs-adapter-date-fns@3.0.0/dist/chartjs-adapter-date-fns.bundle.min.js';
    s.onload = res; s.onerror = rej;
    document.head.appendChild(s);
  });

  try { const ex = Chart.registry.getPlugin('perfBandsFinal'); if (ex) Chart.unregister(ex); } catch(e) {}

  // --- データ取得 ---
  async function fetchAllPages() {
    const entries = [];
    const base = location.origin;
    const params = new URLSearchParams(location.search);
    params.set('f.Task', contestId + '_a');
    params.set('f.Status', 'AC');
    let page = 1;
    while (true) {
      params.set('page', page);
      const r = await fetch(base + location.pathname + '?' + params.toString());
      const doc = new DOMParser().parseFromString(await r.text(), 'text/html');
      const rows = doc.querySelectorAll('tbody tr');
      if (!rows.length) break;
      rows.forEach(row => {
        const tds = row.querySelectorAll('td');
        if (tds.length < 5) return;
        const score = parseInt(tds[4].textContent.trim().replace(/,/g, ''), 10);
        if (!isNaN(score) && score > 0)
          entries.push({ date: new Date(tds[0].textContent.trim()), score });
      });
      if (!doc.querySelector('a[rel="next"]')) break;
      page++;
    }
    return entries.sort((a, b) => a.date - b.date);
  }

  async function fetchPerfBandScores(allEntries) {
    // キャッシュチェック
    const cache = loadCache();
    if (cache.bandScores) return cache.bandScores;

    const [aperfsRes, stRes] = await Promise.all([
      fetch('https://data.ac-predictor.com/aperfs/' + contestId + '.json'),
      fetch('/contests/' + contestId + '/standings/json')
    ]);
    const aperfs = await aperfsRes.json();
    const st = await stRes.json();
    const ratedWithScore = st.StandingsData
      .filter(d => d.IsRated && d.TotalResult.Score > 0)
      .sort((a, b) => a.Rank - b.Rank);
    const groupAperfs = ratedWithScore.map(d => aperfs[d.UserScreenName] ?? 0);
    const calcRankFromPerf = p => groupAperfs.reduce((s, a) => s + 1 / (1 + Math.pow(6, (p - a) / 400)), 0);

    const userLink = document.querySelector('a[href*="/users/"]:not([href*="ranking"])');
    const username = userLink?.getAttribute('href')?.split('/users/')[1]?.split('/')[0] ?? '';
    const me = ratedWithScore.find(d => d.UserScreenName === username);
    if (!me) return null;

    const myLatestScore = allEntries[allEntries.length - 1].score;
    const absScores = ratedWithScore.map(d =>
      myLatestScore * d.TotalResult.Score / me.TotalResult.Score
    );

    const bandScores = [2800, 2400, 2000, 1600, 1200, 800, 400].map(p => {
      const idx = Math.max(0, Math.min(Math.round(calcRankFromPerf(p)) - 1, absScores.length - 1));
      return absScores[idx];
    });

    saveCache({ bandScores });
    return bandScores;
  }

  // --- UI構築 ---
  const cache = loadCache();

  const container = document.createElement('div');
  container.id = 'ahc-score-graph-container';
  container.style.cssText = 'margin:16px 0;padding:12px;background:#fff;border:1px solid #ddd;border-radius:4px;';

  const header = document.createElement('div');
  header.style.cssText = 'display:flex;align-items:center;gap:16px;margin-bottom:8px;';

  const title = document.createElement('span');
  title.textContent = 'スコア推移'; title.style.fontWeight = 'bold';

  function makeCheckbox(label, defaultVal, cacheKey) {
    const lbl = document.createElement('label');
    lbl.style.cssText = 'display:flex;align-items:center;gap:4px;font-size:13px;cursor:pointer;';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    // キャッシュがあればキャッシュ値、なければデフォルト値
    cb.checked = (cache[cacheKey] !== undefined) ? cache[cacheKey] : defaultVal;
    cb.addEventListener('change', () => saveCache({ [cacheKey]: cb.checked }));
    lbl.append(cb, document.createTextNode(label));
    return { lbl, cb };
  }

  const { lbl: outlierLabel, cb: outlierCb } = makeCheckbox('外れ値除去',   true,  'outlier');
  const { lbl: predLabel,    cb: predCb    } = makeCheckbox('スコア予測',    false, 'pred');
  const { lbl: highLabel,    cb: highCb    } = makeCheckbox('高スコアが上位', true,  'highIsBetter');

  header.append(title, outlierLabel, predLabel, highLabel);

  const wrapper = document.createElement('div');
  wrapper.style.cssText = 'position:relative;width:100%;height:320px;';
  const canvas = document.createElement('canvas');
  wrapper.appendChild(canvas);
  container.append(header, wrapper);

  document.querySelector('.table-responsive,table')?.parentNode?.insertBefore(
    container, document.querySelector('.table-responsive,table')
  );

  // --- データ取得 ---
  const allEntries = await fetchAllPages();
  if (!allEntries.length) return;
  const bandScores = await fetchPerfBandScores(allEntries);

  // --- バンドプラグイン ---
  function makeBandPlugin(bandScores, highIsBetter) {
    const bandColors = ['#808080', '#804000', '#008000', '#00c0c0', '#0000ff', '#c0c000', '#ff8000', '#ff0000'];
    const bandLabels = ['灰', '茶', '緑', '水', '青', '黄', '橙', '赤'];
    return {
      id: 'perfBandsFinal',
      afterDraw(chart) {
        const { ctx, chartArea: { top, bottom, left, right }, scales: { y } } = chart;
        ctx.save();
        const s = [...bandScores].sort((a, b) => a - b);
        for (let i = 0; i < 8; i++) {
          let bt, bb;
          if (highIsBetter) {
            if (i === 7)      { bt = top;                      bb = y.getPixelForValue(s[6]); }
            else if (i === 0) { bt = y.getPixelForValue(s[0]); bb = bottom; }
            else              { bt = y.getPixelForValue(s[i]); bb = y.getPixelForValue(s[i - 1]); }
          } else {
            if (i === 7)      { bt = y.getPixelForValue(s[0]);     bb = bottom; }
            else if (i === 0) { bt = top;                          bb = y.getPixelForValue(s[6]); }
            else              { bt = y.getPixelForValue(s[i - 1]); bb = y.getPixelForValue(s[i]); }
          }
          const ct = Math.max(Math.min(bt, bb), top);
          const cb = Math.min(Math.max(bt, bb), bottom);
          if (ct >= bottom || cb <= top || ct >= cb) continue;
          ctx.fillStyle = bandColors[i] + '30';
          ctx.fillRect(left, ct, right - left, cb - ct);
          if (cb - ct >= 14) {
            ctx.fillStyle = bandColors[i];
            ctx.font = '11px sans-serif';
            ctx.textAlign = 'right';
            ctx.fillText(bandLabels[i], right - 4, (ct + cb) / 2 + 4);
          }
        }
        ctx.restore();
      }
    };
  }

  // --- チャート構築 ---
  function filterOutliers(entries) {
    if (entries.length < 4) return entries;
    const sc = entries.map(e => e.score).sort((a, b) => a - b);
    const q1 = sc[Math.floor(sc.length * 0.25)];
    const q3 = sc[Math.floor(sc.length * 0.75)];
    const iqr = q3 - q1;
    return entries.filter(e => e.score >= q1 - 1.5 * iqr && e.score <= q3 + 1.5 * iqr);
  }

  let chartInstance = null, bandPlugin = null;

  function buildChart(useOutlier, showPred, highIsBetter) {
    const entries = useOutlier ? filterOutliers(allEntries) : allEntries;
    const ys = entries.map(e => e.score);
    const yMin = Math.min(...ys), yMax = Math.max(...ys);

    let expandedMin = yMin, expandedMax = yMax;
    if (bandScores) {
      const sorted = [...bandScores].sort((a, b) => a - b);
      expandedMin = Math.min(expandedMin, sorted[0]);
      expandedMax = Math.max(expandedMax, sorted[sorted.length - 1]);
    }
    const yPad = (expandedMax - expandedMin) * 0.08;

    const datasets = [{
      label: 'スコア', data: entries.map(e => ({ x: e.date, y: e.score })),
      borderColor: '#4e79c4', backgroundColor: '#4e79c450',
      pointRadius: 4, tension: 0.1, fill: false
    }];

    if (showPred && entries.length >= 2) {
      const xs = entries.map(e => e.date.getTime());
      const n = xs.length;
      const xM = xs.reduce((a, b) => a + b, 0) / n;
      const yM = ys.reduce((a, b) => a + b, 0) / n;
      const slope = xs.reduce((s, x, i) => s + (x - xM) * (ys[i] - yM), 0) / xs.reduce((s, x) => s + (x - xM) ** 2, 0);
      const intercept = yM - slope * xM;
      const tEnd = new Date('2026-06-08T19:00:00+09:00').getTime();
      const tLast = xs[xs.length - 1];
      const predPts = Array.from({ length: 21 }, (_, i) => {
        const t = tLast + (tEnd - tLast) * i / 20;
        return { x: new Date(t), y: slope * t + intercept };
      });
      datasets.push({
        label: '予測', data: predPts,
        borderColor: '#e05c5c', borderDash: [5, 5],
        pointRadius: 0, tension: 0.1, fill: false
      });
    }

    if (chartInstance) { chartInstance.destroy(); chartInstance = null; }
    if (bandPlugin) {
      try { const ex = Chart.registry.getPlugin('perfBandsFinal'); if (ex) Chart.unregister(ex); } catch(e) {}
      bandPlugin = null;
    }
    if (bandScores) {
      bandPlugin = makeBandPlugin(bandScores, highIsBetter);
      Chart.register(bandPlugin);
    }

    chartInstance = new Chart(canvas, {
      type: 'line', data: { datasets },
      options: {
        responsive: true, maintainAspectRatio: false,
        scales: {
          x: {
            type: 'time',
            time: { unit: 'hour', displayFormats: { hour: 'MM/dd HH:mm' } },
            ticks: { maxRotation: 45 }
          },
          y: {
            title: { display: true, text: 'スコア' },
            min: Math.floor(expandedMin - yPad),
            max: Math.ceil(expandedMax + yPad)
          }
        },
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { title: i => new Date(i[0].parsed.x).toLocaleString('ja-JP') } }
        }
      }
    });
  }

  buildChart(outlierCb.checked, predCb.checked, highCb.checked);

  outlierCb.addEventListener('change', () => buildChart(outlierCb.checked, predCb.checked, highCb.checked));
  predCb.addEventListener('change',    () => buildChart(outlierCb.checked, predCb.checked, highCb.checked));
  highCb.addEventListener('change',    () => buildChart(outlierCb.checked, predCb.checked, highCb.checked));

})();
