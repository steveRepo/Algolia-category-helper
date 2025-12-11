
const STORAGE_KEYS = {
  CONFIG: 'algoliaCategoryHelper_config',
  MAPPINGS: 'algoliaCategoryHelper_mappings'
};

function setStatus(text) {
  document.getElementById('status').textContent = text || '';
}

function load() {
  chrome.storage.local.get([STORAGE_KEYS.CONFIG, STORAGE_KEYS.MAPPINGS], (res) => {
    if (chrome.runtime.lastError) {
      setStatus('Error loading: ' + chrome.runtime.lastError.message);
      return;
    }

    const config = res[STORAGE_KEYS.CONFIG] || {};
    const mappings = res[STORAGE_KEYS.MAPPINGS] || {};
    document.getElementById('appId').value = config.appId || '';
    document.getElementById('apiKey').value = config.apiKey || '';
    document.getElementById('indexName').value = config.indexName || '';
    document.getElementById('filterField').value = config.filterField || 'facets.categoryIds';
    document.getElementById('categoryPaths').value = config.categoryPaths || 'information.categories,information.categoriesHierarchy';
    document.getElementById('enabled').checked = !!config.enabled;
    document.getElementById('mappingsArea').value = JSON.stringify(mappings, null, 2);

    const count = Object.keys(mappings).length;
    setStatus(`Loaded ${count} mapping(s)`);
  });
}

document.getElementById('saveBtn').addEventListener('click', () => {
  const saveBtn = document.getElementById('saveBtn');
  saveBtn.disabled = true;
  setStatus('Saving...');

  const config = {
    appId: document.getElementById('appId').value.trim(),
    apiKey: document.getElementById('apiKey').value.trim(),
    indexName: document.getElementById('indexName').value.trim(),
    filterField: document.getElementById('filterField').value.trim() || 'facets.categoryIds',
    categoryPaths: document.getElementById('categoryPaths').value.trim() || 'information.categories,information.categoriesHierarchy',
    enabled: document.getElementById('enabled').checked
  };

  // Validation
  if (config.enabled) {
    if (!config.appId) {
      setStatus('Application ID is required when enabled');
      saveBtn.disabled = false;
      return;
    }
    if (!config.apiKey) {
      setStatus('API Key is required when enabled');
      saveBtn.disabled = false;
      return;
    }
    if (!config.indexName) {
      setStatus('Index name is required when enabled');
      saveBtn.disabled = false;
      return;
    }
  }

  let parsed = {};
  try {
    const text = document.getElementById('mappingsArea').value.trim();
    parsed = text ? JSON.parse(text) : {};
    if (typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('JSON must be an object of {id: label}');
    }

    // Validate that all values are strings
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value !== 'string') {
        throw new Error(`Value for key "${key}" must be a string, got ${typeof value}`);
      }
    }
  } catch (e) {
    setStatus('Invalid mappings JSON: ' + e.message);
    saveBtn.disabled = false;
    return;
  }

  chrome.storage.local.set(
    {
      [STORAGE_KEYS.CONFIG]: config,
      [STORAGE_KEYS.MAPPINGS]: parsed
    },
    () => {
      if (chrome.runtime.lastError) {
        setStatus('Error saving: ' + chrome.runtime.lastError.message);
        saveBtn.disabled = false;
        return;
      }

      const count = Object.keys(parsed).length;
      setStatus(`✓ Saved successfully. ${count} mapping(s) stored.`);
      saveBtn.disabled = false;

      // Reload to show updated state
      setTimeout(() => load(), 500);
    }
  );
});

document.addEventListener('DOMContentLoaded', load);
