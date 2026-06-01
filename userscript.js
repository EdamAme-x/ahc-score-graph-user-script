// ==UserScript==
// @name         AHC Score Graph
// @namespace    http://tampermonkey.net/
// @version      1.0
// @match        https://atcoder.jp/contests/*/submissions/me*
// @grant        none
// ==/UserScript==

(async function() {
  'use strict';

  const contestId = location.pathname.split('/')[2];

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

  Object.keys(Chart.registry.plugins.items).filter(k => k.startsWith('perfBand')).forEach(id => {
    try { const p = Chart.registry.getPlugin(id); if (p) Chart.unregister(p); } catch(e) {}
  });

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

    const scores = allEntries.map(e => e.score).sort((a, b) => a - b);
    const q1 = scores[Math.floor(scores.length * 0.25)];
    const q3 = scores[Math.floor(scores.length * 0.75)];
    const iqr = q3 - q1;
    const filtered = allEntries.filter(e => e.score >= q1 - 1.5 * iqr && e.score <= q3 + 1.5 * iqr);
    const latestScore = filtered[filtered.length - 1]?.score ?? allEntries[allEntries.length - 1].score;

    const userLink = document.querySelector('a[href*="/users/"]:not([href*="ranking"])');
    const username = userLink?.getAttribute('href')?.split('/users/')[1]?.split('/')[0] ?? '';
    const me = ratedWithScore.find(d => d.UserScreenName === username);
    if (!me) return null;

    const top1 = ratedWithScore[0];
    const minAbs = me.TotalResult.Score * latestScore / top1.TotalResult.Score;
    const absScores = ratedWithScore.map(d => minAbs * top1.TotalResult.Score / d.TotalResult.Score);

    const bandScores = [2800, 2400, 2000, 1600, 1200, 800, 400].map(p => {
      const idx = Math.max(0, Math.min(Math.round(calcRankFromPerf(p)) - 1, absScores.length - 1));
      return absScores[idx];
    });

    return { bandScores, highIsBetter: false };
  }

  function makeBandPlugin(bandScores, highIsBetter) {
    const bandColors = ['#808080', '#804000', '#008000', '#00c0c0', '#0000ff', '#c0c000', '#ff8000', '#ff0000'];
    const bandLabels = ['灰', '茶', '緑', '水', '青', '黄', '橙', '赤'];

    return {
      id: 'perfBandsFinal',
      afterDraw(chart) {
        const { ctx, chartArea: { top, bottom, left, right }, scales: { y } } = chart;
        ctx.save();
        const s = [...bandScores].sort((a, b) => highIsBetter ? b - a : a - b);

        for (let i = 0; i < 8; i++) {
          let bt, bb;
          if (i === 0) { bt = top; bb = y.getPixelForValue(s[6]); }
          else if (i === 7) { bt = y.getPixelForValue(s[0]); bb = bottom; }
          else { bt = y.getPixelForValue(s[7 - i]); bb = y.getPixelForValue(s[6 - i]); }

          const ct = Math.max(Math.min(bt, bb), top), cb = Math.min(Math.max(bt, bb), bottom);
          if (ct >= bottom || cb <= top || ct >= cb) continue;

          ctx.fillStyle = bandColors[i] + '30';
          ctx.fillRect(left, ct, right - left, cb - ct);
          ctx.fillStyle = bandColors[i];
          ctx.font = '11px sans-serif';
          ctx.textAlign = 'right';
          ctx.fillText(bandLabels[i], right - 4, (ct + cb) / 2 + 4);
        }

        ctx.restore();
      }
    };
  }

  const container = document.createElement('div');
  container.id = 'ahc-score-graph-container';
  container.style.cssText = 'margin:16px 0;padding:12px;background:#fff;border:1px solid #ddd;border-radius:4px;';

  const header = document.createElement('div');
  header.style.cssText = 'display:flex;align-items:center;gap:16px;margin-bottom:8px;';

  const title = document.createElement('span');
  title.textContent = 'スコア推移';
  title.style.fontWeight = 'bold';

  const outlierLabel = document.createElement('label');
  outlierLabel.style.cssText = 'display:flex;align-items:center;gap:4px;font-size:13px;cursor:pointer;';
  const outlierCb = document.createElement('input');
  outlierCb.type = 'checkbox'; outlierCb.checked = true;
  outlierLabel.append(outlierCb, document.createTextNode('外れ値除去'));

  const predLabel = document.createElement('label');
  predLabel.style.cssText = 'display:flex;align-items:center;gap:4px;font-size:13px;cursor:pointer;';
  const predCb = document.createElement('input');
  predCb.type = 'checkbox'; predCb.checked = false;
  predLabel.append(predCb, document.createTextNode('スコア予測'));

  header.append(title, outlierLabel, predLabel);

  const wrapper = document.createElement('div');
  wrapper.style.cssText = 'position:relative;width:100%;height:320px;';
  const canvas = document.createElement('canvas');
  wrapper.appendChild(canvas);
  container.append(header, wrapper);

  document.querySelector('.table-responsive,table')?.parentNode?.insertBefore(
    container,
    document.querySelector('.table-responsive,table')
  );

  const allEntries = await fetchAllPages();
  if (!allEntries.length) return;

  const bandData = await fetchPerfBandScores(allEntries);

  function filterOutliers(entries) {
    if (entries.length < 4) return entries;
    const sc = entries.map(e => e.score).sort((a, b) => a - b);
    const q1 = sc[Math.floor(sc.length * 0.25)];
    const q3 = sc[Math.floor(sc.length * 0.75)];
    const iqr = q3 - q1;
    return entries.filter(e => e.score >= q1 - 1.5 * iqr && e.score <= q3 + 1.5 * iqr);
  }

  let chartInstance = null, bandPlugin = null;

  function buildChart(useOutlier, showPred) {
    const entries = useOutlier ? filterOutliers(allEntries) : allEntries;
    const ys = entries.map(e => e.score);
    const yMin = Math.min(...ys), yMax = Math.max(...ys);
    let expandedMin = yMin, expandedMax = yMax;

    if (bandData) {
      const sorted = [...bandData.bandScores].sort((a, b) => a - b);
      const range = yMax - yMin, pad = range * 0.15;
      sorted.forEach(b => {
        if (b > yMin - range && b < yMax + range) {
          expandedMin = Math.min(expandedMin, b - pad);
          expandedMax = Math.max(expandedMax, b + pad);
        }
      });
    }

    const yPad = (expandedMax - expandedMin) * 0.05;

    const datasets = [{
      label: 'スコア',
      data: entries.map(e => ({ x: e.date, y: e.score })),
      borderColor: '#4e79c4',
      backgroundColor: '#4e79c450',
      pointRadius: 4,
      tension: 0.1,
      fill: false
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
        label: '予測',
        data: predPts,
        borderColor: '#e05c5c',
        borderDash: [5, 5],
        pointRadius: 0,
        tension: 0.1,
        fill: false
      });
    }

    if (chartInstance) { chartInstance.destroy(); chartInstance = null; }

    if (bandPlugin) {
      try {
        const ex = Chart.registry.getPlugin('perfBandsFinal');
        if (ex) Chart.unregister(ex);
      } catch(e) {}
      bandPlugin = null;
    }

    if (bandData) {
      bandPlugin = makeBandPlugin(bandData.bandScores, bandData.highIsBetter);
      Chart.register(bandPlugin);
    }

    chartInstance = new Chart(canvas, {
      type: 'line',
      data: { datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
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
          tooltip: {
            callbacks: {
              title: i => new Date(i[0].parsed.x).toLocaleString('ja-JP')
            }
          }
        }
      }
    });
  }

  buildChart(true, false);

  outlierCb.addEventListener('change', () => buildChart(outlierCb.checked, predCb.checked));
  predCb.addEventListener('change', () => buildChart(outlierCb.checked, predCb.checked));
})();
