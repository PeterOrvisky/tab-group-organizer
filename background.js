// Tab Organizer - Background Script
console.log('Tab Organizer: Background script načítaný');

// Preddefinované kategórie stránok
const defaultCategories = {
  'social': {
    name: 'Sociálne siete',
    color: 'red',
    domains: ['facebook.com', 'instagram.com', 'twitter.com', 'x.com', 'linkedin.com', 'tiktok.com', 'reddit.com', 'discord.com', 'youtube.com']
  },
  'school': {
    name: 'Škola',
    color: 'blue',
    domains: ['edupage.org', 'ais.uniba.sk', 'uniba.sk', 'stuba.sk', 'ukf.sk', 'tuke.sk', 'umb.sk', 'moodle.com', 'moodle.org']
  },
  'programming': {
    name: 'Programovanie',
    color: 'green',
    domains: ['github.com', 'stackoverflow.com', 'codepen.io', 'jsfiddle.net', 'replit.com', 'glitch.com', 'codesandbox.io']
  },
  'entertainment': {
    name: 'Zábava',
    color: 'purple',
    domains: ['netflix.com', 'hbo.com', 'primevideo.com', 'disneyplus.com', 'twitch.tv', 'steam.com']
  }
};

// Detekcia kategórie stránky
function detectCategory(url) {
  try {
    const domain = new URL(url).hostname.replace('www.', '');
    
    for (const [category, data] of Object.entries(defaultCategories)) {
      if (data.domains.some(d => domain.includes(d))) {
        return { type: category, color: data.color, name: data.name };
      }
    }
    
    return null;
  } catch (e) {
    return null;
  }
}

// Hlavná funkcia pre organizovanie tabov
async function organizeTabs() {
  console.log('Tab Organizer: Spúšťam organizovanie tabov...');
  try {
    // Získame všetky taby v aktuálnom okne
    const tabs = await chrome.tabs.query({ currentWindow: true });
    console.log('Tab Organizer: Nájdených tabov:', tabs.length);
    
    // Rozdelíme taby podľa kategórií
    const categorizedTabs = {
      'social': [],
      'school': [],
      'programming': [],
      'entertainment': [],
      'other': []
    };
    
    for (const tab of tabs) {
      if (!tab.url) {
        categorizedTabs.other.push(tab);
        continue;
      }
      
      const category = detectCategory(tab.url);
      if (category) {
        categorizedTabs[category.type].push(tab);
      } else {
        categorizedTabs.other.push(tab);
      }
    }
    
    // Najprv zrušíme všetky existujúce skupiny (ak sú podporované)
    if (chrome.tabGroups) {
      try {
        const existingGroups = await chrome.tabGroups.query({ windowId: chrome.windows.WINDOW_ID_CURRENT });
        for (const group of existingGroups) {
          try {
            const groupTabs = tabs.filter(t => t.groupId === group.id);
            for (const tab of groupTabs) {
              await chrome.tabs.ungroup(tab.id);
            }
          } catch (e) {
            // Ignorujeme chyby
          }
        }
      } catch (e) {
        // Tab Groups nie sú podporované
      }
    }
    
    // Pozícia pre presúvanie tabov
    let position = 0;
    
    // Presunieme a zoskupíme taby podľa kategórií
    for (const [categoryKey, categoryTabs] of Object.entries(categorizedTabs)) {
      if (categoryTabs.length === 0) continue;
      
      // Presunieme taby na správnu pozíciu
      for (const tab of categoryTabs) {
        await chrome.tabs.move(tab.id, { index: position });
        position++;
      }
      
      // Vytvoríme skupinu (okrem "other") - ak prehliadač podporuje tabGroups
      if (categoryKey !== 'other' && categoryTabs.length > 0 && chrome.tabGroups) {
        try {
          const tabIds = categoryTabs.map(t => t.id);
          const groupId = await chrome.tabs.group({ tabIds });
          
          const categoryData = defaultCategories[categoryKey];
          await chrome.tabGroups.update(groupId, {
            title: categoryData.name,
            color: categoryData.color
          });
        } catch (e) {
          // Ak tabGroups nie je podporované, taby sú aspoň presunuté vedľa seba
          console.log('Tab Groups nie sú podporované:', e.message);
        }
      }
    }
    
    return { success: true };
  } catch (error) {
    console.error('Chyba pri organizovaní tabov:', error);
    return { success: false, error: error.message };
  }
}

// Spracovanie správ od popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Tab Organizer: Prijatá správa:', message);
  if (message.type === 'organizeTabs') {
    organizeTabs()
      .then(result => {
        console.log('Tab Organizer: Výsledok:', result);
        sendResponse(result);
      })
      .catch(error => {
        console.error('Tab Organizer: Chyba:', error);
        sendResponse({ success: false, error: error.message });
      });
    return true;
  }
});
