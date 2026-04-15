const chrome = globalThis.browser ?? globalThis.chrome;

if (!chrome) {
  throw new Error('TabNest: Browser extension API is not available.');
}

const STORAGE_KEY = 'tabOrganizerSettings';
const GROUP_COLORS = ['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange'];
const TAB_ID_NONE = typeof chrome?.tabs?.TAB_ID_NONE === 'number' ? chrome.tabs.TAB_ID_NONE : -1;
const WINDOW_ID_NONE = typeof chrome?.windows?.WINDOW_ID_NONE === 'number' ? chrome.windows.WINDOW_ID_NONE : -1;

function supportsTabGroups() {
  return Boolean(chrome?.tabGroups && chrome?.tabs?.group && chrome?.tabs?.ungroup);
}

const defaultSettings = {
  enabled: true,
  includeOtherGroup: true,
  theme: 'light',
  categories: [
    {
      id: 'other',
      name: 'Ostatne',
      color: 'grey',
      domains: []
    }
  ]
};

let settings = normalizeSettings(defaultSettings);
let organizingWindows = new Set();
let scheduledRuns = new Map();
let isInitializingSettings = true;
let suppressNextSettingsRefresh = false;

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || `category-${Date.now()}`;
}

function normalizeDomains(domains) {
  if (Array.isArray(domains)) {
    return domains.map(domain => String(domain).trim().toLowerCase()).filter(Boolean);
  }

  if (typeof domains === 'string') {
    return domains
      .split(/[,\n]/)
      .map(domain => domain.trim().toLowerCase())
      .filter(Boolean);
  }

  return [];
}

function normalizeColor(color) {
  return GROUP_COLORS.includes(color) ? color : 'grey';
}

function cloneCategory(category) {
  const color = normalizeColor(category.color);
  return {
    id: category.id || slugify(category.name),
    name: String(category.name || 'Category'),
    color,
    domains: normalizeDomains(category.domains)
  };
}

function normalizeSettings(rawSettings) {
  const merged = {
    enabled: rawSettings && typeof rawSettings.enabled === 'boolean' ? rawSettings.enabled : defaultSettings.enabled,
    includeOtherGroup: rawSettings && typeof rawSettings.includeOtherGroup === 'boolean' ? rawSettings.includeOtherGroup : defaultSettings.includeOtherGroup,
    theme: rawSettings && (rawSettings.theme === 'dark' || rawSettings.theme === 'light') ? rawSettings.theme : defaultSettings.theme,
    categories: []
  };

  const rawCategories = Array.isArray(rawSettings && rawSettings.categories) ? rawSettings.categories : defaultSettings.categories;
  const categories = rawCategories.map(cloneCategory);

  if (!categories.some(category => category.id === 'other')) {
    categories.push(cloneCategory(defaultSettings.categories.find(category => category.id === 'other')));
  }

  merged.categories = categories;
  return merged;
}

async function loadSettings() {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  settings = normalizeSettings(stored[STORAGE_KEY]);
  await chrome.storage.local.set({ [STORAGE_KEY]: settings });
  isInitializingSettings = false;
  return settings;
}

function domainMatches(hostname, domain) {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

function detectCategory(url) {
  if (!url || !settings) {
    return null;
  }

  try {
    const hostname = new URL(url).hostname.replace(/^www\./, '').toLowerCase();
    const categories = settings.categories.filter(category => category.id !== 'other');

    for (const category of categories) {
      for (const domain of category.domains) {
        if (domain && domainMatches(hostname, domain)) {
          return category;
        }
      }
    }
  } catch (error) {
    return null;
  }

  return null;
}

function getCategoryOrder() {
  const categories = settings.categories.filter(category => category.id !== 'other');
  if (settings.includeOtherGroup) {
    categories.push(settings.categories.find(category => category.id === 'other'));
  }

  return categories.filter(Boolean);
}

async function ungroupTabs(tabIds) {
  if (!tabIds.length || !supportsTabGroups()) {
    return;
  }

  try {
    await chrome.tabs.ungroup(tabIds);
  } catch (error) {
    console.warn('TabNest: Ungroup failed', error);
  }
}

async function moveTabsInOrder(orderedTabs) {
  let nextIndex = 0;

  for (const tab of orderedTabs) {
    try {
      await chrome.tabs.move(tab.id, { index: nextIndex });
      nextIndex += 1;
    } catch (error) {
      console.warn('TabNest: Move failed for tab', tab.id, error);
    }
  }
}

async function groupTabsByCategory(categoryMap) {
  if (!supportsTabGroups()) {
    return;
  }

  for (const category of getCategoryOrder()) {
    const tabs = categoryMap.get(category.id) || [];
    if (!tabs.length) {
      continue;
    }

    try {
      const groupId = await chrome.tabs.group({ tabIds: tabs.map(tab => tab.id) });
      await chrome.tabGroups.update(groupId, {
        title: category.name,
        color: normalizeColor(category.color)
      });
    } catch (error) {
      console.warn('TabNest: Group failed for category', category.id, error);
    }
  }
}

async function captureCollapsedGroupStates(tabs, windowId) {
  if (!supportsTabGroups()) {
    return new Map();
  }

  const states = new Map();
  const groupIds = [...new Set(tabs.map(tab => tab.groupId).filter(groupId => typeof groupId === 'number' && groupId !== TAB_ID_NONE))];

  for (const groupId of groupIds) {
    try {
      const group = await chrome.tabGroups.get(groupId);
      if (group && group.title && group.windowId === windowId) {
        states.set(group.title, Boolean(group.collapsed));
      }
    } catch (error) {
      console.warn('TabNest: Could not capture group state', groupId, error);
    }
  }

  return states;
}

async function restoreCollapsedGroupStates(collapseStates, windowId) {
  if (!supportsTabGroups() || !collapseStates || !collapseStates.size) {
    return;
  }

  try {
    const tabs = await chrome.tabs.query({ windowId });
    const groupIds = [...new Set(tabs.map(tab => tab.groupId).filter(groupId => typeof groupId === 'number' && groupId !== TAB_ID_NONE))];

    for (const groupId of groupIds) {
      try {
        const group = await chrome.tabGroups.get(groupId);
        const shouldCollapse = collapseStates.get(group.title);

        if (typeof shouldCollapse === 'boolean') {
          await chrome.tabGroups.update(groupId, { collapsed: shouldCollapse });
        }
      } catch (error) {
        console.warn('TabNest: Could not restore group state', groupId, error);
      }
    }
  } catch (error) {
    console.warn('TabNest: Could not inspect window for group state restore', windowId, error);
  }
}

async function organizeWindow(windowId, force = false) {
  if (!settings) {
    await loadSettings();
  }

  if (!force && !settings.enabled) {
    return { success: true, skipped: true };
  }

  if (organizingWindows.has(windowId)) {
    return { success: true, skipped: true };
  }

  organizingWindows.add(windowId);

  try {
    const tabs = await chrome.tabs.query({ windowId });
    const sortedTabs = [...tabs].sort((left, right) => left.index - right.index);
    const collapsedGroupStates = await captureCollapsedGroupStates(sortedTabs, windowId);
    const categoryMap = new Map();

    for (const category of getCategoryOrder()) {
      categoryMap.set(category.id, []);
    }

    if (!categoryMap.has('other')) {
      categoryMap.set('other', []);
    }

    for (const tab of sortedTabs) {
      const category = detectCategory(tab.url);
      const key = category ? category.id : 'other';
      if (!categoryMap.has(key)) {
        categoryMap.set(key, []);
      }
      categoryMap.get(key).push(tab);
    }

    const groupedTabIds = sortedTabs
      .filter(tab => typeof tab.groupId === 'number' && tab.groupId !== TAB_ID_NONE)
      .map(tab => tab.id);
    await ungroupTabs(groupedTabIds);

    const orderedTabs = [];
    for (const category of getCategoryOrder()) {
      orderedTabs.push(...(categoryMap.get(category.id) || []));
    }

    if (!settings.includeOtherGroup) {
      orderedTabs.push(...(categoryMap.get('other') || []));
    }

    await moveTabsInOrder(orderedTabs);
    await groupTabsByCategory(categoryMap);
    await restoreCollapsedGroupStates(collapsedGroupStates, windowId);

    return { success: true, tabCount: sortedTabs.length };
  } catch (error) {
    console.error('TabNest: Organizing failed', error);
    return { success: false, error: error.message };
  } finally {
    organizingWindows.delete(windowId);
  }
}

async function organizeAllWindows(force = false) {
  const windows = await chrome.windows.getAll({ windowTypes: ['normal'] });
  const results = [];

  for (const window of windows) {
    results.push(await organizeWindow(window.id, force));
  }

  return results;
}

function scheduleOrganize(windowId, delay = 500) {
  if (!settings || !settings.enabled || windowId === WINDOW_ID_NONE) {
    return;
  }

  const existingTimer = scheduledRuns.get(windowId);
  if (existingTimer) {
    clearTimeout(existingTimer);
  }

  const timer = setTimeout(() => {
    scheduledRuns.delete(windowId);
    organizeWindow(windowId).catch(error => {
      console.error('TabNest: Scheduled organize failed', error);
    });
  }, delay);

  scheduledRuns.set(windowId, timer);
}

async function keepNewTabInOpenerGroup(tab) {
  if (!supportsTabGroups()) {
    return false;
  }

  if (!tab || typeof tab.id !== 'number' || typeof tab.openerTabId !== 'number') {
    return false;
  }

  try {
    const openerTab = await chrome.tabs.get(tab.openerTabId);

    if (
      openerTab.windowId !== tab.windowId ||
      openerTab.groupId === TAB_ID_NONE ||
      tab.groupId !== TAB_ID_NONE
    ) {
      return false;
    }

    await chrome.tabs.group({
      groupId: openerTab.groupId,
      tabIds: [tab.id]
    });

    return true;
  } catch (error) {
    console.warn('TabNest: Could not keep new tab in opener group', error);
    return false;
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  await loadSettings();
  if (settings.enabled) {
    await organizeAllWindows();
  }
});

chrome.runtime.onStartup.addListener(async () => {
  await loadSettings();
  if (settings.enabled) {
    await organizeAllWindows();
  }
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local' || !changes[STORAGE_KEY]) {
    return;
  }

  settings = normalizeSettings(changes[STORAGE_KEY].newValue);

  if (suppressNextSettingsRefresh) {
    suppressNextSettingsRefresh = false;
    return;
  }

  if (!isInitializingSettings && settings.enabled) {
    organizeAllWindows(true).catch(error => {
      console.error('TabNest: Refresh after settings change failed', error);
    });
  }
});

chrome.tabs.onCreated.addListener(async tab => {
  const wasGroupedWithOpener = await keepNewTabInOpenerGroup(tab);

  if (wasGroupedWithOpener) {
    scheduleOrganize(tab.windowId, 700);
    return;
  }

  scheduleOrganize(tab.windowId, 700);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url && changeInfo.url.startsWith('chrome://newtab')) {
    return;
  }

  if (changeInfo.url) {
    scheduleOrganize(tab.windowId, 900);
  }
});

chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
  scheduleOrganize(removeInfo.windowId, 300);
});

chrome.tabs.onAttached.addListener((tabId, attachInfo) => {
  scheduleOrganize(attachInfo.newWindowId, 500);
});

chrome.tabs.onMoved.addListener((tabId, moveInfo) => {
  scheduleOrganize(moveInfo.windowId, 300);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'organizeTabs') {
    const windowId = typeof message.windowId === 'number' ? message.windowId : sender?.tab?.windowId;

    if (typeof windowId !== 'number') {
      organizeAllWindows(true)
        .then(result => sendResponse({ success: true, result }))
        .catch(error => sendResponse({ success: false, error: error.message }));
      return true;
    }

    organizeWindow(windowId, true)
      .then(result => sendResponse(result))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (message.type === 'getSettings') {
    loadSettings()
      .then(currentSettings => sendResponse({ success: true, settings: currentSettings }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (message.type === 'addDomainToCategories') {
    (async () => {
      if (!Array.isArray(message.categoryIds) || typeof message.domain !== 'string') {
        sendResponse({ success: false, error: 'Neplatne vstupne data.' });
        return;
      }

      if (!settings) {
        await loadSettings();
      }

      const normalizedDomain = message.domain.trim().toLowerCase();
      const updatedCategories = settings.categories.map(category => {
        if (category.id === 'other' || !message.categoryIds.includes(category.id)) {
          return category;
        }

        const domains = Array.isArray(category.domains) ? [...category.domains] : [];
        if (!domains.includes(normalizedDomain)) {
          domains.push(normalizedDomain);
        }

        return {
          ...category,
          domains
        };
      });

      settings = normalizeSettings({ ...settings, categories: updatedCategories });
      suppressNextSettingsRefresh = true;
      await chrome.storage.local.set({ [STORAGE_KEY]: settings });
      sendResponse({ success: true, settings });
    })().catch(error => {
      suppressNextSettingsRefresh = false;
      sendResponse({ success: false, error: error.message });
    });

    return true;
  }

  return false;
});

loadSettings().catch(error => {
  console.error('TabNest: Failed to initialize settings', error);
});
