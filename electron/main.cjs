const { app, BrowserWindow, screen } = require('electron');
const path = require('path');

// 屏蔽安全警告
process.env['ELECTRON_DISABLE_SECURITY_WARNINGS'] = 'true';

let mainWindow;

function createWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;

  mainWindow = new BrowserWindow({
    width: width,
    height: height,
    minWidth: 1024,
    minHeight: 768,
    icon: path.join(__dirname, '../public/icon.png'), // 如果没有图标可能会报错，但不影响运行
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webSecurity: false // 允许加载本地资源
    },
    autoHideMenuBar: true, // 隐藏菜单栏
  });

  // 判断是开发环境还是生产环境
  // 注意：在开发时，您需要先启动 npm start，然后再在另一个终端运行 npm run electron:start
  // 但为了打包方便，我们通常只关注加载构建后的文件
  
  // 生产环境加载逻辑 (打包后)
  if (app.isPackaged) {
    const indexPath = path.join(__dirname, '../dist/index.html');
    mainWindow.loadFile(indexPath);
  } else {
    // 开发环境加载逻辑
    // 尝试连接本地 Vite 服务，如果连接不上则加载 dist
    // 简便起见，这里假设开发时您希望加载本地服务
    mainWindow.loadURL('http://localhost:3000');
    
    // 打开开发者工具
    // mainWindow.webContents.openDevTools(); 
  }

  mainWindow.on('closed', function () {
    mainWindow = null;
  });
}

app.on('ready', createWindow);

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', function () {
  if (mainWindow === null) {
    createWindow();
  }
});