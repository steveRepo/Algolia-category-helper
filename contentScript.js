
// contentScript.js
// Runs on Algolia dashboard pages and rewrites category IDs to labels when possible.

const STORAGE_KEYS = {
  CONFIG: 'algoliaCategoryHelper_config',
  MAPPINGS: 'algoliaCategoryHelper_mappings'
};

// Check if extension context is still valid (becomes invalid after extension reload/update)
function isContextValid() {
  try {
    return !!chrome.runtime && !!chrome.runtime.id;
  } catch (e) {
    return false;
  }
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

// Security: cap IDs sent per lookup cycle to prevent quota abuse
const MAX_IDS_PER_CYCLE = 100;

// Cache mappings and config in the content script for faster access
let cachedMappings = {};
let cachedEnabled = false;
let lastAppliedVersion = 0;

async function loadState() {
  if (!isContextValid()) {
    return { mappings: cachedMappings, enabled: cachedEnabled };
  }
  return new Promise((resolve) => {
    try {
      chrome.storage.local.get([STORAGE_KEYS.CONFIG, STORAGE_KEYS.MAPPINGS], (res) => {
        if (chrome.runtime.lastError) {
          resolve({ mappings: cachedMappings, enabled: cachedEnabled });
          return;
        }
        cachedMappings = res[STORAGE_KEYS.MAPPINGS] || {};
        const config = res[STORAGE_KEYS.CONFIG] || {};
        cachedEnabled = !!config.enabled;
        resolve({ mappings: cachedMappings, enabled: cachedEnabled });
      });
    } catch (e) {
      resolve({ mappings: cachedMappings, enabled: cachedEnabled });
    }
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

}

// Ask background for labels for any unknown IDs, then apply labels.
async function updateLabels() {
  const { mappings, enabled } = await loadState();
  if (!enabled) return;

  const nodes = findCategoryNodes();
  if (!nodes.length) return;

  const ids = Array.from(new Set(nodes.map((p) => p.id)));

  // Cap the number of IDs sent per cycle to prevent quota abuse
  const missing = ids.filter((id) => !cachedMappings[id]).slice(0, MAX_IDS_PER_CYCLE);
  let stateResult = { success: true };

  if (missing.length) {
    if (!isContextValid()) {
      applyLabelsToDom(nodes, cachedMappings);
      return;
    }

    stateResult = await new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(
          { type: 'ALGOLIA_LOOKUP', ids: missing },
          (res) => {
            if (chrome.runtime.lastError) {
              resolve({ success: false, error: chrome.runtime.lastError.message });
              return;
            }
            resolve(res || { success: false, error: 'No response' });
          }
        );
      } catch (e) {
        resolve({ success: false, error: 'Extension context invalidated' });
      }
    });

    if (stateResult.success) {
      cachedMappings = stateResult.labels || cachedMappings;
    }
  }

  applyLabelsToDom(nodes, cachedMappings);

  // Notify badge we have successfully applied mappings
  if (isContextValid()) {
    try {
      const applied = Object.keys(cachedMappings || {}).length;
      chrome.action.setBadgeText({ text: applied ? 'ON' : '' });
      if (applied) {
        chrome.action.setBadgeBackgroundColor({ color: '#5468ff' });
      }
    } catch (e) {
      // ignore — context may have been lost between check and call
    }
  }
}

function setupMutationObserver() {
  const target = document.querySelector('main') || document.body;
  if (!target) return;

  const observer = new MutationObserver((mutations) => {
    const now = Date.now();
    if (now - lastAppliedVersion < 500) return;
    lastAppliedVersion = now;
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
  if (!isContextValid()) return;
  updateLabels();

  retryCount++;
  if (retryCount < MAX_RETRIES) {
    setTimeout(retryUpdateLabels, RETRY_INTERVAL);
  }
}

// Kick-off when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  updateLabels();
  setupMutationObserver();

  // Start retry mechanism for SPA content
  setTimeout(retryUpdateLabels, RETRY_INTERVAL);
});

// Also run once on initial injection (in case DOMContentLoaded already fired)
if (document.readyState === 'loading') {
  // Wait for DOMContentLoaded event
} else {
  updateLabels();
  setupMutationObserver();

  // Start retry mechanism for SPA content
  setTimeout(retryUpdateLabels, RETRY_INTERVAL);
}
