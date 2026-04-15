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
  selectedCategoryIds: new Set(),
  collapsedCategoryIds: new Set()
};

let saveTimer = null;
let isReady = false;
let draggedCategoryId = null;

const enabledToggle = document.getElementById('enabledToggle');
const categoriesContainer = document.getElementById('categories');
const addCategoryBtn = document.getElementById('addCategoryBtn');
const organizeBtn = document.getElementById('organizeBtn');
const addCurrentDomainBtn = document.getElementById('addCurrentDomainBtn');
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

function getSelectedCategories() {
  return state.categories.filter(category => state.selectedCategoryIds.has(category.id) && category.id !== 'other');
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
      metaEl.textContent = domainCount === 1 ? '1 domena' : `${domainCount} domen`;
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
  const collapseBtn = card.querySelector('[data-action="collapse"]');
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

  if (collapseBtn) {
    collapseBtn.textContent = collapsed ? 'Rozbalit' : 'Zbalit';
    collapseBtn.setAttribute('aria-expanded', String(!collapsed));
  }
}

function moveCardBefore(draggedCard, targetCard) {
  if (!draggedCard || !targetCard || draggedCard === targetCard) {
    return;
  }

  const targetCategoryId = targetCard.getAttribute('data-category-id');
  if (targetCategoryId === 'other') {
    categoriesContainer.insertBefore(draggedCard, targetCard);
    return;
  }

  categoriesContainer.insertBefore(draggedCard, targetCard);
}

function toggleCategorySelected(categoryId, selected) {
  if (selected) {
    state.selectedCategoryIds.add(categoryId);
  } else {
    state.selectedCategoryIds.delete(categoryId);
  }
}

async function addCurrentDomainToSelectedCategories() {
  syncStateFromControls();

  const selectedCategories = getSelectedCategories();
  if (!selectedCategories.length) {
    setStatus('Najprv oznac aspon jednu kategoriu.', 'error');
    return;
  }

  const domain = await getCurrentTabDomain();
  if (!domain) {
    setStatus('Nepodarilo sa ziskat domenu z aktualneho tabu.', 'error');
    return;
  }

  const categoryIds = selectedCategories.map(category => category.id);

  try {
    const response = await chrome.runtime.sendMessage({
      type: 'addDomainToCategories',
      domain,
      categoryIds
    });

    if (!response || !response.success) {
      setStatus(`Nepodarilo sa pridat domenu: ${response?.error || 'neznamy problem'}`, 'error');
      return;
    }

    state.categories = response.settings.categories;
    renderCategories();
    setStatus(`Domena ${domain} pridana do ${categoryIds.length} kategorii.`, 'success');
  } catch (error) {
    setStatus(`Nepodarilo sa pridat domenu: ${error.message}`, 'error');
  }
}

function renderCategory(category) {
  const card = document.createElement('article');
  card.className = 'category-card';
  card.dataset.categoryId = category.id;
  applyCategoryAccent(card, category);

  if (state.selectedCategoryIds.has(category.id)) {
    card.classList.add('is-selected');
  }

  const header = document.createElement('div');
  header.className = 'category-header';

  const summary = document.createElement('div');
  summary.className = 'category-summary';

  const selectionBadge = document.createElement('span');
  selectionBadge.className = 'category-selection-badge';
  selectionBadge.textContent = 'Vybrana';

  const colorDot = document.createElement('span');
  colorDot.className = 'category-color-dot';

  const titleGroup = document.createElement('div');
  titleGroup.className = 'category-title-group';

  const title = document.createElement('h3');
  title.className = 'category-title';
  title.textContent = category.name;

  const meta = document.createElement('p');
  meta.className = 'category-meta';

  titleGroup.append(title, meta);
  summary.append(selectionBadge, colorDot, titleGroup);

  const actions = document.createElement('div');
  actions.className = 'category-actions';

  const dragHandle = document.createElement('button');
  dragHandle.type = 'button';
  dragHandle.className = 'drag-handle';
  dragHandle.textContent = 'Presun';
  dragHandle.title = category.id === 'other' ? 'Ostatne je pevna kategoria' : 'Presunut kategoriu';
  dragHandle.disabled = category.id === 'other';
  dragHandle.draggable = category.id !== 'other';

  dragHandle.addEventListener('dragstart', event => {
    if (category.id === 'other') {
      event.preventDefault();
      return;
    }

    draggedCategoryId = category.id;
    card.classList.add('is-dragging');
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', category.id);
  });

  dragHandle.addEventListener('dragend', () => {
    draggedCategoryId = null;
    card.classList.remove('is-dragging');
    for (const item of categoriesContainer.querySelectorAll('.is-drop-target')) {
      item.classList.remove('is-drop-target');
    }
  });

  const collapseBtn = document.createElement('button');
  collapseBtn.type = 'button';
  collapseBtn.className = 'ghost-btn compact';
  collapseBtn.dataset.action = 'collapse';
  collapseBtn.textContent = 'Zbalit';
  collapseBtn.addEventListener('click', () => {
    const isCollapsed = !card.classList.contains('is-collapsed');
    setCardCollapsed(card, isCollapsed);
  });

  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'danger-btn compact';
  removeBtn.textContent = 'Odstranit';
  removeBtn.disabled = category.id === 'other';
  removeBtn.title = category.id === 'other' ? 'Ostatne je systemova kategoria' : 'Odstranit kategoriu';
  removeBtn.addEventListener('click', () => {
    if (category.id === 'other') {
      return;
    }

    card.remove();
    syncStateFromControls();
    scheduleSave();
  });

  actions.append(dragHandle, collapseBtn, removeBtn);
  header.append(summary, actions);

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
  domainLabel.textContent = 'Domény';

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
  note.textContent = 'Domény oddel ciarkou alebo novym riadkom.';

  body.append(nameGroup, colorGroup, domainLabel, domainsInput, note);
  card.append(header, body);

  card.addEventListener('dragover', event => {
    if (!draggedCategoryId || category.id === 'other') {
      return;
    }

    event.preventDefault();
    card.classList.add('is-drop-target');
  });

  card.addEventListener('dragleave', () => {
    card.classList.remove('is-drop-target');
  });

  card.addEventListener('drop', event => {
    if (!draggedCategoryId || category.id === 'other') {
      return;
    }

    event.preventDefault();
    const draggedCard = categoriesContainer.querySelector(`[data-category-id="${draggedCategoryId}"]`);
    card.classList.remove('is-drop-target');

    if (draggedCard) {
      moveCardBefore(draggedCard, card);
      syncStateFromControls();
      scheduleSave();
    }
  });

  card.addEventListener('click', event => {
    if (category.id === 'other') {
      return;
    }

    if (event.target.closest('button, input, select, textarea, label, a')) {
      return;
    }

    const isSelected = state.selectedCategoryIds.has(category.id);
    toggleCategorySelected(category.id, !isSelected);
    card.classList.toggle('is-selected', !isSelected);
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
  state.categories = [...categoriesWithoutOther, newCategory, ...(otherCategory ? [otherCategory] : [])];
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
addCurrentDomainBtn.addEventListener('click', addCurrentDomainToSelectedCategories);

loadState().catch(error => {
  setStatus(`Nepodarilo sa nacitat nastavenia: ${error.message}`, 'error');
});
