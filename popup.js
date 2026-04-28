
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

function collectConfigFromForm() {
  return {
    appId: document.getElementById('appId').value.trim(),
    apiKey: document.getElementById('apiKey').value.trim(),
    indexName: document.getElementById('indexName').value.trim(),
    filterField: document.getElementById('filterField').value.trim(),
    categoryPaths: document.getElementById('categoryPaths').value.trim(),
    enabled: document.getElementById('enabled').checked
  };
}

function renderSuggestionSummary(data) {
  const box = document.getElementById('suggestionResult');
  if (!data) {
    box.textContent = 'No suggestion applied yet.';
    return;
  }

  const warnings = Array.isArray(data.warnings) && data.warnings.length
    ? '\nWarnings:\n' + data.warnings.map((item) => `• ${item}`).join('\n')
    : '';

  const filterCandidates = Array.isArray(data.filterFieldCandidates)
    ? data.filterFieldCandidates.map((item) => `• ${item.path} — ${item.why}`).join('\n')
    : '';

  const categoryCandidates = Array.isArray(data.categoryPathCandidates)
    ? data.categoryPathCandidates.map((item) => `• ${item.path} — ${item.why}`).join('\n')
    : '';

  box.textContent = [
    `Recommended filter field: ${data.recommendedFilterField || '(none)'}`,
    `Recommended category paths: ${(data.recommendedCategoryPaths || []).join(', ') || '(none)'}`,
    '',
    `Why: ${data.reasoningSummary || ''}`,
    '',
    'Filter candidates:',
    filterCandidates || '• None',
    '',
    'Category path candidates:',
    categoryCandidates || '• None',
    warnings
  ].join('\n');
}

function parseSuggestionJson(rawText) {
  const parsed = JSON.parse(rawText);

  return {
    recommendedFilterField: typeof parsed.recommendedFilterField === 'string' ? parsed.recommendedFilterField.trim() : '',
    recommendedCategoryPaths: Array.isArray(parsed.recommendedCategoryPaths)
      ? parsed.recommendedCategoryPaths.map((item) => String(item || '').trim()).filter(Boolean)
      : [],
    filterFieldCandidates: Array.isArray(parsed.filterFieldCandidates) ? parsed.filterFieldCandidates : [],
    categoryPathCandidates: Array.isArray(parsed.categoryPathCandidates) ? parsed.categoryPathCandidates : [],
    reasoningSummary: typeof parsed.reasoningSummary === 'string' ? parsed.reasoningSummary : '',
    warnings: Array.isArray(parsed.warnings) ? parsed.warnings : []
  };
}

function loadState() {
  chrome.runtime.sendMessage({ type: 'GET_STATE' }, (res) => {
    if (chrome.runtime.lastError) {
      setStatus('Error loading state: ' + chrome.runtime.lastError.message, true);
      setPill('Error', false);
      return;
    }

    if (!res || !res.success) {
      setStatus((res && res.error) || 'Could not load state', true);
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
  });
}

function renderDiagnostics(status) {
  document.getElementById('diagRoute').textContent = status?.route || '—';
  document.getElementById('diagStatus').textContent = status?.state || '—';
  document.getElementById('diagIds').textContent = typeof status?.uniqueIds === 'number' ? String(status.uniqueIds) : '—';
  document.getElementById('diagApplied').textContent = typeof status?.labelsApplied === 'number' ? String(status.labelsApplied) : '—';

  const details = document.getElementById('diagnosticDetails');
  if (!status) {
    details.textContent = 'No page feedback yet.';
    return;
  }

  const parts = [];
  if (status.message) parts.push(status.message);
  if (Array.isArray(status.notes) && status.notes.length) {
    parts.push('Notes:\n' + status.notes.map((item) => `• ${item}`).join('\n'));
  }
  if (Array.isArray(status.unresolvedIds) && status.unresolvedIds.length) {
    parts.push('Unresolved IDs:\n' + status.unresolvedIds.slice(0, 12).map((item) => `• ${item}`).join('\n'));
  }
  if (status.lastError) {
    parts.push('Last error:\n• ' + status.lastError);
  }
  if (status.updatedAt) {
    parts.push('Updated: ' + status.updatedAt);
  }

  details.textContent = parts.join('\n\n') || 'No details available.';
}

function withActiveTab(callback) {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs && tabs[0];
    if (!tab || typeof tab.id !== 'number') {
      setStatus('No active tab.', true);
      return;
    }
    callback(tab);
  });
}

function loadDiagnostics() {
  withActiveTab((tab) => {
    chrome.runtime.sendMessage({ type: 'GET_PAGE_STATUS', tabId: tab.id }, (res) => {
      if (chrome.runtime.lastError) {
        renderDiagnostics(null);
        return;
      }
      if (!res || !res.success) {
        renderDiagnostics(null);
        return;
      }
      renderDiagnostics(res.status || null);
    });
  });
}

document.getElementById('saveBtn').addEventListener('click', () => {
  const saveBtn = document.getElementById('saveBtn');
  saveBtn.disabled = true;
  setStatus('Saving...');

  const config = collectConfigFromForm();

  chrome.runtime.sendMessage({ type: 'SAVE_CONFIG', config }, (res) => {
    saveBtn.disabled = false;

    if (chrome.runtime.lastError) {
      setStatus('Error: ' + chrome.runtime.lastError.message, true);
      return;
    }

    if (res && res.success) {
      setStatus('Config saved');
      setTimeout(() => {
        loadState();
        loadDiagnostics();
      }, 300);
    } else {
      setStatus((res && res.error) || 'Failed to save config', true);
    }
  });
});

document.getElementById('refreshBtn').addEventListener('click', () => {
  withActiveTab((tab) => {
    chrome.tabs.reload(tab.id);
  });
});

document.getElementById('runCheckBtn').addEventListener('click', () => {
  withActiveTab((tab) => {
    chrome.tabs.sendMessage(tab.id, { type: 'RUN_PAGE_SCAN' }, (res) => {
      if (chrome.runtime.lastError) {
        setStatus('Page check failed: ' + chrome.runtime.lastError.message, true);
        loadDiagnostics();
        return;
      }
      if (!res || !res.success) {
        setStatus((res && res.error) || 'Page check failed.', true);
        loadDiagnostics();
        return;
      }
      setStatus('Page check complete');
      setTimeout(loadDiagnostics, 200);
    });
  });
});

document.getElementById('copyPromptBtn').addEventListener('click', () => {
  const sampleRecord = document.getElementById('sampleRecord').value.trim();
  if (!sampleRecord) {
    setStatus('Paste a sample record first.', true);
    return;
  }

  chrome.runtime.sendMessage({ type: 'BUILD_AI_PROMPT', sampleRecord }, async (res) => {
    if (chrome.runtime.lastError) {
      setStatus('Error: ' + chrome.runtime.lastError.message, true);
      return;
    }
    if (!res || !res.success) {
      setStatus((res && res.error) || 'Could not build AI prompt.', true);
      return;
    }

    try {
      await navigator.clipboard.writeText(res.prompt);
      setStatus('AI prompt copied to clipboard');
    } catch (e) {
      setStatus('Could not copy to clipboard. Your browser may block clipboard access.', true);
    }
  });
});

document.getElementById('applySuggestionBtn').addEventListener('click', () => {
  const raw = document.getElementById('suggestionJson').value.trim();
  if (!raw) {
    setStatus('Paste suggestion JSON first.', true);
    return;
  }

  try {
    const parsed = parseSuggestionJson(raw);
    if (parsed.recommendedFilterField) {
      document.getElementById('filterField').value = parsed.recommendedFilterField;
    }
    if (parsed.recommendedCategoryPaths.length) {
      document.getElementById('categoryPaths').value = parsed.recommendedCategoryPaths.join(',');
    }
    renderSuggestionSummary(parsed);
    setStatus('Suggestion applied to the form. Click Save to persist.');
  } catch (e) {
    setStatus('Could not parse suggestion JSON.', true);
  }
});

document.addEventListener('DOMContentLoaded', () => {
  renderSuggestionSummary(null);
  loadState();
  loadDiagnostics();
});
