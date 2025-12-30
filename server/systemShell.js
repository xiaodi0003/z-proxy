const process = require('child_process');
const os = require('os');

const platform = os.platform();
const isWindows = platform === 'win32';
const isMac = platform === 'darwin';

function exec(cmd) {
  console.log('cmd:', cmd);
  process.exec(cmd, (error, stdout, stderr) => {
    if (error) {
      console.log(`error::${error}`);
    }
    if (stdout) {
      console.log(`stdout::${stdout}`);
    }
    if (stderr) {
      console.log(`stderr::${stderr}`);
    }
  });
}

// Get all active network services (macOS only)
function getActiveNetworkServices() {
  return new Promise((resolve) => {
    process.exec('networksetup -listallnetworkservices', (error, stdout) => {
      if (error) {
        console.error('Failed to get network services:', error);
        resolve(['Wi-Fi', 'Ethernet']); // Fallback to common services
        return;
      }
      
      // Parse output and filter out the header line
      const services = stdout
        .split('\n')
        .filter(line => line && !line.startsWith('An asterisk') && line.trim())
        .map(line => line.trim());
      
      resolve(services.length > 0 ? services : ['Wi-Fi', 'Ethernet']);
    });
  });
}

// Set proxy on Windows using registry
function setProxyWindows(port) {
  return new Promise((resolve, reject) => {
    const proxyServer = `127.0.0.1:${port}`;
    
    // Enable proxy
    const enableCmd = `reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyEnable /t REG_DWORD /d 1 /f`;
    const setServerCmd = `reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyServer /t REG_SZ /d "${proxyServer}" /f`;
    
    process.exec(enableCmd, (error1) => {
      if (error1) {
        console.error('Failed to enable proxy:', error1);
        reject(error1);
        return;
      }
      
      process.exec(setServerCmd, (error2) => {
        if (error2) {
          console.error('Failed to set proxy server:', error2);
          reject(error2);
          return;
        }
        
        console.log(`Windows proxy set to ${proxyServer}`);
        resolve();
      });
    });
  });
}

// Delete proxy on Windows
function deleteProxyWindows() {
  return new Promise((resolve, reject) => {
    const disableCmd = `reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyEnable /t REG_DWORD /d 0 /f`;
    
    process.exec(disableCmd, (error) => {
      if (error) {
        console.error('Failed to disable proxy:', error);
        reject(error);
        return;
      }
      
      console.log('Windows proxy disabled');
      resolve();
    });
  });
}

// Set proxy on macOS
async function setProxyMac(port) {
  const services = await getActiveNetworkServices();
  
  // Apply proxy settings to all network services
  const promises = [];
  services.forEach(service => {
    promises.push(
      new Promise((resolve) => {
        const cmd1 = `networksetup -setwebproxy "${service}" 127.0.0.1 ${port}`;
        process.exec(cmd1, (error1) => {
          if (error1) console.error(`Failed to set web proxy for ${service}:`, error1);
          
          const cmd2 = `networksetup -setsecurewebproxy "${service}" 127.0.0.1 ${port}`;
          process.exec(cmd2, (error2) => {
            if (error2) console.error(`Failed to set secure web proxy for ${service}:`, error2);
            resolve();
          });
        });
      })
    );
  });
  
  await Promise.all(promises);
  console.log('macOS proxy settings applied');
  
  // Note: Do not update bypass list here on startup
  // Bypass list is synced with system in syncWithSystem()
  // and only updated when user makes changes
}

// Delete proxy on macOS
async function deleteProxyMac() {
  const services = await getActiveNetworkServices();
  
  // Disable proxy for all network services
  const promises = [];
  services.forEach(service => {
    promises.push(
      new Promise((resolve) => {
        const cmd1 = `networksetup -setwebproxystate "${service}" off`;
        process.exec(cmd1, (error1) => {
          if (error1) console.error(`Failed to disable web proxy for ${service}:`, error1);
          
          const cmd2 = `networksetup -setsecurewebproxystate "${service}" off`;
          process.exec(cmd2, (error2) => {
            if (error2) console.error(`Failed to disable secure web proxy for ${service}:`, error2);
            resolve();
          });
        });
      })
    );
  });
  
  await Promise.all(promises);
  console.log('macOS proxy settings disabled');
}

exports.getActiveNetworkServices = getActiveNetworkServices;

exports.setProxy = async (port) => {
  if (isWindows) {
    await setProxyWindows(port);
  } else if (isMac) {
    await setProxyMac(port);
  } else {
    console.warn('Unsupported platform for automatic proxy configuration:', platform);
  }
};

exports.deleteProxy = async () => {
  if (isWindows) {
    await deleteProxyWindows();
  } else if (isMac) {
    await deleteProxyMac();
  } else {
    console.warn('Unsupported platform for automatic proxy configuration:', platform);
  }
};

exports.startClient = (port) => {
  exec(`cd ./client ./node_modules/.bin/cross-env PORT=${port} ./node_modules/.bin/react-app-rewired start --color nohup &`);
};
