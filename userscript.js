// ==UserScript==
// @name         AHC Score Graph
// @description  AHC Score Graph
// @author       https://github.com/EdamAme-x/ahc-score-graph-user-script
// @namespace    http://tampermonkey.net/
// @version      1.9
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

  // ul.pager の Next が有効か（disabled でないか）を返す
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
