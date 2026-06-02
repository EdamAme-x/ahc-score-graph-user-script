// ==UserScript==
// @name         AHC Score Graph
// @description  AHC において、Score の遷移を見やすくするグラフを表示する。
// @author       https://github.com/EdamAme-x/ahc-score-graph-user-script
// @namespace    http://tampermonkey.net/
// @version      2.1
// @match        https://atcoder.jp/contests/*/submissions/me*
// @grant        none
// @license MIT
// ==/UserScript==

(function () {
  'use strict';

  const contestMatch = location.pathname.match(/\/contests\/([^/]+)\//);
  if (!contestMatch) return;
  const contestId = contestMatch[1];

  if (/^(abc|arc|agc)/i.test(contestId)) return;

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

  function hasNextPage(doc) {
    for (const li of doc.querySelectorAll('ul.pager li')) {
      if (li.classList.contains('disabled')) continue;
      const a = li.querySelector('a');
      if (a && a.textContent.includes('Next')) return true;
    }
    return false;
  }

  async function fetchAllPages() {
    const base = `/contests/${contestId}/submissions/me`;
    const fetchPage = (page) =>
      fetch(`https://atcoder.jp${base}?page=${page}`)
        .then(r => r.text())
        .then(html => new DOMParser().parseFromString(html, 'text/html'));

    const all = [];
    let page = 1;
    let doc = await fetchPage(page);
    while (true) {
      all.push(...parseSubmissionsFromDoc(doc));
      if (!hasNextPage(doc) || page >= 100) break;
      page++;
      doc = await fetchPage(page);
    }
    all.sort((a, b) => a.date - b.date);
    return all;
  }

  function removeOutliers(entries) {
    if (entries.length < 4) return entries;
    const scores = entries.map(e => e.score).sort((a, b) => a - b);
    const q1 = scores[Math.floor(scores.length * 0.25)];
    const q3 = scores[Math.floor(scores.length * 0.75)];
    const iqr = q3 - q1;
    const lower = q1 - 1.5 * iqr;
    const upper = q3 + 1.5 * iqr;
    return entries.filter(e => e.score >= lower && e.score <= upper);
  }

  let chart = null;
  let allEntries = [];

  function getEntries(filterOutliers) {
    return filterOutliers ? removeOutliers(allEntries) : allEntries;
  }

  function scoreDataset(filterOutliers) {
    return {
      label: 'スコア',
      data: getEntries(filterOutliers).map(e => ({ x: e.date, y: e.score })),
      borderColor: 'rgba(80,140,240,0.8)',
      backgroundColor: 'transparent',
      pointRadius: 3,
      pointHoverRadius: 5,
      borderWidth: 1.5,
      showLine: true,
      order: 2,
    };
  }

  function getOptions() {
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

  function update(filterOn) {
    chart.data.datasets = [scoreDataset(filterOn)];
    chart.options = getOptions();
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

    const controls = document.createElement('div');
    controls.style.cssText = 'display:flex;align-items:center;gap:12px;';

    const makeToggle = (label, defaultChecked) => {
      const wrap = document.createElement('label');
      wrap.style.cssText = 'display:flex;align-items:center;gap:5px;font-size:13px;color:#555;cursor:pointer;user-select:none;';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = defaultChecked;
      cb.style.cursor = 'pointer';
      wrap.appendChild(cb);
      wrap.appendChild(document.createTextNode(label));
      return { wrap, cb };
    };

    const { wrap: filterWrap, cb: filterCb } = makeToggle('外れ値除去', true);
    controls.appendChild(filterWrap);
    header.appendChild(controls);
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

      if (entries.length === 0) {
        container.remove();
        return;
      }

      allEntries = entries;
      document.getElementById('ahc-graph-loading')?.remove();

      chart = new Chart(canvas.getContext('2d'), {
        type: 'line',
        data: { datasets: [scoreDataset(true)] },
        options: getOptions(),
      });

      filterCb.addEventListener('change', () => update(filterCb.checked));
    } catch (err) {
      const el = document.getElementById('ahc-graph-loading');
      if (el) el.textContent = 'エラー: ' + err.message;
      console.error(err);
    }
  }

  main();
})();
