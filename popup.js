
const STORAGE_KEYS = {
  CONFIG: 'algoliaCategoryHelper_config'
};

let statusTimeout = null;

function setStatus(text, isError = false) {
  const el = document.getElementById('status');
  el.textContent = text || '';
  el.className = 'status ' + (isError ? 'err' : text ? 'ok' : '');

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
  pill.className = 'header-pill' + (on ? ' on' : '');
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
    document.getElementById('filterField').value = config.filterField || '';
    document.getElementById('categoryPaths').value = config.categoryPaths || '';
    document.getElementById('enabled').checked = !!config.enabled;

    const count = Object.keys(mappings || {}).length;
    if (config.enabled && config.appId && config.apiKey && config.indexName) {
      setPill(`Active · ${count} mapping(s)`, count > 0);
    } else if (config.enabled) {
      setPill('Config incomplete', false);
    } else {
      setPill('Disabled', false);
    }
    setStatus('');
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
      setTimeout(() => loadState(), 500);
    } else {
      setStatus('Failed to save config', true);
    }
  });
});

document.getElementById('refreshBtn').addEventListener('click', () => {
  setStatus('Refreshing...');
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
          setStatus('Could not refresh in this tab', true);
        } else {
          setStatus('Refresh requested');
        }
      }
    );
  });
});

document.addEventListener('DOMContentLoaded', loadState);
