// ==UserScript==
// @name         AHC Score Graph
// @description  AHC Score Graph
// @author       https://github.com/EdamAme-x
// @namespace    http://tampermonkey.net/
// @version      1.8
// @match        https://atcoder.jp/contests/*/submissions/me*
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const contestMatch = location.pathname.match(/\/contests\/([^/]+)\//);
  if (!contestMatch) return;
  const contestId = contestMatch[1];

  function loadScript(url) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = url;
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  function parseDate(text) {
    text = text.trim().replace(/\+(\d{2})(\d{2})$/, '+$1:$2').replace(' ', 'T');
    const d = new Date(text);
    return isNaN(d.getTime()) ? null : d;
  }

  function parseSubmissionsFromDoc(doc) {
    const entries = [];
    doc.querySelectorAll('table tbody tr').forEach(row => {
      const cells = row.querySelectorAll('td');
      if (cells.length < 7) return;
      const date = parseDate(cells[0].textContent);
      const score = parseInt(cells[4].textContent.replace(/,/g, ''), 10);
      if (!date || isNaN(score) || score === 0) return;
      entries.push({ date, score });
    });
    return entries;
  }

  async function fetchAllPages() {
    const base = `/contests/${contestId}/submissions/me`;
    const fetchPage = (page) =>
      fetch(`https://atcoder.jp${base}?page=${page}`)
        .then(r => r.text())
        .then(html => new DOMParser().parseFromString(html, 'text/html'));

    const firstDoc = await fetchPage(1);
    let maxPage = 1;
    firstDoc.querySelectorAll('.pagination li a').forEach(a => {
      const m = a.href.match(/page=(\d+)/);
      if (m) maxPage = Math.max(maxPage, parseInt(m[1], 10));
    });
    const all = parseSubmissionsFromDoc(firstDoc);
    const rest = await Promise.all(
      Array.from({ length: Math.min(maxPage - 1, 19) }, (_, i) => fetchPage(i + 2))
    );
    rest.forEach(doc => all.push(...parseSubmissionsFromDoc(doc)));
    all.sort((a, b) => a.date - b.date);
    return all;
  }

  function getContestEndDate() {
    const links = document.querySelectorAll('a[href*="timeanddate"]');
    if (links.length >= 2) {
      const m = links[1].textContent.trim().match(/(\d{4}-\d{2}-\d{2})[^0-9]+(\d{2}:\d{2})/);
      if (m) {
        const d = new Date(`${m[1]}T${m[2]}:00+09:00`);
        if (!isNaN(d.getTime())) return d;
      }
    }
    return null;
  }

  function linreg(xs, ys) {
    const n = xs.length;
    const mx = xs.reduce((s, x) => s + x, 0) / n;
    const my = ys.reduce((s, y) => s + y, 0) / n;
    let num = 0, den = 0;
    for (let i = 0; i < n; i++) {
      num += (xs[i] - mx) * (ys[i] - my);
      den += (xs[i] - mx) ** 2;
    }
    return den === 0 ? 0 : num / den;
  }

  function blendedSlope(xs, ys) {
    const N = Math.min(xs.length, 10);
    let wA = 0, tW = 0;
    for (let k = 3; k <= N; k++) {
      const w = N - k + 1;
      wA += w * linreg(xs.slice(-k), ys.slice(-k));
      tW += w;
    }
    const raw = tW === 0 ? linreg(xs, ys) : wA / tW;
    return raw * 0.5;
  }

  let chart = null;
  let allEntries = [];
  let contestEnd = null;

  function scoreDataset() {
    return {
      label: 'スコア',
      data: allEntries.map(e => ({ x: e.date, y: e.score })),
      borderColor: 'rgba(80,140,240,0.8)',
      backgroundColor: 'transparent',
      pointRadius: 3,
      pointHoverRadius: 5,
      borderWidth: 1.5,
      showLine: true,
      order: 2,
    };
  }

  function buildPredDataset() {
    const t0 = allEntries[0].date.getTime();
    const xs = allEntries.map(e => (e.date.getTime() - t0) / 3600000);
    const ys = allEntries.map(e => e.score);

    const a = blendedSlope(xs, ys);
    const tLast = xs[xs.length - 1];
    const yLast = ys[ys.length - 1];
    const b = yLast - a * tLast;
    const tEnd = (contestEnd.getTime() - t0) / 3600000;
    const duration = tEnd - tLast;

    const amp = yLast * 0.003;
    const f1 = (2 * Math.PI) / (duration / 2.5);
    const f2 = (2 * Math.PI) / (duration / 1.3);

    return {
      label: '予測',
      data: Array.from({ length: 151 }, (_, i) => {
        const t = tLast + duration * (i / 150);
        const dt = t - tLast;
        const noise = amp * (Math.sin(f1 * dt) + 0.5 * Math.cos(f2 * dt));
        return { x: new Date(t0 + t * 3600000), y: Math.round(a * t + b + noise) };
      }),
      borderColor: 'rgba(240,140,40,0.8)',
      backgroundColor: 'transparent',
      pointRadius: 0,
      borderWidth: 1.5,
      borderDash: [5, 4],
      showLine: true,
      order: 3,
    };
  }

  function getOptions(withPrediction) {
    return {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: items => items[0]?.raw?.x?.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }) || '',
            label: ctx => `${ctx.dataset.label}: ${ctx.raw.y.toLocaleString()}`,
          },
        },
      },
      scales: {
        x: {
          type: 'time',
          time: { displayFormats: { hour: 'HH:mm', minute: 'HH:mm' } },
          ...(withPrediction && contestEnd ? { max: contestEnd } : {}),
          ticks: {
            maxRotation: 0,
            autoSkip: true,
            autoSkipPadding: 20,
            callback: function (value, index, ticks) {
              const date = new Date(ticks[index].value);
              const hhmm = date.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tokyo' });
              const dateStr = date.toLocaleDateString('ja-JP', { month: '2-digit', day: '2-digit', timeZone: 'Asia/Tokyo' });
              const prev = index > 0 ? new Date(ticks[index - 1].value) : null;
              const prevDateStr = prev ? prev.toLocaleDateString('ja-JP', { month: '2-digit', day: '2-digit', timeZone: 'Asia/Tokyo' }) : null;
              return (index === 0 || dateStr !== prevDateStr) ? [hhmm, dateStr] : hhmm;
            },
          },
        },
        y: {
          title: { display: true, text: 'スコア' },
          ticks: { callback: v => v.toLocaleString() },
        },
      },
    };
  }

  function update(on) {
    chart.data.datasets = on ? [scoreDataset(), buildPredDataset()] : [scoreDataset()];
    chart.options = getOptions(on);
    chart.update();
  }

  async function main() {
    const container = document.createElement('div');
    container.id = 'ahc-score-graph-container';
    container.style.cssText = 'background:#fff;border:1px solid #ddd;border-radius:6px;padding:16px;margin:16px 0;box-shadow:0 2px 6px rgba(0,0,0,0.08);';

    const header = document.createElement('div');
    header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;';

    const titleEl = document.createElement('div');
    titleEl.textContent = 'スコア推移';
    titleEl.style.cssText = 'font-weight:bold;font-size:15px;color:#333;';
    header.appendChild(titleEl);

    const toggleWrap = document.createElement('label');
    toggleWrap.style.cssText = 'display:flex;align-items:center;gap:5px;font-size:13px;color:#555;cursor:pointer;user-select:none;';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.style.cursor = 'pointer';
    toggleWrap.appendChild(checkbox);
    toggleWrap.appendChild(document.createTextNode('スコア予測'));
    header.appendChild(toggleWrap);
    container.appendChild(header);

    const loading = document.createElement('p');
    loading.id = 'ahc-graph-loading';
    loading.textContent = 'データ読み込み中...';
    loading.style.cssText = 'text-align:center;color:#888;margin:0;';
    container.appendChild(loading);

    const wrapper = document.createElement('div');
    wrapper.style.cssText = 'height:280px;position:relative;';
    const canvas = document.createElement('canvas');
    canvas.id = 'ahc-score-chart';
    wrapper.appendChild(canvas);
    container.appendChild(wrapper);

    const table = document.querySelector('table');
    if (table?.parentNode) table.parentNode.insertBefore(container, table);

    try {
      await loadScript('https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js');
      await loadScript('https://cdn.jsdelivr.net/npm/chartjs-adapter-date-fns@3.0.0/dist/chartjs-adapter-date-fns.bundle.min.js');
      const entries = await fetchAllPages();
      contestEnd = getContestEndDate();
      allEntries = entries;
      document.getElementById('ahc-graph-loading')?.remove();
      if (entries.length === 0) {
        container.insertAdjacentHTML('beforeend', '<p style="color:#888;text-align:center">データなし</p>');
        return;
      }
      chart = new Chart(canvas.getContext('2d'), {
        type: 'line',
        data: { datasets: [scoreDataset()] },
        options: getOptions(false),
      });
      checkbox.addEventListener('change', () => update(checkbox.checked));
    } catch (err) {
      const el = document.getElementById('ahc-graph-loading');
      if (el) el.textContent = 'エラー: ' + err.message;
      console.error(err);
    }
  }

  main();
})();
