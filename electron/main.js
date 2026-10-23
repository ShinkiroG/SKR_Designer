// Processo principal do SKR Designer (Electron).
const { app, BrowserWindow, dialog, ipcMain, shell, Menu, net } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');

const REPO = { owner: 'ShinkiroG', repo: 'SKR_Designer' };
// O executável portátil do electron-builder define esta variável.
const IS_PORTABLE = Boolean(process.env.PORTABLE_EXECUTABLE_DIR);

let win = null;
let hasUnsaved = false;

function createWindow() {
  win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#14161c',
    title: 'SKR Designer',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.loadFile(path.join(__dirname, '..', 'src', 'index.html'));

  win.on('close', (e) => {
    if (!hasUnsaved) return;
    const choice = dialog.showMessageBoxSync(win, {
      type: 'warning',
      buttons: ['Sair sem salvar', 'Cancelar'],
      defaultId: 1,
      cancelId: 1,
      title: 'Alterações não salvas',
      message: 'Há documentos com alterações não salvas.',
      detail: 'Elas continuam guardadas na sessão e serão reabertas na próxima vez, mas não foram gravadas em arquivo.',
    });
    if (choice === 1) e.preventDefault();
  });

  // Links externos abrem no navegador padrão.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  // F12 abre as ferramentas de desenvolvedor.
  win.webContents.on('before-input-event', (_e, input) => {
    if (input.type === 'keyDown' && input.key === 'F12') win.webContents.toggleDevTools();
  });
}

// ---------- Arquivos ----------
const FILTERS = [
  { name: 'Documentos SKR', extensions: ['json'] },
  { name: 'Todos os arquivos', extensions: ['*'] },
];

ipcMain.handle('file:open', async () => {
  const res = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: FILTERS });
  if (res.canceled || !res.filePaths[0]) return null;
  const filePath = res.filePaths[0];
  return { path: filePath, name: path.basename(filePath), content: await fs.readFile(filePath, 'utf8') };
});

ipcMain.handle('file:save', async (_e, { content, filePath, suggestedName }) => {
  let target = filePath;
  if (!target) {
    const res = await dialog.showSaveDialog(win, {
      defaultPath: suggestedName || 'documento.json',
      filters: FILTERS,
    });
    if (res.canceled || !res.filePath) return null;
    target = res.filePath;
  }
  await fs.writeFile(target, content, 'utf8');
  return { path: target, name: path.basename(target) };
});

ipcMain.on('doc:unsaved', (_e, value) => { hasUnsaved = Boolean(value); });

ipcMain.handle('app:info', () => ({
  version: app.getVersion(),
  portable: IS_PORTABLE,
  packaged: app.isPackaged,
  platform: process.platform,
}));

ipcMain.handle('shell:open', (_e, url) => {
  if (/^https:\/\//.test(url)) shell.openExternal(url);
});

// ---------- Atualizações ----------
// A verificação consulta a última release do GitHub. A versão instalada baixa
// e instala sozinha (electron-updater); a portátil abre a página de download.

function compareVersions(a, b) {
  const pa = String(a).replace(/^v/, '').split(/[.-]/).map((n) => parseInt(n, 10) || 0);
  const pb = String(b).replace(/^v/, '').split(/[.-]/).map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  }
  return 0;
}

function canAutoInstall() {
  return app.isPackaged && !IS_PORTABLE && (process.platform === 'win32' || process.env.APPIMAGE);
}

ipcMain.handle('update:check', async () => {
  const current = app.getVersion();
  const url = `https://api.github.com/repos/${REPO.owner}/${REPO.repo}/releases/latest`;
  let res;
  try {
    res = await net.fetch(url, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'SKR-Designer' } });
  } catch (err) {
    return { status: 'error', current, message: 'Sem conexão com o GitHub: ' + err.message };
  }
  if (res.status === 404) return { status: 'none', current };
  if (!res.ok) return { status: 'error', current, message: `GitHub respondeu ${res.status}.` };

  const rel = await res.json();
  const latest = String(rel.tag_name || '').replace(/^v/, '');
  if (!latest || compareVersions(latest, current) <= 0) return { status: 'latest', current, latest };

  return {
    status: 'available',
    current,
    latest,
    notes: rel.body || '',
    pageUrl: rel.html_url,
    canInstall: Boolean(canAutoInstall()),
  };
});

let updaterReady = false;
function getUpdater() {
  const { autoUpdater } = require('electron-updater');
  if (!updaterReady) {
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.on('download-progress', (p) => win?.webContents.send('update:progress', Math.round(p.percent)));
    autoUpdater.on('error', (err) => win?.webContents.send('update:error', err.message));
    updaterReady = true;
  }
  return autoUpdater;
}

ipcMain.handle('update:download', async () => {
  if (!canAutoInstall()) throw new Error('Esta versão não instala atualizações sozinha.');
  const updater = getUpdater();
  const result = await updater.checkForUpdates();
  if (!result || !result.isUpdateAvailable) return { status: 'latest' };
  await updater.downloadUpdate();
  return { status: 'downloaded' };
});

ipcMain.handle('update:install', () => {
  hasUnsaved = false;
  getUpdater().quitAndInstall();
});

// ---------- Ciclo de vida ----------
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });

  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    createWindow();
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
