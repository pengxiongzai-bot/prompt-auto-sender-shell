const { app, BrowserWindow, dialog, shell } = require('electron');
const http = require('http');
const path = require('path');
const { execFile } = require('child_process');

const PORT = Number(process.env.PORT || 8787);
const APP_URL = `http://localhost:${PORT}/`;
const HEALTH_URL = `http://localhost:${PORT}/api/health`;
const REQUIRED_SERVICE_FEATURE_VERSION = 5;

let mainWindow = null;
let bootInProgress = false;

app.setName('阿臭弟AI发送器');

app.whenReady().then(async () => {
  try {
    configureDataDirectory();
    createMainWindow();
    await bootWorkbench();
  } catch (error) {
    showStartupFailure(error);
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createMainWindow();
    bootWorkbench();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

async function bootWorkbench() {
  if (bootInProgress) return;
  bootInProgress = true;
  const bootStartedAt = Date.now();
  try {
    updateStartupView('正在检查本地服务', '检测 8787 端口和当前服务版本。', 'running');
    await ensureServerReady(updateStartupView);
    updateStartupView('正在加载工作台', '本地服务已就绪，正在进入主界面。', 'running');
    await sleep(Math.max(0, 800 - (Date.now() - bootStartedAt)));
    await mainWindow?.loadURL(APP_URL);
  } catch (error) {
    showStartupFailure(error);
  } finally {
    bootInProgress = false;
  }
}

async function ensureServerReady(onStatus = () => {}) {
  onStatus('正在检查本地服务', '检测当前端口是否已有可用服务。', 'running');
  const currentHealth = await readHealth();
  if (isCompatibleHealth(currentHealth)) {
    onStatus('本地服务已就绪', '检测到兼容服务，可以直接加载工作台。', 'done');
    return;
  }
  if (currentHealth?.ok) {
    onStatus('正在释放旧服务', '检测到旧版本服务占用端口，正在关闭并重启。', 'running');
    await stopPortOwner(PORT);
    await sleep(800);
  }

  onStatus('正在启动本地服务', '正在启动后端服务和浏览器自动化接口。', 'running');
  const { startServer } = require('./server');
  await startServer(PORT);

  onStatus('等待服务就绪', '服务已启动，正在等待健康检查通过。', 'running');
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    if (isCompatibleHealth(await readHealth())) {
      onStatus('本地服务已就绪', '健康检查通过。', 'done');
      return;
    }
    await sleep(300);
  }
  throw new Error('本地服务未能在 20 秒内就绪。');
}

function configureDataDirectory() {
  if (!app.isPackaged) return;

  const portableRoot = process.env.PORTABLE_EXECUTABLE_DIR;
  const dataRoot = portableRoot
    ? path.join(portableRoot, 'app-data')
    : path.join(app.getPath('userData'), 'data');
  process.env.PROMPT_WORKBENCH_DATA_DIR = dataRoot;
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1680,
    height: 980,
    minWidth: 1280,
    minHeight: 760,
    title: '阿臭弟AI发送器',
    backgroundColor: '#0e1114',
    icon: path.join(__dirname, 'assets', 'app-icon.ico'),
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  loadStartupView('正在启动', '正在准备阿臭弟AI发送器。', 'running');

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (handleWorkbenchAction(url)) return { action: 'deny' };
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!handleWorkbenchAction(url)) return;
    event.preventDefault();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function handleWorkbenchAction(url) {
  if (!url.startsWith('prompt-workbench://')) return false;
  const action = url.replace('prompt-workbench://', '').replace(/\/$/, '');
  if (action === 'retry') {
    bootWorkbench();
    return true;
  }
  if (action === 'logs') {
    shell.openPath(__dirname);
    return true;
  }
  if (action === 'close') {
    app.quit();
    return true;
  }
  return false;
}

function updateStartupView(title, detail, state = 'running') {
  loadStartupView(title, detail, state);
}

function showStartupFailure(error) {
  const message = error?.message || String(error || '未知错误');
  loadStartupView('启动失败', message, 'error');
}

function loadStartupView(title, detail, state = 'running') {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.loadURL(makeStartupDataUrl(title, detail, state)).catch(() => {});
}

function makeStartupDataUrl(title, detail, state) {
  const escapedTitle = escapeHtml(title);
  const escapedDetail = escapeHtml(detail);
  const isError = state === 'error';
  const isDone = state === 'done';
  const statusClass = isError ? 'error' : (isDone ? 'done' : 'running');
  const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>阿臭弟AI发送器</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #0e1114;
      --panel: #151b20;
      --line: #26323a;
      --text: #eef5f2;
      --muted: #8fa19c;
      --accent: #2fc7a7;
      --danger: #ff6b66;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      background:
        linear-gradient(rgba(47,199,167,.045) 1px, transparent 1px),
        linear-gradient(90deg, rgba(47,199,167,.045) 1px, transparent 1px),
        var(--bg);
      background-size: 32px 32px;
      color: var(--text);
      font-family: "Microsoft YaHei", "Segoe UI", sans-serif;
    }
    .shell {
      width: min(560px, calc(100vw - 48px));
      padding: 34px 36px;
      border: 1px solid var(--line);
      border-radius: 12px;
      background: rgba(21,27,32,.94);
      box-shadow: 0 24px 80px rgba(0,0,0,.38);
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 14px;
      margin-bottom: 26px;
    }
    .bar {
      width: 5px;
      height: 46px;
      border-radius: 999px;
      background: var(--accent);
      box-shadow: 0 0 20px rgba(47,199,167,.45);
    }
    h1 {
      margin: 0;
      font-size: 28px;
      line-height: 1.2;
      letter-spacing: 0;
    }
    .eyebrow {
      margin: 0 0 4px;
      color: var(--accent);
      font-size: 12px;
      font-weight: 700;
      text-transform: uppercase;
    }
    .status {
      padding: 20px;
      border: 1px solid var(--line);
      border-radius: 10px;
      background: #10161a;
    }
    .status-title {
      margin: 0 0 10px;
      font-size: 19px;
      font-weight: 800;
    }
    .status-detail {
      min-height: 48px;
      margin: 0;
      color: var(--muted);
      font-size: 14px;
      line-height: 1.65;
      word-break: break-word;
    }
    .progress {
      position: relative;
      overflow: hidden;
      height: 4px;
      margin-top: 22px;
      border-radius: 999px;
      background: #223039;
    }
    .progress::before {
      content: "";
      position: absolute;
      inset: 0 auto 0 0;
      width: 38%;
      border-radius: inherit;
      background: var(--accent);
      animation: slide 1.15s ease-in-out infinite;
    }
    .done .progress::before {
      width: 100%;
      animation: none;
    }
    .error .progress::before {
      width: 100%;
      background: var(--danger);
      animation: none;
    }
    .error .status-title { color: var(--danger); }
    .actions {
      display: ${isError ? 'flex' : 'none'};
      gap: 10px;
      margin-top: 22px;
    }
    .button {
      flex: 1;
      padding: 11px 14px;
      border: 1px solid var(--line);
      border-radius: 8px;
      color: var(--text);
      background: #172027;
      text-align: center;
      text-decoration: none;
      font-weight: 700;
    }
    .button.primary {
      border-color: rgba(47,199,167,.5);
      background: #1caf91;
      color: #05120f;
    }
    @keyframes slide {
      0% { transform: translateX(-105%); }
      55% { transform: translateX(95%); }
      100% { transform: translateX(260%); }
    }
  </style>
</head>
<body>
  <main class="shell ${statusClass}">
    <section class="brand">
      <div class="bar"></div>
      <div>
        <p class="eyebrow">Startup Monitor</p>
        <h1>阿臭弟AI发送器</h1>
      </div>
    </section>
    <section class="status">
      <p class="status-title">${escapedTitle}</p>
      <p class="status-detail">${escapedDetail}</p>
      <div class="progress" aria-hidden="true"></div>
      <div class="actions">
        <a class="button primary" href="prompt-workbench://retry">重试</a>
        <a class="button" href="prompt-workbench://logs">打开目录</a>
        <a class="button" href="prompt-workbench://close">关闭</a>
      </div>
    </section>
  </main>
</body>
</html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function readHealth() {
  return new Promise((resolve) => {
    const request = http.get(HEALTH_URL, { timeout: 2000 }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        body += chunk;
      });
      response.on('end', () => {
        try {
          const data = JSON.parse(body);
          resolve(data);
        } catch (_error) {
          resolve(null);
        }
      });
    });
    request.on('timeout', () => {
      request.destroy();
      resolve(null);
    });
    request.on('error', () => resolve(null));
  });
}

function isCompatibleHealth(data) {
  return Boolean(data?.ok && Number(data.serviceFeatureVersion || 0) >= REQUIRED_SERVICE_FEATURE_VERSION);
}

function stopPortOwner(port) {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') {
      resolve();
      return;
    }

    const script = [
      `$connections=Get-NetTCPConnection -LocalPort ${Number(port)} -State Listen -ErrorAction SilentlyContinue`,
      'foreach ($connection in $connections) {',
      '  Stop-Process -Id $connection.OwningProcess -Force -ErrorAction SilentlyContinue',
      '}',
    ].join('; ');

    execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], {
      windowsHide: true,
    }, () => resolve());
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
