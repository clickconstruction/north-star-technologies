#!/usr/bin/env node
// Static site generator. No dependencies. `node build.mjs` writes ./dist.
//
//   site.config.json          the display name and contact details (one place)
//   content/*.json            layers, services, status metrics, water devices, career ladder
//   content/field-notes/*.md  one Markdown file per field note
//   src/                      styles, script, favicon (copied to dist/assets)

import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const OUT = join(ROOT, 'dist');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

const cfg = JSON.parse(read('site.config.json'));
const svc = cfg.service;

// {{name}}, {{shortName}} and {{service}} work in every content file.
const TOKENS = { name: cfg.name, shortName: cfg.shortName, service: svc.name };
const fill = (s, forJson = false) =>
  s.replace(/\{\{(\w+)\}\}/g, (m, k) => {
    if (!(k in TOKENS)) return m;
    return forJson ? JSON.stringify(TOKENS[k]).slice(1, -1) : TOKENS[k];
  });
const json = (p) => JSON.parse(fill(read(p), true));

const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ---------- Markdown (the small subset the field notes use) ----------

function inline(s) {
  return esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2">$1</a>');
}

function markdown(src) {
  const lines = src.replace(/\r/g, '').split('\n');
  const out = [];
  let i = 0;
  const isBlockStart = (l) => /^(#{2,4}\s|\||[-*]\s|\d+\.\s|>\s?)/.test(l);
  while (i < lines.length) {
    const l = lines[i];
    if (!l.trim()) { i++; continue; }
    let m;
    if ((m = l.match(/^(#{2,4})\s+(.*)$/))) {
      out.push(`<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`);
      i++;
    } else if (/^\|/.test(l)) {
      const rows = [];
      while (i < lines.length && /^\|/.test(lines[i])) {
        rows.push(lines[i].trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim()));
        i++;
      }
      const [head, sep, ...body] = rows;
      const hasHead = sep && sep.every((c) => /^:?-+:?$/.test(c));
      const bodyRows = hasHead ? body : rows;
      out.push(
        '<div class="table-wrap"><table>' +
          (hasHead ? `<thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead>` : '') +
          `<tbody>${bodyRows.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody>` +
          '</table></div>'
      );
    } else if (/^[-*]\s+/.test(l)) {
      const items = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i])) items.push(lines[i++].replace(/^[-*]\s+/, ''));
      out.push(`<ul>${items.map((t) => `<li>${inline(t)}</li>`).join('')}</ul>`);
    } else if (/^\d+\.\s+/.test(l)) {
      const items = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i])) items.push(lines[i++].replace(/^\d+\.\s+/, ''));
      out.push(`<ol>${items.map((t) => `<li>${inline(t)}</li>`).join('')}</ol>`);
    } else if (/^>\s?/.test(l)) {
      const quote = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) quote.push(lines[i++].replace(/^>\s?/, ''));
      out.push(`<blockquote><p>${inline(quote.join(' '))}</p></blockquote>`);
    } else {
      const para = [];
      while (i < lines.length && lines[i].trim() && !isBlockStart(lines[i])) para.push(lines[i++]);
      out.push(`<p>${inline(para.join(' '))}</p>`);
    }
  }
  return out.join('\n');
}

function loadNotes() {
  const dir = join(ROOT, 'content/field-notes');
  return readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .map((file) => {
      const raw = fill(readFileSync(join(dir, file), 'utf8'));
      const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
      if (!m) throw new Error(`${file}: missing front matter`);
      const meta = {};
      for (const line of m[1].split('\n')) {
        const kv = line.match(/^(\w+):\s*(.*)$/);
        if (kv) meta[kv[1]] = kv[2].trim();
      }
      const body = m[2];
      const number = Number(meta.number);
      return {
        slug: file.replace(/\.md$/, '').replace(/^\d+-/, ''),
        number,
        code: `FN-${String(number).padStart(3, '0')}`,
        title: meta.title,
        date: meta.date,
        summary: meta.summary || '',
        tags: (meta.tags || '').split(',').map((t) => t.trim()).filter(Boolean),
        sample: meta.sample === 'true',
        minutes: Math.max(1, Math.ceil(body.split(/\s+/).length / 220)),
        html: markdown(body),
      };
    })
    .sort((a, b) => b.number - a.number);
}

const fmtDate = (iso) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', year: 'numeric', month: 'short', day: 'numeric' });

// ---------- Marks and drawings ----------

const starPath = (cx, cy, rx, ry, k = 0.16) =>
  `M${cx},${cy - ry} Q${cx + rx * k},${cy - ry * k} ${cx + rx},${cy} Q${cx + rx * k},${cy + ry * k} ${cx},${cy + ry} ` +
  `Q${cx - rx * k},${cy + ry * k} ${cx - rx},${cy} Q${cx - rx * k},${cy - ry * k} ${cx},${cy - ry}Z`;

const mark = (size = 28) => `<svg class="mark" width="${size}" height="${size}" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
  <circle cx="16" cy="16" r="13.25" fill="none" stroke="currentColor" stroke-width="1.5"/>
  <circle cx="16" cy="16" r="7.75" fill="none" stroke="currentColor" stroke-width="1" opacity=".45"/>
  <path d="${starPath(16, 16, 8.5, 15.5)}" fill="currentColor"/>
</svg>`;

const ICONS = {
  plumbing: '<path d="M4 5h6M7 5v6a6 6 0 0 0 6 6h4M17 14v6"/>',
  hvac: '<path d="M3 7c3-3 6 3 9 0s6-3 9 0M3 12c3-3 6 3 9 0s6-3 9 0M3 17c3-3 6 3 9 0s6-3 9 0"/>',
  electrical: '<path d="M13 3 6 13h5l-1 8 8-11h-5z"/>',
  mechanical: '<path d="M3 20h18L12 4zM7.6 12h8.8M12 4v16"/>',
};
const icon = (k) =>
  `<svg class="icon" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[k] || ''}</svg>`;

// Hero drawing: four concentric rings, one per capability layer. The outer ring is dashed: not reached yet.
function dial(layers) {
  const c = 260;
  const pt = (r, deg) => {
    const a = (deg * Math.PI) / 180;
    return [(c + r * Math.cos(a)).toFixed(1), (c + r * Math.sin(a)).toFixed(1)];
  };
  let ticks = '';
  for (let a = 0; a < 360; a += 5) {
    const long = a % 30 === 0;
    const [x1, y1] = pt(238, a);
    const [x2, y2] = pt(long ? 252 : 244, a);
    ticks += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" class="${long ? 'tick tick-l' : 'tick'}"/>`;
  }
  const radii = [72, 122, 172, 216];
  const angles = [-62, -28, 14, 52];
  const rings = layers
    .map((l, i) => `<circle cx="${c}" cy="${c}" r="${radii[i]}" class="ring ring-${l.state}"/>`)
    .join('');
  const nodes = layers
    .map((l, i) => {
      const [x, y] = pt(radii[i], angles[i]);
      return `<g class="node node-${l.state}"><circle cx="${x}" cy="${y}" r="9" class="halo"/><circle cx="${x}" cy="${y}" r="4"/><text x="${Number(x) + 13}" y="${Number(y) + 4}">${esc(l.id)}</text></g>`;
    })
    .join('');
  return `<svg class="dial" viewBox="0 0 520 520" role="img" aria-label="Four concentric rings around a north star, one ring for each capability layer. The outermost ring is dashed because it has not been reached.">
  <g class="ticks">${ticks}</g>
  <line x1="${c}" y1="20" x2="${c}" y2="500" class="axis"/><line x1="20" y1="${c}" x2="500" y2="${c}" class="axis"/>
  ${rings}
  <path d="${starPath(c, c, 26, 48)}" class="star"/>
  <circle cx="${c}" cy="${c}" r="3" class="core"/>
  ${nodes}
</svg>`;
}

// ---------- Layout ----------

const NAV = [
  ['approach', 'Approach'],
  ['services', 'Services'],
  ['status', 'Status'],
  ['field-notes', 'Field notes'],
  ['water', 'Water systems'],
  ['careers', 'Careers'],
];

function layout({ title, description, root, body, home = false }) {
  const base = home ? '' : root;
  const nav = NAV.map(([id, label]) => `<a href="${base}#${id}" data-nav="${id}">${label}</a>`).join('');
  const fullTitle = title ? `${title} · ${cfg.name}` : `${cfg.name} · ${cfg.tagline}`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(fullTitle)}</title>
<meta name="description" content="${esc(description)}">
<meta name="theme-color" content="#080b10">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${esc(cfg.name)}">
<meta property="og:title" content="${esc(fullTitle)}">
<meta property="og:description" content="${esc(description)}">
<link rel="icon" href="${root}assets/favicon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<link rel="stylesheet" href="${root}assets/styles.css">
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<div class="svcbar">
  <div class="wrap">
    <span>Need a plumber, HVAC tech or electrician? Service is performed by ${esc(svc.name)}.</span>
    <a href="tel:${svc.phoneHref}">Call ${esc(svc.phone)}</a>
  </div>
</div>
<header class="site-head">
  <div class="wrap">
    <a class="brand" href="${home ? '#top' : root}" aria-label="${esc(cfg.name)}, home">${mark(28)}<span>${esc(cfg.name)}</span></a>
    <button class="nav-toggle" type="button" aria-expanded="false" aria-controls="site-nav"><span class="sr">Menu</span><i></i><i></i></button>
    <nav id="site-nav" class="site-nav" aria-label="Sections">${nav}<a class="btn btn-sm" href="${base}#contact">Request service</a></nav>
  </div>
</header>
<main id="main">
${body}
</main>
<footer class="site-foot">
  <div class="wrap">
    <p class="relation">Service work is performed by <a href="${svc.url}">${esc(svc.name)}</a>. Product development and systems work are advanced under ${esc(cfg.name)}.</p>
    <div class="foot-grid">
      <div class="foot-col">
        <p class="label">Service business</p>
        <p class="foot-name">${esc(svc.name)}</p>
        <p>Licensed plumbing, HVAC, electrical and mechanical service. ${esc(svc.area)}.</p>
        <p><a href="tel:${svc.phoneHref}">${esc(svc.phone)}</a><br><a href="mailto:${svc.email}">${esc(svc.email)}</a><br><a href="${svc.url}">${esc(svc.url.replace(/^https?:\/\//, ''))}</a></p>
      </div>
      <div class="foot-col">
        <p class="label">Product and systems</p>
        <p class="foot-name">${mark(18)} ${esc(cfg.name)}</p>
        <p>Measured performance, water systems under test, field notes and the career ladder.</p>
        <p><a href="${base}#approach">Approach</a><br><a href="${root}field-notes/">Field notes</a><br><a href="${base}#careers">Careers</a></p>
      </div>
    </div>
    <p class="fine">© <span data-year>2026</span> ${esc(cfg.name)}. An extension of ${esc(svc.name)}.</p>
  </div>
</footer>
<script src="${root}assets/site.js" defer></script>
</body>
</html>
`;
}

const secHead = (num, label, title, lede) => `<header class="sec-head reveal">
      <p class="label"><b>${num}</b>${esc(label)}</p>
      <h2>${esc(title)}</h2>
      ${lede ? `<p class="lede">${esc(lede)}</p>` : ''}
    </header>`;

const noteCard = (n, root) => `<a class="note-card reveal" href="${root}field-notes/${n.slug}/">
        <p class="note-meta"><span>${n.code}</span><span>${fmtDate(n.date)}</span></p>
        <h3>${esc(n.title)}</h3>
        <p>${esc(n.summary)}</p>
        <p class="tags">${n.tags.map((t) => `<span>${esc(t)}</span>`).join('')}${n.sample ? '<span class="tag-sample">Example</span>' : ''}</p>
        <span class="more">Read note <i aria-hidden="true">→</i></span>
      </a>`;

// ---------- Home ----------

function home({ layers, services, status, water, ladder, notes }) {
  const stateWord = { done: 'Done', active: 'In progress', planned: 'Planned' };

  const hero = `<section class="hero" id="top">
  <div class="wrap hero-grid">
    <div class="hero-copy">
      <p class="label">An extension of ${esc(svc.name)} · ${esc(svc.area)}</p>
      <h1>We add capabilities to humanity.</h1>
      <p class="lede">${esc(cfg.heroLine)}</p>
      <div class="cta">
        <a class="btn" href="#contact">Request service</a>
        <a class="btn btn-ghost" href="#approach">See the approach</a>
      </div>
      <p class="horizon"><span class="label">How we get there</span>Every new tool is proved on ordinary jobs first. Licensed crews do the work. Measurements check it.</p>
    </div>
    <figure class="hero-fig">
      ${dial(layers)}
      <figcaption>
        <ul class="legend">
          ${layers.map((l) => `<li class="lg-${l.state}"><b>${esc(l.id)}</b><span>${esc(l.title)}</span></li>`).join('\n          ')}
        </ul>
      </figcaption>
    </figure>
  </div>
</section>
<section class="creed" aria-label="Mission and vision">
  <div class="wrap creed-grid">
    <div class="reveal">
      <p class="label">Mission</p>
      <p class="creed-text">${esc(cfg.mission)}</p>
      <p class="creed-sub">A capability counts when someone can rely on it on an ordinary day.</p>
    </div>
    <div class="reveal">
      <p class="label">Vision</p>
      <p class="creed-text">${esc(cfg.vision)}</p>
      <p class="creed-sub">A technology becomes a tool once a crew can pick it up, use it and repair it.</p>
    </div>
    <div class="reveal">
      <p class="label">Who we are looking for</p>
      <p class="creed-text">${esc(cfg.magic)}</p>
      <p class="creed-sub">We want to find the wizards who can help make it.</p>
      <a class="link" href="#careers">See careers <i aria-hidden="true">→</i></a>
    </div>
  </div>
</section>`;

  const approach = `<section class="sec" id="approach">
  <div class="wrap">
    ${secHead('01', 'Approach', 'Capability is built in layers.', 'Each layer has to hold before the next one means anything. The service work pays for the rest, and it is where a new tool has to prove itself.')}
    <ol class="layers">
      ${layers
        .map(
          (l) => `<li class="layer layer-${l.state} reveal">
        <div class="layer-id"><b>${esc(l.id)}</b></div>
        <div class="layer-body">
          <h3>${esc(l.title)}</h3>
          <p>${esc(l.body)}</p>
        </div>
        <div class="layer-side">
          <p class="chip chip-${l.state}"><i></i>${esc(l.stateLabel)}</p>
          <p class="evidence"><span class="label">Evidence</span>${esc(l.evidence)}</p>
        </div>
      </li>`
        )
        .join('\n      ')}
    </ol>
  </div>
</section>`;

  const servicesSec = `<section class="sec sec-alt" id="services">
  <div class="wrap">
    ${secHead('02', 'Services', 'Four trades, one crew.', `All service work is booked and performed by ${svc.name}, across ${svc.area}.`)}
    <div class="cards cards-4">
      ${services
        .map(
          (s) => `<article class="card reveal">
        ${icon(s.icon)}
        <h3>${esc(s.title)}</h3>
        <p class="card-lead">${esc(s.lead)}</p>
        <ul class="ticks-list">${s.items.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>
      </article>`
        )
        .join('\n      ')}
    </div>
    <p class="sec-foot reveal"><a class="link" href="${svc.url}">Book service at ${esc(svc.url.replace(/^https?:\/\//, ''))} <i aria-hidden="true">→</i></a><span>or call <a href="tel:${svc.phoneHref}">${esc(svc.phone)}</a>. ${esc(svc.emergency)}.</span></p>
  </div>
</section>`;

  const statusSec = `<section class="sec" id="status">
  <div class="wrap">
    ${secHead('03', 'Progress and status', 'What is true today.', 'Numbers go here when they can be backed. A dash means the figure is not published yet.')}
    <p class="updated reveal"><span class="label">Last updated</span> <time datetime="${status.updated}">${fmtDate(status.updated)}</time></p>
    <div class="metrics">
      ${status.metrics
        .map(
          (m) => `<div class="metric${m.placeholder ? ' is-placeholder' : ''} reveal">
        <p class="label">${esc(m.label)}</p>
        <p class="metric-value">${esc(m.value)}${m.unit ? `<small>${esc(m.unit)}</small>` : ''}</p>
        <p class="metric-detail">${esc(m.detail || '')}</p>
        <p class="metric-src">${m.placeholder ? '<span class="tag-sample">Placeholder</span> Not yet published' : esc(m.source || '')}</p>
      </div>`
        )
        .join('\n      ')}
    </div>
    <div class="status-grid">
      <div class="panel reveal">
        <h3 class="panel-title">Capability milestones</h3>
        <ul class="milestones">
          ${status.milestones
            .map((m) => `<li class="ms-${m.state}"><i aria-hidden="true"></i><span class="ms-layer">${esc(m.layer)}</span><span class="ms-label">${esc(m.label)}</span><span class="ms-state">${stateWord[m.state] || esc(m.state)}</span></li>`)
            .join('\n          ')}
        </ul>
      </div>
      <div class="panel reveal">
        <h3 class="panel-title">Water devices</h3>
        <ul class="devices">
          ${water.devices
            .map((d) => `<li><p class="dev-id">${esc(d.id)}</p><p class="dev-name">${esc(d.name)}</p><p class="chip chip-${d.state}"><i></i>${esc(d.status)}</p><p class="dev-stage">Stage ${d.stage} of ${water.stages.length}</p></li>`)
            .join('\n          ')}
        </ul>
        <a class="link" href="#water">Device detail <i aria-hidden="true">→</i></a>
      </div>
    </div>
  </div>
</section>`;

  const notesSec = `<section class="sec sec-alt" id="field-notes">
  <div class="wrap">
    ${secHead('04', 'Field notes', 'Short technical notes from the work.', 'One problem, how it was measured, what changed. Written so another tradesperson could repeat it.')}
    <div class="cards cards-3">
      ${notes.slice(0, 3).map((n) => noteCard(n, './')).join('\n      ')}
    </div>
    <p class="sec-foot reveal"><a class="link" href="field-notes/">All field notes <i aria-hidden="true">→</i></a></p>
  </div>
</section>`;

  const waterSec = `<section class="sec" id="water">
  <div class="wrap">
    ${secHead('05', 'Water systems', 'In development. Not for sale.', 'Two technologies from outside the trade, being turned into tools. Each one is listed with its stage, what is being measured and what comes next. No performance figures are published until there are logs behind them.')}
    <div class="devices-grid">
      ${water.devices
        .map(
          (d) => `<article class="device reveal">
        <header>
          <p class="dev-id">${esc(d.id)}</p>
          <p class="chip chip-${d.state}"><i></i>${esc(d.status)}</p>
        </header>
        <h3>${esc(d.name)}</h3>
        <p class="device-sum">${esc(d.summary)}</p>
        <p>${esc(d.how)}</p>
        <div class="stage">
          <p class="label">Stage ${d.stage} of ${water.stages.length}</p>
          <div class="stage-bar" aria-hidden="true">${water.stages.map((_, i) => `<i class="${i + 1 < d.stage ? 'is-done' : i + 1 === d.stage ? 'is-now' : ''}"></i>`).join('')}</div>
          <ol class="stage-names">${water.stages.map((s, i) => `<li class="${i + 1 < d.stage ? 'is-done' : i + 1 === d.stage ? 'is-now' : ''}"${i + 1 === d.stage ? ' aria-current="step"' : ''}>${esc(s)}</li>`).join('')}</ol>
        </div>
        <div class="device-cols">
          <div>
            <p class="label">${esc(d.measuringLabel)}</p>
            <ul class="ticks-list">${d.measuring.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>
          </div>
          <div>
            <p class="label">Next step</p>
            <p>${esc(d.next)}</p>
          </div>
        </div>
      </article>`
        )
        .join('\n      ')}
    </div>
  </div>
</section>`;

  const careersSec = `<section class="sec sec-alt" id="careers">
  <div class="wrap">
    ${secHead('06', 'Careers', 'We are looking for wizards.', '')}
    <div class="seek reveal">
      <blockquote>${esc(cfg.magic)} <span>We want to find the people who can help make it.</span></blockquote>
      <div class="seek-list">
        <div>
          <h3>Tradespeople who want to go further</h3>
          <p>Plumbers at any level who want to measure their work, teach it and build systems, not only install them.</p>
        </div>
        <div>
          <h3>People from esoteric fields</h3>
          <p>Deep knowledge of an unusual technology, and the wish to see it become a tool in a crew's hands.</p>
        </div>
      </div>
    </div>
    <header class="sec-head sec-head-sub reveal">
      <h3 class="h-sub">The plumber ladder: nine levels</h3>
      <p class="lede">Every level says what the work is and roughly how long it takes. The later levels add measurement, mentoring and systems work to the trade itself.</p>
    </header>
    <div class="ladder reveal">
      <div class="ladder-head" aria-hidden="true"><span>Level</span><span>Title</span><span>Typical time in level</span><span>Focus</span><span>Adds</span></div>
      ${ladder.bands
        .map(
          (b) => `<p class="band"><span>${esc(b.name)}</span></p>
      <ol class="rungs" start="${b.levels[0].n}">
        ${b.levels
          .map(
            (l) => `<li class="rung">
          <span class="rung-n">${String(l.n).padStart(2, '0')}</span>
          <span class="rung-title">${esc(l.title)}</span>
          <span class="rung-time">${esc(l.time)}</span>
          <span class="rung-focus">${esc(l.focus)}</span>
          <span class="rung-adds">${l.adds.map((a) => `<em class="add add-${a.toLowerCase()}">${esc(a)}</em>`).join('')}</span>
        </li>`
          )
          .join('\n        ')}
      </ol>`
        )
        .join('\n      ')}
    </div>
    <p class="ladder-note reveal"><span class="tag-sample">${esc(ladder.version)}</span> ${esc(ladder.note)} HVAC and electrical ladders will follow.</p>
    <p class="sec-foot reveal"><a class="btn" href="${svc.applyUrl}">Apply through ${esc(svc.name)}</a><span>Hiring is handled by the service business.</span></p>
  </div>
</section>`;

  const contactSec = `<section class="sec" id="contact">
  <div class="wrap">
    ${secHead('07', 'Contact', 'Need service? That is Click Plumbing.'.replace('Click Plumbing', svc.name), '')}
    <div class="contact-grid">
      <div class="contact-main reveal">
        <p class="label">Service, quotes and emergencies</p>
        <p class="contact-name">${esc(svc.name)}</p>
        <a class="contact-phone" href="tel:${svc.phoneHref}">${esc(svc.phone)}</a>
        <dl class="facts">
          <div><dt>Hours</dt><dd>${esc(svc.hours)}<br>${esc(svc.emergency)}</dd></div>
          <div><dt>Area</dt><dd>${esc(svc.area)}</dd></div>
          <div><dt>Office</dt><dd>${svc.address.map(esc).join('<br>')}</dd></div>
          <div><dt>Email</dt><dd><a href="mailto:${svc.email}">${esc(svc.email)}</a></dd></div>
        </dl>
        <div class="cta">
          <a class="btn" href="tel:${svc.phoneHref}">Call ${esc(svc.phone)}</a>
          <a class="btn btn-ghost" href="${svc.contactUrl}">Request a quote online</a>
        </div>
      </div>
      <div class="contact-side reveal">
        <p class="label">${esc(cfg.name)}</p>
        <h3>Systems work, testing and talent</h3>
        <p>Questions about the water devices, the field notes or the career ladder go to the same office. Put "${esc(cfg.shortName)}" in the subject line.</p>
        <a class="link" href="mailto:${cfg.inquiryEmail}?subject=${encodeURIComponent(cfg.shortName + ' inquiry')}">${esc(cfg.inquiryEmail)} <i aria-hidden="true">→</i></a>
      </div>
    </div>
  </div>
</section>`;

  return [hero, approach, servicesSec, statusSec, notesSec, waterSec, careersSec, contactSec].join('\n');
}

// ---------- Field note pages ----------

const sampleBanner = `<p class="sample-note"><span class="tag-sample">Example note</span> This shows the format. The figures are illustrative and do not come from a real job.</p>`;

function notePage(n, i, notes) {
  const newer = notes[i - 1];
  const older = notes[i + 1];
  return `<article class="note">
  <div class="wrap wrap-narrow">
    <p class="crumbs"><a href="../../">Home</a><span>/</span><a href="../">Field notes</a><span>/</span>${n.code}</p>
    <header class="note-head">
      <p class="note-meta"><span>${n.code}</span><span>${fmtDate(n.date)}</span><span>${n.minutes} min read</span></p>
      <h1>${esc(n.title)}</h1>
      <p class="lede">${esc(n.summary)}</p>
      <p class="tags">${n.tags.map((t) => `<span>${esc(t)}</span>`).join('')}</p>
    </header>
    ${n.sample ? sampleBanner : ''}
    <div class="prose">
${n.html}
    </div>
    <nav class="note-nav" aria-label="More field notes">
      ${older ? `<a href="../${older.slug}/"><span class="label">Previous</span>${esc(older.title)}</a>` : '<span></span>'}
      ${newer ? `<a class="next" href="../${newer.slug}/"><span class="label">Next</span>${esc(newer.title)}</a>` : '<span></span>'}
    </nav>
  </div>
</article>`;
}

function notesIndex(notes) {
  return `<section class="sec sec-first">
  <div class="wrap">
    <p class="crumbs"><a href="../">Home</a><span>/</span>Field notes</p>
    <header class="sec-head">
      <p class="label"><b>${String(notes.length).padStart(2, '0')}</b>Field notes</p>
      <h1 class="h2">Short technical notes from the work.</h1>
      <p class="lede">One problem, how it was measured, what changed. Newest first.</p>
    </header>
    <div class="cards cards-3">
      ${notes.map((n) => noteCard(n, '../')).join('\n      ')}
    </div>
  </div>
</section>`;
}

// ---------- Write ----------

function write(rel, html) {
  const file = join(OUT, rel);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, html);
}

const data = {
  layers: json('content/layers.json'),
  services: json('content/services.json'),
  status: json('content/status.json'),
  water: json('content/water.json'),
  ladder: json('content/ladder.json'),
  notes: loadNotes(),
};

rmSync(OUT, { recursive: true, force: true });
mkdirSync(join(OUT, 'assets'), { recursive: true });
for (const f of readdirSync(join(ROOT, 'src'))) copyFileSync(join(ROOT, 'src', f), join(OUT, 'assets', f));
writeFileSync(join(OUT, '.nojekyll'), '');

write('index.html', layout({ title: '', description: cfg.description, root: './', home: true, body: home(data) }));
write('field-notes/index.html', layout({ title: 'Field notes', description: `Short technical notes from ${cfg.name}.`, root: '../', body: notesIndex(data.notes) }));
data.notes.forEach((n, i) =>
  write(`field-notes/${n.slug}/index.html`, layout({ title: `${n.code} ${n.title}`, description: n.summary, root: '../../', body: notePage(n, i, data.notes) }))
);
write(
  '404.html',
  layout({
    title: 'Page not found',
    description: 'Page not found.',
    root: './',
    body: `<section class="sec sec-first"><div class="wrap"><header class="sec-head"><p class="label"><b>404</b>Not found</p><h1 class="h2">That page is not here.</h1><p class="lede">It may have moved.</p></header><a class="btn" href="./">Go to the home page</a></div></section>`,
  })
);

console.log(`Built ${cfg.name}: 1 home page, ${data.notes.length} field notes → dist/`);
