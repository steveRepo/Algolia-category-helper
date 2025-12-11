
// background.js (MV3 service worker)

// Keys we use in chrome.storage
const STORAGE_KEYS = {
  CONFIG: 'algoliaCategoryHelper_config',
  MAPPINGS: 'algoliaCategoryHelper_mappings'
};

function log(...args) {
  console.log('[Algolia Category Helper][bg]', ...args);
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
          filterField: 'facets.categoryIds',
          categoryPaths: 'information.categories,information.categoriesHierarchy',
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

// Listen for messages from content-script & popup/options
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
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

        log('Config saved:', config);
        sendResponse({ success: true, config });
      } catch (e) {
        log('Error saving config:', e);
        sendResponse({ success: false, error: e.message });
      }
      return;
    }

    if (msg.type === 'SET_MAPPINGS') {
      await setMappings(msg.mappings || {});
      sendResponse({ success: true });
      return;
    }

    if (msg.type === 'ALGOLIA_LOOKUP') {
      // msg.ids is an array of category IDs (strings)
      const { config, mappings } = await getState();
      if (!config.enabled || !config.appId || !config.apiKey || !config.indexName) {
        sendResponse({ success: false, error: 'Config not complete or extension disabled.' });
        return;
      }

      const idsToFetch = (msg.ids || []).filter((id) => !mappings[id]);
      if (!idsToFetch.length) {
        sendResponse({ success: true, labels: mappings });
        return;
      }

      // Algolia multi-query API has limits, so batch requests
      const BATCH_SIZE = 20; // Conservative limit
      const newLabels = {};

      try {
        log(`Fetching labels for ${idsToFetch.length} IDs in batches of ${BATCH_SIZE}`);

        for (let i = 0; i < idsToFetch.length; i += BATCH_SIZE) {
          const batch = idsToFetch.slice(i, i + BATCH_SIZE);
          log(`Processing batch ${Math.floor(i / BATCH_SIZE) + 1} with ${batch.length} IDs`);

          // Build multi-query: one query per ID, using configurable filter field
          const filterField = config.filterField || 'facets.categoryIds';
          const categoryPaths = config.categoryPaths || 'information.categories,information.categoriesHierarchy';
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
            const text = await res.text();
            log('Algolia lookup failed for batch', res.status, text);
            log('Batch IDs:', batch);
            // Continue with other batches even if one fails
            continue;
          }

          const data = await res.json();
          const results = data.results || [];

          // Extract labels from this batch using configured paths
          results.forEach((r, idx) => {
            const id = batch[idx];
            const hit = (r.hits && r.hits[0]) || null;
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
                  label = match.name;
                  continue;
                }

                // Try nested arrays (like categoriesHierarchy)
                for (const subArray of value) {
                  if (Array.isArray(subArray)) {
                    const nestedMatch = subArray.find((item) => item && String(item.id) === String(id));
                    if (nestedMatch && nestedMatch.name) {
                      label = nestedMatch.name;
                      break;
                    }
                  }
                }
              }
              // If it's a simple object with id/name
              else if (value && typeof value === 'object' && String(value.id) === String(id)) {
                label = value.name || null;
              }
              // If it's just a string value
              else if (typeof value === 'string') {
                label = value;
              }
            }

            if (label) {
              newLabels[id] = label;
            }
          });
        }

        log(`Found ${Object.keys(newLabels).length} labels out of ${idsToFetch.length} requested`);

        const updated = { ...mappings, ...newLabels };
        await setMappings(updated);

        // Update badge if we have at least one mapping
        try {
          const total = Object.keys(updated).length;
          chrome.action.setBadgeText({ text: total ? 'ON' : '' });
          if (total) {
            chrome.action.setBadgeBackgroundColor({ color: '#0f766e' }); // teal-ish
          }
        } catch (e) {
          // ignore in older browsers
        }

        sendResponse({ success: true, labels: updated, fetched: newLabels });
      } catch (e) {
        log('Algolia lookup exception', e);
        sendResponse({ success: false, error: e && e.message ? e.message : String(e) });
      }

      return;
    }

    sendResponse({ success: false, error: 'Unknown message type' });
  })();

  // Keep channel open for async response
  return true;
});
