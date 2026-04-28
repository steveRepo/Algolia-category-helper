
// background.js (MV3 service worker)

const STORAGE_KEYS = {
  CONFIG: 'algoliaCategoryHelper_config',
  MAPPINGS: 'algoliaCategoryHelper_mappings'
};

const MAX_IDS_PER_REQUEST = 120;
const BATCH_DELAY_MS = 200;
const pageStatusByTab = new Map();

function defaultConfig() {
  return {
    appId: '',
    apiKey: '',
    indexName: '',
    filterField: '',
    categoryPaths: '',
    enabled: false
  };
}

async function setStorageAccessLevels() {
  try {
    if (chrome.storage?.local?.setAccessLevel) {
      await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
    }
  } catch (e) {
    // ignore access-level errors on older Chrome builds
  }
}

chrome.runtime.onInstalled.addListener(() => {
  setStorageAccessLevels();
});

chrome.runtime.onStartup.addListener(() => {
  setStorageAccessLevels();
});

setStorageAccessLevels();

function isValidFieldPath(path) {
  if (!path || typeof path !== 'string') return false;
  return /^[a-zA-Z0-9._,\-]+$/.test(path.trim());
}

async function getState() {
  return new Promise((resolve) => {
    chrome.storage.local.get([STORAGE_KEYS.CONFIG, STORAGE_KEYS.MAPPINGS], (res) => {
      resolve({
        config: res[STORAGE_KEYS.CONFIG] || defaultConfig(),
        mappings: res[STORAGE_KEYS.MAPPINGS] || {}
      });
    });
  });
}

async function setConfig(config) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set({ [STORAGE_KEYS.CONFIG]: config }, () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve();
      }
    });
  });
}

async function setMappings(newMappings) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set({ [STORAGE_KEYS.MAPPINGS]: newMappings }, () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve();
      }
    });
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sanitizeIds(rawIds) {
  if (!Array.isArray(rawIds)) return [];
  return rawIds
    .filter((id) => typeof id === 'string' && id.length > 0 && id.length <= 200)
    .map((id) => id.trim())
    .filter((id) => /^[a-zA-Z0-9_\-]+$/.test(id));
}

function buildAiPrompt(sampleRecordText) {
  return [
    'You are helping configure an Algolia browser extension.',
    'Analyze the sample Algolia record below and identify the most likely attribute paths for:',
    '1. filterField: the field or fields that contain the category identifier used for matching.',
    '2. categoryPaths: one or more field paths that contain the human-readable category label or hierarchy.',
    '',
    'Rules:',
    '- Only use fields that actually exist in the sample record.',
    '- Use dot-notation paths only.',
    '- Prefer fields that are stable and suitable for exact category ID lookup.',
    '- Prefer label paths that clearly contain category names or hierarchies.',
    '- If you are unsure, include warnings.',
    '- Return strict JSON with this exact shape:',
    '{',
    '  "recommendedFilterField": "field.path,optional.second.path",',
    '  "recommendedCategoryPaths": ["field.path", "field.otherPath"],',
    '  "filterFieldCandidates": [{"path": "field.path", "why": "reason"}],',
    '  "categoryPathCandidates": [{"path": "field.path", "why": "reason"}],',
    '  "reasoningSummary": "short explanation",',
    '  "warnings": ["warning 1"]',
    '}',
    '',
    'Sample record:',
    sampleRecordText
  ].join('\n');
}

function validateConfig(config) {
  if (config.enabled) {
    if (!config.appId || !config.apiKey || !config.indexName) {
      return 'Application ID, API Key, and Index Name are required when enabled.';
    }
    if (!config.filterField) {
      return 'Filter field is required when enabled.';
    }
    if (!config.categoryPaths) {
      return 'Category name paths are required when enabled.';
    }
  }

  if (config.filterField && !isValidFieldPath(config.filterField)) {
    return 'Filter field contains invalid characters. Only letters, numbers, dots, underscores, commas, and hyphens are allowed.';
  }
  if (config.categoryPaths && !isValidFieldPath(config.categoryPaths)) {
    return 'Category paths contain invalid characters. Only letters, numbers, dots, underscores, commas, and hyphens are allowed.';
  }

  return null;
}

async function performAlgoliaLookup(config, existingMappings, rawIds) {
  const idsToFetch = sanitizeIds(rawIds)
    .filter((id) => !existingMappings[id])
    .slice(0, MAX_IDS_PER_REQUEST);

  if (!idsToFetch.length) {
    return { success: true, labels: existingMappings, fetched: {} };
  }

  const BATCH_SIZE = 20;
  const newLabels = {};
  const filterParts = String(config.filterField || '')
    .split(',')
    .map((f) => f.trim())
    .filter(Boolean);
  const pathsArray = String(config.categoryPaths || '')
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);

  if (!filterParts.length || !pathsArray.length) {
    return { success: false, error: 'Config not complete or extension disabled.' };
  }

  try {
    for (let i = 0; i < idsToFetch.length; i += BATCH_SIZE) {
      const batch = idsToFetch.slice(i, i + BATCH_SIZE);
      if (i > 0) {
        await delay(BATCH_DELAY_MS);
      }

      const requests = batch.map((id) => {
        const filters = filterParts.map((field) => `${field}:"${id}"`).join(' OR ');
        const params = new URLSearchParams({
          hitsPerPage: '1',
          attributesToRetrieve: pathsArray.join(','),
          filters
        });

        return {
          indexName: config.indexName,
          params: params.toString()
        };
      });

      const res = await fetch(`https://${config.appId}-dsn.algolia.net/1/indexes/*/queries`, {
        method: 'POST',
        headers: {
          'X-Algolia-Application-Id': config.appId,
          'X-Algolia-API-Key': config.apiKey,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ requests })
      });

      if (!res.ok) {
        const errorText = await res.text().catch(() => '');
        return {
          success: false,
          error: `Algolia lookup failed with status ${res.status}${errorText ? `: ${errorText.slice(0, 200)}` : ''}`
        };
      }

      const data = await res.json();
      const results = Array.isArray(data.results) ? data.results : [];

      results.forEach((result, idx) => {
        const id = batch[idx];
        const hit = result?.hits?.[0];
        if (!hit) return;

        let label = null;

        for (const path of pathsArray) {
          if (label) break;

          const parts = path.split('.');
          let value = hit;
          for (const part of parts) {
            if (value && typeof value === 'object') {
              value = value[part];
            } else {
              value = null;
              break;
            }
          }

          if (!value) continue;

          if (Array.isArray(value)) {
            const match = value.find((item) => item && String(item.id) === String(id));
            if (match && match.name) {
              label = String(match.name);
              continue;
            }

            for (const nested of value) {
              if (Array.isArray(nested)) {
                const nestedMatch = nested.find((item) => item && String(item.id) === String(id));
                if (nestedMatch && nestedMatch.name) {
                  label = String(nestedMatch.name);
                  break;
                }
              }
            }
          } else if (value && typeof value === 'object' && String(value.id) === String(id)) {
            label = value.name ? String(value.name) : null;
          } else if (typeof value === 'string') {
            label = value;
          }
        }

        if (label && typeof label === 'string' && label.length <= 500) {
          newLabels[id] = label;
        }
      });
    }

    const updated = { ...existingMappings, ...newLabels };
    await setMappings(updated);

    return { success: true, labels: updated, fetched: newLabels };
  } catch (e) {
    return { success: false, error: e?.message || 'Lookup failed.' };
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) {
    sendResponse({ success: false, error: 'Unauthorized sender.' });
    return true;
  }

  (async () => {
    if (msg.type === 'GET_STATE') {
      if (sender.tab) {
        sendResponse({ success: false, error: 'GET_STATE is not available to content scripts.' });
        return;
      }
      const state = await getState();
      sendResponse({ success: true, state });
      return;
    }

    if (msg.type === 'GET_PUBLIC_STATE') {
      const state = await getState();
      sendResponse({
        success: true,
        state: {
          enabled: !!state.config.enabled,
          mappings: state.mappings || {}
        }
      });
      return;
    }

    if (msg.type === 'SAVE_CONFIG') {
      const current = await getState();
      const nextConfig = { ...current.config, ...msg.config };
      const validationError = validateConfig(nextConfig);

      if (validationError) {
        sendResponse({ success: false, error: validationError });
        return;
      }

      try {
        await setConfig(nextConfig);
        sendResponse({ success: true });
      } catch (e) {
        sendResponse({ success: false, error: e?.message || 'Failed to save config.' });
      }
      return;
    }

    if (msg.type === 'ALGOLIA_LOOKUP') {
      const { config, mappings } = await getState();

      if (!config.enabled || !config.appId || !config.apiKey || !config.indexName || !config.filterField || !config.categoryPaths) {
        sendResponse({ success: false, error: 'Config not complete or extension disabled.' });
        return;
      }

      const validationError = validateConfig(config);
      if (validationError) {
        sendResponse({ success: false, error: validationError });
        return;
      }

      const result = await performAlgoliaLookup(config, mappings, msg.ids);
      sendResponse(result);
      return;
    }

    if (msg.type === 'BUILD_AI_PROMPT') {
      const sampleRecord = String(msg.sampleRecord || '').trim();
      if (!sampleRecord) {
        sendResponse({ success: false, error: 'Paste a sample record first.' });
        return;
      }
      sendResponse({ success: true, prompt: buildAiPrompt(sampleRecord) });
      return;
    }

    if (msg.type === 'REPORT_PAGE_STATUS') {
      const tabId = sender.tab?.id;
      if (typeof tabId === 'number') {
        pageStatusByTab.set(tabId, {
          ...msg.status,
          tabId,
          url: sender.tab?.url || '',
          updatedAt: new Date().toISOString()
        });
      }
      sendResponse({ success: true });
      return;
    }

    if (msg.type === 'GET_PAGE_STATUS') {
      const tabId = typeof msg.tabId === 'number' ? msg.tabId : sender.tab?.id;
      if (typeof tabId !== 'number') {
        sendResponse({ success: false, error: 'No tab available.' });
        return;
      }

      sendResponse({
        success: true,
        status: pageStatusByTab.get(tabId) || null
      });
      return;
    }

    sendResponse({ success: false, error: 'Unknown message type.' });
  })();

  return true;
});
