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

const state = {
  enabled: true,
  includeOtherGroup: true,
  categories: []
};

let saveTimer = null;
let isReady = false;

const enabledToggle = document.getElementById('enabledToggle');
const categoriesContainer = document.getElementById('categories');
const addCategoryBtn = document.getElementById('addCategoryBtn');
const organizeBtn = document.getElementById('organizeBtn');
const statusEl = document.getElementById('status');

function setStatus(message, type = 'info') {
  statusEl.textContent = message;
  statusEl.classList.remove('success', 'error');
  if (type === 'success' || type === 'error') {
    statusEl.classList.add(type);
  }
}

function cloneCategory(category) {
  return {
    id: category.id || `category-${Date.now()}`,
    name: String(category.name || 'Nova kategoria'),
    color: GROUP_COLORS.includes(category.color) ? category.color : 'grey',
    domains: Array.isArray(category.domains) ? [...category.domains] : []
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
    option.textContent = color;
    option.selected = color === selectedColor;
    return option;
  });
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

function syncStateFromControls() {
  state.enabled = enabledToggle.checked;

  const categoryCards = categoriesContainer.querySelectorAll('[data-category-id]');
  const categories = [];

  for (const card of categoryCards) {
    const categoryId = card.getAttribute('data-category-id');
    const nameInput = card.querySelector('[data-field="name"]');
    const colorSelect = card.querySelector('[data-field="color"]');
    const domainsInput = card.querySelector('[data-field="domains"]');

    categories.push({
      id: categoryId,
      name: nameInput.value.trim() || 'Nova kategoria',
      color: colorSelect.value,
      domains: toDomainList(domainsInput.value)
    });
  }

  state.categories = categories;
}

function renderCategory(category) {
  const card = document.createElement('article');
  card.className = 'category-card';
  card.dataset.categoryId = category.id;

  const header = document.createElement('div');
  header.className = 'category-header';

  const titleGroup = document.createElement('div');
  titleGroup.className = 'field-group';

  const nameLabel = document.createElement('label');
  nameLabel.textContent = 'Nazov skupiny';
  nameLabel.className = 'field-label';

  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.className = 'text-input';
  nameInput.dataset.field = 'name';
  nameInput.value = category.name;
  nameInput.addEventListener('input', () => {
    syncStateFromControls();
    scheduleSave();
  });

  titleGroup.append(nameLabel, nameInput);

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
    syncStateFromControls();
    scheduleSave();
  });

  colorGroup.append(colorLabel, colorSelect);

  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'danger-btn';
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

  header.append(titleGroup, colorGroup, removeBtn);

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
    syncStateFromControls();
    scheduleSave();
  });

  const note = document.createElement('p');
  note.className = 'category-note';
  note.textContent = 'Domény oddel ciarkou alebo novym riadkom.';

  card.append(header, domainLabel, domainsInput, note);
  return card;
}

function renderCategories() {
  categoriesContainer.innerHTML = '';
  for (const category of state.categories) {
    categoriesContainer.appendChild(renderCategory(category));
  }
}

function addCategory() {
  const newCategory = {
    id: `custom-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    name: 'Nova kategoria',
    color: 'orange',
    domains: []
  };

  state.categories = [...state.categories, newCategory];
  renderCategories();
  scheduleSave();
}

async function loadState() {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  const normalized = normalizeSettings(stored[STORAGE_KEY]);

  state.enabled = normalized.enabled;
  state.includeOtherGroup = normalized.includeOtherGroup;
  state.categories = normalized.categories;

  enabledToggle.checked = state.enabled;
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
  }
}

enabledToggle.addEventListener('change', () => {
  syncStateFromControls();
  scheduleSave();
});

addCategoryBtn.addEventListener('click', addCategory);
organizeBtn.addEventListener('click', organizeNow);

loadState().catch(error => {
  setStatus(`Nepodarilo sa nacitat nastavenia: ${error.message}`, 'error');
});
