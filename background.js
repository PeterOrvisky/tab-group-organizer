const STORAGE_KEY = 'tabOrganizerSettings';
const GROUP_COLORS = ['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange'];

const defaultSettings = {
  enabled: true,
  includeOtherGroup: true,
  categories: [
    {
      id: 'social',
      name: 'Socialne siete',
      color: 'red',
      domains: ['facebook.com', 'instagram.com', 'twitter.com', 'x.com', 'linkedin.com', 'tiktok.com', 'reddit.com', 'discord.com', 'youtube.com']
    },
    {
      id: 'school',
      name: 'Skola',
      color: 'blue',
      domains: ['edupage.org', 'ais.uniba.sk', 'uniba.sk', 'stuba.sk', 'ukf.sk', 'tuke.sk', 'umb.sk', 'moodle.com', 'moodle.org']
    },
    {
      id: 'programming',
      name: 'Programovanie',
      color: 'green',
      domains: ['github.com', 'stackoverflow.com', 'codepen.io', 'jsfiddle.net', 'replit.com', 'glitch.com', 'codesandbox.io']
    },
    {
      id: 'entertainment',
      name: 'Zabava',
      color: 'purple',
      domains: ['netflix.com', 'hbo.com', 'primevideo.com', 'disneyplus.com', 'twitch.tv', 'steam.com']
    },
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
  return {
    id: category.id || slugify(category.name),
    name: String(category.name || 'Category'),
    color: normalizeColor(category.color),
    domains: normalizeDomains(category.domains)
  };
}

function normalizeSettings(rawSettings) {
  const merged = {
    enabled: rawSettings && typeof rawSettings.enabled === 'boolean' ? rawSettings.enabled : defaultSettings.enabled,
    includeOtherGroup: rawSettings && typeof rawSettings.includeOtherGroup === 'boolean' ? rawSettings.includeOtherGroup : defaultSettings.includeOtherGroup,
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
  if (!tabIds.length || !chrome.tabGroups) {
    return;
  }

  try {
    await chrome.tabs.ungroup(tabIds);
  } catch (error) {
    console.warn('Tab Organizer: Ungroup failed', error);
  }
}

async function moveTabsInOrder(orderedTabs) {
  let nextIndex = 0;

  for (const tab of orderedTabs) {
    try {
      await chrome.tabs.move(tab.id, { index: nextIndex });
      nextIndex += 1;
    } catch (error) {
      console.warn('Tab Organizer: Move failed for tab', tab.id, error);
    }
  }
}

async function groupTabsByCategory(categoryMap) {
  if (!chrome.tabGroups) {
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
      console.warn('Tab Organizer: Group failed for category', category.id, error);
    }
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

    const groupedTabIds = sortedTabs.filter(tab => tab.groupId !== chrome.tabs.TAB_ID_NONE).map(tab => tab.id);
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

    return { success: true, tabCount: sortedTabs.length };
  } catch (error) {
    console.error('Tab Organizer: Organizing failed', error);
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
  if (!settings || !settings.enabled || windowId === chrome.windows.WINDOW_ID_NONE) {
    return;
  }

  const existingTimer = scheduledRuns.get(windowId);
  if (existingTimer) {
    clearTimeout(existingTimer);
  }

  const timer = setTimeout(() => {
    scheduledRuns.delete(windowId);
    organizeWindow(windowId).catch(error => {
      console.error('Tab Organizer: Scheduled organize failed', error);
    });
  }, delay);

  scheduledRuns.set(windowId, timer);
}

async function keepNewTabInOpenerGroup(tab) {
  if (!tab || typeof tab.id !== 'number' || typeof tab.openerTabId !== 'number') {
    return false;
  }

  try {
    const openerTab = await chrome.tabs.get(tab.openerTabId);

    if (
      openerTab.windowId !== tab.windowId ||
      openerTab.groupId === chrome.tabs.TAB_ID_NONE ||
      tab.groupId !== chrome.tabs.TAB_ID_NONE
    ) {
      return false;
    }

    await chrome.tabs.group({
      groupId: openerTab.groupId,
      tabIds: [tab.id]
    });

    return true;
  } catch (error) {
    console.warn('Tab Organizer: Could not keep new tab in opener group', error);
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

  if (!isInitializingSettings && settings.enabled) {
    organizeAllWindows(true).catch(error => {
      console.error('Tab Organizer: Refresh after settings change failed', error);
    });
  }
});

chrome.tabs.onCreated.addListener(async tab => {
  const wasGroupedWithOpener = await keepNewTabInOpenerGroup(tab);
  if (!wasGroupedWithOpener) {
    scheduleOrganize(tab.windowId, 800);
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (tab.groupId !== chrome.tabs.TAB_ID_NONE) {
    return;
  }

  if (changeInfo.url && changeInfo.url.startsWith('chrome://newtab')) {
    return;
  }

  if (changeInfo.status === 'complete' || changeInfo.url) {
    scheduleOrganize(tab.windowId, 800);
  }
});

chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
  scheduleOrganize(removeInfo.windowId, 300);
});

chrome.tabs.onAttached.addListener((tabId, attachInfo) => {
  scheduleOrganize(attachInfo.newWindowId, 500);
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

  return false;
});

loadSettings().catch(error => {
  console.error('Tab Organizer: Failed to initialize settings', error);
});
