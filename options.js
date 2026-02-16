
const STORAGE_KEYS = {
  CONFIG: 'algoliaCategoryHelper_config'
};

function setStatus(text, isError = false) {
  const el = document.getElementById('status');
  el.textContent = text || '';
  el.className = 'status ' + (isError ? 'err' : text ? 'ok' : '');
}

function load() {
  chrome.storage.local.get([STORAGE_KEYS.CONFIG], (res) => {
    if (chrome.runtime.lastError) {
      setStatus('Error loading: ' + chrome.runtime.lastError.message, true);
      return;
    }

    const config = res[STORAGE_KEYS.CONFIG] || {};
    document.getElementById('appId').value = config.appId || '';
    document.getElementById('apiKey').value = config.apiKey || '';
    document.getElementById('indexName').value = config.indexName || '';
    document.getElementById('filterField').value = config.filterField || '';
    document.getElementById('categoryPaths').value = config.categoryPaths || '';
    document.getElementById('enabled').checked = !!config.enabled;
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
    filterField: document.getElementById('filterField').value.trim(),
    categoryPaths: document.getElementById('categoryPaths').value.trim(),
    enabled: document.getElementById('enabled').checked
  };

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
    if (!config.filterField) {
      setStatus('Filter field is required when enabled', true);
      saveBtn.disabled = false;
      return;
    }
    if (!config.categoryPaths) {
      setStatus('Category name paths are required when enabled', true);
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
      setStatus('Config saved');
    } else {
      setStatus('Failed to save config', true);
    }
  });
});

document.addEventListener('DOMContentLoaded', load);
