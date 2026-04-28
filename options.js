
function setStatus(text, isError = false) {
  const el = document.getElementById('status');
  el.textContent = text || '';
  el.className = 'status ' + (isError ? 'err' : text ? 'ok' : '');
}

function collectConfig() {
  return {
    appId: document.getElementById('appId').value.trim(),
    apiKey: document.getElementById('apiKey').value.trim(),
    indexName: document.getElementById('indexName').value.trim(),
    filterField: document.getElementById('filterField').value.trim(),
    categoryPaths: document.getElementById('categoryPaths').value.trim(),
    enabled: document.getElementById('enabled').checked
  };
}

function load() {
  chrome.runtime.sendMessage({ type: 'GET_STATE' }, (res) => {
    if (chrome.runtime.lastError) {
      setStatus('Error loading: ' + chrome.runtime.lastError.message, true);
      return;
    }

    if (!res || !res.success) {
      setStatus((res && res.error) || 'Could not load state.', true);
      return;
    }

    const config = res.state.config || {};
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

  const config = collectConfig();

  chrome.runtime.sendMessage({ type: 'SAVE_CONFIG', config }, (res) => {
    saveBtn.disabled = false;

    if (chrome.runtime.lastError) {
      setStatus('Error: ' + chrome.runtime.lastError.message, true);
      return;
    }

    if (res && res.success) {
      setStatus('Config saved');
    } else {
      setStatus((res && res.error) || 'Failed to save config', true);
    }
  });
});

document.addEventListener('DOMContentLoaded', load);
