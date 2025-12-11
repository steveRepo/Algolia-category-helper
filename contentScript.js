
// contentScript.js
// Runs on Algolia dashboard pages and rewrites category IDs to labels when possible.

const STORAGE_KEYS = {
  CONFIG: 'algoliaCategoryHelper_config',
  MAPPINGS: 'algoliaCategoryHelper_mappings'
};

function csLog(...args) {
  console.log('[Algolia Category Helper][cs]', ...args);
}

function isLikelyCategoryId(text) {
  const t = (text || '').trim();
  if (!t) return false;
  // Plain digits or slug-ish strings; avoid single digit noise
  if (!/^[0-9a-z-]+$/i.test(t)) return false;
  if (t.length < 2) return false;
  // Ignore things that clearly look like years
  if (/^20\d{2}$/.test(t)) return false;
  return true;
}

// Cache mappings in the content script for faster access
let cachedMappings = {};
let lastAppliedVersion = 0;

async function loadMappings() {
  return new Promise((resolve) => {
    chrome.storage.local.get([STORAGE_KEYS.MAPPINGS], (res) => {
      cachedMappings = res[STORAGE_KEYS.MAPPINGS] || {};
      resolve(cachedMappings);
    });
  });
}

/**
 * Extract candidate nodes and IDs from:
 *  - Query Categorization "Categories tree" tab (left side tree)
 *  - Predictions list cards (IDs under each prediction)
 */
function findCategoryNodes() {
  const pairs = [];

  // 1) Tree view: li[role="treeitem"] > button (more flexible selector)
  const treeButtons = document.querySelectorAll('li[role="treeitem"] > button');
  treeButtons.forEach((btn) => {
    btn.childNodes.forEach((node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        const raw = node.textContent.trim();
        if (isLikelyCategoryId(raw)) {
          pairs.push({ node, id: raw, context: 'tree' });
        }
      }
    });
  });

  // 2) Broader search: all text nodes in spans that might contain category IDs
  const allSpans = document.querySelectorAll('span');
  allSpans.forEach((span) => {
    // Check direct text content
    const raw = span.textContent.trim();
    if (isLikelyCategoryId(raw) && span.textContent === raw) {
      // Only match if the span contains ONLY the ID (no other text)
      const textNode = Array.from(span.childNodes).find(n => n.nodeType === Node.TEXT_NODE);
      if (textNode) {
        pairs.push({ node: textNode, id: raw, context: 'span' });
      } else {
        pairs.push({ node: span, id: raw, context: 'span' });
      }
    }
  });

  // 3) Search in elements with specific arrow icons (category hierarchies)
  const arrowParents = document.querySelectorAll('[class*="arrow"], [class*="chevron"]');
  arrowParents.forEach((elem) => {
    const parent = elem.parentElement;
    if (!parent) return;

    parent.childNodes.forEach((node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        const raw = node.textContent.trim();
        if (isLikelyCategoryId(raw)) {
          pairs.push({ node, id: raw, context: 'hierarchy' });
        }
      }
    });
  });

  // De-duplicate by node
  const seen = new Set();
  const unique = [];
  for (const p of pairs) {
    if (!p.node || seen.has(p.node)) continue;
    seen.add(p.node);
    unique.push(p);
  }

  return unique;
}

function applyLabelsToDom(nodes, mappings) {
  let appliedCount = 0;

  nodes.forEach(({ node, id, context }) => {
    const label = mappings[id];
    if (!label) return;

    const parent = node.parentElement;
    if (!parent) return;

    // Avoid double-replacement
    if (parent.dataset.algoliaCategoryHelperApplied === 'true') return;

    const originalText = node.textContent.trim();

    // Build replacement: e.g. "Tech & Audio (63)"
    const newText = `${label} (${originalText})`;
    node.textContent = newText;

    parent.dataset.algoliaCategoryHelperApplied = 'true';
    parent.dataset.algoliaCategoryHelperId = id;
    parent.dataset.algoliaCategoryHelperLabel = label;

    appliedCount++;
  });

  if (appliedCount) {
    csLog(`Applied ${appliedCount} label(s) to DOM`);
  }
}

// Ask background for labels for any unknown IDs, then apply labels.
async function updateLabels() {
  const nodes = findCategoryNodes();
  if (!nodes.length) {
    csLog('No candidate category nodes found on this view.');
    csLog('Page title:', document.title);
    csLog('URL:', window.location.href);
    return;
  }

  const ids = Array.from(new Set(nodes.map((p) => p.id)));
  const contextBreakdown = nodes.reduce((acc, n) => {
    acc[n.context] = (acc[n.context] || 0) + 1;
    return acc;
  }, {});

  csLog('Found category IDs:', ids);
  csLog('Found nodes by context:', contextBreakdown);
  csLog(`Total: ${ids.length} unique IDs from ${nodes.length} nodes`);

  await loadMappings();

  const missing = ids.filter((id) => !cachedMappings[id]);
  let stateResult = { success: true };

  if (missing.length) {
    csLog('Requesting Algolia lookup for missing IDs:', missing);
    stateResult = await new Promise((resolve) => {
      chrome.runtime.sendMessage(
        { type: 'ALGOLIA_LOOKUP', ids: missing },
        (res) => resolve(res || { success: false, error: 'No response' })
      );
    });

    if (!stateResult.success) {
      csLog('Algolia lookup failed:', stateResult.error);
    } else {
      cachedMappings = stateResult.labels || cachedMappings;
    }
  }

  applyLabelsToDom(nodes, cachedMappings);

  // Notify badge we have successfully applied mappings
  try {
    const applied = Object.keys(cachedMappings || {}).length;
    chrome.action.setBadgeText({ text: applied ? 'ON' : '' });
    if (applied) {
      chrome.action.setBadgeBackgroundColor({ color: '#0f766e' });
    }
  } catch (e) {
    // ignore
  }
}

function setupMutationObserver() {
  const target = document.querySelector('main') || document.body;
  if (!target) {
    csLog('No target element found for mutation observer');
    return;
  }

  csLog('Setting up mutation observer on:', target.tagName);

  const observer = new MutationObserver((mutations) => {
    // Simple debounce: if many mutations fire, we only run once every 500ms
    const now = Date.now();
    if (now - lastAppliedVersion < 500) return;
    lastAppliedVersion = now;
    csLog('Mutation detected, running updateLabels');
    updateLabels();
  });

  observer.observe(target, {
    childList: true,
    subtree: true
  });
}

// Periodic retry mechanism for slow-loading SPAs
let retryCount = 0;
const MAX_RETRIES = 10; // Try for up to 10 seconds
const RETRY_INTERVAL = 1000; // 1 second

function retryUpdateLabels() {
  csLog(`Retry attempt ${retryCount + 1}/${MAX_RETRIES}`);
  updateLabels();

  retryCount++;
  if (retryCount < MAX_RETRIES) {
    setTimeout(retryUpdateLabels, RETRY_INTERVAL);
  } else {
    csLog('Max retries reached, relying on mutation observer');
  }
}

// Kick-off when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  csLog('Content script loaded (DOMContentLoaded)');
  updateLabels();
  setupMutationObserver();

  // Start retry mechanism for SPA content
  setTimeout(retryUpdateLabels, RETRY_INTERVAL);
});

// Also run once on initial injection (in case DOMContentLoaded already fired)
if (document.readyState === 'loading') {
  csLog('Document still loading, waiting for DOMContentLoaded');
} else {
  csLog('Content script loaded (document already ready)');
  updateLabels();
  setupMutationObserver();

  // Start retry mechanism for SPA content
  setTimeout(retryUpdateLabels, RETRY_INTERVAL);
}
