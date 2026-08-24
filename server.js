const express = require('express');
const multer = require('multer');
const { chromium } = require('playwright');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { spawn } = require('child_process');

const app = express();
const PORT = Number(process.env.PORT || 8787);
const ROOT = __dirname;
const IS_PACKAGED = Boolean(process.versions?.electron) && process.defaultApp === false;
const DATA_ROOT = process.env.PROMPT_WORKBENCH_DATA_DIR
  || (IS_PACKAGED ? path.join(path.dirname(process.execPath), 'app-data') : ROOT);
const PUBLIC_DIR = path.join(ROOT, 'public');
const RUNS_DIR = path.join(DATA_ROOT, 'runs');
const TMP_DIR = path.join(DATA_ROOT, 'tmp_uploads');
const WORKFLOWS_DIR = path.join(DATA_ROOT, 'workflows');
const BROWSER_PROFILES_DIR = path.join(DATA_ROOT, 'browser-profiles');
const MAX_STAGES = 100;
const DEFAULT_STAGE_LAYOUT_MODE = 'full';
const STAGE_MIN_HEIGHT = 260;
const STAGE_MAX_HEIGHT = 1200;
const STAGE_MODULE_KEYS = ['files', 'source', 'replacements', 'preview'];
const STAGE_LAYOUT_PRESETS = {
  full: { files: true, source: true, replacements: true, preview: true },
  prompt: { files: false, source: true, replacements: false, preview: false },
  files: { files: true, source: false, replacements: false, preview: false },
  filesPrompt: { files: true, source: true, replacements: false, preview: false },
  replacements: { files: false, source: true, replacements: true, preview: true },
};
const SERVICE_FEATURE_VERSION = 5;
const CLIENT_INACTIVE_MS = 60 * 1000;
const CLIENT_SHUTDOWN_GRACE_MS = 4000;
const CUSTOM_BROWSER_PORT_BASE = 9290;
const ISOLATED_BROWSER_PORT_BASE = 11000;
const RESPONSE_POLL_MS = 1000;
const RESPONSE_STABLE_MS = 12 * 1000;
const RESPONSE_TIMEOUT_MS = 60 * 60 * 1000;
const RESPONSE_START_TIMEOUT_MS = 10 * 60 * 1000;
const SEND_CONFIRM_TIMEOUT_MS = 2 * 60 * 1000;
const IMAGE_OUTPUT_GRACE_MS = 4 * 60 * 1000;
const MAX_STAGE_NUDGES = 1;
const IMAGE_COMPLETION_NUDGE = '继续执行本轮要求，立即逐张生成并完成全部图片。不要等待确认，不要只回复说明文字；请直接输出剩余图片。';

class StageOutputIncompleteError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'StageOutputIncompleteError';
    this.code = 'STAGE_OUTPUT_INCOMPLETE';
    this.details = details;
  }
}

const AI_TARGETS = {
  chatgpt: {
    label: 'ChatGPT',
    url: 'https://chatgpt.com/',
  },
  gemini: {
    label: 'Gemini',
    url: 'https://gemini.google.com/app',
  },
  doubao: {
    label: '豆包',
    url: 'https://www.doubao.com/chat/',
  },
  deepseek: {
    label: 'DeepSeek',
    url: 'https://chat.deepseek.com/',
  },
  custom: {
    label: '自定义平台',
    url: '',
  },
};

const DEFAULT_EDITOR_SELECTORS = [
  '#prompt-textarea',
  'textarea',
  '[contenteditable="true"]',
  '[role="textbox"]',
  '.ProseMirror',
];

const DEFAULT_SEND_SELECTORS = [
  'button[data-testid="send-button"]',
  'button[aria-label="Send prompt"]',
  'button[aria-label*="Send"]',
  'button[aria-label*="发送"]',
  'button[aria-label*="提交"]',
  'button[type="submit"]',
];

const DEFAULT_STOP_SELECTORS = [
  'button[data-testid="stop-button"]',
  'button[aria-label*="Stop"]',
  'button[aria-label*="停止"]',
  'button[aria-label*="终止"]',
];

const PROGRAM_FILES = process.env.ProgramFiles || 'C:\\Program Files';
const PROGRAM_FILES_X86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
const LOCAL_APP_DATA = process.env.LOCALAPPDATA || '';
const APP_DATA = process.env.APPDATA || '';

const BROWSER_PRESETS = {
  edge: {
    label: 'Microsoft Edge',
    port: 9222,
    processName: 'msedge.exe',
    paths: [
      path.join(PROGRAM_FILES, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      path.join(PROGRAM_FILES_X86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      pathFromBase(LOCAL_APP_DATA, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    ],
  },
  chrome: {
    label: 'Google Chrome',
    port: 9223,
    processName: 'chrome.exe',
    paths: [
      path.join(PROGRAM_FILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(PROGRAM_FILES_X86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      pathFromBase(LOCAL_APP_DATA, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    ],
  },
  brave: {
    label: 'Brave Browser',
    port: 9224,
    processName: 'brave.exe',
    paths: [
      path.join(PROGRAM_FILES, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
      path.join(PROGRAM_FILES_X86, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
      pathFromBase(LOCAL_APP_DATA, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
    ],
  },
  opera: {
    label: 'Opera',
    port: 9225,
    processName: 'opera.exe',
    paths: [
      pathFromBase(LOCAL_APP_DATA, 'Programs', 'Opera', 'opera.exe'),
      path.join(PROGRAM_FILES, 'Opera', 'opera.exe'),
      path.join(PROGRAM_FILES_X86, 'Opera', 'opera.exe'),
    ],
  },
  'opera-gx': {
    label: 'Opera GX',
    port: 9226,
    processName: 'opera.exe',
    paths: [
      pathFromBase(LOCAL_APP_DATA, 'Programs', 'Opera GX', 'opera.exe'),
      path.join(PROGRAM_FILES, 'Opera GX', 'opera.exe'),
      path.join(PROGRAM_FILES_X86, 'Opera GX', 'opera.exe'),
    ],
  },
  vivaldi: {
    label: 'Vivaldi',
    port: 9227,
    processName: 'vivaldi.exe',
    paths: [
      pathFromBase(LOCAL_APP_DATA, 'Vivaldi', 'Application', 'vivaldi.exe'),
      path.join(PROGRAM_FILES, 'Vivaldi', 'Application', 'vivaldi.exe'),
      path.join(PROGRAM_FILES_X86, 'Vivaldi', 'Application', 'vivaldi.exe'),
    ],
  },
  chromium: {
    label: 'Chromium',
    port: 9228,
    processName: 'chrome.exe',
    paths: [
      pathFromBase(LOCAL_APP_DATA, 'Chromium', 'Application', 'chrome.exe'),
      path.join(PROGRAM_FILES, 'Chromium', 'Application', 'chrome.exe'),
      path.join(PROGRAM_FILES_X86, 'Chromium', 'Application', 'chrome.exe'),
    ],
  },
  qqbrowser: {
    label: 'QQ 浏览器',
    port: 9229,
    processName: 'QQBrowser.exe',
    paths: [
      pathFromBase(LOCAL_APP_DATA, 'Tencent', 'QQBrowser', 'QQBrowser.exe'),
      path.join(PROGRAM_FILES, 'Tencent', 'QQBrowser', 'QQBrowser.exe'),
      path.join(PROGRAM_FILES_X86, 'Tencent', 'QQBrowser', 'QQBrowser.exe'),
    ],
  },
  '360chrome': {
    label: '360 极速浏览器',
    port: 9230,
    processName: '360chrome.exe',
    paths: [
      pathFromBase(LOCAL_APP_DATA, '360Chrome', 'Chrome', 'Application', '360chrome.exe'),
      path.join(PROGRAM_FILES, '360Chrome', 'Chrome', 'Application', '360chrome.exe'),
      path.join(PROGRAM_FILES_X86, '360Chrome', 'Chrome', 'Application', '360chrome.exe'),
    ],
  },
  '360se': {
    label: '360 安全浏览器',
    port: 9231,
    processName: '360se.exe',
    paths: [
      pathFromBase(APP_DATA, '360se6', 'Application', '360se.exe'),
      path.join(PROGRAM_FILES, '360', '360se6', 'Application', '360se.exe'),
      path.join(PROGRAM_FILES_X86, '360', '360se6', 'Application', '360se.exe'),
    ],
  },
  custom: {
    label: '自定义 Chromium 浏览器',
    port: null,
    processName: null,
    paths: [],
  },
};

for (const dir of [RUNS_DIR, TMP_DIR, WORKFLOWS_DIR, BROWSER_PROFILES_DIR]) {
  fs.mkdirSync(dir, { recursive: true });
}

const upload = multer({ dest: TMP_DIR });
const jobs = new Map();
const browserSessions = new Map();
const activeBrowserLocks = new Map();
const browserJobQueues = new Map();
const browserProcesses = new Map();
const activeClients = new Map();
let shutdownTimer = null;
let isShuttingDown = false;
let hasSeenClient = false;

setInterval(() => {
  if (!hasSeenClient || isShuttingDown) return;
  pruneInactiveClients();
  if (activeClients.size === 0) {
    scheduleShutdownIfNoClients();
  }
}, 15000).unref();

app.use(express.json({ limit: '2mb' }));

app.get('/favicon.ico', (_req, res) => {
  res.status(204).end();
});

app.use(express.static(PUBLIC_DIR));

app.get('/api/health', (_req, res) => {
  const jobSummary = getJobRuntimeSummary();
  res.json({
    ok: true,
    serviceFeatureVersion: SERVICE_FEATURE_VERSION,
    ...jobSummary,
    defaultBrowser: 'edge',
    defaultTarget: 'chatgpt',
    targets: getTargetChoices(),
    browsers: getBrowserChoices(),
    maxStages: MAX_STAGES,
    defaultStageCount: 1,
    supportsParallelJobs: true,
    supportsIsolatedParallelJobs: true,
    sameBrowserJobLock: true,
    sameBrowserJobQueue: true,
    workflowsDir: WORKFLOWS_DIR,
    supportsIndependentBrowserProfiles: true,
    browserProfilesDir: BROWSER_PROFILES_DIR,
  });
});

function getJobRuntimeSummary() {
  let runningJobCount = 0;
  let queuedJobCount = 0;
  for (const job of jobs.values()) {
    if (job.status === 'running') runningJobCount += 1;
    if (job.status === 'queued') queuedJobCount += 1;
  }

  let pausedQueueCount = 0;
  for (const queue of browserJobQueues.values()) {
    if (queue?.paused) pausedQueueCount += 1;
  }

  return {
    activeJobCount: runningJobCount + queuedJobCount,
    runningJobCount,
    queuedJobCount,
    pausedQueueCount,
  };
}

app.post('/api/client/heartbeat', (req, res) => {
  const clientId = normalizeClientId(req.body?.clientId || req.query.clientId);
  hasSeenClient = true;
  activeClients.set(clientId, Date.now());
  clearShutdownTimer();
  res.json({ ok: true, clientId });
});

app.post('/api/client/close', (req, res) => {
  const clientId = normalizeClientId(req.body?.clientId || req.query.clientId);
  activeClients.delete(clientId);
  res.status(204).end();
  scheduleShutdownIfNoClients({ force: true });
});

app.get('/api/workflows', async (_req, res) => {
  try {
    const workflows = await listWorkflows();
    res.json({ ok: true, workflows });
  } catch (error) {
    res.status(500).json({ ok: false, message: normalizeError(error) });
  }
});

app.get('/api/workflows/:name', async (req, res) => {
  try {
    const workflow = await readWorkflow(req.params.name);
    if (!workflow) {
      res.status(404).json({ ok: false, message: '未找到工作流。' });
      return;
    }
    res.json({ ok: true, workflow });
  } catch (error) {
    res.status(500).json({ ok: false, message: normalizeError(error) });
  }
});

app.post('/api/workflows', async (req, res) => {
  try {
    const workflow = normalizeWorkflow(req.body || {});
    await saveWorkflow(workflow);
    const workflows = await listWorkflows();
    res.json({ ok: true, workflow, workflows });
  } catch (error) {
    res.status(400).json({ ok: false, message: normalizeError(error) });
  }
});

app.delete('/api/workflows/:name', async (req, res) => {
  try {
    const deleted = await deleteWorkflow(req.params.name);
    const workflows = await listWorkflows();
    res.json({ ok: true, deleted, workflows });
  } catch (error) {
    res.status(500).json({ ok: false, message: normalizeError(error) });
  }
});

app.post('/api/open-chatgpt', async (req, res) => {
  try {
    const browserConfig = resolveBrowserConfig(req.body || {});
    assertBrowserCanOpen(browserConfig);
    const targetConfig = resolveTargetConfig(req.body || {});
    const page = await createTargetWindow(browserConfig, targetConfig);
    await page.bringToFront();
    res.json({ ok: true, message: `已使用 ${browserConfig.label} 打开 ${targetConfig.label}。` });
  } catch (error) {
    res.status(500).json({ ok: false, message: normalizeError(error) });
  }
});

app.post('/api/run', upload.any(), async (req, res) => {
  try {
    const job = await createJob(req.body, req.files || []);
    jobs.set(job.id, job);
    enqueueBrowserJob(job);
    res.json({ ok: true, jobId: job.id });
  } catch (error) {
    await cleanupUploadedFiles(req.files || []);
    res.status(400).json({ ok: false, message: normalizeError(error) });
  }
});

app.get('/api/jobs/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) {
    res.status(404).json({ ok: false, message: '未找到任务。' });
    return;
  }

  res.json({
    ok: true,
    job: {
      id: job.id,
      status: job.status,
      browserLabel: job.browserConfig.label,
      title: job.title,
      currentStage: job.currentStage,
      stagesTotal: job.stagesTotal || job.stages.length,
      stagesDone: job.stagesDone,
      stopRequested: job.stopRequested,
      createdAt: job.createdAt,
      queue: getJobQueueStatus(job),
      logs: job.logs,
    },
  });
});

app.post('/api/jobs/:jobId/stop', async (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) {
    res.status(404).json({ ok: false, message: '未找到任务。' });
    return;
  }

  const force = Boolean(req.body?.force);
  job.stopRequested = true;
  if (force) {
    const queue = browserJobQueues.get(job.browserLockKey);
    if (queue?.jobIds?.length) {
      queue.jobIds = queue.jobIds.filter((jobId) => jobId !== job.id);
    }
    const releasedPausedQueue = queue?.paused && queue.blockedByJobId === job.id;
    if (releasedPausedQueue) {
      unpauseBrowserQueue(job.browserLockKey);
    }
    markJobStopped(job, '已强制停止旧任务，队列将继续释放。');
    await job.page?.close?.().catch(() => {});
    if (releasedPausedQueue) {
      setImmediate(() => processBrowserQueue(job.browserLockKey));
    }
  } else {
    job.logs.push(logLine('已请求暂停，当前等待释放后停止。'));
  }
  res.json({ ok: true });
});

app.post('/api/jobs/:jobId/logs/clear', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) {
    res.status(404).json({ ok: false, message: '未找到任务。' });
    return;
  }

  job.logs = [];
  res.json({ ok: true });
});

let serverInstance = null;

function startServer(port = PORT) {
  if (serverInstance) return Promise.resolve(serverInstance);

  return new Promise((resolve, reject) => {
    serverInstance = app.listen(port, () => {
      console.log(`Auto sender is running at http://localhost:${port}`);
      resolve(serverInstance);
    });
    serverInstance.once('error', (error) => {
      serverInstance = null;
      reject(error);
    });
  });
}

if (require.main === module) {
  startServer().catch((error) => {
    console.error(normalizeError(error));
    process.exit(1);
  });
}

module.exports = {
  app,
  startServer,
  PORT,
  __test: {
    inferExpectedImageCount,
    inferStageOutputContract,
    responseLooksDeferred,
  },
};

async function createJob(body, uploadedFiles) {
  const browserConfig = resolveBrowserConfig(body);
  const targetConfig = resolveTargetConfig(body);
  const now = new Date();
  const id = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0'),
    String(now.getSeconds()).padStart(2, '0'),
    String(Math.floor(Math.random() * 1000)).padStart(3, '0'),
  ].join('');

  const runDir = path.join(RUNS_DIR, id);
  await fsp.mkdir(runDir, { recursive: true });

  const stageLimit = resolveStageLimit(body, uploadedFiles);
  const resumeFromStage = resolveResumeFromStage(body, stageLimit);
  const completedBeforeResume = resumeFromStage - 1;
  const filesByStage = new Map();
  for (const file of uploadedFiles) {
    const match = /^files_(\d+)$/.exec(file.fieldname);
    if (!match) continue;
    const stageIndex = Number(match[1]);
    if (!filesByStage.has(stageIndex)) filesByStage.set(stageIndex, []);
    filesByStage.get(stageIndex).push(file);
  }

  const stages = [];
  for (let index = resumeFromStage; index <= stageLimit; index += 1) {
    const stageName = String(body[`stageName_${index}`] || '').trim();
    const prompt = String(body[`prompt_${index}`] || '').trim();
    const rawFiles = filesByStage.get(index) || [];

    if (!prompt && rawFiles.length === 0) {
      break;
    }

    const stageDir = path.join(runDir, `stage_${String(index).padStart(2, '0')}`);
    await fsp.mkdir(stageDir, { recursive: true });
    const files = [];
    for (const [fileIndex, file] of rawFiles.entries()) {
      const safeName = safeFileName(file.originalname || `file_${fileIndex + 1}`);
      const target = path.join(stageDir, `${String(fileIndex + 1).padStart(2, '0')}_${safeName}`);
      await fsp.rename(file.path, target);
      files.push(target);
    }

    stages.push({
      index,
      name: stageName,
      prompt,
      files,
      sendMode: 'send',
    });
  }

  await cleanupUploadedFiles(uploadedFiles);

  if (stages.length === 0) {
    await fsp.rm(runDir, { recursive: true, force: true }).catch(() => {});
    throw new Error(`第 ${resumeFromStage} 个阶段为空，无法开始。`);
  }

  const requestedEffectiveCount = Number(body.effectiveStageCount);
  const stagesTotal = Number.isInteger(requestedEffectiveCount) && requestedEffectiveCount >= resumeFromStage
    ? Math.min(MAX_STAGES, requestedEffectiveCount)
    : completedBeforeResume + stages.length;

  const manifest = {
    id,
    createdAt: now.toISOString(),
    resumeFromStage,
    stagesTotal,
    browser: {
      type: browserConfig.type,
      label: browserConfig.label,
      port: browserConfig.port,
      profileMode: browserConfig.profileMode,
      isolatedProfileName: browserConfig.isolatedProfileName,
      profileDirectory: browserConfig.profileDirectory,
      userDataDir: browserConfig.userDataDir,
      executablePath: browserConfig.executablePath,
    },
    target: {
      type: targetConfig.type,
      label: targetConfig.label,
      url: targetConfig.url,
    },
    stages: stages.map((stage) => ({
      index: stage.index,
      name: stage.name,
      promptLength: stage.prompt.length,
      files: stage.files.map((file) => path.basename(file)),
      sendMode: 'send',
    })),
  };
  await fsp.writeFile(path.join(runDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

  return {
    id,
    runDir,
    createdAt: now.toISOString(),
    title: resolveJobTitle(body, stages, id),
    status: 'queued',
    browserConfig,
    targetConfig,
    browserLockKey: browserConfig.lockKey,
    page: null,
    currentStage: null,
    stages,
    stagesTotal,
    stagesDone: completedBeforeResume,
    stopRequested: false,
    queuePriority: parseBoolean(body.queuePriority),
    logs: [logLine(resumeFromStage > 1
      ? `已创建断点续跑任务，从第 ${resumeFromStage} 阶段开始，共 ${stagesTotal} 个有效阶段。`
      : `已创建任务，共 ${stages.length} 个有效阶段。`)],
  };
}

function resolveJobTitle(body, stages, id) {
  const workflowName = String(body.workflowName || '').trim();
  if (workflowName) return workflowName;
  const stageName = stages.find((stage) => stage.name)?.name;
  if (stageName) return stageName;
  return `任务 ${id.slice(-6)}`;
}

function enqueueBrowserJob(job) {
  const lockKey = job.browserLockKey;
  if (!browserJobQueues.has(lockKey)) {
    browserJobQueues.set(lockKey, createBrowserQueue());
  }

  const queue = browserJobQueues.get(lockKey);
  if (job.queuePriority) {
    unpauseBrowserQueue(lockKey);
    queue.jobIds.unshift(job.id);
  } else {
    queue.jobIds.push(job.id);
  }
  const position = queue.running ? queue.jobIds.length + 1 : queue.jobIds.length;
  job.status = 'queued';
  job.logs.push(logLine(job.queuePriority
    ? `已作为恢复任务优先加入 ${job.browserConfig.label} 队列。`
    : `已加入 ${job.browserConfig.label} 队列，排队位置 ${position}。`));
  processBrowserQueue(lockKey);
}

function processBrowserQueue(lockKey) {
  const queue = browserJobQueues.get(lockKey);
  if (!queue || queue.running || queue.paused) return;

  const jobId = queue.jobIds.shift();
  if (!jobId) {
    browserJobQueues.delete(lockKey);
    return;
  }

  const job = jobs.get(jobId);
  if (!job) {
    processBrowserQueue(lockKey);
    return;
  }

  if (job.stopRequested) {
    job.status = 'stopped';
    job.currentStage = null;
    job.logs.push(logLine('任务已在队列中取消。'));
    processBrowserQueue(lockKey);
    return;
  }

  queue.running = true;
  activeBrowserLocks.set(lockKey, job.id);

  let failed = false;
  runJob(job).catch((error) => {
    if (job.stopRequested || job.status === 'stopped') {
      markJobStopped(job, '旧任务已停止，队列继续。');
      return;
    }
    failed = true;
    job.status = 'failed';
    job.currentStage = null;
    job.logs.push(logLine(`失败：${normalizeError(error)}`));
    pauseBrowserQueue(lockKey, job, error);
  }).finally(() => {
    releaseBrowserLock(job);
    queue.running = false;
    if (!failed && !queue.paused) {
      processBrowserQueue(lockKey);
    }
  });
}

function createBrowserQueue() {
  return {
    running: false,
    jobIds: [],
    paused: false,
    blockedByJobId: null,
    pauseReason: '',
  };
}

function pauseBrowserQueue(lockKey, job, error) {
  const queue = browserJobQueues.get(lockKey);
  if (!queue) return;
  queue.paused = true;
  queue.blockedByJobId = job?.id || null;
  queue.pauseReason = normalizeError(error);
  const waitingCount = queue.jobIds.length;
  job?.logs?.push(logLine(waitingCount > 0
    ? `当前输出未通过验收，已暂停后续 ${waitingCount} 个排队任务，避免回合错位。请续跑或重跑本任务。`
    : '当前输出未通过验收，队列已暂停。请续跑或重跑本任务。'));
}

function unpauseBrowserQueue(lockKey) {
  const queue = browserJobQueues.get(lockKey);
  if (!queue) return;
  queue.paused = false;
  queue.blockedByJobId = null;
  queue.pauseReason = '';
}

function getJobQueueStatus(job) {
  const lockKey = job?.browserLockKey;
  if (!lockKey) {
    return {
      position: null,
      total: 0,
      ahead: 0,
      runningJobId: null,
      waiting: 0,
      paused: false,
      blockedByJobId: null,
      pauseReason: '',
    };
  }

  const queue = browserJobQueues.get(lockKey);
  const runningJobId = activeBrowserLocks.get(lockKey) || null;
  const waitingIds = queue?.jobIds || [];
  const activeIds = runningJobId ? [runningJobId, ...waitingIds] : [...waitingIds];
  const activeIndex = activeIds.indexOf(job.id);
  const position = activeIndex >= 0 ? activeIndex + 1 : null;

  return {
    position,
    total: activeIds.length,
    ahead: position ? position - 1 : 0,
    runningJobId,
    waiting: waitingIds.length,
    paused: Boolean(queue?.paused),
    blockedByJobId: queue?.blockedByJobId || null,
    pauseReason: queue?.pauseReason || '',
  };
}

async function runJob(job) {
  job.status = 'running';
  job.logs.push(logLine(`使用 ${job.browserConfig.label} 新建 ${job.targetConfig.label} 窗口。`));

  const page = await createTargetWindow(job.browserConfig, job.targetConfig);
  job.page = page;
  if (job.stopRequested) {
    await page.close().catch(() => {});
    markJobStopped(job, '已暂停。');
    return;
  }
  await page.bringToFront();
  await waitForComposer(page, job);
  if (markJobStoppedIfRequested(job)) return;

  for (const stage of job.stages) {
    if (markJobStoppedIfRequested(job)) return;

    job.currentStage = stage.index;
    const label = stageDisplayName(stage);
    job.logs.push(logLine(`${label} 开始。`));
    await waitForComposer(page, job);
    if (markJobStoppedIfRequested(job)) return;

    if (stage.files.length > 0) {
      job.logs.push(logLine(`${label} 上传 ${stage.files.length} 个文件。`));
      await attachFiles(page, stage.files, job.targetConfig);
      if (markJobStoppedIfRequested(job)) return;
      await waitAfterUpload(page, job);
      if (markJobStoppedIfRequested(job)) return;
    }

    if (stage.prompt) {
      job.logs.push(logLine(`${label} 填入提示词。`));
      await typePrompt(page, stage.prompt, job.targetConfig);
      if (markJobStoppedIfRequested(job)) return;
    }

    job.logs.push(logLine(`${label} 发送。`));
    const responseBaseline = await captureConversationState(page);
    await clickSend(page, job.targetConfig);
    if (markJobStoppedIfRequested(job)) return;
    await waitForResponseComplete(page, job, stage, responseBaseline);
    if (markJobStoppedIfRequested(job)) return;
    job.stagesDone += 1;
    job.logs.push(logLine(`${label} 完成。`));
  }

  job.currentStage = null;
  job.status = 'completed';
  job.logs.push(logLine('全部阶段完成。'));
}

function markJobStoppedIfRequested(job) {
  if (!job?.stopRequested) return false;
  markJobStopped(job, '已暂停。');
  return true;
}

function markJobStopped(job, message) {
  if (!job) return;
  job.status = 'stopped';
  job.currentStage = null;
  const lastLog = job.logs?.[job.logs.length - 1] || '';
  if (message && !lastLog.endsWith(message)) {
    job.logs.push(logLine(message));
  }
}

async function createTargetWindow(browserConfig, targetConfig) {
  let lastError = null;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const session = await getBrowserSession(browserConfig, { forceNew: attempt > 1 });
    try {
      const page = await openNewWindow(session.context);
      await page.goto(targetConfig.url, { waitUntil: 'domcontentloaded' });
      return page;
    } catch (error) {
      lastError = error;
      discardBrowserSession(browserConfig.key, session);
      if (!isBrowserClosedError(error)) break;
    }
  }

  throw new Error(`打开 ${targetConfig.label} 窗口失败：${normalizeError(lastError)}`);
}

async function getBrowserSession(browserConfig, options = {}) {
  const key = browserConfig.key;
  const cached = browserSessions.get(key);
  if (!options.forceNew && isBrowserSessionUsable(cached)) {
    return cached;
  }
  discardBrowserSession(key, cached);

  let cdpReady = await isCdpReady(browserConfig.port);
  if (!cdpReady) {
    launchBrowserForAutomation(browserConfig);
    cdpReady = await waitForCdpReady(browserConfig.port, 15000);
  }

  if (!cdpReady) {
    throw new Error(`未能打开 ${browserConfig.label}。请确认浏览器已安装、路径正确，并且该浏览器支持 Chromium 远程调试；如果使用原浏览器资料，请先关闭该浏览器或改用独立资料目录。`);
  }

  const cdp = await chromium.connectOverCDP(`http://127.0.0.1:${browserConfig.port}`);
  const context = cdp.contexts()[0];
  const session = { cdp, context, config: browserConfig };
  browserSessions.set(key, session);
  cdp.on('disconnected', () => {
    if (browserSessions.get(key) === session) {
      browserSessions.delete(key);
    }
  });
  return session;
}

function isBrowserSessionUsable(session) {
  if (!session?.cdp || !session.context) return false;
  try {
    if (typeof session.cdp.isConnected === 'function' && !session.cdp.isConnected()) return false;
    session.context.pages();
    return true;
  } catch (_error) {
    return false;
  }
}

function discardBrowserSession(key, session) {
  if (key && browserSessions.get(key) === session) {
    browserSessions.delete(key);
  }
  session?.cdp?.close?.().catch(() => {});
}

function normalizeClientId(value) {
  const clean = String(value || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
  return clean || `client-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function clearShutdownTimer() {
  if (!shutdownTimer) return;
  clearTimeout(shutdownTimer);
  shutdownTimer = null;
}

function pruneInactiveClients() {
  const now = Date.now();
  for (const [clientId, lastSeen] of activeClients.entries()) {
    if (now - lastSeen > CLIENT_INACTIVE_MS) {
      activeClients.delete(clientId);
    }
  }
}

function scheduleShutdownIfNoClients(options = {}) {
  const force = Boolean(options.force);
  clearShutdownTimer();
  shutdownTimer = setTimeout(() => {
    pruneInactiveClients();
    if (activeClients.size === 0 && (force || !hasActiveJobs())) {
      shutdownWorkbench('最后一个工作台窗口已关闭。');
    }
  }, CLIENT_SHUTDOWN_GRACE_MS);
}

function hasActiveJobs() {
  for (const job of jobs.values()) {
    if (['queued', 'running'].includes(job.status)) return true;
  }
  for (const queue of browserJobQueues.values()) {
    if (queue?.running || queue?.jobIds?.length) return true;
  }
  return activeBrowserLocks.size > 0;
}

async function shutdownWorkbench(reason = '工作台退出。') {
  if (isShuttingDown) return;
  isShuttingDown = true;
  clearShutdownTimer();

  for (const job of jobs.values()) {
    job.stopRequested = true;
    if (['queued', 'running'].includes(job.status)) {
      job.status = 'stopped';
      job.currentStage = null;
      job.logs.push(logLine(reason));
    }
    await job.page?.close?.().catch(() => {});
  }

  browserJobQueues.clear();
  activeBrowserLocks.clear();

  for (const [key, session] of browserSessions.entries()) {
    discardBrowserSession(key, session);
  }

  for (const child of browserProcesses.values()) {
    await stopProcessTree(child.pid);
  }
  browserProcesses.clear();

  setTimeout(() => {
    if (!serverInstance) {
      process.exit(0);
      return;
    }

    serverInstance.close(() => {
      serverInstance = null;
      process.exit(0);
    });

    setTimeout(() => process.exit(0), 1500).unref();
  }, 100).unref();
}

function stopProcessTree(pid) {
  return new Promise((resolve) => {
    if (!pid) {
      resolve();
      return;
    }

    if (process.platform === 'win32') {
      const child = spawn('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore',
      });
      child.on('close', () => resolve());
      child.on('error', () => resolve());
      return;
    }

    try {
      process.kill(pid);
    } catch (_error) {
      // Ignore already closed browser processes.
    }
    resolve();
  });
}

function isBrowserClosedError(error) {
  const message = normalizeError(error);
  return /target page|context|browser has been closed|browser closed|disconnected|connection closed/i.test(message);
}

async function openNewWindow(context) {
  const existingPage = context.pages()[0] || await context.newPage();
  const client = await context.newCDPSession(existingPage);
  const pagePromise = context.waitForEvent('page', { timeout: 5000 }).catch(() => null);

  await client.send('Target.createTarget', {
    url: 'about:blank',
    newWindow: true,
  }).catch(() => null);

  const page = await pagePromise;
  if (page) return page;
  return context.newPage();
}

function launchBrowserForAutomation(browserConfig) {
  const args = [
    `--remote-debugging-port=${browserConfig.port}`,
    '--no-first-run',
    '--new-window',
  ];

  if (browserConfig.profileMode === 'isolated') {
    fs.mkdirSync(browserConfig.userDataDir, { recursive: true });
    args.push(`--user-data-dir=${browserConfig.userDataDir}`);
    args.push('--profile-directory=Default');
  } else {
    args.push(`--profile-directory=${browserConfig.profileDirectory}`);
  }

  const child = spawn(browserConfig.executablePath, args, {
    detached: true,
    stdio: 'ignore',
  });
  child.on('error', () => {
    // The caller verifies CDP readiness and reports a controlled failure.
  });
  browserProcesses.set(browserConfig.key, child);
  child.on('exit', () => {
    if (browserProcesses.get(browserConfig.key) === child) {
      browserProcesses.delete(browserConfig.key);
    }
  });
  child.unref();
}

async function waitForCdpReady(port, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await isCdpReady(port)) return true;
    await sleep(500);
  }
  return false;
}

async function isCdpReady(port) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1000);
    const response = await fetch(`http://127.0.0.1:${port}/json/version`, {
      signal: controller.signal,
    });
    clearTimeout(timer);
    return response.ok;
  } catch (_error) {
    return false;
  }
}

async function waitForComposer(page, job) {
  job.logs.push(logLine('等待输入框。'));
  const selectors = getTargetSelectors(job?.targetConfig).editors;

  const started = Date.now();
  while (Date.now() - started < 10 * 60 * 1000) {
    if (job.stopRequested) return;
    for (const selector of selectors) {
      const locator = page.locator(selector).last();
      if ((await locator.count()) > 0) {
        const visible = await locator.isVisible().catch(() => false);
        if (visible) return;
      }
    }
    await page.waitForTimeout(1000);
  }
  throw new Error(`等待 ${job?.targetConfig?.label || '目标平台'} 输入框超时。请确认已登录且没有弹窗遮挡。`);
}

async function attachFiles(page, files, targetConfig) {
  const fileInput = page.locator('input[type="file"]').first();
  if ((await fileInput.count()) > 0) {
    await fileInput.setInputFiles(files);
    return;
  }

  const possibleButtons = getTargetSelectors(targetConfig).uploadButtons;

  for (const selector of possibleButtons) {
    const button = page.locator(selector).first();
    if ((await button.count()) === 0) continue;
    if (!(await button.isVisible().catch(() => false))) continue;

    const chooserPromise = page.waitForEvent('filechooser', { timeout: 5000 });
    await button.click();
    const chooser = await chooserPromise;
    await chooser.setFiles(files);
    return;
  }

  throw new Error('未找到文件上传入口。');
}

async function waitAfterUpload(page, job) {
  const started = Date.now();
  while (Date.now() - started < 5 * 60 * 1000) {
    if (job.stopRequested) return;
    const bodyText = await safeBodyText(page);
    const stillUploading = /uploading|上传中|正在上传|processing|处理中/i.test(bodyText);
    if (!stillUploading) {
      await page.waitForTimeout(1500);
      return;
    }
    await page.waitForTimeout(1000);
  }
  throw new Error('等待文件上传完成超时。');
}

async function typePrompt(page, prompt, targetConfig) {
  const editor = await findEditor(page, targetConfig);
  await editor.click();

  const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
  await page.keyboard.press(`${modifier}+A`).catch(() => {});
  await page.keyboard.press('Backspace').catch(() => {});

  const pasted = await page.evaluate(async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (_error) {
      return false;
    }
  }, prompt).catch(() => false);

  if (pasted) {
    await page.keyboard.press(`${modifier}+V`);
  } else {
    await page.keyboard.insertText(prompt);
  }
}

async function findEditor(page, targetConfig) {
  const selectors = getTargetSelectors(targetConfig).editors;
  for (const selector of selectors) {
    const locator = page.locator(selector).last();
    if ((await locator.count()) > 0 && (await locator.isVisible().catch(() => false))) {
      return locator;
    }
  }
  throw new Error('未找到提示词输入框。');
}

async function clickSend(page, targetConfig) {
  const selectors = getTargetSelectors(targetConfig).sendButtons;

  const started = Date.now();
  while (Date.now() - started < 2 * 60 * 1000) {
    for (const selector of selectors) {
      const button = page.locator(selector).last();
      if ((await button.count()) === 0) continue;
      const visible = await button.isVisible().catch(() => false);
      const enabled = await button.isEnabled().catch(() => false);
      if (visible && enabled) {
        await button.click();
        return;
      }
    }
    await page.waitForTimeout(500);
  }

  await page.keyboard.press('Enter');
}

async function waitForResponseComplete(page, job, stage, responseBaseline) {
  const contract = inferStageOutputContract(stage);
  const label = stageDisplayName(stage);
  const stageArtifactBaseline = Number(responseBaseline?.artifactCount) || 0;
  job.logs.push(logLine(contract.type === 'images'
    ? `${label} 等待回复及至少 ${contract.expectedImages} 张结果图完成。`
    : `${label} 等待本轮新回复完成。`));

  let attemptBaseline = responseBaseline || await captureConversationState(page);
  for (let attempt = 0; attempt <= MAX_STAGE_NUDGES; attempt += 1) {
    const result = await waitForResponseAttempt(page, job, stage, {
      contract,
      attemptBaseline,
      stageArtifactBaseline,
    });
    if (job.stopRequested) return;
    if (result.complete) {
      await waitForComposer(page, job);
      if (contract.type === 'images') {
        job.logs.push(logLine(`${label} 已确认新增 ${result.artifactDelta} 张结果图。`));
      }
      return;
    }

    if (attempt >= MAX_STAGE_NUDGES || contract.type !== 'images') {
      throw new StageOutputIncompleteError(
        `${label} 输出未完成：需要 ${contract.expectedImages} 张结果图，当前仅确认 ${result.artifactDelta} 张。`,
        {
          stageIndex: stage.index,
          expectedImages: contract.expectedImages,
          artifactDelta: result.artifactDelta,
          reason: result.reason,
        },
      );
    }

    job.logs.push(logLine(
      `${label} 当前仅确认 ${result.artifactDelta}/${contract.expectedImages} 张，自动追发一次完成指令。`,
    ));
    await waitForComposer(page, job);
    if (job.stopRequested) return;
    await typePrompt(page, IMAGE_COMPLETION_NUDGE, job.targetConfig);
    attemptBaseline = await captureConversationState(page);
    await clickSend(page, job.targetConfig);
  }
}

async function waitForResponseAttempt(page, job, stage, options) {
  const {
    contract,
    attemptBaseline,
    stageArtifactBaseline,
  } = options;
  const started = Date.now();
  const strictTurns = job?.targetConfig?.type === 'chatgpt';
  let latestSignature = '';
  let stableSince = 0;
  let responseStartedAt = 0;
  let incompleteSince = 0;

  while (Date.now() - started < RESPONSE_TIMEOUT_MS) {
    if (job.stopRequested) {
      return {
        complete: false,
        artifactDelta: 0,
        reason: 'stopped',
      };
    }

    const snapshot = await captureConversationState(page);
    const hasStop = await hasGeneratingStop(page, job.targetConfig);
    const userTurnSeen = hasUserTurnAdvanced(snapshot, attemptBaseline);
    const assistantTurnSeen = hasAssistantTurnAdvanced(snapshot, attemptBaseline);
    const genericTurnSeen = snapshot.bodySignature !== attemptBaseline.bodySignature;
    const responseStarted = strictTurns
      ? userTurnSeen && assistantTurnSeen
      : assistantTurnSeen || genericTurnSeen;

    if (strictTurns && !userTurnSeen && Date.now() - started >= SEND_CONFIRM_TIMEOUT_MS) {
      throw new Error(`阶段 ${stage.index} 发送后未检测到新用户消息，发送动作可能没有落地。`);
    }

    if (!responseStarted) {
      if (Date.now() - started >= RESPONSE_START_TIMEOUT_MS) {
        throw new Error(`阶段 ${stage.index} 未检测到新的助手回复。`);
      }
      await page.waitForTimeout(RESPONSE_POLL_MS);
      continue;
    }

    if (!responseStartedAt) responseStartedAt = Date.now();
    const artifactDelta = Math.max(0, snapshot.artifactCount - stageArtifactBaseline);
    const responseSignature = assistantTurnSeen
      ? `${snapshot.latestAssistantSignature}:${snapshot.artifactCount}`
      : `${snapshot.bodySignature}:${snapshot.artifactCount}`;
    if (!hasStop && responseSignature === latestSignature) {
      if (!stableSince) stableSince = Date.now();
    } else {
      latestSignature = responseSignature;
      stableSince = 0;
      incompleteSince = 0;
    }

    const isStable = !hasStop && stableSince > 0 && Date.now() - stableSince >= RESPONSE_STABLE_MS;
    if (!isStable) {
      await page.waitForTimeout(RESPONSE_POLL_MS);
      continue;
    }

    if (contract.type !== 'images') {
      return {
        complete: true,
        artifactDelta,
        reason: 'stable-assistant-turn',
      };
    }

    if (artifactDelta >= contract.expectedImages) {
      return {
        complete: true,
        artifactDelta,
        reason: 'image-contract-satisfied',
      };
    }

    if (responseLooksDeferred(snapshot.latestAssistantText)) {
      return {
        complete: false,
        artifactDelta,
        reason: 'assistant-deferred-generation',
      };
    }

    if (!incompleteSince) incompleteSince = Date.now();
    if (Date.now() - incompleteSince >= IMAGE_OUTPUT_GRACE_MS) {
      return {
        complete: false,
        artifactDelta,
        reason: 'image-count-incomplete',
      };
    }

    await page.waitForTimeout(RESPONSE_POLL_MS);
  }

  throw new Error(`阶段 ${stage.index} 等待回复完成超时。`);
}

async function captureConversationState(page) {
  const state = await page.evaluate(() => {
    const unique = (nodes) => [...new Set(nodes.filter(Boolean))];
    const textOf = (node) => String(node?.innerText || node?.textContent || '').trim();
    const keyOf = (node) => String(
      node?.getAttribute?.('data-message-id')
      || node?.getAttribute?.('data-testid')
      || node?.id
      || '',
    );
    const userSelectors = [
      '[data-message-author-role="user"]',
      '[data-author="user"]',
      '[data-role="user"]',
      '.user-message',
    ];
    const assistantSelectors = [
      '[data-message-author-role="assistant"]',
      '[data-author="assistant"]',
      '[data-role="assistant"]',
      '.assistant-message',
      '.model-response',
      'model-response',
    ];
    const collect = (selectors) => unique(selectors.flatMap((selector) => (
      [...document.querySelectorAll(selector)]
    )));
    const users = collect(userSelectors);
    const assistants = collect(assistantSelectors);
    const latestUser = users.at(-1) || null;
    const latestAssistant = assistants.at(-1) || null;
    const artifactKeys = new Set();

    for (const [assistantIndex, root] of assistants.entries()) {
      const fileLabels = new Set();
      for (const node of root.querySelectorAll('button, a, [aria-label], [download]')) {
        const label = [
          node.getAttribute('aria-label'),
          node.getAttribute('download'),
          textOf(node),
        ].filter(Boolean).join(' ');
        const matches = label.match(/[^\s"'<>]+\.(?:png|jpe?g|webp|gif)\b/gi) || [];
        for (const match of matches) {
          fileLabels.add(match.trim().toLowerCase());
        }
      }

      if (fileLabels.size > 0) {
        for (const label of fileLabels) {
          artifactKeys.add(`assistant-${assistantIndex}:file:${label}`);
        }
        continue;
      }

      for (const image of root.querySelectorAll('img')) {
        const src = String(image.currentSrc || image.src || '').trim();
        const isMeaningfulSize = Number(image.naturalWidth) >= 128 && Number(image.naturalHeight) >= 128;
        const looksGenerated = /blob:|oaiusercontent|usercontent|dalle|generated|image/i.test(src);
        if (src && (isMeaningfulSize || looksGenerated)) {
          artifactKeys.add(`assistant-${assistantIndex}:image:${src}`);
        }
      }
    }

    const bodyText = String(document.body?.innerText || '');
    return {
      userCount: users.length,
      assistantCount: assistants.length,
      latestUserKey: keyOf(latestUser),
      latestUserText: textOf(latestUser),
      latestAssistantKey: keyOf(latestAssistant),
      latestAssistantText: textOf(latestAssistant),
      artifactCount: artifactKeys.size,
      bodyText,
    };
  }).catch(() => ({
    userCount: 0,
    assistantCount: 0,
    latestUserKey: '',
    latestUserText: '',
    latestAssistantKey: '',
    latestAssistantText: '',
    artifactCount: 0,
    bodyText: '',
  }));

  return {
    ...state,
    latestUserSignature: messageSignature(state.latestUserKey, state.latestUserText),
    latestAssistantSignature: messageSignature(state.latestAssistantKey, state.latestAssistantText),
    bodySignature: messageSignature('', state.bodyText),
  };
}

function hasUserTurnAdvanced(snapshot, baseline) {
  return snapshot.userCount > baseline.userCount
    || snapshot.latestUserKey !== baseline.latestUserKey
    || snapshot.latestUserSignature !== baseline.latestUserSignature;
}

function hasAssistantTurnAdvanced(snapshot, baseline) {
  return snapshot.assistantCount > baseline.assistantCount
    || snapshot.latestAssistantKey !== baseline.latestAssistantKey
    || snapshot.latestAssistantSignature !== baseline.latestAssistantSignature;
}

function messageSignature(key, text) {
  const normalized = String(text || '');
  return `${String(key || '')}:${normalized.length}:${hashString(normalized)}`;
}

function inferStageOutputContract(stage = {}) {
  const prompt = String(stage.prompt || '');
  const normalized = prompt.replace(/\s+/g, ' ').trim();
  const fileCount = Array.isArray(stage.files) ? stage.files.length : 0;
  const explicitNoGeneration = /(?:本轮|当前(?:这一轮)?|这一阶段).{0,30}(?:不生成(?:新)?图|不要生成(?:新)?图|不做图片生成|只做分析|只做理解|只做策划|只生成蓝图)/i.test(normalized);
  const preparationOnly = /准备生图|开启.{0,16}(?:逐张)?生成图片系统|等待.{0,12}(?:开始|指令|确认)|下一轮.{0,20}(?:提示词|指令)|需要注意什么|怎么生成剩余/i.test(normalized);
  const preparationOverride = /商业精修|逐张输出|(?:请|立即|开始|继续|接着|本轮|本批).{0,24}(?:逐张|分批)?生成/i.test(normalized);
  const actualGeneration = /生成高质量产品白底图|商业精修.{0,80}(?:逐张输出|生成)|(?:本轮|本批|这一轮).{0,30}生成|(?:立即|开始|继续|接着|严格按照).{0,24}(?:逐张|分批)?生成|逐张生成|分批生成结果图|逐张输出/i.test(normalized);

  if (explicitNoGeneration || (preparationOnly && !preparationOverride)) {
    return { type: 'text', expectedImages: 0 };
  }

  if (!actualGeneration) {
    return { type: 'text', expectedImages: 0 };
  }

  return {
    type: 'images',
    expectedImages: inferExpectedImageCount(prompt, fileCount),
  };
}

function inferExpectedImageCount(prompt, fallbackCount = 0) {
  const text = String(prompt || '');
  const candidates = [];
  const rangePattern = /(?:图|第)\s*(\d+)\s*(?:-|—|–|~|至|到)\s*(?:图|第)?\s*(\d+)(?:\s*页)?/gi;
  const explicitPattern = /(?:总共|共|合计|本轮(?:需要)?生成|本批(?:需要)?生成|生成)\s*(\d+)\s*张(?:独立)?(?:图片|图像|结果图|白底图)?/gi;
  let match;

  while ((match = rangePattern.exec(text)) !== null) {
    const start = Number(match[1]);
    const end = Number(match[2]);
    const count = Math.abs(end - start) + 1;
    if (Number.isInteger(count) && count > 0 && count <= 100) {
      candidates.push({ index: match.index, count });
    }
  }

  while ((match = explicitPattern.exec(text)) !== null) {
    const count = Number(match[1]);
    if (Number.isInteger(count) && count > 0 && count <= 100) {
      candidates.push({ index: match.index, count });
    }
  }

  candidates.sort((left, right) => left.index - right.index);
  if (candidates.length > 0) return candidates.at(-1).count;
  if (Number.isInteger(fallbackCount) && fallbackCount > 0) return fallbackCount;
  return 1;
}

function responseLooksDeferred(text) {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return false;
  return /等待.{0,16}(?:开始|指令|确认)|请(?:你)?(?:回复|发送|提交|提供).{0,20}(?:开始|指令|下一步|素材|图片)|准备好.{0,12}(?:开始|继续)|收到.{0,30}(?:等待|请继续)|下一轮.{0,20}(?:提示词|指令)|等你.{0,16}(?:确认|开始|继续)/i.test(normalized);
}

async function hasGeneratingStop(page, targetConfig) {
  const selectors = getTargetSelectors(targetConfig).stopButtons;
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if ((await locator.count()) > 0 && (await locator.isVisible().catch(() => false))) {
      return true;
    }
  }

  const text = await safeBodyText(page);
  return /generating|正在生成|stop generating|停止生成/i.test(text);
}

async function safeBodyText(page) {
  return page.evaluate(() => document.body.innerText || '').catch(() => '');
}

function resolveBrowserConfig(input) {
  const type = String(input.browserType || 'edge').toLowerCase();
  const presetKey = BROWSER_PRESETS[type] ? type : 'edge';
  const preset = BROWSER_PRESETS[presetKey];
  const profileMode = normalizeProfileMode(input.profileMode);
  const profileDirectory = String(input.profileDirectory || 'Default').trim() || 'Default';
  const isolatedProfileName = normalizeProfileName(input.isolatedProfileName || input.profileName || profileDirectory);
  const explicitPath = String(input.browserPath || '').trim();
  const isCustom = presetKey === 'custom';

  if (isCustom && !explicitPath) {
    throw new Error('请选择自定义浏览器 exe 路径。');
  }

  if (explicitPath && !fs.existsSync(explicitPath)) {
    throw new Error(`浏览器路径不存在：${explicitPath}`);
  }

  if (explicitPath && path.extname(explicitPath).toLowerCase() !== '.exe') {
    throw new Error(`浏览器路径必须指向 exe 文件：${explicitPath}`);
  }

  const executablePath = explicitPath || findExistingPath(preset.paths);
  const processName = preset.processName || (executablePath ? path.basename(executablePath) : null);

  if (!executablePath || !fs.existsSync(executablePath)) {
    throw new Error(`未找到 ${preset.label}。请选择自定义浏览器路径。`);
  }

  const browserType = isCustom ? 'custom' : presetKey;
  const baseLabel = isCustom ? `自定义浏览器（${path.basename(executablePath)}）` : preset.label;
  const userDataDir = profileMode === 'isolated'
    ? path.join(BROWSER_PROFILES_DIR, browserProfileFolderName(browserType, executablePath), isolatedProfileName)
    : '';
  const automationPort = profileMode === 'isolated'
    ? resolveIsolatedBrowserPort(executablePath, userDataDir)
    : (isCustom ? resolveCustomBrowserPort(executablePath) : preset.port);
  const profileIdentity = profileMode === 'isolated' ? userDataDir : profileDirectory;
  const profileLabel = profileMode === 'isolated'
    ? `独立资料：${isolatedProfileName}`
    : `原浏览器资料：${profileDirectory}`;
  const lockKey = profileMode === 'isolated'
    ? `${executablePath}|isolated|${userDataDir}`
    : `${executablePath}|system`;

  return {
    type: browserType,
    label: `${baseLabel}（${profileLabel}）`,
    baseLabel,
    port: automationPort,
    profileMode,
    profileDirectory,
    isolatedProfileName,
    userDataDir,
    executablePath,
    processName,
    key: `${automationPort}|${executablePath}|${profileMode}|${profileIdentity}`,
    lockKey,
  };
}

function getBrowserChoices() {
  return Object.entries(BROWSER_PRESETS).map(([type, preset]) => {
    const executablePath = findExistingPath(preset.paths);
    return {
      type,
      label: preset.label,
      installed: type === 'custom' ? false : Boolean(executablePath),
      executablePath,
      requiresPath: type === 'custom',
    };
  });
}

function getTargetChoices() {
  return Object.entries(AI_TARGETS).map(([type, target]) => ({
    type,
    label: target.label,
    url: target.url,
    requiresUrl: type === 'custom',
  }));
}

function assertBrowserCanOpen(browserConfig) {
  const runningJobId = activeBrowserLocks.get(browserConfig.lockKey);
  if (runningJobId && isJobActiveOrPending(runningJobId)) {
    throw new Error(`当前 ${browserConfig.label} 正在执行任务 ${runningJobId}，暂不允许在同一浏览器环境继续开窗口。`);
  }
}

function releaseBrowserLock(job) {
  const lockKey = job?.browserConfig?.lockKey || job?.browserLockKey;
  if (!lockKey) return;
  if (activeBrowserLocks.get(lockKey) === job.id) {
    activeBrowserLocks.delete(lockKey);
  }
}

function isJobActive(jobId) {
  const job = jobs.get(jobId);
  return Boolean(job && ['queued', 'running'].includes(job.status));
}

function isJobActiveOrPending(jobId) {
  return !jobs.has(jobId) || isJobActive(jobId);
}

function resolveTargetConfig(input) {
  const requestedType = String(input.targetPlatform || input.targetType || 'chatgpt').toLowerCase();
  const type = AI_TARGETS[requestedType] ? requestedType : 'chatgpt';
  const preset = AI_TARGETS[type];
  const explicitUrl = String(input.targetUrl || '').trim();
  const url = type === 'custom' ? explicitUrl : preset.url;

  if (!url) {
    throw new Error('请填写自定义目标平台网址。');
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch (_error) {
    throw new Error(`目标平台网址无效：${url}`);
  }

  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw new Error(`目标平台网址必须是 http 或 https：${url}`);
  }

  return {
    type,
    label: type === 'custom' ? '自定义平台' : preset.label,
    url: parsedUrl.toString(),
  };
}

function getTargetSelectors(targetConfig = {}) {
  const uploadButtons = [
    'button[aria-label*="Attach"]',
    'button[aria-label*="Upload"]',
    'button[aria-label*="上传"]',
    'button[aria-label*="添加"]',
    'button[data-testid*="upload"]',
    'button[data-testid*="attach"]',
    '[role="button"][aria-label*="Upload"]',
    '[role="button"][aria-label*="上传"]',
  ];

  return {
    editors: DEFAULT_EDITOR_SELECTORS,
    sendButtons: DEFAULT_SEND_SELECTORS,
    stopButtons: DEFAULT_STOP_SELECTORS,
    uploadButtons,
  };
}

async function listWorkflows() {
  await fsp.mkdir(WORKFLOWS_DIR, { recursive: true });
  const files = await fsp.readdir(WORKFLOWS_DIR, { withFileTypes: true });
  const workflows = [];

  for (const file of files) {
    if (!file.isFile() || !file.name.endsWith('.json')) continue;
    const fullPath = path.join(WORKFLOWS_DIR, file.name);
    try {
      const raw = await fsp.readFile(fullPath, 'utf8');
      const parsed = JSON.parse(raw);
      if (!parsed || !parsed.name) continue;
      workflows.push({
        name: String(parsed.name),
        updatedAt: parsed.updatedAt || '',
        stageCount: Array.isArray(parsed.stages) ? parsed.stages.length : 0,
        fileName: file.name,
      });
    } catch (_error) {
      // Ignore malformed workflow files so one bad file does not break the picker.
    }
  }

  return workflows.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
}

async function readWorkflow(name) {
  const filePath = workflowPathFromName(name);
  if (!fs.existsSync(filePath)) return null;
  const raw = await fsp.readFile(filePath, 'utf8');
  return JSON.parse(raw);
}

async function saveWorkflow(workflow) {
  await fsp.mkdir(WORKFLOWS_DIR, { recursive: true });
  const filePath = workflowPathFromName(workflow.name);
  await fsp.writeFile(filePath, JSON.stringify(workflow, null, 2), 'utf8');
}

async function deleteWorkflow(name) {
  const filePath = workflowPathFromName(name);
  if (!fs.existsSync(filePath)) return false;
  await fsp.unlink(filePath);
  return true;
}

function normalizeWorkflow(input) {
  const name = String(input.name || '').trim();
  if (!name) {
    throw new Error('工作流名称为空，无法保存。');
  }

  const browser = input.browser && typeof input.browser === 'object' ? input.browser : {};
  const target = input.target && typeof input.target === 'object' ? input.target : {};
  const taskForm = input.taskForm && typeof input.taskForm === 'object' ? input.taskForm : {};
  const stages = Array.isArray(input.stages) ? input.stages : [];

  return {
    name,
    version: 1,
    updatedAt: new Date().toISOString(),
    browser: {
      browserType: String(browser.browserType || 'edge'),
      browserPath: String(browser.browserPath || ''),
      profileMode: normalizeProfileMode(browser.profileMode),
      isolatedProfileName: normalizeProfileName(browser.isolatedProfileName || browser.profileName || browser.profileDirectory),
      profileDirectory: String(browser.profileDirectory || 'Default'),
    },
    target: {
      targetPlatform: String(target.targetPlatform || target.targetType || 'chatgpt'),
      targetUrl: String(target.targetUrl || ''),
    },
    taskForm: {
      stageUseCommonFiles: Array.isArray(taskForm.stageUseCommonFiles)
        ? taskForm.stageUseCommonFiles.slice(0, MAX_STAGES).map((value) => value !== false)
        : [],
    },
    stages: stages.slice(0, MAX_STAGES).map((stage, arrayIndex) => {
      const templatePrompt = String(stage.templatePrompt || stage.sourcePrompt || stage.prompt || '');
      const replacements = normalizeStageReplacements(stage.replacements);
      const layout = normalizeStageVisibility(stage);
      const prompt = layout.visible.source
        ? (layout.visible.replacements ? applyPromptReplacements(templatePrompt, replacements) : templatePrompt)
        : '';
      return {
        index: arrayIndex + 1,
        name: String(stage.name || stage.stageName || ''),
        mode: 'send',
        templatePrompt,
        replacements,
        prompt,
        layoutMode: layout.layoutMode,
        visible: layout.visible,
        height: normalizeStageHeight(stage.height || stage.cardHeight || stage.stageHeight),
      };
    }),
  };
}

function createDefaultStageVisibility() {
  return { ...STAGE_LAYOUT_PRESETS[DEFAULT_STAGE_LAYOUT_MODE] };
}

function normalizeStageVisibility(stage = {}) {
  const rawMode = String(stage.layoutMode || stage.viewMode || '').trim();
  const storedVisible = stage.visible && typeof stage.visible === 'object'
    ? stage.visible
    : (stage.modules && typeof stage.modules === 'object' ? stage.modules : null);

  if (rawMode && rawMode !== 'custom' && STAGE_LAYOUT_PRESETS[rawMode]) {
    return { layoutMode: rawMode, visible: { ...STAGE_LAYOUT_PRESETS[rawMode] } };
  }

  if (rawMode === 'custom' || storedVisible) {
    const fallback = createDefaultStageVisibility();
    const visible = {};
    for (const key of STAGE_MODULE_KEYS) {
      visible[key] = storedVisible?.[key] !== undefined ? storedVisible[key] !== false : fallback[key];
    }
    return { layoutMode: 'custom', visible };
  }

  return { layoutMode: DEFAULT_STAGE_LAYOUT_MODE, visible: createDefaultStageVisibility() };
}

function normalizeStageHeight(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return null;
  return Math.max(STAGE_MIN_HEIGHT, Math.min(STAGE_MAX_HEIGHT, Math.round(number)));
}

function normalizeStageReplacements(replacements) {
  if (!Array.isArray(replacements)) return [];
  return replacements
    .map((replacement) => ({
      marker: String(replacement?.marker || replacement?.key || replacement?.placeholder || ''),
      value: String(replacement?.value ?? replacement?.content ?? ''),
    }))
    .filter((replacement) => replacement.marker || replacement.value)
    .slice(0, 200);
}

function applyPromptReplacements(templateText, replacements = []) {
  let output = String(templateText || '');
  const pendingValues = [];

  for (const replacement of replacements) {
    const marker = String(replacement.marker || '').trim();
    if (!marker) continue;
    const temporaryToken = `\uE000REPLACE_${pendingValues.length}\uE001`;
    let matched = false;

    for (const group of buildReplacementCandidateGroups(marker)) {
      let groupMatched = false;
      for (const candidate of group) {
        if (!candidate || !output.includes(candidate)) continue;
        output = output.split(candidate).join(temporaryToken);
        matched = true;
        groupMatched = true;
      }
      if (groupMatched) break;
    }

    if (matched) {
      pendingValues.push({
        token: temporaryToken,
        value: String(replacement.value ?? ''),
      });
    }
  }

  for (const item of pendingValues) {
    output = output.split(item.token).join(item.value);
  }

  return output;
}

function buildReplacementCandidates(marker) {
  return [...new Set(buildReplacementCandidateGroups(marker).flat())]
    .sort((left, right) => right.length - left.length);
}

function buildReplacementCandidateGroups(marker) {
  const raw = String(marker || '').trim();
  if (!raw) return [];
  const variableName = extractVariableName(raw);
  const wrappedCandidates = [
    `***{${variableName}}***`,
    `{${variableName}}`,
    `\u3010${variableName}\u3011`,
    `***${variableName}***`,
  ];
  const wrapped = [...new Set(wrappedCandidates.filter(Boolean))]
    .filter((candidate) => candidate !== raw)
    .sort((left, right) => right.length - left.length);
  const rawGroup = [raw];
  const isExplicitMarker = raw !== variableName;
  const groups = isExplicitMarker ? [rawGroup, wrapped] : [wrapped, rawGroup];
  return groups.filter((group) => group.length > 0);
}

function extractVariableName(marker) {
  let value = String(marker || '').trim();
  const patterns = [
    /^\*{3}\{([\s\S]+)\}\*{3}$/,
    /^\{([\s\S]+)\}$/,
    /^\u3010([\s\S]+)\u3011$/,
    /^\*{3}([\s\S]+)\*{3}$/,
  ];

  for (const pattern of patterns) {
    const match = value.match(pattern);
    if (match) {
      value = match[1].trim();
      break;
    }
  }

  return value;
}

function resolveStageLimit(body, uploadedFiles) {
  const requested = Number(body.stageCount);
  const detectedIndexes = [];

  for (const key of Object.keys(body || {})) {
    const match = /^(?:prompt|mode)_(\d+)$/.exec(key);
    if (match) detectedIndexes.push(Number(match[1]));
  }

  for (const file of uploadedFiles || []) {
    const match = /^files_(\d+)$/.exec(file.fieldname || '');
    if (match) detectedIndexes.push(Number(match[1]));
  }

  const detected = detectedIndexes.length ? Math.max(...detectedIndexes) : 1;
  const count = Number.isInteger(requested) && requested > 0 ? requested : detected;
  return Math.max(1, Math.min(MAX_STAGES, count));
}

function resolveResumeFromStage(body, stageLimit) {
  const requested = Number(body.resumeFromStage);
  if (!Number.isInteger(requested) || requested < 1) return 1;
  return Math.max(1, Math.min(stageLimit, requested));
}

function workflowPathFromName(name) {
  const cleanName = String(name || '').trim();
  if (!cleanName) {
    throw new Error('工作流名称为空。');
  }
  return path.join(WORKFLOWS_DIR, `${encodeURIComponent(cleanName)}.json`);
}

function pathFromBase(basePath, ...segments) {
  return basePath ? path.join(basePath, ...segments) : '';
}

function findExistingPath(paths) {
  return paths.find((candidate) => candidate && fs.existsSync(candidate)) || '';
}

function resolveCustomBrowserPort(executablePath) {
  const normalized = String(executablePath || '').toLowerCase();
  return CUSTOM_BROWSER_PORT_BASE + Math.abs(hashString(normalized) % 500);
}

function resolveIsolatedBrowserPort(executablePath, userDataDir) {
  const normalized = `${String(executablePath || '').toLowerCase()}|${String(userDataDir || '').toLowerCase()}`;
  return ISOLATED_BROWSER_PORT_BASE + Math.abs(hashString(normalized) % 20000);
}

function hashString(value) {
  let hash = 0;
  const normalized = String(value || '');
  for (let index = 0; index < normalized.length; index += 1) {
    hash = ((hash << 5) - hash + normalized.charCodeAt(index)) | 0;
  }
  return hash;
}

function normalizeProfileMode(value) {
  return String(value || '').toLowerCase() === 'system' ? 'system' : 'isolated';
}

function parseBoolean(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

function normalizeProfileName(value, fallback = 'Default') {
  const clean = safeFileName(String(value || '').trim()).replace(/^\.+$/, '').trim();
  return clean || fallback;
}

function browserProfileFolderName(type, executablePath) {
  if (type !== 'custom') return normalizeProfileName(type, 'browser');
  const parsed = path.parse(executablePath || '');
  return `custom-${normalizeProfileName(parsed.name, 'browser')}`;
}

function safeFileName(name) {
  return name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').slice(0, 120);
}

async function cleanupUploadedFiles(uploadedFiles) {
  for (const file of uploadedFiles || []) {
    if (file?.path && fs.existsSync(file.path)) {
      await fsp.unlink(file.path).catch(() => {});
    }
  }
}

function logLine(message) {
  const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  return `[${time}] ${message}`;
}

function stageDisplayName(stage) {
  const name = String(stage?.name || '').trim();
  return name ? `阶段 ${stage.index}（${name}）` : `阶段 ${stage.index}`;
}

function normalizeError(error) {
  if (!error) return '未知错误';
  if (typeof error === 'string') return error;
  return error.message || String(error);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
