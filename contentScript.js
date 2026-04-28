
// contentScript.js
// Runs on Algolia dashboard pages and rewrites category IDs to labels when possible.
// Supports legacy dashboard pages and selected Merch Studio routes.

const MAX_IDS_PER_CYCLE = 120;

let cachedMappings = {};
let cachedEnabled = false;
let observerStarted = false;
let lastRunAt = 0;
let retryCount = 0;
let lastUrl = location.href;

const COMMON_FALSE_POSITIVES = new Set([
  'true', 'false', 'yes', 'no', 'on', 'off', 'null', 'undefined', 'nan'
]);

function isContextValid() {
  try {
    return !!chrome.runtime && !!chrome.runtime.id;
  } catch (e) {
    return false;
  }
}

function getRouteKind(pathname = location.pathname) {
  if (/\/merchandising\/studio\/[^/]+\/visualize\/[^/]+/.test(pathname)) {
    return 'studio-visualize';
  }
  if (/\/merchandising\/studio\/[^/]+\/analytics\/[^/]+\/category-page\/category-pages/.test(pathname)) {
    return 'studio-analytics-category-pages';
  }
  if (/\/merchandising\/studio\/[^/]+\/analytics\/[^/]+\/search\/grouped-searches/.test(pathname)) {
    return 'studio-analytics-grouped-searches';
  }
  return 'legacy-dashboard';
}

function decodeHtml(text) {
  const el = document.createElement('textarea');
  el.innerHTML = text || '';
  return el.value;
}

function normalisePlainText(text) {
  return decodeHtml(String(text || ''))
    .replace(/\s+/g, ' ')
    .trim();
}

function normaliseCategoryText(text) {
  return normalisePlainText(String(text || ''))
    .replace(/^category:\s*/i, '')
    .replace(/\s*>\s*/g, ' > ');
}

function getOwnText(el) {
  if (!el) return '';
  const ownText = [];
  el.childNodes.forEach((node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = normalisePlainText(node.textContent || '');
      if (text) ownText.push(text);
    }
  });
  return ownText.join(' ').trim();
}

function getNodeText(node) {
  return normalisePlainText(node?.textContent || '');
}

function isLikelyCategoryId(text, opts = {}) {
  const { allowSingleChar = false } = opts;
  const value = normalisePlainText(text);
  if (!value) return false;
  if (COMMON_FALSE_POSITIVES.has(value.toLowerCase())) return false;
  if (!/^[0-9a-z_-]+$/i.test(value)) return false;
  if (value.length === 1 && !allowSingleChar) return false;
  if (/^20\d{2}$/.test(value)) return false;
  return true;
}

function getRefinementValuesFromUrl() {
  try {
    const url = new URL(location.href);
    const values = [];
    url.searchParams.forEach((value, key) => {
      if (key.startsWith('refinementList[')) {
        const clean = normaliseCategoryText(value);
        if (clean) values.push(clean);
      }
    });
    return [...new Set(values)];
  } catch (e) {
    return [];
  }
}

function expandHierarchy(path) {
  const clean = normaliseCategoryText(path);
  if (!clean || !clean.includes(' > ')) return clean ? [clean] : [];
  const parts = clean.split(' > ').map((s) => s.trim()).filter(Boolean);
  return parts.map((_, idx) => parts.slice(0, idx + 1).join(' > '));
}

function getCandidateCategorySet() {
  const set = new Set();
  getRefinementValuesFromUrl().forEach((value) => {
    set.add(value);
    expandHierarchy(value).forEach((part) => set.add(part));
  });
  return set;
}

async function sendRuntimeMessage(message) {
  if (!isContextValid()) {
    return { success: false, error: 'Extension context invalidated.' };
  }

  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(message, (res) => {
        if (chrome.runtime.lastError) {
          resolve({ success: false, error: chrome.runtime.lastError.message });
          return;
        }
        resolve(res || { success: false, error: 'No response.' });
      });
    } catch (e) {
      resolve({ success: false, error: 'Extension context invalidated.' });
    }
  });
}

async function loadPublicState() {
  const res = await sendRuntimeMessage({ type: 'GET_PUBLIC_STATE' });
  if (!res.success) {
    return { enabled: cachedEnabled, mappings: cachedMappings, error: res.error || 'Could not load state.' };
  }

  cachedEnabled = !!res.state?.enabled;
  cachedMappings = res.state?.mappings || {};
  return { enabled: cachedEnabled, mappings: cachedMappings };
}

async function reportPageStatus(status) {
  if (!isContextValid()) return;
  try {
    await sendRuntimeMessage({ type: 'REPORT_PAGE_STATUS', status });
  } catch (e) {
    // ignore
  }
}

function shouldIgnoreTextNode(node) {
  const el = node.parentElement;
  if (!el) return true;
  const tagName = (el.tagName || '').toLowerCase();
  if (['script', 'style', 'noscript', 'textarea'].includes(tagName)) return true;
  if (el.closest('script, style, noscript')) return true;
  if (el.closest('[data-algolia-category-helper-ignore="true"]')) return true;
  return false;
}

function walkTextNodes(root, callback) {
  if (!root) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const text = normalisePlainText(node.textContent || '');
      if (!text) return NodeFilter.FILTER_REJECT;
      if (shouldIgnoreTextNode(node)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    }
  });

  let current;
  while ((current = walker.nextNode())) {
    callback(current);
  }
}

function collectTextNodeCandidates(root, opts = {}) {
  const results = [];
  walkTextNodes(root, (node) => {
    const value = getNodeText(node);
    if (!isLikelyCategoryId(value, opts)) return;
    results.push({ node, id: value });
  });
  return results;
}

function ancestorTextContains(el, pattern) {
  let current = el;
  for (let i = 0; i < 6 && current; i += 1) {
    const text = normalisePlainText(
      (typeof current.innerText === 'string' ? current.innerText : current.textContent) || ''
    ).slice(0, 800);
    if (pattern.test(text)) return true;
    current = current.parentElement;
  }
  return false;
}

function findBadgeRow(el) {
  let current = el;
  for (let i = 0; i < 4 && current; i += 1) {
    const pieces = Array.from(current.querySelectorAll('span, div, a, strong'))
      .slice(0, 20)
      .map((item) => normalisePlainText(getOwnText(item) || item.textContent || ''))
      .filter(Boolean);

    const shortPieces = pieces.filter((piece) => {
      return piece.length <= 14 && (
        /^\$/.test(piece) ||
        isLikelyCategoryId(piece, { allowSingleChar: true }) ||
        /^\d+(?:\.\d+)?$/.test(piece)
      );
    });

    if (shortPieces.length >= 2 && current.querySelector('svg')) {
      return current;
    }
    current = current.parentElement;
  }
  return null;
}

function scoreVisualizeCandidate(node, id) {
  const el = node.parentElement;
  if (!el) return -99;
  if (COMMON_FALSE_POSITIVES.has(id.toLowerCase())) return -99;

  let score = 0;
  const row = el.closest('button, [role="option"], [role="menuitem"], li, label, a, div') || el;
  const rowText = normalisePlainText((row.innerText || row.textContent || '').slice(0, 400));

  if (/\d{1,3}(?:,\d{3})+/.test(rowText)) score += 2;
  if (row.querySelector?.('input[type="checkbox"]')) score += 2;
  if (el.closest('[role="dialog"], [aria-modal="true"]')) score += 2;
  if (ancestorTextContains(el, /(search categories|category page|collection|facets\.categories)/i)) score += 2;
  if (findBadgeRow(el)) score += 2;
  if (/\$/.test(rowText) && findBadgeRow(el)) score += 1;
  if (/(stl-truncate|stl-break-all|stl-whitespace-normal)/.test(el.className || '')) score += 1;
  if (id.length === 1 && score < 4) score -= 2;

  return score;
}

function findLegacyCategoryNodes() {
  const pairs = [];

  const treeButtons = document.querySelectorAll('li[role="treeitem"] > button');
  treeButtons.forEach((btn) => {
    btn.childNodes.forEach((node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        const raw = getNodeText(node);
        if (isLikelyCategoryId(raw)) {
          pairs.push({ node, id: raw, context: 'tree' });
        }
      }
    });
  });

  const allSpans = document.querySelectorAll('span');
  allSpans.forEach((span) => {
    const raw = normalisePlainText(span.textContent || '');
    if (isLikelyCategoryId(raw) && normalisePlainText(span.textContent || '') === raw) {
      const textNode = Array.from(span.childNodes).find((n) => n.nodeType === Node.TEXT_NODE);
      pairs.push({ node: textNode || span, id: raw, context: 'span' });
    }
  });

  const arrowParents = document.querySelectorAll('[class*="arrow"], [class*="chevron"]');
  arrowParents.forEach((elem) => {
    const parent = elem.parentElement;
    if (!parent) return;

    parent.childNodes.forEach((node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        const raw = getNodeText(node);
        if (isLikelyCategoryId(raw)) {
          pairs.push({ node, id: raw, context: 'hierarchy' });
        }
      }
    });
  });

  if (ancestorTextContains(document.body, /facets\.categories/i)) {
    collectTextNodeCandidates(document.body, { allowSingleChar: false }).forEach((pair) => {
      const el = pair.node.parentElement;
      if (!el) return;
      const rowText = normalisePlainText((el.parentElement?.textContent || '').slice(0, 250));
      if (/\d{1,3}(?:,\d{3})+/.test(rowText) && el.parentElement?.querySelector('input[type="checkbox"]')) {
        pairs.push({ node: pair.node, id: pair.id, context: 'facet-row' });
      }
    });
  }

  const seen = new Set();
  return pairs.filter((pair) => {
    if (!pair.node || seen.has(pair.node)) return false;
    seen.add(pair.node);
    return true;
  });
}

function findMerchStudioCategoryPagesTargets() {
  const results = [];
  const tables = Array.from(document.querySelectorAll('table'));
  const seen = new Set();

  tables.forEach((table) => {
    const headerCells = Array.from(table.querySelectorAll('thead th'));
    const categoryIndex = headerCells.findIndex((cell) => normalisePlainText(cell.textContent || '').toLowerCase() === 'category page');
    if (categoryIndex < 0) return;

    Array.from(table.querySelectorAll('tbody tr')).forEach((row) => {
      const cell = row.children[categoryIndex];
      if (!cell) return;

      const target = cell.querySelector('a, span, strong') || cell;
      const value = normaliseCategoryText(target.textContent || '');
      if (!value || !value.includes(' > ')) return;
      if (seen.has(target)) return;
      seen.add(target);

      results.push({
        el: target,
        value,
        route: 'studio-analytics-category-pages',
        matchType: 'category-table'
      });
    });
  });

  return results;
}

function findMerchStudioGroupedSearchTargets() {
  const results = [];
  const seen = new Set();
  const elements = document.querySelectorAll('div.stl-truncate.direction-rtl > strong, div.direction-rtl strong');

  elements.forEach((el) => {
    const value = normaliseCategoryText(el.textContent || '');
    if (!value) return;
    if (seen.has(el)) return;
    seen.add(el);

    results.push({
      el,
      value,
      route: 'studio-analytics-grouped-searches',
      matchType: 'grouped-search-heading'
    });
  });

  return results;
}

function findMerchStudioVisualizeSemanticTargets() {
  const results = [];
  const seen = new Set();
  const candidates = getCandidateCategorySet();

  const elements = document.querySelectorAll([
    'main span.stl-truncate.stl-flex-1',
    'main span.stl-whitespace-normal.stl-break-all.stl-ml-2',
    'main span.stl-truncate',
    'main button span',
    'main [role="button"] span'
  ].join(', '));

  elements.forEach((el) => {
    const rawText = normaliseCategoryText(el.textContent || '');
    if (!rawText) return;

    const isExplicit = /^category:\s*/i.test(normalisePlainText(el.textContent || ''));
    const isCandidateMatch = candidates.size > 0 && candidates.has(rawText);

    if (!isExplicit && !isCandidateMatch) return;
    if (seen.has(el)) return;
    seen.add(el);

    results.push({
      el,
      value: rawText,
      route: 'studio-visualize',
      matchType: isExplicit ? 'prefixed-filter-label' : 'url-refinement-match'
    });
  });

  return results;
}

function findMerchStudioVisualizeIdNodes() {
  const results = [];
  const seen = new Set();
  const roots = [document.querySelector('main') || document.body, ...Array.from(document.querySelectorAll('[role="dialog"], [aria-modal="true"]'))];

  roots.forEach((root) => {
    collectTextNodeCandidates(root, { allowSingleChar: true }).forEach((pair) => {
      const key = `${pair.id}|${pair.node.parentElement}`;
      if (seen.has(key)) return;

      const score = scoreVisualizeCandidate(pair.node, pair.id);
      if (score < 3) return;

      seen.add(key);
      results.push({
        node: pair.node,
        id: pair.id,
        context: 'studio-visualize-id',
        score
      });
    });
  });

  return results;
}

function attachSemanticMeta(el, value, extra = {}) {
  if (!el || !value) return false;
  if (el.dataset.algoliaCategoryHelperSemanticApplied === 'true') return false;

  el.dataset.algoliaCategoryHelperSemanticApplied = 'true';
  el.dataset.algoliaCategoryHelperCategoryValue = value;
  el.dataset.algoliaCategoryHelperRoute = extra.route || '';
  el.dataset.algoliaCategoryHelperMatchType = extra.matchType || '';

  const titleParts = [];
  if (el.getAttribute('title')) titleParts.push(el.getAttribute('title'));
  titleParts.push(`Category: ${value}`);
  el.setAttribute('title', [...new Set(titleParts)].join(' | '));

  if (!el.dataset.algoliaCategoryHelperStyled) {
    el.style.outline = el.style.outline || '1px solid rgba(84,104,255,0.35)';
    el.style.outlineOffset = el.style.outlineOffset || '2px';
    el.style.borderRadius = el.style.borderRadius || '4px';
    el.dataset.algoliaCategoryHelperStyled = 'true';
  }

  return true;
}

function applySemanticTargets(targets) {
  let appliedCount = 0;
  targets.forEach((target) => {
    if (attachSemanticMeta(target.el, target.value, { route: target.route, matchType: target.matchType })) {
      appliedCount += 1;
    }
  });
  return appliedCount;
}

function applyLabelsToDom(nodes, mappings) {
  let appliedCount = 0;

  nodes.forEach(({ node, id }) => {
    const label = mappings[id];
    if (!label) return;

    const host = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
    if (!host) return;
    if (host.dataset.algoliaCategoryHelperApplied === 'true') return;

    const originalText = node.nodeType === Node.TEXT_NODE ? getNodeText(node) : normalisePlainText(node.textContent || '');
    const newText = `${label} (${originalText})`;

    if (node.nodeType === Node.TEXT_NODE) {
      node.textContent = newText;
    } else {
      node.textContent = newText;
    }

    host.dataset.algoliaCategoryHelperApplied = 'true';
    host.dataset.algoliaCategoryHelperId = id;
    host.dataset.algoliaCategoryHelperLabel = label;
    host.setAttribute('title', `Category: ${label} (${id})`);

    appliedCount += 1;
  });

  return appliedCount;
}

async function lookupMissingIds(nodes) {
  const ids = Array.from(new Set(nodes.map((item) => item.id))).slice(0, MAX_IDS_PER_CYCLE);
  const missing = ids.filter((id) => !cachedMappings[id]);

  if (!missing.length) {
    return { success: true, ids, missing: [] };
  }

  const response = await sendRuntimeMessage({ type: 'ALGOLIA_LOOKUP', ids: missing });
  if (response.success) {
    cachedMappings = response.labels || cachedMappings;
    return { success: true, ids, missing };
  }

  return { success: false, ids, missing, error: response.error || 'Lookup failed.' };
}

async function runScan() {
  const state = await loadPublicState();
  const route = getRouteKind();
  const notes = [];
  const status = {
    route,
    state: 'idle',
    uniqueIds: 0,
    labelsApplied: 0,
    semanticTargets: 0,
    unresolvedIds: [],
    notes,
    message: '',
    lastError: ''
  };

  if (state.error) {
    status.state = 'error';
    status.message = 'Could not load extension state.';
    status.lastError = state.error;
    await reportPageStatus(status);
    return status;
  }

  if (!state.enabled) {
    status.state = 'disabled';
    status.message = 'Extension is disabled.';
    await reportPageStatus(status);
    return status;
  }

  if (route === 'legacy-dashboard') {
    const nodes = findLegacyCategoryNodes();
    status.uniqueIds = Array.from(new Set(nodes.map((item) => item.id))).length;

    if (!nodes.length) {
      status.state = 'warning';
      status.message = 'No category ID candidates found on this page.';
      await reportPageStatus(status);
      return status;
    }

    const lookup = await lookupMissingIds(nodes);
    if (!lookup.success) {
      status.state = 'error';
      status.message = 'Category lookup failed.';
      status.lastError = lookup.error || '';
      status.unresolvedIds = lookup.missing || [];
      await reportPageStatus(status);
      return status;
    }

    status.labelsApplied = applyLabelsToDom(nodes, cachedMappings);
    status.unresolvedIds = lookup.ids.filter((id) => !cachedMappings[id]);
    status.state = status.labelsApplied ? 'ok' : 'warning';
    status.message = status.labelsApplied
      ? `Applied ${status.labelsApplied} label(s) on the current page.`
      : 'No labels were applied. Check your field mapping.';
    if (status.unresolvedIds.length) {
      notes.push('Some detected IDs did not resolve to labels.');
    }

    await reportPageStatus(status);
    return status;
  }

  if (route === 'studio-visualize') {
    const idNodes = findMerchStudioVisualizeIdNodes();
    const semanticTargets = findMerchStudioVisualizeSemanticTargets();

    status.uniqueIds = Array.from(new Set(idNodes.map((item) => item.id))).length;
    status.semanticTargets = semanticTargets.length;

    if (!idNodes.length && !semanticTargets.length) {
      status.state = 'warning';
      status.message = 'No Merch Studio category targets were detected.';
      notes.push('Open the category chooser or category facets panel and run the check again.');
      await reportPageStatus(status);
      return status;
    }

    const lookup = await lookupMissingIds(idNodes);
    if (!lookup.success) {
      status.state = 'error';
      status.message = 'Category lookup failed on the Merch Studio page.';
      status.lastError = lookup.error || '';
      status.unresolvedIds = lookup.missing || [];
      await reportPageStatus(status);
      return status;
    }

    status.labelsApplied = applyLabelsToDom(idNodes, cachedMappings);
    applySemanticTargets(semanticTargets);
    status.unresolvedIds = lookup.ids.filter((id) => !cachedMappings[id]);

    if (!status.labelsApplied && semanticTargets.length) {
      status.state = 'warning';
      status.message = 'Category labels were detected, but no raw category IDs were replaced.';
      notes.push('This usually means the page is already showing human-readable category labels.');
    } else if (status.labelsApplied) {
      status.state = 'ok';
      status.message = `Applied ${status.labelsApplied} label(s) on the Merch Studio page.`;
    } else {
      status.state = 'warning';
      status.message = 'No labels were applied. Check your field mapping and open category surfaces before running the check.';
    }

    if (status.unresolvedIds.length) {
      notes.push('Some Merch Studio IDs were detected but could not be resolved.');
    }

    await reportPageStatus(status);
    return status;
  }

  if (route === 'studio-analytics-category-pages' || route === 'studio-analytics-grouped-searches') {
    const semanticTargets = route === 'studio-analytics-category-pages'
      ? findMerchStudioCategoryPagesTargets()
      : findMerchStudioGroupedSearchTargets();

    status.semanticTargets = semanticTargets.length;
    applySemanticTargets(semanticTargets);

    status.state = semanticTargets.length ? 'ok' : 'warning';
    status.message = semanticTargets.length
      ? 'Detected human-readable category labels on this analytics page.'
      : 'No category labels were detected on this analytics page.';
    notes.push('Analytics pages typically show labels already, so no ID replacement may be needed.');

    await reportPageStatus(status);
    return status;
  }

  status.state = 'warning';
  status.message = 'Unknown page type.';
  await reportPageStatus(status);
  return status;
}

function debouncedRun() {
  const now = Date.now();
  if (now - lastRunAt < 400) return;
  lastRunAt = now;
  runScan();
}

function setupMutationObserver() {
  if (observerStarted) return;
  const target = document.querySelector('main') || document.body;
  if (!target) return;

  const observer = new MutationObserver(() => {
    debouncedRun();
  });

  observer.observe(target, { childList: true, subtree: true });
  observerStarted = true;
}

function setupNavigationListeners() {
  if (window.__algoliaCategoryHelperNavigationHooked) return;
  window.__algoliaCategoryHelperNavigationHooked = true;

  const onLocationMaybeChanged = () => {
    if (location.href === lastUrl) return;
    lastUrl = location.href;
    setTimeout(runScan, 60);
    setTimeout(runScan, 500);
  };

  ['pushState', 'replaceState'].forEach((methodName) => {
    const original = history[methodName];
    if (typeof original !== 'function') return;
    history[methodName] = function(...args) {
      const result = original.apply(this, args);
      onLocationMaybeChanged();
      return result;
    };
  });

  window.addEventListener('popstate', onLocationMaybeChanged);
  window.addEventListener('hashchange', onLocationMaybeChanged);
}

function retryRun() {
  if (!isContextValid()) return;
  runScan();
  retryCount += 1;
  if (retryCount < 10) {
    setTimeout(retryRun, 1000);
  }
}

function start() {
  runScan();
  setupMutationObserver();
  setupNavigationListeners();
  setTimeout(retryRun, 1000);
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'RUN_PAGE_SCAN') {
    runScan().then((status) => {
      sendResponse({ success: true, status });
    }).catch((error) => {
      sendResponse({ success: false, error: error?.message || 'Page scan failed.' });
    });
    return true;
  }
  return false;
});

document.addEventListener('DOMContentLoaded', () => {
  start();
});

if (document.readyState !== 'loading') {
  start();
}
