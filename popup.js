var categories = {
  social: { name: "Socialne siete", color: "red", domains: ["facebook.com", "instagram.com", "twitter.com", "x.com", "linkedin.com", "tiktok.com", "reddit.com", "discord.com", "youtube.com", "meta.com"] },
  school: { name: "Skola/Praca", color: "blue", domains: ["edupage.org", "ais.uniba.sk", "uniba.sk", "stuba.sk", "ukf.sk", "tuke.sk", "umb.sk", "moodle.com", "moodle.org", "outlook.office.com", "mail.google.com"] },
  programming: { name: "Programovanie", color: "green", domains: ["github.com", "stackoverflow.com", "codepen.io", "jsfiddle.net", "replit.com", "glitch.com", "codesandbox.io"] },
  entertainment: { name: "Zabava", color: "purple", domains: ["netflix.com", "hbo.com", "primevideo.com", "disneyplus.com", "twitch.tv", "steam.com"] }
};

function getCategory(url) {
  if (!url) return null;
  try {
    var domain = new URL(url).hostname.replace("www.", "");
    for (var key in categories) {
      if (categories.hasOwnProperty(key)) {
        var cat = categories[key];
        for (var i = 0; i < cat.domains.length; i++) {
          if (domain.indexOf(cat.domains[i]) !== -1) {
            return { type: key, name: cat.name, color: cat.color };
          }
        }
      }
    }
  } catch (e) {}
  return null;
}

function doOrganize() {
  var status = document.getElementById("status");
  var btn = document.getElementById("organizeBtn");
  
  status.textContent = "Pracujem...";
  status.style.color = "orange";
  btn.disabled = true;
  
  chrome.tabs.query({ currentWindow: true }, function(tabs) {
    status.textContent = "Nasiel som " + tabs.length + " tabov...";
    
    var sorted = { social: [], school: [], programming: [], entertainment: [], other: [] };
    
    for (var i = 0; i < tabs.length; i++) {
      var cat = getCategory(tabs[i].url);
      if (cat) {
        sorted[cat.type].push(tabs[i]);
      } else {
        sorted.other.push(tabs[i]);
      }
    }
    
    var pos = 0;
    var keys = ["social", "school", "programming", "entertainment", "other"];
    
    function moveNext(keyIndex, tabIndex) {
      if (keyIndex >= keys.length) {
        createGroups(0);
        return;
      }
      var key = keys[keyIndex];
      var tabsInCat = sorted[key];
      if (tabIndex >= tabsInCat.length) {
        moveNext(keyIndex + 1, 0);
        return;
      }
      chrome.tabs.move(tabsInCat[tabIndex].id, { index: pos }, function() {
        pos++;
        moveNext(keyIndex, tabIndex + 1);
      });
    }
    
    function createGroups(keyIndex) {
      if (keyIndex >= keys.length) {
        status.textContent = "Hotovo!";
        status.style.color = "green";
        btn.disabled = false;
        return;
      }
      var key = keys[keyIndex];
      if (key === "other" || sorted[key].length === 0) {
        createGroups(keyIndex + 1);
        return;
      }
      var ids = [];
      for (var j = 0; j < sorted[key].length; j++) {
        ids.push(sorted[key][j].id);
      }
      chrome.tabs.group({ tabIds: ids }, function(groupId) {
        if (chrome.runtime.lastError) {
          createGroups(keyIndex + 1);
          return;
        }
        chrome.tabGroups.update(groupId, { title: categories[key].name, color: categories[key].color }, function() {
          createGroups(keyIndex + 1);
        });
      });
    }
    
    moveNext(0, 0);
  });
}

document.getElementById("status").textContent = "Klikni na tlacidlo";
document.getElementById("status").style.color = "blue";
document.getElementById("organizeBtn").onclick = doOrganize;