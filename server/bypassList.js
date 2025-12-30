const { set, get } = require('./store');
const { getActiveNetworkServices } = require('./systemShell');
const process = require('child_process');
const os = require('os');

const platform = os.platform();
const isWindows = platform === 'win32';
const isMac = platform === 'darwin';

let bypassListCache = null;
let saveTimer = null;

const getBypassList = () => {
  if (bypassListCache === null) {
    bypassListCache = get('bypassList') || [];
  }
  return bypassListCache;
};

// Debounced save to disk
const setBypassList = (bypassList) => {
  bypassListCache = bypassList;
  
  // Clear existing timer
  if (saveTimer) {
    clearTimeout(saveTimer);
  }
  
  // Save to disk after 100ms of no changes
  saveTimer = setTimeout(() => {
    set('bypassList', bypassList);
    saveTimer = null;
  }, 100);
};

// Initialize
if (!get('bypassList')) {
  setBypassList([]);
}

exports.getBypassList = getBypassList;

exports.addBypassListItem = (item) => {
  item.id = `${Date.now()}-${Math.random()}`;
  const bypassList = getBypassList();
  bypassList.push(item);
  setBypassList(bypassList);
  updateSystemProxyBypass();
  return Promise.resolve(true);
};

exports.deleteBypassListItem = (item) => {
  const bypassList = getBypassList();
  setBypassList(bypassList.filter((w) => w.id !== item.id));
  updateSystemProxyBypass();
  return Promise.resolve(true);
};

exports.updateBypassListItem = (item) => {
  const bypassList = getBypassList();
  const oldItem = bypassList.find((w) => w.id === item.id);
  if (oldItem) {
    Object.assign(oldItem, item);
    setBypassList(bypassList);
    updateSystemProxyBypass();
  }
  return Promise.resolve(true);
};

// Update system proxy bypass domains
async function updateSystemProxyBypass() {
  const enabledDomains = getBypassList()
    .filter((item) => item.enabled)
    .map((item) => item.domain);

  if (isWindows) {
    // Windows: Set ProxyOverride in registry (empty string to clear)
    const bypassList = enabledDomains.length > 0 ? enabledDomains.join(';') : '';
    const cmd = `reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyOverride /t REG_SZ /d "${bypassList}" /f`;
    process.exec(cmd, (error) => {
      if (error) {
        console.error('Failed to update Windows bypass list:', error);
      } else {
        console.log(`Windows bypass list updated: ${bypassList || '(empty)'}`);
      }
    });
  } else if (isMac) {
    // macOS: Use networksetup
    if (enabledDomains.length === 0) {
      console.log('No enabled bypass list domains, clearing macOS bypass list');
      const services = await getActiveNetworkServices();
      services.forEach((service) => {
        const cmd = `networksetup -setproxybypassdomains "${service}" ""`;
        process.exec(cmd, (error) => {
          if (error) console.error(`Failed to clear bypass for ${service}:`, error);
        });
      });
    } else {
      const services = await getActiveNetworkServices();
      const bypassDomains = enabledDomains.join(' ');

      services.forEach((service) => {
        const cmd = `networksetup -setproxybypassdomains "${service}" ${bypassDomains}`;
        process.exec(cmd, (error) => {
          if (error) console.error(`Failed to update bypass for ${service}:`, error);
        });
      });
    }
  }
}

exports.updateSystemProxyBypass = updateSystemProxyBypass;

// Get current system proxy bypass domains
async function getSystemProxyBypass() {
  const bypassDomains = {};

  if (isWindows) {
    // Windows: Read ProxyOverride from registry
    await new Promise((resolve) => {
      const cmd = `reg query "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyOverride`;
      process.exec(cmd, (error, stdout) => {
        if (!error && stdout) {
          const match = stdout.match(/ProxyOverride\s+REG_SZ\s+(.+)/);
          if (match && match[1]) {
            const domains = match[1]
              .split(';')
              .map((d) => d.trim())
              .filter((d) => d);
            if (domains.length > 0) {
              bypassDomains['Windows'] = domains;
            }
          }
        }
        resolve();
      });
    });
  } else if (isMac) {
    // macOS: Use networksetup
    const services = await getActiveNetworkServices();

    for (const service of services) {
      await new Promise((resolve) => {
        const cmd = `networksetup -getproxybypassdomains "${service}"`;
        process.exec(cmd, (error, stdout) => {
          if (!error && stdout) {
            const domains = stdout
              .split('\n')
              .map((line) => line.trim())
              .filter((line) => line && !line.startsWith('There'));
            if (domains.length > 0) {
              bypassDomains[service] = domains;
            }
          }
          resolve();
        });
      });
    }
  }

  return bypassDomains;
}

exports.getSystemProxyBypass = getSystemProxyBypass;

// Sync bypass list with system on startup
async function syncWithSystem() {
  const systemBypass = await getSystemProxyBypass();
  const bypassList = getBypassList();
  
  // Collect all system domains
  const systemDomains = new Set();
  Object.values(systemBypass).forEach((domains) => {
    domains.forEach((domain) => systemDomains.add(domain));
  });
  
  // Update bypass list items based on system state
  let hasChanges = false;
  bypassList.forEach((item) => {
    const isInSystem = systemDomains.has(item.domain);
    if (item.enabled && !isInSystem) {
      // Item is enabled in app but not in system, disable it
      item.enabled = false;
      hasChanges = true;
      console.log(`Disabled bypass list item not in system: ${item.domain}`);
    } else if (!item.enabled && isInSystem) {
      // Item is disabled in app but exists in system, enable it
      item.enabled = true;
      hasChanges = true;
      console.log(`Enabled bypass list item found in system: ${item.domain}`);
    }
  });
  
  // Add system domains that are not in bypass list
  const bypassListDomains = new Set(bypassList.map((item) => item.domain));
  systemDomains.forEach((domain) => {
    if (!bypassListDomains.has(domain)) {
      bypassList.push({
        id: `${Date.now()}-${Math.random()}`,
        enabled: true,
        domain: domain,
      });
      hasChanges = true;
      console.log(`Added system domain to bypass list: ${domain}`);
    }
  });
  
  if (hasChanges) {
    setBypassList(bypassList);
    console.log('Bypass list synced with system');
  }
}

exports.syncWithSystem = syncWithSystem;
