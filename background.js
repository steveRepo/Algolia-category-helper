
// background.js (MV3 service worker)

// Keys we use in chrome.storage
const STORAGE_KEYS = {
  CONFIG: 'algoliaCategoryHelper_config',
  MAPPINGS: 'algoliaCategoryHelper_mappings'
};

// Security: max IDs per single lookup request to prevent quota abuse
const MAX_IDS_PER_REQUEST = 100;
// Rate limit: minimum ms between batch API calls
const BATCH_DELAY_MS = 200;

// Validate that a field path only contains safe characters: a-z, 0-9, dots, underscores, commas, hyphens
function isValidFieldPath(path) {
  if (!path || typeof path !== 'string') return false;
  return /^[a-zA-Z0-9._,\-]+$/.test(path.trim());
}

// Helper to get config & mappings
async function getState() {
  return new Promise((resolve) => {
    chrome.storage.local.get([STORAGE_KEYS.CONFIG, STORAGE_KEYS.MAPPINGS], (res) => {
      resolve({
        config: res[STORAGE_KEYS.CONFIG] || {
          appId: '',
          apiKey: '',
          indexName: '',
          filterField: '',
          categoryPaths: '',
          enabled: false
        },
        mappings: res[STORAGE_KEYS.MAPPINGS] || {}
      });
    });
  });
}

async function setMappings(newMappings) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [STORAGE_KEYS.MAPPINGS]: newMappings }, () => resolve());
  });
}

// Delay helper for rate limiting
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Listen for messages from content-script & popup/options
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Security: only accept messages from this extension
  if (sender.id !== chrome.runtime.id) {
    sendResponse({ success: false, error: 'Unauthorized sender' });
    return true;
  }

  (async () => {
    if (msg.type === 'GET_STATE') {
      const state = await getState();
      sendResponse({ success: true, state });
      return;
    }

    if (msg.type === 'SAVE_CONFIG') {
      try {
        const current = await getState();
        const config = { ...current.config, ...msg.config };

        // Validate config
        if (config.enabled) {
          if (!config.appId || !config.apiKey || !config.indexName) {
            sendResponse({
              success: false,
              error: 'Application ID, API Key, and Index Name are required when enabled'
            });
            return;
          }

          // Validate field paths contain only safe characters
          if (config.filterField && !isValidFieldPath(config.filterField)) {
            sendResponse({
              success: false,
              error: 'Filter field contains invalid characters. Only letters, numbers, dots, underscores, commas, and hyphens are allowed.'
            });
            return;
          }
          if (config.categoryPaths && !isValidFieldPath(config.categoryPaths)) {
            sendResponse({
              success: false,
              error: 'Category paths contain invalid characters. Only letters, numbers, dots, underscores, commas, and hyphens are allowed.'
            });
            return;
          }
        }

        await new Promise((resolve, reject) => {
          chrome.storage.local.set({ [STORAGE_KEYS.CONFIG]: config }, () => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
            } else {
              resolve();
            }
          });
        });

        sendResponse({ success: true });
      } catch (e) {
        sendResponse({ success: false, error: e.message });
      }
      return;
    }

    if (msg.type === 'ALGOLIA_LOOKUP') {
      const { config, mappings } = await getState();
      if (!config.enabled || !config.appId || !config.apiKey || !config.indexName || !config.filterField || !config.categoryPaths) {
        sendResponse({ success: false, error: 'Config not complete or extension disabled.' });
        return;
      }

      // Validate field paths before making API calls
      if (!isValidFieldPath(config.filterField) || !isValidFieldPath(config.categoryPaths)) {
        sendResponse({ success: false, error: 'Invalid field paths in config.' });
        return;
      }

      // Security: validate msg.ids is an array of strings, sanitise values
      const rawIds = msg.ids;
      if (!Array.isArray(rawIds)) {
        sendResponse({ success: false, error: 'Invalid IDs format.' });
        return;
      }

      const sanitisedIds = rawIds
        .filter((id) => typeof id === 'string' && id.length > 0 && id.length <= 200)
        .map((id) => id.trim())
        .filter((id) => /^[a-zA-Z0-9_\-]+$/.test(id));

      const idsToFetch = sanitisedIds
        .filter((id) => !mappings[id])
        .slice(0, MAX_IDS_PER_REQUEST); // Cap to prevent quota abuse

      if (!idsToFetch.length) {
        sendResponse({ success: true, labels: mappings });
        return;
      }

      // Algolia multi-query API has limits, so batch requests
      const BATCH_SIZE = 20;
      const newLabels = {};

      try {

        for (let i = 0; i < idsToFetch.length; i += BATCH_SIZE) {
          const batch = idsToFetch.slice(i, i + BATCH_SIZE);

          // Rate limit: delay between batches (skip delay on first batch)
          if (i > 0) {
            await delay(BATCH_DELAY_MS);
          }

          // Build multi-query: one query per ID, using configurable filter field
          const filterField = config.filterField;
          const categoryPaths = config.categoryPaths;
          const pathsArray = categoryPaths.split(',').map(p => p.trim()).filter(p => p);

          const requests = batch.map((id) => {
            // Build filter - support multiple filter fields
            const filterParts = filterField.split(',').map(f => f.trim()).filter(f => f);
            const filters = filterParts.map(field => `${field}:"${id}"`).join(' OR ');

            const params = new URLSearchParams({
              hitsPerPage: '1',
              attributesToRetrieve: pathsArray.join(','),
              filters: filters
            });
            return {
              indexName: config.indexName,
              params: params.toString()
            };
          });

          const url = `https://${config.appId}-dsn.algolia.net/1/indexes/*/queries`;
          const res = await fetch(url, {
            method: 'POST',
            headers: {
              'X-Algolia-Application-Id': config.appId,
              'X-Algolia-API-Key': config.apiKey,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ requests })
          });

          if (!res.ok) {
            // Continue with other batches even if one fails
            continue;
          }

          const data = await res.json();
          const results = data.results || [];

          // Extract labels from this batch using configured paths
          results.forEach((r, idx) => {
            const id = batch[idx];
            if (!r || !Array.isArray(r.hits)) return;
            const hit = r.hits[0] || null;
            if (!hit) return;

            let label = null;

            // Try each configured path
            for (const path of pathsArray) {
              if (label) break;

              // Navigate to the field using dot notation
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

              // If it's an array of objects with id/name
              if (Array.isArray(value)) {
                // Try flat array first
                const match = value.find((item) => item && String(item.id) === String(id));
                if (match && match.name) {
                  label = String(match.name);
                  continue;
                }

                // Try nested arrays (like categoriesHierarchy)
                for (const subArray of value) {
                  if (Array.isArray(subArray)) {
                    const nestedMatch = subArray.find((item) => item && String(item.id) === String(id));
                    if (nestedMatch && nestedMatch.name) {
                      label = String(nestedMatch.name);
                      break;
                    }
                  }
                }
              }
              // If it's a simple object with id/name
              else if (value && typeof value === 'object' && String(value.id) === String(id)) {
                label = value.name ? String(value.name) : null;
              }
              // If it's just a string value
              else if (typeof value === 'string') {
                label = value;
              }
            }

            // Sanitise label: must be a non-empty string, cap length
            if (label && typeof label === 'string' && label.length <= 500) {
              newLabels[id] = label;
            }
          });
        }


        const updated = { ...mappings, ...newLabels };
        await setMappings(updated);

        // Update badge if we have at least one mapping
        try {
          const total = Object.keys(updated).length;
          chrome.action.setBadgeText({ text: total ? 'ON' : '' });
          if (total) {
            chrome.action.setBadgeBackgroundColor({ color: '#5468ff' });
          }
        } catch (e) {
          // ignore in older browsers
        }

        sendResponse({ success: true, labels: updated, fetched: newLabels });
      } catch (e) {
        sendResponse({ success: false, error: 'Lookup failed' });
      }

      return;
    }

    sendResponse({ success: false, error: 'Unknown message type' });
  })();

  // Keep channel open for async response
  return true;
});
