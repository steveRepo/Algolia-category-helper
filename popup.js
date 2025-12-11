
const STORAGE_KEYS = {
  CONFIG: 'algoliaCategoryHelper_config',
  MAPPINGS: 'algoliaCategoryHelper_mappings'
};

let statusTimeout = null;

function setStatus(text, isError = false) {
  const el = document.getElementById('status');
  el.textContent = text || '';
  el.className = 'status ' + (isError ? 'err' : text ? 'ok' : '');

  // Auto-clear status after 5 seconds (unless it's an error)
  if (statusTimeout) {
    clearTimeout(statusTimeout);
    statusTimeout = null;
  }

  if (text && !isError) {
    statusTimeout = setTimeout(() => {
      el.textContent = '';
      el.className = 'status';
    }, 5000);
  }
}

function setPill(stateText, on) {
  const pill = document.getElementById('status-pill');
  const pillText = document.getElementById('status-pill-text');
  pill.className = 'pill' + (on ? ' on' : '');
  pillText.textContent = stateText;
}

function loadState() {
  chrome.runtime.sendMessage({ type: 'GET_STATE' }, (res) => {
    if (chrome.runtime.lastError) {
      setStatus('Error loading state: ' + chrome.runtime.lastError.message, true);
      setPill('Error', false);
      return;
    }

    if (!res || !res.success) {
      setStatus('Could not load state', true);
      setPill('Error', false);
      return;
    }

    const { config, mappings } = res.state;
    document.getElementById('appId').value = config.appId || '';
    document.getElementById('apiKey').value = config.apiKey || '';
    document.getElementById('indexName').value = config.indexName || '';
    document.getElementById('filterField').value = config.filterField || 'facets.categoryIds';
    document.getElementById('categoryPaths').value = config.categoryPaths || 'information.categories,information.categoriesHierarchy';
    document.getElementById('enabled').checked = !!config.enabled;

    document.getElementById('mappingsArea').value = JSON.stringify(mappings || {}, null, 2);

    const count = Object.keys(mappings || {}).length;
    if (config.enabled && config.appId && config.apiKey && config.indexName) {
      setPill(`Active · ${count} mapping(s)`, count > 0);
    } else if (config.enabled) {
      setPill('Enabled but config incomplete', false);
    } else {
      setPill('Disabled', false);
    }
    setStatus(''); // Clear any previous status
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
      setStatus('Application ID is required when enabled', true);
      saveBtn.disabled = false;
      return;
    }
    if (!config.apiKey) {
      setStatus('API Key is required when enabled', true);
      saveBtn.disabled = false;
      return;
    }
    if (!config.indexName) {
      setStatus('Index name is required when enabled', true);
      saveBtn.disabled = false;
      return;
    }
  }

  chrome.runtime.sendMessage({ type: 'SAVE_CONFIG', config }, (res) => {
    saveBtn.disabled = false;

    if (chrome.runtime.lastError) {
      setStatus('Error: ' + chrome.runtime.lastError.message, true);
      return;
    }

    if (res && res.success) {
      setStatus('✓ Config saved successfully');
      setTimeout(() => loadState(), 500);
    } else {
      setStatus('Failed to save config', true);
    }
  });
});

document.getElementById('refreshBtn').addEventListener('click', () => {
  setStatus('Refreshing labels on active tab...');
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    if (!tab || !tab.id) {
      setStatus('No active tab', true);
      return;
    }
    chrome.scripting.executeScript(
      {
        target: { tabId: tab.id },
        func: () => {
          if (window.updateLabels) {
            window.updateLabels();
          }
        }
      },
      () => {
        if (chrome.runtime.lastError) {
          setStatus('Could not trigger refresh in this tab', true);
        } else {
          setStatus('Refresh requested');
        }
      }
    );
  });
});

document.getElementById('exportBtn').addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'GET_STATE' }, (res) => {
    if (!res || !res.success) {
      setStatus('Failed to export mappings', true);
      return;
    }
    const mappings = res.state.mappings || res.state.mappings === {} ? res.state.mappings : res.state.mappings;
    // Simpler: just read from storage directly
    chrome.storage.local.get([STORAGE_KEYS.MAPPINGS], (data) => {
      const map = data[STORAGE_KEYS.MAPPINGS] || {};
      document.getElementById('mappingsArea').value = JSON.stringify(map, null, 2);
      setStatus(`Exported ${Object.keys(map).length} mapping(s)`);
    });
  });
});

document.getElementById('importBtn').addEventListener('click', () => {
  const importBtn = document.getElementById('importBtn');
  importBtn.disabled = true;

  let parsed = {};
  try {
    const text = document.getElementById('mappingsArea').value.trim();
    if (!text) {
      setStatus('Paste JSON mappings first', true);
      importBtn.disabled = false;
      return;
    }
    parsed = JSON.parse(text);
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
    setStatus('Invalid JSON: ' + e.message, true);
    importBtn.disabled = false;
    return;
  }

  setStatus('Importing...');

  chrome.storage.local.get([STORAGE_KEYS.MAPPINGS], (data) => {
    if (chrome.runtime.lastError) {
      setStatus('Error reading storage: ' + chrome.runtime.lastError.message, true);
      importBtn.disabled = false;
      return;
    }

    const existing = data[STORAGE_KEYS.MAPPINGS] || {};
    const merged = { ...existing, ...parsed };
    const newCount = Object.keys(parsed).length;
    const totalCount = Object.keys(merged).length;

    chrome.storage.local.set({ [STORAGE_KEYS.MAPPINGS]: merged }, () => {
      if (chrome.runtime.lastError) {
        setStatus('Error saving: ' + chrome.runtime.lastError.message, true);
        importBtn.disabled = false;
        return;
      }

      document.getElementById('mappingsArea').value = JSON.stringify(merged, null, 2);
      setStatus(`✓ Imported ${newCount} mapping(s). Total: ${totalCount}`);
      loadState();
      importBtn.disabled = false;
    });
  });
});

document.getElementById('clearBtn').addEventListener('click', () => {
  if (!confirm('Clear all stored mappings?')) return;
  chrome.storage.local.set({ [STORAGE_KEYS.MAPPINGS]: {} }, () => {
    document.getElementById('mappingsArea').value = '{}';
    setStatus('All mappings cleared');
    setPill('Active · 0 mapping(s)', false);
  });
});

document.addEventListener('DOMContentLoaded', loadState);
