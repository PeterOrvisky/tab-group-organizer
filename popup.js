const STORAGE_KEY = 'tabOrganizerSettings';
const GROUP_COLORS = ['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange'];
const COLOR_TOKENS = {
  grey: { accent: '#64748b', soft: 'rgba(100, 116, 139, 0.14)' },
  blue: { accent: '#2563eb', soft: 'rgba(37, 99, 235, 0.14)' },
  red: { accent: '#dc2626', soft: 'rgba(220, 38, 38, 0.14)' },
  yellow: { accent: '#d97706', soft: 'rgba(217, 119, 6, 0.16)' },
  green: { accent: '#16a34a', soft: 'rgba(22, 163, 74, 0.14)' },
  pink: { accent: '#db2777', soft: 'rgba(219, 39, 119, 0.14)' },
  purple: { accent: '#7c3aed', soft: 'rgba(124, 58, 237, 0.14)' },
  cyan: { accent: '#0891b2', soft: 'rgba(8, 145, 178, 0.14)' },
  orange: { accent: '#ea580c', soft: 'rgba(234, 88, 12, 0.14)' }
};

const ACTION_ICON_SVGS = {
  remove: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M5 7h14M10 3.8h4M9 7v11m6-11v11M7.5 7l.8 12h7.4l.8-12" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8"/></svg>',
  addDomain: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"/></svg>',
  removeDomain: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M5 12h14" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"/></svg>',
  chevron: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m8 10 4 4 4-4" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8"/></svg>'
};

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

const state = {
  enabled: true,
  includeOtherGroup: true,
  theme: 'light',
  categories: [],
  collapsedCategoryIds: new Set(),
  currentTabDomain: null
};

let saveTimer = null;
let isReady = false;

const enabledToggle = document.getElementById('enabledToggle');
const categoriesContainer = document.getElementById('categories');
const addCategoryBtn = document.getElementById('addCategoryBtn');
const organizeBtn = document.getElementById('organizeBtn');
const themeButtons = document.querySelectorAll('[data-theme-option]');
const statusEl = document.getElementById('status');

function setStatus(message, type = 'info') {
  statusEl.textContent = message;
  statusEl.classList.remove('success', 'error');

  if (type === 'success' || type === 'error') {
    statusEl.classList.add(type);
  }
}

function cloneCategory(category) {
  const safeCategory = category && typeof category === 'object' ? category : {};
  const color = GROUP_COLORS.includes(safeCategory.color) ? safeCategory.color : 'grey';

  return {
    id: safeCategory.id || `category-${Date.now()}`,
    name: String(safeCategory.name || 'Nova kategoria'),
    color,
    domains: Array.isArray(safeCategory.domains) ? [...safeCategory.domains] : []
  };
}

function normalizeColor(color) {
  return GROUP_COLORS.includes(color) ? color : 'grey';
}

function normalizeSettings(rawSettings) {
  const merged = {
    enabled: rawSettings && typeof rawSettings.enabled === 'boolean' ? rawSettings.enabled : defaultSettings.enabled,
    includeOtherGroup: rawSettings && typeof rawSettings.includeOtherGroup === 'boolean' ? rawSettings.includeOtherGroup : defaultSettings.includeOtherGroup,
    theme: rawSettings && (rawSettings.theme === 'dark' || rawSettings.theme === 'light') ? rawSettings.theme : defaultSettings.theme,
    categories: []
  };

  const rawCategories = Array.isArray(rawSettings && rawSettings.categories) ? rawSettings.categories : defaultSettings.categories;
  const categories = rawCategories.filter(Boolean).map(cloneCategory);
  const defaultOtherCategory = cloneCategory(defaultSettings.categories.find(category => category.id === 'other'));
  const otherCategory = categories.find(category => category.id === 'other') || defaultOtherCategory;
  const regularCategories = categories.filter(category => category.id !== 'other');

  merged.categories = [...regularCategories, otherCategory];
  return merged;
}

function getHostnameFromUrl(url) {
  if (!url) {
    return null;
  }

  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch (error) {
    return null;
  }
}

function toDomainList(value) {
  return String(value || '')
    .split(/[\n,]/)
    .map(domain => domain.trim().toLowerCase())
    .filter(Boolean);
}

function domainMatches(hostname, domain) {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

function categoryHasCurrentDomain(category, currentDomain) {
  if (!category || !currentDomain || category.id === 'other') {
    return false;
  }

  const domains = Array.isArray(category.domains) ? category.domains : [];
  return domains.some(domain => domain && domainMatches(currentDomain, String(domain).trim().toLowerCase()));
}

function createColorOptions(selectedColor) {
  return GROUP_COLORS.map(color => {
    const option = document.createElement('option');
    option.value = color;
    option.textContent = color.charAt(0).toUpperCase() + color.slice(1);
    option.selected = color === selectedColor;
    return option;
  });
}

function getColorTokens(color) {
  return COLOR_TOKENS[color] || COLOR_TOKENS.grey;
}

function applyCategoryAccent(card, category) {
  const safeCategory = category && typeof category === 'object' ? category : {};
  const color = normalizeColor(safeCategory.color);
  const tokens = getColorTokens(color);
  card.dataset.color = color;
  card.style.setProperty('--category-accent', tokens.accent);
  card.style.setProperty('--category-accent-soft', tokens.soft);
}

function applyTheme(theme) {
  state.theme = theme === 'dark' ? 'dark' : 'light';
  document.body.dataset.theme = state.theme;

  for (const button of themeButtons) {
    const isActive = button.getAttribute('data-theme-option') === state.theme;
    button.classList.toggle('is-active', isActive);
    button.setAttribute('aria-pressed', String(isActive));
  }
}

async function getCurrentTabDomain() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const currentTab = tabs[0];

  if (!currentTab || !currentTab.url) {
    return null;
  }

  return getHostnameFromUrl(currentTab.url);
}

function scheduleSave() {
  if (!isReady) {
    return;
  }

  if (saveTimer) {
    clearTimeout(saveTimer);
  }

  setStatus('Ukladam zmeny...');
  saveTimer = setTimeout(async () => {
    try {
      await chrome.storage.local.set({ [STORAGE_KEY]: normalizeSettings(state) });
      setStatus('Nastavenia ulozene.', 'success');
    } catch (error) {
      setStatus(`Nepodarilo sa ulozit nastavenia: ${error.message}`, 'error');
    }
  }, 250);
}

function createIconSpan(svgMarkup, className) {
  const icon = document.createElement('span');
  icon.className = className;
  icon.setAttribute('aria-hidden', 'true');
  icon.innerHTML = svgMarkup;
  return icon;
}

function attachIconClickFeedback(button) {
  if (!button) {
    return;
  }

  button.addEventListener('click', () => {
    button.classList.add('is-clicked');
    setTimeout(() => {
      button.classList.remove('is-clicked');
    }, 140);
  });
}

function createIconButton({ className, iconKey, label, title, pressed = null, disabled = false }) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.title = title || label;
  button.setAttribute('aria-label', label);

  if (pressed !== null) {
    button.setAttribute('aria-pressed', String(pressed));
  }

  button.disabled = disabled;
  button.appendChild(createIconSpan(ACTION_ICON_SVGS[iconKey], 'button-icon'));
  attachIconClickFeedback(button);
  return button;
}

async function updateCurrentTabDomainInCategory(categoryId, operation) {
  const category = state.categories.find(item => item.id === categoryId);
  if (!category || category.id === 'other') {
    return;
  }

  const web = state.currentTabDomain || await getCurrentTabDomain();
  if (!web) {
    setStatus('Nepodarilo sa ziskat aktualny web z karty.', 'error');
    return;
  }

  const normalizedOperation = operation === 'remove' ? 'remove' : 'add';

  try {
    const response = await chrome.runtime.sendMessage({
      type: 'addDomainToCategories',
      domain: web,
      categoryIds: [categoryId],
      operation: normalizedOperation
    });

    if (!response || !response.success) {
      const actionText = normalizedOperation === 'remove' ? 'odstranit web' : 'pridat web';
      setStatus(`Nepodarilo sa ${actionText}: ${response?.error || 'neznamy problem'}`, 'error');
      return;
    }

    state.categories = response.settings.categories;
    state.currentTabDomain = web;
    renderCategories();
    if (normalizedOperation === 'remove') {
      setStatus(`Aktualny web bol odstraneny z kategorie ${category.name}.`, 'success');
    } else {
      setStatus(`Aktualny web bol pridany do kategorie ${category.name}.`, 'success');
    }
  } catch (error) {
    const actionText = normalizedOperation === 'remove' ? 'odstranit web' : 'pridat web';
    setStatus(`Nepodarilo sa ${actionText}: ${error.message}`, 'error');
  }
}

function moveCategoryByOffset(categoryId, offset) {
  if (!offset || categoryId === 'other') {
    return;
  }

  const card = categoriesContainer.querySelector(`[data-category-id="${categoryId}"]`);
  if (!card) {
    return;
  }

  const cards = Array.from(categoriesContainer.querySelectorAll('[data-category-id]'));
  const currentIndex = cards.findIndex(item => item.getAttribute('data-category-id') === categoryId);
  if (currentIndex < 0) {
    return;
  }

  const targetIndex = currentIndex + offset;
  if (targetIndex < 0 || targetIndex >= cards.length) {
    return;
  }

  const targetCard = cards[targetIndex];
  if (!targetCard || targetCard.getAttribute('data-category-id') === 'other') {
    return;
  }

  if (offset < 0) {
    categoriesContainer.insertBefore(card, targetCard);
  } else {
    categoriesContainer.insertBefore(targetCard, card);
  }

  syncStateFromControls();
  renderCategories({ preserveCollapsedState: true });
  scheduleSave();
}

function updateCategorySummary(card) {
  try {
    if (!card || typeof card.querySelector !== 'function') {
      return;
    }

    const nameInput = card.querySelector('[data-field="name"]');
    const domainsInput = card.querySelector('[data-field="domains"]');
    const titleEl = card.querySelector('.category-title');
    const metaEl = card.querySelector('.category-meta');

    if (titleEl && nameInput) {
      titleEl.textContent = nameInput.value.trim() || 'Nova kategoria';
    }

    if (metaEl && domainsInput) {
      const domainCount = toDomainList(domainsInput.value).length;
      metaEl.textContent = domainCount === 1 ? '1 web' : `${domainCount} webov`;
    }
  } catch (error) {
    console.warn('TabNest: updateCategorySummary failed', error);
  }
}

function syncStateFromControls() {
  state.enabled = enabledToggle.checked;

  const categoryCards = categoriesContainer.querySelectorAll('[data-category-id]');
  const categories = [];

  for (const card of categoryCards) {
    const categoryId = card.getAttribute('data-category-id');
    const nameInput = card.querySelector('[data-field="name"]');
    const colorSelect = card.querySelector('[data-field="color"]');
    const domainsInput = card.querySelector('[data-field="domains"]');
    const color = normalizeColor(colorSelect?.value);

    categories.push({
      id: categoryId,
      name: nameInput.value.trim() || 'Nova kategoria',
      color,
      domains: toDomainList(domainsInput.value)
    });
  }

  state.categories = categories;
}

function setCardCollapsed(card, collapsed) {
  const body = card.querySelector('.category-body');
  const indicator = card.querySelector('.category-collapse-indicator');
  const categoryId = card.getAttribute('data-category-id');

  card.classList.toggle('is-collapsed', collapsed);
  card.classList.toggle('is-expanded', !collapsed);

  if (body) {
    body.hidden = collapsed;
  }

  if (categoryId) {
    if (collapsed) {
      state.collapsedCategoryIds.add(categoryId);
    } else {
      state.collapsedCategoryIds.delete(categoryId);
    }
  }

  if (indicator) {
    indicator.setAttribute('aria-label', collapsed ? 'Rozbalit kategoriu' : 'Zbalit kategoriu');
  }
}

function renderCategory(category) {
  const card = document.createElement('article');
  card.className = 'category-card';
  card.dataset.categoryId = category.id;
  applyCategoryAccent(card, category);

  const header = document.createElement('div');
  header.className = 'category-header';

  const summary = document.createElement('div');
  summary.className = 'category-summary';

  const titleGroup = document.createElement('div');
  titleGroup.className = 'category-title-group';

  const title = document.createElement('h3');
  title.className = 'category-title';
  title.textContent = category.name;

  const meta = document.createElement('p');
  meta.className = 'category-meta';

  titleGroup.append(title, meta);

  if (category.id === 'other') {
    summary.append(titleGroup);
    header.append(summary);
  } else {
    const collapseIndicator = createIconSpan(ACTION_ICON_SVGS.chevron, 'category-collapse-indicator');
    summary.append(titleGroup, collapseIndicator);

    const actions = document.createElement('div');
    actions.className = 'category-actions';

    const moveControls = document.createElement('div');
    moveControls.className = 'move-controls';

    const categoryIndex = state.categories.findIndex(item => item.id === category.id);
    const canMoveUp = categoryIndex > 0;
    const canMoveDown = categoryIndex >= 0 && categoryIndex < state.categories.length - 2;
    const hasCurrentDomain = categoryHasCurrentDomain(category, state.currentTabDomain);

    const moveUpBtn = createIconButton({
      className: 'icon-btn move-btn move-up-btn',
      iconKey: 'chevron',
      label: 'Posunut kategoriu hore',
      title: 'Posunut kategoriu hore',
      disabled: !canMoveUp
    });

    moveUpBtn.addEventListener('click', () => {
      moveCategoryByOffset(category.id, -1);
    });

    const moveDownBtn = createIconButton({
      className: 'icon-btn move-btn move-down-btn',
      iconKey: 'chevron',
      label: 'Posunut kategoriu dole',
      title: 'Posunut kategoriu dole',
      disabled: !canMoveDown
    });

    moveDownBtn.addEventListener('click', () => {
      moveCategoryByOffset(category.id, 1);
    });

    const addDomainBtn = createIconButton({
      className: 'icon-btn add-domain-btn',
      iconKey: hasCurrentDomain ? 'removeDomain' : 'addDomain',
      label: hasCurrentDomain ? 'Odstranit aktualny web z kategorie' : 'Pridat aktualny web do kategorie',
      title: hasCurrentDomain ? 'Odstranit aktualny web z kategorie' : 'Pridat aktualny web do kategorie'
    });

    addDomainBtn.addEventListener('click', () => {
      updateCurrentTabDomainInCategory(category.id, hasCurrentDomain ? 'remove' : 'add');
    });

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'danger-btn compact icon-btn';
    removeBtn.appendChild(createIconSpan(ACTION_ICON_SVGS.remove, 'button-icon'));
    attachIconClickFeedback(removeBtn);
    removeBtn.title = 'Odstranit kategoriu';
    removeBtn.setAttribute('aria-label', removeBtn.title);
    removeBtn.addEventListener('click', () => {
      card.remove();
      syncStateFromControls();
      scheduleSave();
    });

    moveControls.append(moveUpBtn, moveDownBtn);
    actions.append(addDomainBtn, removeBtn, moveControls);
    header.append(summary, actions);
  }

  const body = document.createElement('div');
  body.className = 'category-body';

  const nameGroup = document.createElement('div');
  nameGroup.className = 'field-group';

  const nameLabel = document.createElement('label');
  nameLabel.textContent = 'Nazov skupiny';
  nameLabel.className = 'field-label';

  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.className = 'text-input';
  nameInput.dataset.field = 'name';
  nameInput.value = category.name;
  nameInput.addEventListener('input', () => {
    updateCategorySummary(card);
    syncStateFromControls();
    scheduleSave();
  });

  nameGroup.append(nameLabel, nameInput);

  const colorGroup = document.createElement('div');
  colorGroup.className = 'field-group compact';

  const colorLabel = document.createElement('label');
  colorLabel.textContent = 'Farba';
  colorLabel.className = 'field-label';

  const colorSelect = document.createElement('select');
  colorSelect.className = 'text-input';
  colorSelect.dataset.field = 'color';
  colorSelect.append(...createColorOptions(category.color));
  colorSelect.addEventListener('change', () => {
    applyCategoryAccent(card, {
      color: colorSelect.value
    });
    syncStateFromControls();
    scheduleSave();
  });

  colorGroup.append(colorLabel, colorSelect);

  const domainLabel = document.createElement('label');
  domainLabel.className = 'field-label';
  domainLabel.textContent = 'Weby';

  const domainsInput = document.createElement('textarea');
  domainsInput.className = 'domains-input';
  domainsInput.dataset.field = 'domains';
  domainsInput.rows = 3;
  domainsInput.value = category.domains.join(', ');
  domainsInput.placeholder = 'napr. github.com, stackoverflow.com';
  domainsInput.addEventListener('input', () => {
    updateCategorySummary(card);
    syncStateFromControls();
    scheduleSave();
  });

  const note = document.createElement('p');
  note.className = 'category-note';
  note.textContent = 'Weby oddel ciarkou alebo novym riadkom.';

  body.append(nameGroup, colorGroup, domainLabel, domainsInput, note);
  card.append(header, body);

  card.addEventListener('click', event => {
    if (event.target.closest('button, input, select, textarea, label, a')) {
      return;
    }

    if (category.id === 'other') {
      return;
    }

    const isCollapsed = !card.classList.contains('is-collapsed');
    setCardCollapsed(card, isCollapsed);
  });

  updateCategorySummary(card);
  setCardCollapsed(card, state.collapsedCategoryIds.has(category.id));
  return card;
}

function renderCategories(options = {}) {
  const preserveCollapsedState = options.preserveCollapsedState !== false;
  const collapsedCategoryIds = preserveCollapsedState ? new Set(state.collapsedCategoryIds) : new Set();
  categoriesContainer.innerHTML = '';

  for (const category of state.categories) {
    const card = renderCategory(category);
    categoriesContainer.appendChild(card);

    if (collapsedCategoryIds.has(category.id)) {
      setCardCollapsed(card, true);
    }
  }
}

function addCategory() {
  const newCategory = {
    id: `custom-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    name: 'Nova kategoria',
    color: 'orange',
    domains: []
  };

  const categoriesWithoutOther = state.categories.filter(category => category.id !== 'other');
  const otherCategory = state.categories.find(category => category.id === 'other');
  state.categories = [newCategory, ...categoriesWithoutOther, ...(otherCategory ? [otherCategory] : [])];
  renderCategories({ preserveCollapsedState: true });
  scheduleSave();
}

async function loadState() {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  const normalized = normalizeSettings(stored[STORAGE_KEY]);

  state.enabled = normalized.enabled;
  state.includeOtherGroup = normalized.includeOtherGroup;
  state.theme = normalized.theme;
  state.categories = normalized.categories;
  try {
    state.currentTabDomain = await getCurrentTabDomain();
  } catch (error) {
    state.currentTabDomain = null;
  }
  state.collapsedCategoryIds = new Set(normalized.categories.map(category => category.id));

  enabledToggle.checked = state.enabled;
  applyTheme(state.theme);
  renderCategories();
  isReady = true;
  setStatus('Nastavenia nacitane.', 'success');
}

async function organizeNow() {
  syncStateFromControls();
  await chrome.storage.local.set({ [STORAGE_KEY]: normalizeSettings(state) });

  try {
    const response = await chrome.runtime.sendMessage({ type: 'organizeTabs' });
    if (response && response.success) {
      setStatus('Taby boli preusporiadane.', 'success');
    } else {
      setStatus(`Nepodarilo sa preusporiadat taby: ${response?.error || 'neznamy problem'}`, 'error');
    }
  } catch (error) {
    setStatus(`Nepodarilo sa preusporiadat taby: ${error.message}`, 'error');
    renderCategories({ preserveCollapsedState: true });
  }
}

enabledToggle.addEventListener('change', () => {
  syncStateFromControls();
  scheduleSave();
});

for (const button of themeButtons) {
  button.addEventListener('click', () => {
    applyTheme(button.getAttribute('data-theme-option'));
    scheduleSave();
  });
}

addCategoryBtn.addEventListener('click', addCategory);
organizeBtn.addEventListener('click', organizeNow);

loadState().catch(error => {
  setStatus(`Nepodarilo sa nacitat nastavenia: ${error.message}`, 'error');
});
