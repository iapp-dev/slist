(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GeminiSponsors = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';

  const TIER_COUNT = 10;
  const ORDERED_LIMIT = 5;
  const layouts = new WeakMap();

  const FALLBACKS = {
    sponsorWallEyebrow: 'POWERED BY GENEROSITY',
    sponsorWallTitle: 'Sponsor Hall of Fame',
    sponsorWallIntro: 'The people helping this project shine.',
    sponsorWallCount: '$1 supporters',
    sponsorWallEmptyTitle: 'The first star could be yours.',
    sponsorWallEmptyText: 'Support the project and leave your name among its stars.',
    sponsorWallJoin: 'Become a sponsor',
    sponsorWallFootnote: 'Every contribution makes a difference.',
    sponsorWallDate: 'Sponsored on $1',
    sponsorWallUnavailable: 'The sponsor list is temporarily unavailable. Please check back soon.'
  };

  function validDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T00:00:00Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }

  function validateSponsors(data) {
    if (!data || !Array.isArray(data.sponsors)) return ['sponsors must be an array'];
    const errors = [];
    data.sponsors.forEach((entry, index) => {
      const prefix = `sponsors[${index}]`;
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        errors.push(`${prefix} must be an object`);
        return;
      }
      if (typeof entry.name !== 'string' || !entry.name.trim() || [...entry.name.trim()].length > 120) {
        errors.push(`${prefix}.name must contain 1 to 120 characters`);
      }
      if (typeof entry.weight !== 'number' || !Number.isFinite(entry.weight) || entry.weight <= 0) {
        errors.push(`${prefix}.weight must be a finite positive number`);
      }
      if (!validDate(entry.date)) errors.push(`${prefix}.date must be a real YYYY-MM-DD date`);
    });
    return errors;
  }

  function normalizeSponsors(data) {
    if (!Array.isArray(data?.sponsors)) return [];
    const entries = data.sponsors.filter(entry => validateSponsors({ sponsors: [entry] }).length === 0)
      .map(entry => ({ name: entry.name.trim(), weight: entry.weight, date: entry.date }))
      .sort((a, b) => b.weight - a.weight);
    if (!entries.length) return entries;
    const minimum = Math.log1p(entries.at(-1).weight);
    const maximum = Math.log1p(entries[0].weight);
    // Quantize relative logarithmic weights so size and variable font weight share ten tiers.
    return entries.map(entry => {
      const relative = maximum === minimum ? 0.5 : (Math.log1p(entry.weight) - minimum) / (maximum - minimum);
      const tier = 1 + Math.round(relative * (TIER_COUNT - 1));
      return { ...entry, tier, scale: (tier - 1) / (TIER_COUNT - 1), fontWeight: 360 + (tier - 1) * 60 };
    });
  }

  function arrangeSponsors(entries) {
    if (entries.length <= ORDERED_LIMIT) return entries.map(entry => ({ ...entry }));
    const occurrences = new Map();
    // Include the record and its occurrence so repeated names get independent stable positions.
    return entries.map(entry => {
      const identity = JSON.stringify([entry.name, entry.weight, entry.date]);
      const occurrence = occurrences.get(identity) || 0;
      occurrences.set(identity, occurrence + 1);
      let seed = 2166136261;
      for (const character of `${identity}:${occurrence}`) seed = Math.imul(seed ^ character.codePointAt(0), 16777619);
      return { ...entry, seed: seed >>> 0 };
    }).sort((a, b) => a.seed - b.seed);
  }

  function randomFor(seed) {
    let state = seed >>> 0;
    return () => {
      state = (state + 0x6d2b79f5) >>> 0;
      let value = Math.imul(state ^ (state >>> 15), state | 1);
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
  }

  function placeSponsors(boxes, width, gap = 10, preferredHeight = Infinity) {
    if (!boxes.length) return { positions: [], height: 0, probes: 0 };
    const cellSize = 64;
    const cells = new Map();
    const positions = new Array(boxes.length);
    const order = boxes.map((box, index) => ({ ...box, index }))
      .sort((a, b) => b.width * b.height - a.width * a.height || a.seed - b.seed);
    const area = boxes.reduce((total, box) => total + (box.width + gap) * (box.height + gap), 0);
    const tallest = boxes.reduce((height, box) => Math.max(height, box.height + gap), 0);
    const fieldHeight = Math.ceil(Math.max(180, tallest, area / (width * 0.58)));
    const firstBandHeight = Math.max(tallest, Math.min(fieldHeight, preferredHeight));
    let bottom = 0;
    let probes = 0;

    function visitCells(rect, margin, visit) {
      for (let x = Math.floor((rect.x - margin) / cellSize); x <= Math.floor((rect.x + rect.width + margin) / cellSize); x++) {
        for (let y = Math.floor((rect.y - margin) / cellSize); y <= Math.floor((rect.y + rect.height + margin) / cellSize); y++) {
          visit(`${x}:${y}`);
        }
      }
    }
    function fits(rect) {
      probes++;
      const neighbors = new Set();
      visitCells(rect, gap, key => { for (const index of cells.get(key) || []) neighbors.add(index); });
      for (const index of neighbors) {
        const other = positions[index];
        if (rect.x < other.x + other.width + gap && rect.x + rect.width + gap > other.x &&
          rect.y < other.y + other.height + gap && rect.y + rect.height + gap > other.y) return false;
      }
      return true;
    }

    // Largest names anchor the visible center; bounded probes use a spatial index instead of scanning every name.
    order.forEach((box, orderIndex) => {
      const random = randomFor(box.seed);
      let position;
      for (let attempt = 0; attempt < 256; attempt++) {
        const centered = orderIndex === 0 && attempt === 0;
        const height = attempt < 32 ? firstBandHeight : fieldHeight;
        const candidate = { x: Math.round((width - box.width) * (centered ? 0.5 : random())),
          y: Math.round((height - box.height) * (centered ? 0.5 : random())), width: box.width, height: box.height };
        if (fits(candidate)) { position = candidate; break; }
      }
      // A new band always fits, including full-width wrapped names on very narrow screens.
      if (!position) position = { x: Math.round((width - box.width) * random()), y: bottom + gap,
        width: box.width, height: box.height };
      positions[box.index] = position;
      bottom = Math.max(bottom, position.y + position.height);
      visitCells(position, 0, key => {
        if (!cells.has(key)) cells.set(key, []);
        cells.get(key).push(box.index);
      });
    });
    return { positions, height: Math.max(180, bottom), probes };
  }

  function scatterSponsors(document, cloud, entries) {
    const view = document.defaultView;
    const items = [...cloud.children];
    let frame = null;
    let previousWidth = -1;
    let disposed = false;

    function layout() {
      frame = null;
      if (disposed || !cloud.isConnected) return;
      const style = view.getComputedStyle(cloud);
      const paddingLeft = parseFloat(style.paddingLeft);
      const paddingRight = parseFloat(style.paddingRight);
      const paddingTop = parseFloat(style.paddingTop);
      const gutter = Math.max(0, cloud.offsetWidth - cloud.clientWidth) / 2;
      const inset = paddingLeft + gutter + 4;
      const width = Math.floor(cloud.clientWidth - paddingLeft - paddingRight - 8);
      if (width <= 0) return;
      previousWidth = cloud.clientWidth;
      // Batch width constraints, measurements, then coordinates to avoid per-probe DOM work.
      items.forEach(item => { item.style.maxWidth = `${width}px`; });
      const boxes = items.map((item, index) => ({ width: Math.ceil(item.offsetWidth), height: Math.ceil(item.offsetHeight), seed: entries[index].seed }));
      const dense = cloud.closest('.sponsor-wall').dataset.density === 'dense';
      const packed = placeSponsors(boxes, width, dense ? 6 : 10, dense ? 300 : Infinity);
      packed.positions.forEach((position, index) => {
        items[index].style.left = `${inset + position.x}px`;
        items[index].style.top = `${paddingTop + position.y}px`;
      });
      cloud.style.setProperty('--sponsor-field-height', `${packed.height}px`);
      cloud.dataset.layoutWidth = String(previousWidth);
    }
    const observer = new view.ResizeObserver(() => {
      if (cloud.clientWidth !== previousWidth && frame === null) frame = view.requestAnimationFrame(layout);
    });
    const controller = { dispose() {
      disposed = true;
      observer.disconnect();
      if (frame !== null) view.cancelAnimationFrame(frame);
    } };
    layouts.set(cloud, controller);
    layout();
    observer.observe(cloud);
    return document.fonts.status === 'loaded' ? Promise.resolve() : document.fonts.ready.then(() => { if (!disposed) layout(); });
  }

  function densityFor(count) {
    return count <= ORDERED_LIMIT ? 'sparse' : count <= 24 ? 'regular' : 'dense';
  }

  function message(i18n, key, substitutions) {
    return i18n.getMessage(key, substitutions) || (FALLBACKS[key] || key).replace('$1', substitutions || '');
  }

  function dateFormatter(language) {
    const options = { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' };
    try { return new Intl.DateTimeFormat(language.replace(/_/g, '-'), options); }
    catch (_) { return new Intl.DateTimeFormat('en', options); }
  }

  function renderSponsors(document, entries, i18n, language) {
    const wall = document.getElementById('sponsor-wall');
    const cloud = document.getElementById('sponsor-cloud');
    const empty = document.getElementById('sponsor-empty');
    const count = document.getElementById('sponsor-count');
    layouts.get(cloud)?.dispose();
    layouts.delete(cloud);
    cloud.style.removeProperty('--sponsor-field-height');
    delete cloud.dataset.layoutWidth;
    const formatter = dateFormatter(language);
    const fragment = document.createDocumentFragment();
    const arranged = arrangeSponsors(entries);
    for (const entry of arranged) {
      const item = document.createElement('li');
      item.className = 'sponsor-entry';
      const name = document.createElement('button');
      name.type = 'button';
      name.className = `sponsor-name${entry.tier >= 8 ? ' sponsor-name--featured' : ''}`;
      name.textContent = entry.name;
      name.style.setProperty('--sponsor-scale', entry.scale.toFixed(4));
      name.style.setProperty('--sponsor-font-weight', String(entry.fontWeight));
      name.dataset.sponsorTier = String(entry.tier);
      name.dataset.sponsorDate = entry.date;
      const dateText = message(i18n, 'sponsorWallDate', formatter.format(new Date(`${entry.date}T00:00:00Z`)));
      name.dataset.sponsorDateText = dateText;
      name.setAttribute('aria-label', `${entry.name}. ${dateText}`);
      item.appendChild(name);
      fragment.appendChild(item);
    }
    cloud.replaceChildren(fragment);
    wall.dataset.density = densityFor(entries.length);
    wall.dataset.layout = entries.length > ORDERED_LIMIT ? 'scattered' : 'ordered';
    cloud.tabIndex = wall.dataset.density === 'dense' ? 0 : -1;
    cloud.scrollTop = 0;
    cloud.hidden = entries.length === 0;
    empty.hidden = entries.length !== 0;
    count.hidden = entries.length === 0;
    count.textContent = entries.length ? message(i18n, 'sponsorWallCount', String(entries.length)) : '';
    if (entries.length > ORDERED_LIMIT) return scatterSponsors(document, cloud, arranged);
    return Promise.resolve();
  }

  function attachTooltip(document) {
    const cloud = document.getElementById('sponsor-cloud');
    const tooltip = document.getElementById('sponsor-tooltip');
    const view = document.defaultView;
    let activeName = null;
    let closeTimer = null;

    function hide() {
      clearTimeout(closeTimer);
      if (!activeName && tooltip.hidden) return;
      activeName?.removeAttribute('aria-describedby');
      activeName = null;
      tooltip.hidden = true;
    }
    function show(name) {
      if (!name) return;
      clearTimeout(closeTimer);
      activeName?.removeAttribute('aria-describedby');
      activeName = name;
      tooltip.textContent = name.dataset.sponsorDateText;
      tooltip.hidden = false;
      name.setAttribute('aria-describedby', tooltip.id);
      const bounds = name.getBoundingClientRect();
      const tip = tooltip.getBoundingClientRect();
      const margin = 8;
      const left = Math.max(margin, Math.min(bounds.left + (bounds.width - tip.width) / 2, view.innerWidth - tip.width - margin));
      const above = bounds.top - tip.height - margin;
      const top = above >= margin ? above : Math.min(bounds.bottom + margin, view.innerHeight - tip.height - margin);
      tooltip.style.left = `${left}px`;
      tooltip.style.top = `${Math.max(margin, top)}px`;
    }
    function nameFrom(target) {
      const name = target?.closest?.('.sponsor-name');
      return name && cloud.contains(name) ? name : null;
    }
    function scheduleHide() {
      clearTimeout(closeTimer);
      closeTimer = setTimeout(() => { if (document.activeElement !== activeName) hide(); }, 120);
    }

    // A shared tooltip and delegated events keep listener count independent of the list size.
    cloud.addEventListener('pointerover', event => show(nameFrom(event.target)));
    cloud.addEventListener('pointermove', event => {
      const name = nameFrom(event.target);
      if (name && (activeName !== name || tooltip.hidden)) show(name);
    });
    cloud.addEventListener('pointerout', event => {
      if (event.relatedTarget && (tooltip.contains(event.relatedTarget) || nameFrom(event.relatedTarget))) return;
      scheduleHide();
    });
    cloud.addEventListener('focusin', event => show(nameFrom(event.target)));
    cloud.addEventListener('focusout', hide);
    cloud.addEventListener('click', event => show(nameFrom(event.target)));
    tooltip.addEventListener('pointerenter', () => clearTimeout(closeTimer));
    tooltip.addEventListener('pointerleave', scheduleHide);
    document.addEventListener('pointerdown', event => {
      if (!nameFrom(event.target) && !tooltip.contains(event.target)) hide();
    });
    document.addEventListener('keydown', event => { if (event.key === 'Escape') hide(); });
    document.addEventListener('scroll', () => {
      if (!activeName) return;
      if (document.activeElement !== activeName && !activeName.matches(':hover')) return hide();
      const bounds = activeName.getBoundingClientRect();
      const cloudBounds = cloud.getBoundingClientRect();
      if (bounds.bottom <= Math.max(0, cloudBounds.top) || bounds.top >= Math.min(view.innerHeight, cloudBounds.bottom)) hide();
      else show(activeName);
    }, { capture: true, passive: true });
    view.addEventListener('resize', hide, { passive: true });
  }

  async function init(document, chrome) {
    const wall = document.getElementById('sponsor-wall');
    const status = document.getElementById('sponsor-wall-status');
    const language = chrome.i18n.getUILanguage() || 'en';
    wall.querySelectorAll('[data-i18n]').forEach(element => {
      element.textContent = message(chrome.i18n, element.dataset.i18n);
    });
    attachTooltip(document);
    wall.setAttribute('aria-busy', 'true');
    try {
      // Only the options page reads this bundled file; no network polling or background work.
      const response = await fetch(chrome.runtime.getURL('runtime/sponsors.json'));
      if (!response.ok) throw new Error('Sponsor list unavailable');
      const data = await response.json();
      if (!Array.isArray(data?.sponsors)) throw new Error('Invalid sponsor list');
      await renderSponsors(document, normalizeSponsors(data), chrome.i18n, language);
    } catch (_) {
      document.getElementById('sponsor-cloud').hidden = true;
      document.getElementById('sponsor-empty').hidden = true;
      document.getElementById('sponsor-count').hidden = true;
      status.textContent = message(chrome.i18n, 'sponsorWallUnavailable');
      status.hidden = false;
    } finally {
      wall.setAttribute('aria-busy', 'false');
    }
  }

  return { validDate, validateSponsors, normalizeSponsors, arrangeSponsors, placeSponsors, densityFor, message, renderSponsors, init };
});
