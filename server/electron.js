// Modules to control application life and create native browser window
const { app, BrowserWindow, globalShortcut, Menu } = require('electron');
const path = require('path');
const url = require('url');
const childProcess = require('child_process');
const systemShell = require('./systemShell');
const server = require('./index.js');
// const portIsOccupied = require('./port.js');
const {addWindow, removeWindow} = require('./messageBus.js');

const serverPort = 8000;

function createWindow() {
  const startUrl = process.env.PORT ? `http://localhost:${process.env.PORT}/` : url.format({
    pathname: path.join(__dirname, '../build/index.html'),
    protocol: 'file:',
    slashes: true,
  });

  console.log('Loading URL:', startUrl);

  const mainWindow = new BrowserWindow({ 
    width: 1366,
    height: 800,
    icon: path.join(__dirname, '../public/icons/icon-512x512.png'),
    webPreferences: {
      // preload: path.join(__dirname, '../static/preload.js'),
      /* Enable Node.js integration for Electron 12+ */
      nodeIntegration: true,
      contextIsolation: false,
      enableRemoteModule: true,
      /* Should be false in production */
      webSecurity: false
    }
  });
  
  mainWindow.loadURL(startUrl);

  // Open DevTools in production to debug issues
  // mainWindow.webContents.openDevTools();

  // Log any errors
  mainWindow.webContents.on('crashed', () => {
    console.error('Renderer process crashed');
  });

  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    console.error(`Failed to load ${validatedURL}: ${errorCode} ${errorDescription}`);
  });

  // Register shortcuts
  // Cmd+R / Ctrl+R: Reload page
  globalShortcut.register('CommandOrControl+R', () => {
    const focusedWindow = BrowserWindow.getFocusedWindow();
    if (focusedWindow) {
      focusedWindow.reload();
    }
  });

  // Cmd+Shift+R / Ctrl+Shift+R: Force reload (ignore cache)
  globalShortcut.register('CommandOrControl+Shift+R', () => {
    const focusedWindow = BrowserWindow.getFocusedWindow();
    if (focusedWindow) {
      focusedWindow.webContents.reloadIgnoringCache();
    }
  });

  // F5: Reload page (Windows habit)
  globalShortcut.register('F5', () => {
    const focusedWindow = BrowserWindow.getFocusedWindow();
    if (focusedWindow) {
      focusedWindow.reload();
    }
  });

  addWindow(mainWindow);
  mainWindow.on("closed", () => removeWindow(mainWindow));
}

// 创建应用菜单
function createMenu() {
  const template = [
    {
      label: '应用',
      submenu: [
        { role: 'about', label: '关于' },
        { type: 'separator' },
        { role: 'quit', label: '退出' }
      ]
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' }
      ]
    },
    {
      label: '视图',
      submenu: [
        { 
          role: 'reload', 
          label: '刷新',
          accelerator: 'CmdOrCtrl+R'
        },
        { 
          role: 'forceReload', 
          label: '强制刷新',
          accelerator: 'CmdOrCtrl+Shift+R'
        },
        { type: 'separator' },
        { role: 'toggleDevTools', label: '开发者工具' },
        { type: 'separator' },
        { role: 'resetZoom', label: '实际大小' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '全屏' }
      ]
    },
    {
      label: '窗口',
      submenu: [
        { role: 'minimize', label: '最小化' },
        { role: 'close', label: '关闭' }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

// Clean harData from proxySettings store if exists
function cleanHarDataFromStore() {
  try {
    const Store = require('electron-store');
    const store = new Store();
    const proxySettings = store.get('proxySettings');
    
    if (!proxySettings || !Array.isArray(proxySettings)) {
      return;
    }
    
    let hasHarData = false;
    
    // Check and remove harData from settings
    proxySettings.forEach((setting) => {
      if (setting.harData) {
        hasHarData = true;
        console.log(`Cleaning harData from setting: ${setting.id}`);
        delete setting.harData;
      }
    });
    
    if (hasHarData) {
      store.set('proxySettings', proxySettings);
      console.log('✓ Successfully cleaned harData from proxySettings store');
    }
  } catch (error) {
    console.error('Error cleaning harData:', error);
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(async () => {
  // Clean harData from store on startup
  // cleanHarDataFromStore();
  
  // 创建菜单
  // createMenu();
  
  // const clientPort = await portIsOccupied(3000);
  // systemShell.startClient(clientPort);
  
  createWindow();

  /* 启动的时候设置系统代理，启动httpserver */
  await server.start(serverPort);

  app.on('activate', () => {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  // For this proxy app, we want to quit when all windows are closed on all platforms
  // to ensure proxy settings are cleaned up
  app.quit();
});

/* 程序退出时关掉系统代理 */
let isQuitting = false;

async function cleanup() {
  if (isQuitting) return;
  isQuitting = true;
  
  console.log('Cleaning up before quit...');
  
  try {
    // Clean up proxy settings and server
    await server.end();
    console.log('Proxy cleanup completed');
  } catch (error) {
    console.error('Error during cleanup:', error);
  }
  
  // Unregister all shortcuts
  globalShortcut.unregisterAll();
  
  console.log('Cleanup finished');
}

app.on('will-quit', async (event) => {
  event.preventDefault();
  await cleanup();
  app.exit(0);
});

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
