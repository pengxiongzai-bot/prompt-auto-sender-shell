const DEFAULT_STAGE_COUNT = 1;
const MAX_STAGES = 100;
const WORKFLOW_NEW_VALUE = '__new_workflow__';
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
const BASE_DRAFT_KEY = 'prompt-auto-sender-draft-v2';
const WORKSPACES_KEY = 'prompt-auto-sender-workspaces-v1';
const ACTIVE_WORKSPACE_KEY = 'prompt-auto-sender-active-workspace-v1';
const WORKBENCH_ID = getWorkbenchId();
const DRAFT_KEY = WORKBENCH_ID === 'default' ? BASE_DRAFT_KEY : `${BASE_DRAFT_KEY}:${WORKBENCH_ID}`;
const MONITOR_COLLAPSED_KEY = WORKBENCH_ID === 'default'
  ? 'prompt-auto-sender-monitor-collapsed-v1'
  : `prompt-auto-sender-monitor-collapsed-v1:${WORKBENCH_ID}`;
const CLIENT_ID = createClientId();
const CLIENT_HEARTBEAT_MS = 2500;
const JOB_POLL_FAILURE_LIMIT = 5;
const JOB_POLL_FAILURE_LOG_INTERVAL = 10;

const form = document.querySelector('#stage-form');
const template = document.querySelector('#stage-template');
const canvasEl = document.querySelector('#workflow-canvas');
const linksEl = document.querySelector('#node-links');
const workspaceTabsEl = document.querySelector('#workspace-tabs');
const addWorkspaceTabButton = document.querySelector('#add-workspace-tab');
const browserTypeEl = document.querySelector('#browser-type');
const browserPathEl = document.querySelector('#browser-path');
const browserHintEl = document.querySelector('#browser-hint');
const browserPathHintEl = document.querySelector('#browser-path-hint');
const profileModeEl = document.querySelector('#profile-mode');
const isolatedProfileNameEl = document.querySelector('#isolated-profile-name');
const isolatedProfileHintEl = document.querySelector('#isolated-profile-hint');
const profileDirectoryEl = document.querySelector('#profile-directory');
const systemProfileHintEl = document.querySelector('#system-profile-hint');
const targetPlatformEl = document.querySelector('#target-platform');
const targetUrlEl = document.querySelector('#target-url');
const targetHintEl = document.querySelector('#target-hint');
const openChatGPTButton = document.querySelector('#open-chatgpt');
const startButton = document.querySelector('#start-run');
const stopButton = document.querySelector('#stop-run');
const clearPageButton = document.querySelector('#clear-page');
const clearLogButton = document.querySelector('#clear-log');
const workflowNameEl = document.querySelector('#workflow-name');
const workflowSelectEl = document.querySelector('#workflow-select');
const saveWorkflowButton = document.querySelector('#save-workflow');
const loadWorkflowButton = document.querySelector('#load-workflow');
const deleteWorkflowButton = document.querySelector('#delete-workflow');
const refreshWorkflowButton = document.querySelector('#refresh-workflows');
const statusEl = document.querySelector('#job-status');
const currentStageEl = document.querySelector('#current-stage');
const progressEl = document.querySelector('#stage-progress');
const queueListEl = document.querySelector('#queue-list');
const addTaskPageButton = document.querySelector('#add-task-page');
const taskPageStatusEl = document.querySelector('#task-page-status');
const taskFormPanelEl = document.querySelector('#task-form-panel');
const taskFormToggleButton = document.querySelector('#task-form-toggle');
const taskFormBodyEl = document.querySelector('#task-form-body');
const taskFormFieldsEl = document.querySelector('#task-form-fields');
const taskCommonFilesEl = document.querySelector('#task-common-files');
const taskCommonFileListEl = document.querySelector('#task-common-file-list');
const taskFormStageAssetsEl = document.querySelector('#task-form-stage-assets');
const monitorDrawerEl = document.querySelector('#monitor-drawer');
const monitorToggleButton = document.querySelector('#monitor-toggle');
const monitorSummaryEl = document.querySelector('#monitor-summary');
const monitorToggleIconEl = document.querySelector('.monitor-toggle-icon');
const logBox = document.querySelector('#log-box');

let activeJobId = null;
let pollTimer = null;
let isPolling = false;
let draftTimer = null;
let isRestoringDraft = false;
let isRestartingTask = false;
let isSavingWorkflow = false;
let browserCatalog = readBrowserOptionsFromSelect();
let targetCatalog = readTargetOptionsFromSelect();
let workspaces = [];
let activeWorkspaceId = '';
const runtimeFilesByWorkspace = new Map();
const runtimeTaskFormFilesByWorkspace = new Map();
const jobPollFailures = new Map();
let taskFormRenderTimer = null;
let isRenderingTaskForm = false;
let isApplyingTaskForm = false;
let isTaskFormCollapsed = false;

const restoredDraft = restoreWorkspaceState();
bindEvents();
initMonitorDrawer();
initBrowserOptions();
initTargetOptions();
renderWorkflowOptions(getActiveWorkspace()?.draft?.workflowName || '');
initCanvasLinks();
renderWorkspaceTabs();
ensurePolling();
if (restoredDraft) {
  appendLog('已恢复上次页面状态。图片需要重新选择。');
}

function initStages(count = DEFAULT_STAGE_COUNT) {
  cleanupAllFilePreviews();
  form.innerHTML = '';
  for (let index = 0; index < count; index += 1) {
    addStageAfter(null, null, { silent: true });
  }
  renumberStages();
  renderTaskFormPanel();
  requestAnimationFrame(drawNodeLinks);
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

function normalizeVisibleModules(visible = {}) {
  const fallback = createDefaultStageVisibility();
  return STAGE_MODULE_KEYS.reduce((result, key) => {
    result[key] = visible?.[key] !== undefined ? visible[key] !== false : fallback[key];
    return result;
  }, {});
}

function getStageLayout(card) {
  const select = card?.querySelector('.stage-layout-mode');
  const mode = select?.value || DEFAULT_STAGE_LAYOUT_MODE;
  if (mode !== 'custom' && STAGE_LAYOUT_PRESETS[mode]) {
    return { layoutMode: mode, visible: { ...STAGE_LAYOUT_PRESETS[mode] } };
  }

  const visible = {};
  for (const key of STAGE_MODULE_KEYS) {
    const checkbox = card.querySelector(`.stage-module-toggle[data-module="${key}"]`);
    visible[key] = checkbox ? checkbox.checked : createDefaultStageVisibility()[key];
  }
  return { layoutMode: 'custom', visible: normalizeVisibleModules(visible) };
}

function normalizeStageHeight(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return null;
  return Math.max(STAGE_MIN_HEIGHT, Math.min(STAGE_MAX_HEIGHT, Math.round(number)));
}

function applyStageHeight(card, value) {
  if (!card) return null;
  const height = normalizeStageHeight(value);
  if (!height) {
    delete card.dataset.stageHeight;
    card.style.removeProperty('--stage-custom-height');
    card.classList.remove('is-custom-height');
    return null;
  }

  card.dataset.stageHeight = String(height);
  card.style.setProperty('--stage-custom-height', `${height}px`);
  card.classList.add('is-custom-height');
  return height;
}

function getStageHeight(card) {
  return normalizeStageHeight(card?.dataset.stageHeight);
}

function bindStageResize(card, handle) {
  if (!card || !handle) return;

  handle.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const startY = event.clientY;
    const startHeight = card.getBoundingClientRect().height;

    const onMove = (moveEvent) => {
      applyStageHeight(card, startHeight + moveEvent.clientY - startY);
      requestAnimationFrame(drawNodeLinks);
    };

    const onUp = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onUp);
      card.classList.remove('is-resizing');
      queueSaveDraft();
      requestAnimationFrame(drawNodeLinks);
    };

    card.classList.add('is-resizing');
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp, { once: true });
    document.addEventListener('pointercancel', onUp, { once: true });
  });

  handle.addEventListener('dblclick', () => {
    applyStageHeight(card, null);
    queueSaveDraft();
    requestAnimationFrame(drawNodeLinks);
  });
}

function setStageCustomOptions(card, visible) {
  const normalized = normalizeVisibleModules(visible);
  for (const key of STAGE_MODULE_KEYS) {
    const checkbox = card.querySelector(`.stage-module-toggle[data-module="${key}"]`);
    if (checkbox) checkbox.checked = normalized[key];
  }
}

function applyStageModuleVisibility(card) {
  if (!card) return;
  const layout = getStageLayout(card);
  const customOptions = card.querySelector('.stage-module-options');
  customOptions?.classList.toggle('hidden', layout.layoutMode !== 'custom');

  for (const key of STAGE_MODULE_KEYS) {
    card.querySelectorAll(`[data-stage-module="${key}"]`).forEach((element) => {
      element.classList.toggle('is-module-hidden', !layout.visible[key]);
    });
  }

  const activeCount = STAGE_MODULE_KEYS.filter((key) => layout.visible[key]).length;
  card.style.setProperty('--stage-visible-columns', String(Math.max(activeCount, 1)));
  card.dataset.layoutMode = layout.layoutMode;
  card.dataset.visibleModules = JSON.stringify(layout.visible);
  card.classList.toggle('is-single-module', activeCount <= 1);
  card.classList.toggle('has-replacements-hidden', !layout.visible.replacements);
  card.classList.toggle('has-preview-hidden', !layout.visible.preview);
  card.classList.toggle('has-source-hidden', !layout.visible.source);
  card.classList.toggle('has-files-hidden', !layout.visible.files);
  requestAnimationFrame(drawNodeLinks);
}

function getStageEffectiveModules(card) {
  if (!card) return createDefaultStageVisibility();
  try {
    const stored = card.dataset.visibleModules ? JSON.parse(card.dataset.visibleModules) : null;
    if (stored) return normalizeVisibleModules(stored);
  } catch (_error) {
    // Fall through to live controls.
  }
  return getStageLayout(card).visible;
}

function getStageEffectivePrompt(card) {
  const visible = getStageEffectiveModules(card);
  if (!visible.source) return '';
  return card.querySelector('.stage-prompt')?.value || '';
}

function getStageEffectiveFiles(card) {
  const visible = getStageEffectiveModules(card);
  if (!visible.files) return [];
  return getSelectedFiles(card.querySelector('.stage-files'));
}

function createStageNode(stage = {}) {
  const node = template.content.cloneNode(true);
  const card = node.querySelector('.stage-card');
  const promptEl = node.querySelector('.stage-prompt');
  const templatePromptEl = node.querySelector('.stage-template-prompt');
  const replacementListEl = node.querySelector('.replacement-list');
  const addReplacementButton = node.querySelector('.add-replacement-button');
  const filesEl = node.querySelector('.stage-files');
  const fileZoneEl = node.querySelector('.file-zone');
  const nameEl = node.querySelector('.stage-name');
  const modeEl = node.querySelector('.stage-mode');
  const fileListEl = node.querySelector('.file-list');
  const addButton = node.querySelector('.add-stage-button');
  const removeButton = node.querySelector('.stage-remove-button');
  const resizeHandle = node.querySelector('.stage-resize-handle');
  const layoutModeEl = node.querySelector('.stage-layout-mode');
  const moduleToggleEls = [...node.querySelectorAll('.stage-module-toggle')];

  nameEl.value = stage.name || stage.stageName || '';
  templatePromptEl.value = stage.templatePrompt ?? stage.sourcePrompt ?? stage.prompt ?? '';
  modeEl.value = 'send';
  const stageVisibility = normalizeStageVisibility(stage);
  layoutModeEl.value = stageVisibility.layoutMode;
  setStageCustomOptions(card, stageVisibility.visible);
  applyStageHeight(card, stage.height ?? stage.cardHeight ?? stage.stageHeight);

  nameEl.addEventListener('input', () => {
    queueRenderTaskForm();
    queueSaveDraft();
  });
  templatePromptEl.addEventListener('input', () => {
    updateGeneratedPrompt(card);
    queueSaveDraft();
  });
  filesEl.addEventListener('change', () => appendSelectedFiles(filesEl, fileListEl, [...filesEl.files]));
  filesEl.addEventListener('change', queueSaveDraft);
  bindFileDropZone(fileZoneEl, filesEl, fileListEl, queueSaveDraft);
  addReplacementButton.addEventListener('click', () => {
    addReplacementRow(replacementListEl, {}, card);
    updateGeneratedPrompt(card);
    queueRenderTaskForm();
    queueSaveDraft();
    requestAnimationFrame(drawNodeLinks);
  });

  layoutModeEl.addEventListener('change', () => {
    if (layoutModeEl.value === 'custom') {
      const previousVisible = card.dataset.visibleModules
        ? normalizeVisibleModules(JSON.parse(card.dataset.visibleModules))
        : createDefaultStageVisibility();
      setStageCustomOptions(card, previousVisible);
    } else {
      setStageCustomOptions(card, STAGE_LAYOUT_PRESETS[layoutModeEl.value] || createDefaultStageVisibility());
    }
    applyStageModuleVisibility(card);
    updateGeneratedPrompt(card);
    queueRenderTaskForm();
    queueSaveDraft();
  });

  for (const toggle of moduleToggleEls) {
    toggle.addEventListener('change', () => {
      applyStageModuleVisibility(card);
      updateGeneratedPrompt(card);
      queueRenderTaskForm();
      queueSaveDraft();
    });
  }

  const replacements = Array.isArray(stage.replacements) ? stage.replacements : [];
  if (replacements.length) {
    for (const replacement of replacements) {
      addReplacementRow(replacementListEl, replacement, card);
    }
  } else {
    addReplacementRow(replacementListEl, {}, card);
  }
  applyStageModuleVisibility(card);
  updateGeneratedPrompt(card);

  addButton.addEventListener('click', () => addStageAfter(card));
  removeButton.addEventListener('click', () => removeStage(card));
  bindStageResize(card, resizeHandle);
  return node;
}

function addReplacementRow(listEl, replacement = {}, card = null) {
  const row = document.createElement('div');
  row.className = 'replacement-row';

  const markerInput = document.createElement('textarea');
  markerInput.className = 'replacement-marker';
  markerInput.rows = 3;
  markerInput.placeholder = '变量名 / 原内容';
  markerInput.title = '直接填写要被替换的原文或变量名；系统会自动兼容原文、{原文}、【原文】、***{原文}***';
  markerInput.value = replacement.marker ?? replacement.key ?? replacement.placeholder ?? '';

  const valueInput = document.createElement('textarea');
  valueInput.className = 'replacement-value';
  valueInput.placeholder = '替换内容';
  valueInput.title = '填写要替换进去的新内容';
  valueInput.value = replacement.value ?? replacement.content ?? '';

  const statusEl = document.createElement('div');
  statusEl.className = 'replacement-status is-idle';
  statusEl.textContent = '未填写变量';

  const removeButton = document.createElement('button');
  removeButton.type = 'button';
  removeButton.className = 'replacement-remove-button';
  removeButton.textContent = '×';
  removeButton.title = '删除这一条替换规则';
  removeButton.setAttribute('aria-label', '删除这一条替换规则');

  const sync = () => {
    const stageCard = card || listEl.closest('.stage-card');
    updateGeneratedPrompt(stageCard);
    queueRenderTaskForm();
    queueSaveDraft();
    requestAnimationFrame(drawNodeLinks);
  };

  markerInput.addEventListener('input', sync);
  valueInput.addEventListener('input', sync);
  removeButton.addEventListener('click', () => {
    row.remove();
    if (!listEl.querySelector('.replacement-row')) {
      addReplacementRow(listEl, {}, card || listEl.closest('.stage-card'));
    }
    sync();
  });

  row.append(markerInput, valueInput, removeButton, statusEl);
  listEl.appendChild(row);
}

function updateGeneratedPrompt(card) {
  if (!card) return;
  const templatePromptEl = card.querySelector('.stage-template-prompt');
  const promptEl = card.querySelector('.stage-prompt');
  if (!templatePromptEl || !promptEl) return;
  const visible = getStageEffectiveModules(card);
  const sourceText = visible.source ? templatePromptEl.value : '';
  const replacements = visible.replacements ? collectStageReplacementRows(card) : [];
  const analysis = analyzePromptReplacements(sourceText, replacements);
  promptEl.value = analysis.output;
  if (visible.replacements) {
    updateReplacementStatuses(card, analysis.details);
  } else {
    updateReplacementStatuses(card, []);
  }
}

function refreshAllGeneratedPrompts() {
  for (const card of getStageCards()) {
    updateGeneratedPrompt(card);
  }
}

function applyPromptReplacements(templateText, replacements = []) {
  return analyzePromptReplacements(templateText, replacements).output;
}

function analyzePromptReplacements(templateText, replacements = []) {
  let output = String(templateText || '');
  const details = [];
  const pendingValues = [];
  for (const replacement of replacements) {
    const marker = String(replacement.marker || '');
    const value = String(replacement.value ?? '');
    const candidateGroups = buildReplacementCandidateGroups(marker);
    const candidates = [...new Set(candidateGroups.flat())];
    const detail = {
      marker,
      value,
      candidates,
      matchedMarkers: [],
      count: 0,
      expectedMarker: marker.trim() || candidates[0] || marker,
    };
    if (!marker.trim()) {
      details.push(detail);
      continue;
    }
    const temporaryToken = `\uE000REPLACE_${details.length}\uE001`;
    for (const group of candidateGroups) {
      let groupCount = 0;
      for (const candidate of group) {
        const count = countOccurrences(output, candidate);
        if (!count) continue;
        output = output.split(candidate).join(temporaryToken);
        detail.count += count;
        groupCount += count;
        detail.matchedMarkers.push(candidate);
      }
      if (groupCount > 0) break;
    }
    if (detail.count > 0) {
      pendingValues.push({ token: temporaryToken, value });
    }
    details.push(detail);
  }
  for (const item of pendingValues) {
    output = output.split(item.token).join(item.value);
  }
  return { output, details };
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
    `【${variableName}】`,
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
    /^【([\s\S]+)】$/,
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

function countOccurrences(text, search) {
  if (!search) return 0;
  return String(text || '').split(search).length - 1;
}

function updateReplacementStatuses(card, details = []) {
  const rows = [...card.querySelectorAll('.replacement-row')];
  rows.forEach((row, index) => {
    const statusEl = row.querySelector('.replacement-status');
    if (!statusEl) return;
    const detail = details[index] || {};
    statusEl.classList.remove('is-hit', 'is-miss', 'is-idle');
    row.classList.remove('is-hit', 'is-miss');
    if (!String(detail.marker || '').trim()) {
      statusEl.classList.add('is-idle');
      statusEl.textContent = '未填写变量';
      statusEl.title = '';
      return;
    }
    if (detail.count > 0) {
      const markers = detail.matchedMarkers.join(' / ');
      statusEl.classList.add('is-hit');
      row.classList.add('is-hit');
      statusEl.textContent = `已命中 ${detail.count} 处：${markers}`;
      statusEl.title = `实际替换标记：${markers}`;
      return;
    }
    const expected = detail.expectedMarker || detail.marker || '';
    statusEl.classList.add('is-miss');
    row.classList.add('is-miss');
    statusEl.textContent = `未命中：${expected}`;
    statusEl.title = `原提示词中没有找到：${detail.candidates?.join(' / ') || expected}`;
  });
}

function collectStageReplacementRows(card) {
  return [...card.querySelectorAll('.replacement-row')]
    .map((row) => ({
      marker: row.querySelector('.replacement-marker')?.value || '',
      value: row.querySelector('.replacement-value')?.value || '',
    }));
}

function collectStageReplacements(card) {
  return collectStageReplacementRows(card)
    .filter((replacement) => replacement.marker || replacement.value);
}

function initTaskFormPanel() {
  if (!taskFormPanelEl) return;
  taskFormToggleButton?.addEventListener('click', () => {
    setTaskFormCollapsed(!isTaskFormCollapsed);
  });

  if (taskCommonFilesEl && taskCommonFileListEl) {
    taskCommonFilesEl.addEventListener('change', () => {
      appendSelectedFiles(taskCommonFilesEl, taskCommonFileListEl, [...taskCommonFilesEl.files]);
      queueSaveDraft();
    });
    bindFileDropZone(taskCommonFilesEl.closest('.file-zone'), taskCommonFilesEl, taskCommonFileListEl, queueSaveDraft);
  }
}

function setTaskFormCollapsed(isCollapsed) {
  isTaskFormCollapsed = Boolean(isCollapsed);
  taskFormPanelEl?.classList.toggle('is-collapsed', isTaskFormCollapsed);
  if (taskFormToggleButton) {
    taskFormToggleButton.textContent = isTaskFormCollapsed ? '展开' : '收起';
    taskFormToggleButton.setAttribute('aria-expanded', String(!isTaskFormCollapsed));
  }
  requestAnimationFrame(drawNodeLinks);
}

function createDefaultTaskFormState(stageCount = DEFAULT_STAGE_COUNT) {
  return {
    stageUseCommonFiles: Array.from({ length: Math.max(1, stageCount) }, () => true),
  };
}

function normalizeTaskFormState(state = {}, stageCount = getStageCards().length || DEFAULT_STAGE_COUNT) {
  const source = state && typeof state === 'object' ? state : {};
  const useCommon = Array.isArray(source.stageUseCommonFiles) ? source.stageUseCommonFiles : [];
  const count = Math.max(1, Number(stageCount) || DEFAULT_STAGE_COUNT);
  return {
    stageUseCommonFiles: Array.from({ length: count }, (_item, index) => useCommon[index] !== false),
  };
}

function queueRenderTaskForm() {
  if (isApplyingTaskForm) return;
  clearTimeout(taskFormRenderTimer);
  taskFormRenderTimer = setTimeout(() => renderTaskFormPanel(), 80);
}

function renderTaskFormPanel(state = null) {
  if (!taskFormPanelEl || !taskFormFieldsEl || !taskFormStageAssetsEl) return;
  if (isRenderingTaskForm) return;
  const workspace = getActiveWorkspace();
  const task = getActiveTask(workspace);
  if (!isRestoringDraft) {
    snapshotTaskFormRuntimeFiles(workspace, task);
  }

  isRenderingTaskForm = true;
  try {
    const stageCards = getStageCards();
    const taskFormState = normalizeTaskFormState(state || task?.draft?.taskForm, stageCards.length);
    renderTaskVariableFields(collectTaskFormFields());
    renderTaskStageAssets(stageCards, taskFormState);
  } finally {
    isRenderingTaskForm = false;
  }

  restoreTaskFormFiles(workspace?.id, task?.id);
}

function renderTaskVariableFields(fields) {
  taskFormFieldsEl.innerHTML = '';
  if (!fields.length) {
    taskFormFieldsEl.appendChild(createTaskFormEmpty('暂无变量'));
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const field of fields) {
    const row = document.createElement('div');
    row.className = 'task-field-row';
    row.dataset.fieldKey = field.key;

    const label = document.createElement('div');
    label.className = 'task-field-label';
    const title = document.createElement('strong');
    title.textContent = field.key;
    title.title = field.key;
    const meta = document.createElement('div');
    meta.className = 'task-field-meta';
    meta.textContent = `用于阶段：${field.stageLabels.join('、')}`;
    label.append(title, meta);

    const value = document.createElement('textarea');
    value.className = 'task-field-value';
    value.placeholder = '填写内容';
    value.value = field.value;
    value.addEventListener('input', () => applyTaskFieldValue(field.key, value.value));

    row.append(label, value);
    fragment.appendChild(row);
  }
  taskFormFieldsEl.appendChild(fragment);
}

function renderTaskStageAssets(stageCards, taskFormState) {
  cleanupTaskFormStagePreviews();
  taskFormStageAssetsEl.innerHTML = '';
  if (!stageCards.length) {
    taskFormStageAssetsEl.appendChild(createTaskFormEmpty('暂无阶段'));
    return;
  }

  const fragment = document.createDocumentFragment();
  stageCards.forEach((card, index) => {
    const stageIndex = index + 1;
    const stageName = card.querySelector('.stage-name')?.value?.trim() || `阶段 ${stageIndex}`;
    const row = document.createElement('div');
    row.className = 'task-stage-asset-row';
    row.dataset.stageIndex = String(stageIndex);

    const head = document.createElement('div');
    head.className = 'task-stage-asset-head';
    const titleWrap = document.createElement('div');
    const title = document.createElement('strong');
    title.className = 'task-stage-asset-title';
    title.textContent = `${String(stageIndex).padStart(2, '0')} ${stageName}`;
    title.title = title.textContent;
    const meta = document.createElement('div');
    meta.className = 'task-stage-asset-meta';
    meta.textContent = '阶段专属素材';
    titleWrap.append(title, meta);

    const toggle = document.createElement('label');
    toggle.className = 'task-stage-common-toggle';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'task-form-use-common';
    checkbox.checked = taskFormState.stageUseCommonFiles[index] !== false;
    checkbox.addEventListener('change', queueSaveDraft);
    toggle.append(checkbox, document.createTextNode('带公共素材'));
    head.append(titleWrap, toggle);

    const zone = document.createElement('label');
    zone.className = 'file-zone task-stage-file-zone';
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.className = 'task-stage-form-files';
    const zoneTitle = document.createElement('span');
    zoneTitle.textContent = '选择图片 / 文件';
    const small = document.createElement('small');
    small.textContent = '点击 / 拖入文件夹';
    const fileList = document.createElement('div');
    fileList.className = 'file-list task-stage-file-list';
    fileList.textContent = '未选择文件';
    zone.append(input, zoneTitle, small, fileList);

    input.addEventListener('change', () => {
      appendSelectedFiles(input, fileList, [...input.files]);
      queueSaveDraft();
    });
    bindFileDropZone(zone, input, fileList, queueSaveDraft);

    row.append(head, zone);
    fragment.appendChild(row);
  });
  taskFormStageAssetsEl.appendChild(fragment);
}

function createTaskFormEmpty(text) {
  const empty = document.createElement('div');
  empty.className = 'task-form-empty';
  empty.textContent = text;
  return empty;
}

function collectTaskFormFields() {
  const fields = new Map();
  for (const card of getStageCards()) {
    const visible = getStageEffectiveModules(card);
    if (!visible.replacements) continue;
    const stageIndex = Number(card.dataset.index || 0);
    const stageName = card.querySelector('.stage-name')?.value?.trim();
    const stageLabel = stageName ? `${stageIndex} ${stageName}` : String(stageIndex);
    for (const row of card.querySelectorAll('.replacement-row')) {
      const marker = row.querySelector('.replacement-marker')?.value?.trim() || '';
      if (!marker) continue;
      const key = extractVariableName(marker) || marker;
      if (!key) continue;
      if (!fields.has(key)) {
        fields.set(key, {
          key,
          markers: new Set(),
          stageLabels: [],
          value: '',
        });
      }
      const field = fields.get(key);
      field.markers.add(marker);
      if (!field.stageLabels.includes(stageLabel)) field.stageLabels.push(stageLabel);
      const value = row.querySelector('.replacement-value')?.value || '';
      if (!field.value && value) field.value = value;
    }
  }
  return [...fields.values()].sort((left, right) => naturalCompare(left.key, right.key));
}

function applyTaskFieldValue(fieldKey, value) {
  isApplyingTaskForm = true;
  let touched = false;
  try {
    for (const card of getStageCards()) {
      if (!getStageEffectiveModules(card).replacements) continue;
      let stageTouched = false;
      for (const row of card.querySelectorAll('.replacement-row')) {
        const markerInput = row.querySelector('.replacement-marker');
        const valueInput = row.querySelector('.replacement-value');
        const marker = markerInput?.value?.trim() || '';
        const key = extractVariableName(marker) || marker;
        if (!key || key !== fieldKey || !valueInput) continue;
        valueInput.value = value;
        stageTouched = true;
        touched = true;
      }
      if (stageTouched) updateGeneratedPrompt(card);
    }
  } finally {
    isApplyingTaskForm = false;
  }
  if (touched) {
    queueSaveDraft();
    requestAnimationFrame(drawNodeLinks);
  }
}

function collectTaskFormState() {
  const stageCount = getStageCards().length || DEFAULT_STAGE_COUNT;
  const state = createDefaultTaskFormState(stageCount);
  if (!taskFormStageAssetsEl) return state;
  for (const row of taskFormStageAssetsEl.querySelectorAll('.task-stage-asset-row')) {
    const index = Number(row.dataset.stageIndex || 0) - 1;
    if (index < 0 || index >= stageCount) continue;
    state.stageUseCommonFiles[index] = row.querySelector('.task-form-use-common')?.checked !== false;
  }
  return state;
}

function snapshotTaskFormRuntimeFiles(workspace = getActiveWorkspace(), task = getActiveTask(workspace)) {
  if (!workspace || !task) return;
  runtimeTaskFormFilesByWorkspace.set(getTaskFileKey(workspace.id, task.id), collectTaskFormFiles());
}

function collectTaskFormFiles() {
  const stageCount = getStageCards().length || DEFAULT_STAGE_COUNT;
  const stageFiles = Array.from({ length: stageCount }, () => []);
  if (taskFormStageAssetsEl) {
    for (const row of taskFormStageAssetsEl.querySelectorAll('.task-stage-asset-row')) {
      const index = Number(row.dataset.stageIndex || 0) - 1;
      if (index < 0 || index >= stageFiles.length) continue;
      const input = row.querySelector('.task-stage-form-files');
      stageFiles[index] = getSelectedFiles(input);
    }
  }
  return {
    common: getSelectedFiles(taskCommonFilesEl),
    stages: stageFiles,
  };
}

function restoreTaskFormFiles(workspaceId, taskId) {
  const fileSets = runtimeTaskFormFilesByWorkspace.get(getTaskFileKey(workspaceId, taskId)) || { common: [], stages: [] };
  if (taskCommonFilesEl && taskCommonFileListEl) {
    setSelectedFiles(taskCommonFilesEl, taskCommonFileListEl, fileSets.common || []);
  }
  if (!taskFormStageAssetsEl) return;
  for (const row of taskFormStageAssetsEl.querySelectorAll('.task-stage-asset-row')) {
    const index = Number(row.dataset.stageIndex || 0) - 1;
    const input = row.querySelector('.task-stage-form-files');
    const fileList = row.querySelector('.task-stage-file-list');
    setSelectedFiles(input, fileList, fileSets.stages?.[index] || []);
  }
}

function getSelectedFiles(input) {
  if (!input) return [];
  return [...(input._selectedFiles || input.files || [])];
}

function cleanupTaskFormStagePreviews() {
  if (!taskFormStageAssetsEl) return;
  for (const fileListEl of taskFormStageAssetsEl.querySelectorAll('.task-stage-file-list')) {
    resetFilePreview(fileListEl);
  }
}

function clearTaskFormFiles(workspace = getActiveWorkspace(), task = getActiveTask(workspace)) {
  if (workspace && task) runtimeTaskFormFilesByWorkspace.delete(getTaskFileKey(workspace.id, task.id));
  if (taskCommonFilesEl && taskCommonFileListEl) {
    setSelectedFiles(taskCommonFilesEl, taskCommonFileListEl, []);
  }
  if (!taskFormStageAssetsEl) return;
  for (const row of taskFormStageAssetsEl.querySelectorAll('.task-stage-asset-row')) {
    setSelectedFiles(row.querySelector('.task-stage-form-files'), row.querySelector('.task-stage-file-list'), []);
  }
}

function applyTaskFormToStageCards() {
  if (!taskFormPanelEl) return;
  snapshotTaskFormRuntimeFiles();
  const formFiles = collectTaskFormFiles();
  const formState = collectTaskFormState();
  const commonFiles = formFiles.common || [];

  getStageCards().forEach((card, index) => {
    const filesEl = card.querySelector('.stage-files');
    const fileListEl = card.querySelector('.file-list');
    if (!filesEl || !fileListEl) return;
    const priorMaterialized = filesEl._taskFormMaterializedSignatures || new Set();
    const directFiles = getSelectedFiles(filesEl)
      .filter((file) => !priorMaterialized.has(fileSignature(file)));
    const nextFormFiles = [];
    if (formState.stageUseCommonFiles[index] !== false) nextFormFiles.push(...commonFiles);
    nextFormFiles.push(...(formFiles.stages[index] || []));
    const materializedFiles = mergeFiles([], nextFormFiles);
    const nextFiles = mergeFiles(directFiles, materializedFiles);
    setSelectedFiles(filesEl, fileListEl, nextFiles);
    filesEl._taskFormMaterializedSignatures = new Set(materializedFiles.map(fileSignature));
  });
  refreshAllGeneratedPrompts();
}

function bindFileDropZone(fileZoneEl, filesEl, fileListEl, onFilesChanged = null) {
  for (const eventName of ['dragenter', 'dragover']) {
    fileZoneEl.addEventListener(eventName, (event) => {
      event.preventDefault();
      event.stopPropagation();
      fileZoneEl.classList.add('is-dragging');
      event.dataTransfer.dropEffect = 'copy';
    });
  }

  for (const eventName of ['dragleave', 'drop']) {
    fileZoneEl.addEventListener(eventName, (event) => {
      event.preventDefault();
      event.stopPropagation();
      fileZoneEl.classList.remove('is-dragging');
    });
  }

  fileZoneEl.addEventListener('drop', async (event) => {
    try {
      const droppedFiles = await readDroppedFiles(event.dataTransfer);
      if (droppedFiles.length === 0) {
        appendLog('拖入内容中没有可用文件。');
        return;
      }
      appendSelectedFiles(filesEl, fileListEl, droppedFiles);
      if (typeof onFilesChanged === 'function') onFilesChanged(droppedFiles);
    } catch (error) {
      appendLog(`拖入文件夹读取失败：${error.message || error}`);
    }
  });
}

async function readDroppedFiles(dataTransfer) {
  if (!dataTransfer) return [];
  const items = [...(dataTransfer.items || [])];
  const entries = items
    .map((item) => (typeof item.webkitGetAsEntry === 'function' ? item.webkitGetAsEntry() : null))
    .filter(Boolean);
  const hasDirectory = entries.some((entry) => entry.isDirectory);

  if (!hasDirectory) {
    return [...(dataTransfer.files || [])];
  }

  const collected = [];
  for (const entry of sortFileEntries(entries)) {
    const files = await collectImageFilesFromEntry(entry, '');
    collected.push(...files);
  }
  return sortFilesByRelativePath(collected);
}

async function collectImageFilesFromEntry(entry, parentPath) {
  const relativePath = parentPath ? `${parentPath}/${entry.name}` : entry.name;

  if (entry.isFile) {
    const file = await fileFromEntry(entry);
    if (!isImageFile(file)) return [];
    attachRelativePath(file, relativePath);
    return [file];
  }

  if (!entry.isDirectory) return [];
  const children = await readAllDirectoryEntries(entry);
  const nestedFiles = [];
  for (const child of sortFileEntries(children)) {
    nestedFiles.push(...await collectImageFilesFromEntry(child, relativePath));
  }
  return nestedFiles;
}

function fileFromEntry(entry) {
  return new Promise((resolve, reject) => {
    entry.file(resolve, reject);
  });
}

function readAllDirectoryEntries(directoryEntry) {
  const reader = directoryEntry.createReader();
  const entries = [];

  return new Promise((resolve, reject) => {
    const readNext = () => {
      reader.readEntries((batch) => {
        if (!batch.length) {
          resolve(entries);
          return;
        }
        entries.push(...batch);
        readNext();
      }, reject);
    };
    readNext();
  });
}

function sortFileEntries(entries) {
  return [...entries].sort((left, right) => naturalCompare(left.name, right.name));
}

function sortFilesByRelativePath(files) {
  return [...files].sort((left, right) => {
    const leftPath = getFilePathForSort(left);
    const rightPath = getFilePathForSort(right);
    const depthDifference = getPathDepth(leftPath) - getPathDepth(rightPath);
    if (depthDifference !== 0) return depthDifference;
    return naturalCompare(leftPath, rightPath);
  });
}

function getFilePathForSort(file) {
  return file._relativePath || file.webkitRelativePath || file.name;
}

function getPathDepth(filePath) {
  return String(filePath || '').split('/').filter(Boolean).length;
}

function attachRelativePath(file, relativePath) {
  try {
    Object.defineProperty(file, '_relativePath', {
      value: relativePath,
      configurable: true,
    });
  } catch (_error) {
    file._relativePath = relativePath;
  }
}

function isImageFile(file) {
  if (file.type?.startsWith('image/')) return true;
  return /\.(avif|bmp|gif|heic|heif|jpe?g|png|svg|tiff?|webp)$/i.test(file.name || '');
}

function naturalCompare(left, right) {
  return String(left || '').localeCompare(String(right || ''), 'zh-CN', {
    numeric: true,
    sensitivity: 'base',
  });
}

function appendSelectedFiles(filesEl, fileListEl, additions) {
  const current = filesEl._selectedFiles || [];
  setSelectedFiles(filesEl, fileListEl, mergeFiles(current, additions));
}

function setSelectedFiles(filesEl, fileListEl, files) {
  const normalized = Array.isArray(files) ? files : [];
  const transfer = new DataTransfer();
  for (const file of normalized) {
    transfer.items.add(file);
  }
  filesEl.files = transfer.files;
  filesEl._selectedFiles = normalized;
  updateFileList(filesEl, fileListEl, normalized);
}

function mergeFiles(current, additions) {
  const merged = [...current];
  const seen = new Set(current.map(fileSignature));
  for (const file of additions || []) {
    const signature = fileSignature(file);
    if (seen.has(signature)) continue;
    seen.add(signature);
    merged.push(file);
  }
  return merged;
}

function fileSignature(file) {
  return `${getFilePathForSort(file)}|${file.size}|${file.lastModified}`;
}

function updateFileList(filesEl, fileListEl, selectedFiles = null) {
  const files = selectedFiles || filesEl._selectedFiles || [...filesEl.files];
  resetFilePreview(fileListEl);

  if (files.length === 0) {
    fileListEl.textContent = '未选择文件';
    requestAnimationFrame(drawNodeLinks);
    return;
  }

  fileListEl.closest('.file-zone')?.classList.add('has-files');

  const urls = [];
  const summary = document.createElement('div');
  summary.className = 'file-summary';
  summary.textContent = `已选择 ${files.length} 个文件，可继续点击添加`;

  const grid = document.createElement('div');
  grid.className = 'file-preview-grid';

  files.forEach((file, index) => {
    const item = document.createElement('div');
    item.className = 'file-preview-item';
    item.draggable = true;
    item.dataset.index = String(index);
    item.title = '拖拽缩略图调整发送顺序';
    bindFilePreviewDrag(item, filesEl, fileListEl);

    const media = document.createElement('div');
    media.className = 'file-preview-media';

    if (file.type.startsWith('image/')) {
      const image = document.createElement('img');
      const url = URL.createObjectURL(file);
      urls.push(url);
      image.src = url;
      image.alt = file.name;
      image.loading = 'lazy';
      media.appendChild(image);
    } else {
      const ext = file.name.includes('.') ? file.name.split('.').pop().slice(0, 5).toUpperCase() : 'FILE';
      const badge = document.createElement('span');
      badge.textContent = ext;
      media.classList.add('is-file');
      media.appendChild(badge);
    }

    const name = document.createElement('div');
    name.className = 'file-preview-name';
    name.title = file.name;
    name.textContent = file.name;

    const size = document.createElement('div');
    size.className = 'file-preview-size';
    size.textContent = formatFileSize(file.size);

    const removeButton = createFileControlButton('×', '删除', false, (event) => {
      event.preventDefault();
      event.stopPropagation();
      const nextFiles = (filesEl._selectedFiles || []).filter((_item, itemIndex) => itemIndex !== index);
      setSelectedFiles(filesEl, fileListEl, nextFiles);
    });
    removeButton.classList.add('file-remove-button');

    item.append(media, removeButton, name, size);
    grid.appendChild(item);
  });

  fileListEl._previewUrls = urls;
  fileListEl.append(summary, grid);
  requestAnimationFrame(drawNodeLinks);
}

function bindFilePreviewDrag(item, filesEl, fileListEl) {
  item.addEventListener('dragstart', (event) => {
    item.classList.add('is-dragging');
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', item.dataset.index || '');
  });

  item.addEventListener('dragend', () => {
    item.classList.remove('is-dragging');
    fileListEl.querySelectorAll('.file-preview-item.is-drop-before, .file-preview-item.is-drop-after')
      .forEach((node) => node.classList.remove('is-drop-before', 'is-drop-after'));
  });

  item.addEventListener('dragover', (event) => {
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'move';
    const placement = getDropPlacement(event, item);
    item.classList.toggle('is-drop-before', placement === 'before');
    item.classList.toggle('is-drop-after', placement === 'after');
  });

  item.addEventListener('dragleave', () => {
    item.classList.remove('is-drop-before', 'is-drop-after');
  });

  item.addEventListener('drop', (event) => {
    event.preventDefault();
    event.stopPropagation();
    const fromIndex = Number(event.dataTransfer.getData('text/plain'));
    const toIndex = Number(item.dataset.index);
    if (!Number.isInteger(fromIndex) || !Number.isInteger(toIndex) || fromIndex === toIndex) return;
    const placement = getDropPlacement(event, item);
    reorderSelectedFiles(filesEl, fileListEl, fromIndex, toIndex, placement);
  });
}

function getDropPlacement(event, item) {
  const rect = item.getBoundingClientRect();
  return event.clientX < rect.left + rect.width / 2 ? 'before' : 'after';
}

function reorderSelectedFiles(filesEl, fileListEl, fromIndex, toIndex, placement = 'before') {
  const current = [...(filesEl._selectedFiles || [])];
  if (fromIndex < 0 || fromIndex >= current.length || toIndex < 0 || toIndex >= current.length) return;
  const [moving] = current.splice(fromIndex, 1);
  let insertIndex = toIndex;
  if (fromIndex < toIndex) insertIndex -= 1;
  if (placement === 'after') insertIndex += 1;
  insertIndex = Math.max(0, Math.min(insertIndex, current.length));
  current.splice(insertIndex, 0, moving);
  setSelectedFiles(filesEl, fileListEl, current);
}

function createFileControlButton(label, title, disabled, handler) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'file-preview-button';
  button.textContent = label;
  button.title = title;
  button.setAttribute('aria-label', title);
  button.disabled = disabled;
  button.addEventListener('click', handler);
  return button;
}

function resetFilePreview(fileListEl) {
  for (const url of fileListEl._previewUrls || []) {
    URL.revokeObjectURL(url);
  }
  fileListEl._previewUrls = [];
  fileListEl.innerHTML = '';
  fileListEl.closest('.file-zone')?.classList.remove('has-files');
}

function cleanupAllFilePreviews() {
  for (const fileListEl of form.querySelectorAll('.file-list')) {
    resetFilePreview(fileListEl);
  }
}

function formatFileSize(size) {
  if (!Number.isFinite(size) || size <= 0) return '0 B';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function addStageAfter(afterCard = null, stage = null, options = {}) {
  if (getStageCards().length >= MAX_STAGES) {
    if (!options.silent) appendLog(`阶段数量已达到上限：${MAX_STAGES}`);
    return;
  }

  const node = createStageNode(stage || {});
  if (afterCard?.nextElementSibling) {
    form.insertBefore(node, afterCard.nextElementSibling);
  } else {
    form.appendChild(node);
  }

  renumberStages();
  if (!options.silent) queueRenderTaskForm();
  requestAnimationFrame(drawNodeLinks);
  if (!options.silent) queueSaveDraft();
}

function removeStage(card, options = {}) {
  if (!card) return;
  const cards = getStageCards();
  if (cards.length <= 1) {
    if (!options.silent) appendLog('至少保留 1 个阶段。');
    return;
  }

  resetFilePreview(card.querySelector('.file-list'));
  card.remove();
  renumberStages();
  if (!options.silent) queueRenderTaskForm();
  requestAnimationFrame(drawNodeLinks);
  if (!options.silent) queueSaveDraft();
}

function getStageCards() {
  return [...form.querySelectorAll('.stage-card')];
}

function renumberStages() {
  const cards = getStageCards();
  cards.forEach((card, arrayIndex) => {
    const index = arrayIndex + 1;
    card.dataset.index = String(index);
    card.querySelector('.stage-index').textContent = String(index).padStart(2, '0');
    card.querySelector('.stage-name').name = `stageName_${index}`;
    card.querySelector('.stage-prompt').name = `prompt_${index}`;
    card.querySelector('.stage-files').name = `files_${index}`;
    card.querySelector('.stage-mode').name = `mode_${index}`;
    card.querySelector('.stage-mode').value = 'send';
  });
  syncStageButtons();
}

function bindEvents() {
  registerClientLifecycle();
  initTaskFormPanel();
  addWorkspaceTabButton.addEventListener('click', createAndSwitchWorkspace);
  addTaskPageButton?.addEventListener('click', createAndSwitchTaskPage);
  monitorToggleButton?.addEventListener('click', toggleMonitorDrawer);
  browserTypeEl.addEventListener('change', syncBrowserPathVisibility);
  browserTypeEl.addEventListener('change', queueSaveDraft);
  browserPathEl.addEventListener('input', queueSaveDraft);
  profileModeEl.addEventListener('change', syncBrowserPathVisibility);
  profileModeEl.addEventListener('change', queueSaveDraft);
  isolatedProfileNameEl.addEventListener('input', queueSaveDraft);
  profileDirectoryEl.addEventListener('input', queueSaveDraft);
  targetPlatformEl.addEventListener('change', syncTargetUrlVisibility);
  targetPlatformEl.addEventListener('change', queueSaveDraft);
  targetUrlEl.addEventListener('input', queueSaveDraft);
  workflowNameEl.addEventListener('input', queueSaveDraft);
  openChatGPTButton.addEventListener('click', openChatGPT);
  startButton.addEventListener('click', startRun);
  stopButton.addEventListener('click', stopRun);
  clearPageButton.addEventListener('click', clearPage);
  clearLogButton.addEventListener('click', clearCurrentLogs);
  saveWorkflowButton.addEventListener('click', saveWorkflow);
  workflowSelectEl.addEventListener('change', () => {
    if (workflowSelectEl.value === WORKFLOW_NEW_VALUE) {
      newWorkflow();
    } else if (workflowSelectEl.value) {
      loadWorkflow();
    }
  });
  loadWorkflowButton.addEventListener('click', loadWorkflow);
  deleteWorkflowButton.addEventListener('click', deleteWorkflow);
  refreshWorkflowButton.addEventListener('click', () => renderWorkflowOptions(workflowSelectEl.value));
  window.addEventListener('resize', () => requestAnimationFrame(drawNodeLinks));
  window.addEventListener('keydown', handleKeyboardShortcuts, true);
  syncBrowserPathVisibility();
  syncTargetUrlVisibility();
}

function initMonitorDrawer() {
  const shouldCollapse = localStorage.getItem(MONITOR_COLLAPSED_KEY) !== 'expanded';
  setMonitorDrawerCollapsed(shouldCollapse, false);
  syncMonitorSummary();
}

function toggleMonitorDrawer() {
  const shouldCollapse = !monitorDrawerEl?.classList.contains('is-collapsed');
  setMonitorDrawerCollapsed(shouldCollapse);
}

function setMonitorDrawerCollapsed(isCollapsed, shouldPersist = true) {
  if (!monitorDrawerEl || !monitorToggleButton) return;
  monitorDrawerEl.classList.toggle('is-collapsed', isCollapsed);
  monitorToggleButton.setAttribute('aria-expanded', String(!isCollapsed));
  monitorToggleButton.title = isCollapsed ? '展开运行监控' : '收起运行监控';
  if (monitorToggleIconEl) {
    monitorToggleIconEl.textContent = isCollapsed ? '☰' : '≪';
  }
  if (shouldPersist) {
    localStorage.setItem(MONITOR_COLLAPSED_KEY, isCollapsed ? 'collapsed' : 'expanded');
  }
  requestAnimationFrame(drawNodeLinks);
  window.setTimeout(() => requestAnimationFrame(drawNodeLinks), 90);
}

function syncMonitorSummary() {
  if (!monitorSummaryEl) return;
  const statusText = statusEl?.textContent?.trim() || '未开始';
  const progressText = progressEl?.textContent?.trim() || '0 / 0';
  monitorSummaryEl.textContent = `${statusText} · ${progressText}`;
}

function getWorkbenchId() {
  const raw = new URLSearchParams(window.location.search).get('desk') || 'default';
  return raw.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 48) || 'default';
}

function createClientId() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID().replace(/[^a-zA-Z0-9_-]/g, '');
  return `client-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function registerClientLifecycle() {
  const heartbeat = () => {
    fetch('/api/client/heartbeat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId: CLIENT_ID }),
      keepalive: true,
    }).catch(() => {});
  };

  heartbeat();
  window.setInterval(heartbeat, CLIENT_HEARTBEAT_MS);

  const notifyClosed = () => {
    const url = `/api/client/close?clientId=${encodeURIComponent(CLIENT_ID)}`;
    if (navigator.sendBeacon) {
      navigator.sendBeacon(url);
      return;
    }
    fetch(url, { method: 'POST', keepalive: true }).catch(() => {});
  };

  window.addEventListener('pagehide', notifyClosed);
}

function restoreWorkspaceState() {
  isRestoringDraft = true;
  try {
    const raw = localStorage.getItem(WORKSPACES_KEY);
    const saved = raw ? JSON.parse(raw) : null;
    if (saved && Array.isArray(saved.workspaces) && saved.workspaces.length > 0) {
      workspaces = saved.workspaces
        .filter((workspace) => workspace && workspace.id)
        .map(normalizeWorkspace)
        .slice(0, 24);
      activeWorkspaceId = localStorage.getItem(ACTIVE_WORKSPACE_KEY)
        || saved.activeWorkspaceId
        || workspaces[0]?.id
        || '';
      if (!workspaces.some((workspace) => workspace.id === activeWorkspaceId)) {
        activeWorkspaceId = workspaces[0].id;
      }
      loadWorkspaceIntoPage(activeWorkspaceId);
      return true;
    }

    const legacyDraft = readLegacyDraft();
    const firstWorkspace = createWorkspace(legacyDraft || createDefaultDraft());
    workspaces = [firstWorkspace];
    activeWorkspaceId = firstWorkspace.id;
    loadWorkspaceIntoPage(activeWorkspaceId);
    saveWorkspaceState();
    return Boolean(legacyDraft);
  } catch (_error) {
    const firstWorkspace = createWorkspace(createDefaultDraft());
    workspaces = [firstWorkspace];
    activeWorkspaceId = firstWorkspace.id;
    loadWorkspaceIntoPage(activeWorkspaceId);
    saveWorkspaceState();
    return false;
  } finally {
    isRestoringDraft = false;
  }
}

function readLegacyDraft() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    const draft = raw ? JSON.parse(raw) : null;
    if (!draft || !Array.isArray(draft.stages) || draft.stages.length === 0) return null;
    return normalizeDraft(draft);
  } catch (_error) {
    return null;
  }
}

function createWorkspace(draft = createDefaultDraft()) {
  const id = createWorkspaceId();
  const task = createTaskFromDraft(draft);
  return normalizeWorkspace({
    id,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    draft,
    activeTaskId: task.id,
    tasks: [task],
    jobId: null,
    job: null,
    jobs: [],
    localLogs: [],
  });
}

function normalizeWorkspace(workspace) {
  const draft = normalizeDraft(workspace.draft || createDefaultDraft());
  const jobs = normalizeWorkspaceJobs(workspace);
  const primaryJob = selectPrimaryJob(jobs);
  const tasks = normalizeWorkspaceTasks(workspace, draft, jobs);
  const activeTaskId = tasks.some((task) => task.id === workspace.activeTaskId)
    ? workspace.activeTaskId
    : tasks[0]?.id;
  const legacyLogs = Array.isArray(workspace.localLogs) ? workspace.localLogs.slice(-200) : [];
  if (legacyLogs.length) {
    const activeTask = tasks.find((task) => task.id === activeTaskId);
    if (activeTask && (!Array.isArray(activeTask.localLogs) || activeTask.localLogs.length === 0)) {
      activeTask.localLogs = legacyLogs;
    }
  }
  return {
    id: String(workspace.id || createWorkspaceId()).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64) || createWorkspaceId(),
    createdAt: workspace.createdAt || new Date().toISOString(),
    updatedAt: workspace.updatedAt || new Date().toISOString(),
    draft,
    activeTaskId,
    tasks,
    jobId: primaryJob?.id || workspace.jobId || workspace.job?.id || null,
    job: primaryJob || workspace.job || null,
    jobs,
    localLogs: Array.isArray(workspace.localLogs) ? workspace.localLogs.slice(-200) : [],
  };
}

function normalizeWorkspaceJobs(workspace) {
  const rawJobs = [];
  if (Array.isArray(workspace.jobs)) rawJobs.push(...workspace.jobs);
  if (workspace.job) rawJobs.push(workspace.job);
  const seen = new Set();
  return rawJobs
    .filter((job) => job && job.id && !seen.has(job.id) && seen.add(job.id))
    .map(slimJob)
    .slice(-50);
}

function normalizeWorkspaceTasks(workspace, draft, jobs = []) {
  let tasks = Array.isArray(workspace.tasks) && workspace.tasks.length > 0
    ? workspace.tasks
    : [createTaskFromDraft(draft)];

  tasks = tasks
    .filter(Boolean)
    .map((task) => normalizeTask(task))
    .filter((task) => task.id)
    .slice(0, 100);

  if (!tasks.length) tasks = [createTaskFromDraft(draft)];

  const jobById = new Map(jobs.map((job) => [job.id, job]));
  return tasks.map((task) => {
    if (task.jobId && jobById.has(task.jobId)) {
      return { ...task, job: slimJob(jobById.get(task.jobId)) };
    }
    return task;
  });
}

function normalizeTask(task = {}) {
  const id = String(task.id || createWorkspaceId()).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64) || createWorkspaceId();
  return {
    id,
    createdAt: task.createdAt || new Date().toISOString(),
    updatedAt: task.updatedAt || new Date().toISOString(),
    draft: normalizeTaskDraft(task.draft || task),
    jobId: task.jobId || task.job?.id || null,
    job: task.job ? slimJob(task.job) : null,
    localLogs: Array.isArray(task.localLogs) ? task.localLogs.slice(-200) : [],
  };
}

function normalizeTaskDraft(draft = {}) {
  const stages = Array.isArray(draft.stages) && draft.stages.length > 0
    ? normalizeStageList(draft.stages)
    : createDefaultTaskDraft().stages;
  return {
    workflowName: String(draft.workflowName || '').trim(),
    stages,
    taskForm: normalizeTaskFormState(draft.taskForm || draft.form || {}, stages.length),
    updatedAt: draft.updatedAt || new Date().toISOString(),
  };
}

function createTaskFromDraft(draft = createDefaultDraft()) {
  return normalizeTask({
    id: createWorkspaceId(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    draft: normalizeTaskDraft(draft),
  });
}

function normalizeDraft(draft = {}) {
  return {
    workflowName: String(draft.workflowName || '').trim(),
    browser: normalizeBrowserConfig(draft.browser),
    target: draft.target || { targetPlatform: 'chatgpt', targetUrl: '' },
    stages: Array.isArray(draft.stages) && draft.stages.length > 0
      ? normalizeStageList(draft.stages)
      : createDefaultDraft().stages,
    updatedAt: draft.updatedAt || new Date().toISOString(),
  };
}

function normalizeStageList(stages = []) {
  return stages.slice(0, MAX_STAGES).map((stage, arrayIndex) => normalizeStage(stage, arrayIndex));
}

function normalizeStage(stage = {}, arrayIndex = 0) {
  const templatePrompt = String(stage.templatePrompt ?? stage.sourcePrompt ?? stage.prompt ?? '');
  const replacements = Array.isArray(stage.replacements)
    ? stage.replacements
      .map((replacement) => ({
        marker: String(replacement.marker ?? replacement.key ?? replacement.placeholder ?? ''),
        value: String(replacement.value ?? replacement.content ?? ''),
      }))
      .filter((replacement) => replacement.marker || replacement.value)
    : [];
  const layout = normalizeStageVisibility(stage);
  const prompt = layout.visible.source
    ? (layout.visible.replacements ? applyPromptReplacements(templatePrompt, replacements) : templatePrompt)
    : '';
  return {
    index: Number(stage.index || arrayIndex + 1),
    name: String(stage.name || stage.stageName || ''),
    templatePrompt,
    replacements,
    prompt,
    mode: 'send',
    layoutMode: layout.layoutMode,
    visible: layout.visible,
    height: normalizeStageHeight(stage.height ?? stage.cardHeight ?? stage.stageHeight),
  };
}

function createDefaultDraft() {
  return {
    workflowName: '',
    browser: createDefaultBrowserConfig(),
    target: { targetPlatform: 'chatgpt', targetUrl: '' },
    stages: [{
      index: 1,
      name: '',
      templatePrompt: '',
      prompt: '',
      replacements: [],
      mode: 'send',
      layoutMode: DEFAULT_STAGE_LAYOUT_MODE,
      visible: createDefaultStageVisibility(),
      height: null,
    }],
    updatedAt: new Date().toISOString(),
  };
}

function createDefaultBrowserConfig() {
  return {
    browserType: 'edge',
    browserPath: '',
    profileMode: 'isolated',
    isolatedProfileName: 'Default',
    profileDirectory: 'Default',
  };
}

function normalizeBrowserConfig(browser = {}) {
  const input = browser && typeof browser === 'object' ? browser : {};
  const defaults = createDefaultBrowserConfig();
  const profileMode = input.profileMode === 'system' ? 'system' : 'isolated';
  return {
    ...defaults,
    ...input,
    profileMode,
    isolatedProfileName: String(input.isolatedProfileName || input.profileName || input.profileDirectory || defaults.isolatedProfileName),
    profileDirectory: String(input.profileDirectory || defaults.profileDirectory),
  };
}

function createDefaultTaskDraft() {
  return {
    workflowName: '',
    stages: [{
      index: 1,
      name: '',
      templatePrompt: '',
      prompt: '',
      replacements: [],
      mode: 'send',
      layoutMode: DEFAULT_STAGE_LAYOUT_MODE,
      visible: createDefaultStageVisibility(),
      height: null,
    }],
    taskForm: createDefaultTaskFormState(1),
    updatedAt: new Date().toISOString(),
  };
}

function createWorkspaceId() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  return `task-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function getActiveWorkspace() {
  return workspaces.find((workspace) => workspace.id === activeWorkspaceId) || workspaces[0] || null;
}

function getWorkspaceTasks(workspace) {
  if (!workspace) return [];
  if (!Array.isArray(workspace.tasks) || workspace.tasks.length === 0) {
    workspace.tasks = [createTaskFromDraft(workspace.draft || createDefaultDraft())];
    workspace.activeTaskId = workspace.tasks[0].id;
  }
  return workspace.tasks;
}

function getActiveTask(workspace = getActiveWorkspace()) {
  const tasks = getWorkspaceTasks(workspace);
  return tasks.find((task) => task.id === workspace?.activeTaskId) || tasks[0] || null;
}

function getActiveTaskIndex(workspace = getActiveWorkspace()) {
  const tasks = getWorkspaceTasks(workspace);
  const index = tasks.findIndex((task) => task.id === workspace?.activeTaskId);
  return index >= 0 ? index : 0;
}

function getTaskFileKey(workspaceId, taskId) {
  return `${workspaceId || 'workspace'}::${taskId || 'task'}`;
}

function createAndSwitchWorkspace() {
  snapshotCurrentWorkspace();
  const workspace = createWorkspace(createDefaultDraft());
  workspaces.push(workspace);
  switchWorkspace(workspace.id);
  appendLog('已新建环境页签。');
}

function switchWorkspace(workspaceId) {
  if (!workspaces.some((workspace) => workspace.id === workspaceId)) return;
  snapshotCurrentWorkspace();
  activeWorkspaceId = workspaceId;
  localStorage.setItem(ACTIVE_WORKSPACE_KEY, activeWorkspaceId);
  isRestoringDraft = true;
  try {
    loadWorkspaceIntoPage(workspaceId);
  } finally {
    isRestoringDraft = false;
  }
  renderWorkspaceTabs();
  saveWorkspaceState();
}

function closeWorkspace(workspaceId) {
  const workspace = workspaces.find((item) => item.id === workspaceId);
  if (!workspace || workspaces.length <= 1) return;
  if (isWorkspaceJobActive(workspace)) {
    appendLog('该环境仍有任务执行中，不能关闭页签。');
    return;
  }

  const closingActive = workspaceId === activeWorkspaceId;
  runtimeFilesByWorkspace.delete(workspaceId);
  for (const key of [...runtimeFilesByWorkspace.keys()]) {
    if (key.startsWith(`${workspaceId}::`)) runtimeFilesByWorkspace.delete(key);
  }
  for (const key of [...runtimeTaskFormFilesByWorkspace.keys()]) {
    if (key.startsWith(`${workspaceId}::`)) runtimeTaskFormFilesByWorkspace.delete(key);
  }
  workspaces = workspaces.filter((item) => item.id !== workspaceId);
  if (closingActive) {
    activeWorkspaceId = workspaces[0].id;
    loadWorkspaceIntoPage(activeWorkspaceId);
  }
  renderWorkspaceTabs();
  saveWorkspaceState();
}

function closeActiveWorkspace() {
  const workspace = getActiveWorkspace();
  if (!workspace) return;
  if (workspaces.length <= 1) {
    appendLog('只剩一个环境页签，已保留当前工作台窗口。');
    return;
  }
  closeWorkspace(workspace.id);
}

function handleKeyboardShortcuts(event) {
  const isSaveShortcut = (event.ctrlKey || event.metaKey) && event.key?.toLowerCase() === 's';
  if (isSaveShortcut) {
    event.preventDefault();
    event.stopPropagation();
    if (!event.repeat) saveWorkflow();
    return;
  }

  const isCloseShortcut = (event.ctrlKey || event.metaKey) && event.key?.toLowerCase() === 'w';
  if (!isCloseShortcut) return;
  event.preventDefault();
  event.stopPropagation();
  closeActiveWorkspace();
}

function snapshotCurrentWorkspace() {
  const workspace = getActiveWorkspace();
  if (!workspace || isRestoringDraft) return;
  refreshAllGeneratedPrompts();
  const task = getActiveTask(workspace);
  workspace.draft = collectCurrentDraft();
  if (task) {
    task.draft = collectCurrentTaskDraft();
    task.updatedAt = new Date().toISOString();
    runtimeFilesByWorkspace.set(getTaskFileKey(workspace.id, task.id), collectStageFiles());
    runtimeTaskFormFilesByWorkspace.set(getTaskFileKey(workspace.id, task.id), collectTaskFormFiles());
  }
  workspace.updatedAt = new Date().toISOString();
}

function collectCurrentDraft() {
  return {
    workflowName: workflowNameEl.value.trim(),
    browser: getBrowserConfig(),
    target: getTargetConfig(),
    stages: getStageData(),
    taskForm: collectTaskFormState(),
    updatedAt: new Date().toISOString(),
  };
}

function collectCurrentTaskDraft() {
  return {
    workflowName: workflowNameEl.value.trim(),
    stages: getStageData(),
    taskForm: collectTaskFormState(),
    updatedAt: new Date().toISOString(),
  };
}

function collectStageFiles() {
  return getStageCards().map((card) => {
    const filesEl = card.querySelector('.stage-files');
    return [...(filesEl._selectedFiles || filesEl.files || [])];
  });
}

function loadWorkspaceIntoPage(workspaceId) {
  const workspace = workspaces.find((item) => item.id === workspaceId) || workspaces[0];
  if (!workspace) {
    initStages(DEFAULT_STAGE_COUNT);
    return;
  }

  const draft = normalizeDraft(workspace.draft);
  workspace.draft = draft;
  const task = getActiveTask(workspace);
  activeJobId = workspace.jobId || null;
  applyBrowserConfig(draft.browser || {});
  applyTargetConfig(draft.target || {});
  workflowNameEl.value = task?.draft?.workflowName || '';
  applyStageData(task?.draft?.stages || createDefaultTaskDraft().stages);
  restoreTaskFiles(workspace.id, task?.id);
  renderTaskFormPanel(task?.draft?.taskForm);
  restoreTaskFormFiles(workspace.id, task?.id);
  renderWorkspaceJobState(workspace);
  renderTaskNavigator(workspace);
  requestAnimationFrame(drawNodeLinks);
}

function restoreWorkspaceFiles(workspaceId) {
  const workspace = workspaces.find((item) => item.id === workspaceId);
  const task = getActiveTask(workspace);
  restoreTaskFiles(workspaceId, task?.id);
}

function restoreTaskFiles(workspaceId, taskId) {
  const fileSets = runtimeFilesByWorkspace.get(getTaskFileKey(workspaceId, taskId)) || [];
  if (!fileSets.length) return;
  getStageCards().forEach((card, index) => {
    const files = fileSets[index] || [];
    if (!files.length) return;
    const filesEl = card.querySelector('.stage-files');
    const fileListEl = card.querySelector('.file-list');
    setSelectedFiles(filesEl, fileListEl, files);
  });
}

function switchTask(taskId) {
  const workspace = getActiveWorkspace();
  if (!workspace || !getWorkspaceTasks(workspace).some((task) => task.id === taskId)) return;
  snapshotCurrentWorkspace();
  workspace.activeTaskId = taskId;
  workspace.updatedAt = new Date().toISOString();
  isRestoringDraft = true;
  try {
    loadWorkspaceIntoPage(workspace.id);
  } finally {
    isRestoringDraft = false;
  }
  saveWorkspaceState();
  renderWorkspaceTabs();
}

function createAndSwitchTaskPage() {
  const workspace = getActiveWorkspace();
  if (!workspace) return;
  snapshotCurrentWorkspace();
  const task = createTaskFromDraft(createDefaultTaskDraft());
  workspace.tasks.push(task);
  workspace.activeTaskId = task.id;
  workspace.updatedAt = new Date().toISOString();
  loadWorkspaceIntoPage(workspace.id);
  saveWorkspaceState();
  renderWorkspaceTabs();
  appendLog(`已新增任务页：任务 ${workspace.tasks.length}。`);
}

async function deleteTaskPage(taskId) {
  const workspace = getActiveWorkspace();
  if (!workspace) return;
  const tasks = getWorkspaceTasks(workspace);
  const taskIndex = tasks.findIndex((task) => task.id === taskId);
  if (taskIndex < 0) return;
  if (tasks.length <= 1) {
    appendLog('至少保留一个任务页，未删除。');
    return;
  }

  const task = tasks[taskIndex];
  const job = getTaskJob(workspace, task);
  if (isJobActive(job)) {
    appendLog('任务正在执行或排队中，不能删除。');
    return;
  }

  if (job?.id && job.status === 'failed' && job.queue?.paused && job.queue.blockedByJobId === job.id) {
    try {
      await postJson(`/api/jobs/${job.id}/stop`, { force: true });
    } catch (error) {
      appendLog(`删除失败任务前无法释放队列：${error.message}`);
      return;
    }
  }

  snapshotCurrentWorkspace();
  runtimeFilesByWorkspace.delete(getTaskFileKey(workspace.id, task.id));
  runtimeTaskFormFilesByWorkspace.delete(getTaskFileKey(workspace.id, task.id));
  workspace.tasks = tasks.filter((item) => item.id !== taskId);
  if (job?.id) {
    workspace.jobs = getWorkspaceJobs(workspace).filter((item) => item.id !== job.id);
    workspace.job = selectPrimaryJob(workspace.jobs);
    workspace.jobId = workspace.job?.id || null;
  }

  if (workspace.activeTaskId === taskId) {
    const nextTask = workspace.tasks[Math.min(taskIndex, workspace.tasks.length - 1)];
    workspace.activeTaskId = nextTask?.id || workspace.tasks[0]?.id;
  }

  workspace.updatedAt = new Date().toISOString();
  loadWorkspaceIntoPage(workspace.id);
  saveWorkspaceState();
  renderWorkspaceTabs();
  appendLog(`已删除任务页：任务 ${taskIndex + 1}。`);
}

function renderTaskNavigator(workspace = getActiveWorkspace()) {
  const tasks = getWorkspaceTasks(workspace);
  const index = getActiveTaskIndex(workspace);
  const task = tasks[index];
  const total = Math.max(tasks.length, 1);
  const status = getTaskStatusText(task);

  if (taskPageStatusEl) {
    taskPageStatusEl.textContent = `任务 ${index + 1} / ${total} · ${status}`;
  }

}

function getTaskStatusText(task) {
  if (!task) return '未提交';
  const job = getTaskJob(getActiveWorkspace(), task);
  if (!job) return '未提交';
  return getJobStatusText(job);
}

function renderWorkspaceTabs() {
  workspaceTabsEl.innerHTML = '';
  workspaces.forEach((workspace, index) => {
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.className = 'task-tab';
    tab.classList.toggle('is-active', workspace.id === activeWorkspaceId);
    tab.classList.toggle('is-running', isWorkspaceJobActive(workspace));
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-selected', workspace.id === activeWorkspaceId ? 'true' : 'false');
    tab.addEventListener('click', () => switchWorkspace(workspace.id));

    const title = document.createElement('span');
    title.className = 'task-tab-title';
    title.textContent = getWorkspaceTitle(workspace, index);

    const meta = document.createElement('span');
    meta.className = 'task-tab-meta';
    meta.textContent = getWorkspaceMeta(workspace);

    const progress = document.createElement('span');
    progress.className = 'task-tab-progress';
    progress.textContent = getWorkspaceProgress(workspace);

    const closeButton = document.createElement('span');
    closeButton.className = 'task-tab-close';
    closeButton.textContent = '×';
    closeButton.title = '关闭环境页签';
    closeButton.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      closeWorkspace(workspace.id);
    });

    tab.append(title, meta, progress);
    if (workspaces.length > 1) tab.appendChild(closeButton);
    workspaceTabsEl.appendChild(tab);
  });
}

function getWorkspaceTitle(workspace, index) {
  const browser = getBrowserLabelFromConfig(workspace.draft?.browser || {});
  const target = getTargetLabelFromConfig(workspace.draft?.target || {});
  return `${browser} · ${target}`.trim() || `环境 ${index + 1}`;
}

function getWorkspaceMeta(workspace) {
  const browser = normalizeBrowserConfig(workspace.draft?.browser || {});
  const profile = browser.profileMode === 'system'
    ? `原资料:${browser.profileDirectory || 'Default'}`
    : `独立:${browser.isolatedProfileName || 'Default'}`;
  const jobs = getWorkspaceJobs(workspace);
  const taskCount = getWorkspaceTasks(workspace).length;
  const activeCount = jobs.filter(isJobActive).length;
  if (activeCount > 0) return `${profile} · 任务 ${taskCount} · 队列 ${activeCount}`;
  return `${profile} · 任务 ${taskCount}`;
}

function getWorkspaceProgress(workspace) {
  const activeJobs = getWorkspaceJobs(workspace).filter(isJobActive);
  const runningJob = activeJobs.find((job) => job.status === 'running');
  if (runningJob) {
    const queue = runningJob.queue;
    const queueText = queue?.total ? ` 队列${queue.position || 1}/${queue.total}` : '';
    return `执行中 ${runningJob.stagesDone || 0}/${runningJob.stagesTotal || 0}${queueText}`;
  }
  if (activeJobs.length > 0) {
    return `排队中 ${activeJobs.length}`;
  }
  return '未开始 0/0';
}

function getBrowserLabelFromConfig(browser = {}) {
  const type = browser.browserType || 'edge';
  if (type === 'custom') return '自定义浏览器';
  const current = browserCatalog.find((item) => item.type === type);
  return current?.label?.replace('（未检测到）', '') || type;
}

function getTargetLabelFromConfig(target = {}) {
  const type = target.targetPlatform || 'chatgpt';
  if (type === 'custom') return '自定义平台';
  const current = targetCatalog.find((item) => item.type === type);
  return current?.label || type;
}

function saveWorkspaceState() {
  try {
    const payload = {
      activeWorkspaceId,
      workspaces: workspaces.map((workspace) => ({
        id: workspace.id,
        createdAt: workspace.createdAt,
        updatedAt: workspace.updatedAt,
        draft: workspace.draft,
        activeTaskId: workspace.activeTaskId,
        tasks: getWorkspaceTasks(workspace).map((task) => ({
          id: task.id,
          createdAt: task.createdAt,
          updatedAt: task.updatedAt,
          draft: task.draft,
          jobId: task.jobId,
          job: task.job ? slimJob(task.job) : null,
          localLogs: Array.isArray(task.localLogs) ? task.localLogs.slice(-200) : [],
        })),
        jobId: workspace.jobId,
        job: workspace.job ? slimJob(workspace.job) : null,
        jobs: getWorkspaceJobs(workspace).map(slimJob),
        localLogs: Array.isArray(workspace.localLogs) ? workspace.localLogs.slice(-200) : [],
      })),
    };
    localStorage.setItem(WORKSPACES_KEY, JSON.stringify(payload));
    localStorage.setItem(ACTIVE_WORKSPACE_KEY, activeWorkspaceId);
  } catch (_error) {
    // localStorage may be unavailable in private contexts; runtime state still remains in memory.
  }
}

function slimJob(job) {
  return {
    id: job.id,
    title: job.title,
    status: job.status,
    browserLabel: job.browserLabel,
    currentStage: job.currentStage,
    stagesTotal: job.stagesTotal,
    stagesDone: job.stagesDone,
    queue: job.queue || null,
    createdAt: job.createdAt || null,
    logs: Array.isArray(job.logs) ? job.logs.slice(-300) : [],
  };
}

function getWorkspaceJobs(workspace) {
  if (!workspace) return [];
  if (Array.isArray(workspace.jobs)) return workspace.jobs;
  return workspace.job ? [workspace.job] : [];
}

function isJobActive(job) {
  return Boolean(job && ['queued', 'running'].includes(job.status));
}

function getWorkspaceActiveJobs(workspace) {
  return getWorkspaceJobs(workspace).filter(isJobActive);
}

function selectPrimaryJob(jobs = []) {
  return jobs.find((job) => job.status === 'running')
    || jobs.find((job) => job.status === 'queued')
    || [...jobs].reverse().find(Boolean)
    || null;
}

function upsertWorkspaceJob(workspace, job) {
  if (!workspace || !job?.id) return;
  const jobs = getWorkspaceJobs(workspace).filter((item) => item.id !== job.id);
  jobs.push(slimJob(job));
  workspace.jobs = jobs.slice(-50);
  for (const task of getWorkspaceTasks(workspace)) {
    if (task.jobId === job.id) {
      task.job = slimJob(job);
      task.updatedAt = new Date().toISOString();
    }
  }
  workspace.job = selectPrimaryJob(workspace.jobs);
  workspace.jobId = workspace.job?.id || null;
  workspace.updatedAt = new Date().toISOString();
}

function renderWorkspaceJobState(workspace) {
  const jobs = getWorkspaceJobs(workspace);
  const primaryJob = selectPrimaryJob(jobs);
  workspace.job = primaryJob;
  workspace.jobId = primaryJob?.id || null;
  const activeTask = getActiveTask(workspace);
  const activeTaskJob = getTaskJob(workspace, activeTask);

  if (activeTaskJob) {
    renderJob(activeTaskJob);
  } else {
    statusEl.textContent = '未开始';
    currentStageEl.textContent = '-';
    progressEl.textContent = '0 / 0';
    const localLogs = getTaskLocalLogs(workspace, activeTask);
    logBox.textContent = localLogs.length ? localLogs.join('\n') : '等待操作。';
    clearStageProgress();
  }
  renderQueueList(workspace);
  renderTaskNavigator(workspace);
  syncMonitorSummary();
  setRunningUi(isWorkspaceJobActive(workspace));
}

function getTaskLocalLogs(workspace = getActiveWorkspace(), task = getActiveTask(workspace)) {
  if (task && Array.isArray(task.localLogs)) return task.localLogs;
  return Array.isArray(workspace?.localLogs) ? workspace.localLogs : [];
}

function setTaskLocalLogs(workspace, task, logs) {
  const nextLogs = Array.isArray(logs) ? logs.slice(-200) : [];
  if (task) {
    task.localLogs = nextLogs;
    task.updatedAt = new Date().toISOString();
  } else if (workspace) {
    workspace.localLogs = nextLogs;
  }
  if (workspace) {
    workspace.updatedAt = new Date().toISOString();
  }
}

function clearJobLogs(workspace, jobId) {
  if (!workspace || !jobId) return;
  workspace.jobs = getWorkspaceJobs(workspace).map((job) => (
    job.id === jobId ? slimJob({ ...job, logs: [] }) : job
  ));
  if (workspace.job?.id === jobId) {
    workspace.job = slimJob({ ...workspace.job, logs: [] });
  }
  for (const task of getWorkspaceTasks(workspace)) {
    if (task.job?.id === jobId) {
      task.job = slimJob({ ...task.job, logs: [] });
    }
  }
}

function detachTaskJob(workspace, task) {
  if (!workspace || !task) return;
  const jobId = task.jobId || task.job?.id;
  task.jobId = null;
  task.job = null;
  task.updatedAt = new Date().toISOString();
  if (jobId) {
    workspace.jobs = getWorkspaceJobs(workspace).filter((job) => job.id !== jobId);
    jobPollFailures.delete(jobId);
  }
  workspace.job = selectPrimaryJob(workspace.jobs || []);
  workspace.jobId = workspace.job?.id || null;
  if (activeJobId === jobId) activeJobId = workspace.jobId || null;
}

function clearStageProgress() {
  document.querySelectorAll('.stage-card').forEach((card) => {
    card.classList.remove('is-active', 'is-done');
  });
}

function buildRunFormData(options = {}) {
  refreshAllGeneratedPrompts();
  const body = new FormData();
  const startStage = Math.max(1, Number(options.startStage) || 1);
  getStageCards().forEach((card, arrayIndex) => {
    const index = arrayIndex + 1;
    if (index < startStage) return;
    const visible = getStageEffectiveModules(card);
    body.append(`stageName_${index}`, card.querySelector('.stage-name')?.value || '');
    body.append(`mode_${index}`, 'send');
    body.append(`prompt_${index}`, visible.source ? (card.querySelector('.stage-prompt')?.value || '') : '');
    if (!visible.files) return;
    for (const file of getSelectedFiles(card.querySelector('.stage-files'))) {
      body.append(`files_${index}`, file, file.name || `file_${index}`);
    }
  });
  return body;
}

function isWorkspaceJobActive(workspace) {
  return getWorkspaceActiveJobs(workspace).length > 0;
}

function initCanvasLinks() {
  const observer = new ResizeObserver(() => requestAnimationFrame(drawNodeLinks));
  observer.observe(canvasEl);
  observer.observe(form);
  requestAnimationFrame(drawNodeLinks);
}

function drawNodeLinks() {
  const cards = getStageCards();
  const width = canvasEl.clientWidth;
  const height = Math.max(form.offsetTop + form.scrollHeight + 24, canvasEl.clientHeight);
  linksEl.setAttribute('viewBox', `0 0 ${width} ${height}`);
  linksEl.setAttribute('width', width);
  linksEl.setAttribute('height', height);
  linksEl.innerHTML = '';

  for (let index = 0; index < cards.length - 1; index += 1) {
    const from = cards[index];
    const to = cards[index + 1];
    const x1 = from.offsetLeft + 26;
    const y1 = from.offsetTop + from.offsetHeight - 4;
    const x2 = to.offsetLeft + 26;
    const y2 = to.offsetTop + 4;
    const mid = Math.max(34, (y2 - y1) * 0.5);
    const d = `M ${x1} ${y1} C ${x1} ${y1 + mid}, ${x2} ${y2 - mid}, ${x2} ${y2}`;
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    path.setAttribute('class', 'workflow-link');
    linksEl.appendChild(path);
  }
}

async function openChatGPT() {
  appendLog(`正在新开 ${getTargetLabel()} 窗口。`);
  setButtonsBusy(true);
  try {
    const data = await postJson('/api/open-chatgpt', {
      ...getBrowserConfig(),
      ...getTargetConfig(),
    });
    appendLog(data.message || '已打开。');
  } catch (error) {
    appendLog(`打开失败：${error.message}`);
  } finally {
    setButtonsBusy(false);
  }
}

async function startRun(options = {}) {
  applyTaskFormToStageCards();
  refreshAllGeneratedPrompts();
  saveDraft();
  const workspace = getActiveWorkspace();
  if (!workspace) return;
  const resumeFromStage = Math.max(1, Number(options.resumeFromStage) || 1);

  const firstEmpty = findFirstEmptyStage();
  if (firstEmpty === 1) {
    appendLog('第 1 个阶段为空，无法开始。');
    return;
  }

  const validCount = firstEmpty ? firstEmpty - 1 : getStageCards().length;
  if (resumeFromStage > validCount) {
    appendLog(`无法续跑：第 ${resumeFromStage} 阶段已经超过有效阶段数 ${validCount}。`);
    return;
  }
  appendLog(resumeFromStage > 1
    ? `检测到 ${validCount} 个有效阶段，从第 ${resumeFromStage} 阶段继续发送。`
    : `检测到 ${validCount} 个有效阶段，开始发送。`);
  setRunningUi(true);

  try {
    const body = buildRunFormData({ startStage: resumeFromStage });
    const browserConfig = getBrowserConfig();
    const targetConfig = getTargetConfig();
    body.append('browserType', browserConfig.browserType);
    body.append('browserPath', browserConfig.browserPath);
    body.append('profileMode', browserConfig.profileMode);
    body.append('isolatedProfileName', browserConfig.isolatedProfileName);
    body.append('profileDirectory', browserConfig.profileDirectory);
    body.append('targetPlatform', targetConfig.targetPlatform);
    body.append('targetUrl', targetConfig.targetUrl);
    body.append('workflowName', workflowNameEl.value.trim());
    body.append('stageCount', String(getStageCards().length));
    body.append('effectiveStageCount', String(validCount));
    body.append('resumeFromStage', String(resumeFromStage));
    body.append('queuePriority', options.queuePriority ? 'true' : 'false');

    const response = await fetch('/api/run', {
      method: 'POST',
      body,
    });
    const data = await response.json();
    if (!response.ok || !data.ok) {
      throw new Error(data.message || '创建任务失败。');
    }

    activeJobId = data.jobId;
    const job = {
      id: data.jobId,
      title: resolveLocalJobTitle(validCount),
      status: 'queued',
      currentStage: null,
      stagesTotal: validCount,
      stagesDone: resumeFromStage - 1,
      logs: [],
    };
    const activeTask = getActiveTask(workspace);
    if (activeTask) {
      activeTask.jobId = data.jobId;
      activeTask.job = slimJob(job);
      activeTask.updatedAt = new Date().toISOString();
    }
    upsertWorkspaceJob(workspace, job);
    workspace.updatedAt = new Date().toISOString();
    saveWorkspaceState();
    renderWorkspaceTabs();
    renderWorkspaceJobState(workspace);
    appendLog(resumeFromStage > 1
      ? `断点续跑任务已加入当前页签队列：${activeJobId}`
      : `任务已加入当前页签队列：${activeJobId}`);
    ensurePolling();
  } catch (error) {
    appendLog(`启动失败：${error.message}`);
    setRunningUi(isWorkspaceJobActive(workspace));
    renderWorkspaceTabs();
    saveWorkspaceState();
  }
}

async function restoreTaskTracking(taskId) {
  const workspace = getActiveWorkspace();
  const task = getWorkspaceTasks(workspace).find((item) => item.id === taskId);
  const job = getTaskJob(workspace, task);
  const jobId = job?.id || task?.jobId;
  if (!workspace || !task || !jobId) return;

  appendLog('正在恢复后台任务追踪。');
  try {
    const response = await fetch(`/api/jobs/${jobId}`);
    const data = await response.json();
    if (!response.ok || !data.ok) {
      throw new Error(data.message || '后台任务不可用。');
    }

    upsertWorkspaceJob(workspace, data.job);
    jobPollFailures.delete(jobId);
    saveWorkspaceState();
    renderWorkspaceTabs();
    renderWorkspaceJobState(workspace);
    ensurePolling();
    appendLog(`已恢复任务追踪：${jobId}`);
  } catch (error) {
    appendLog(`恢复追踪失败：${error.message}`);
  }
}

async function stopRun() {
  const workspace = getActiveWorkspace();
  const targetJob = getWorkspaceActiveJobs(workspace).find((job) => job.status === 'running')
    || getWorkspaceActiveJobs(workspace)[0]
    || workspace?.job
    || null;
  const jobId = targetJob?.id || workspace?.jobId || activeJobId;
  if (!jobId) return;
  stopButton.disabled = true;
  appendLog('正在暂停。');
  try {
    await postJson(`/api/jobs/${jobId}/stop`, {});
  } catch (error) {
    appendLog(`暂停失败：${error.message}`);
  }
}

async function restartTaskFromBeginning(taskId) {
  if (isRestartingTask) return;
  const workspace = getActiveWorkspace();
  const task = getWorkspaceTasks(workspace).find((item) => item.id === taskId);
  if (!workspace || !task) return;

  isRestartingTask = true;
  renderQueueList(workspace);

  try {
    if (workspace.activeTaskId === task.id) {
      saveDraft();
    } else {
      snapshotCurrentWorkspace();
    }

    const oldJob = getTaskJob(workspace, task);
    const oldJobId = oldJob?.id || task.jobId;
    const shouldStopOldJob = oldJobId && (!oldJob || isJobActive(oldJob));

    if (shouldStopOldJob) {
      try {
        await postJson(`/api/jobs/${oldJobId}/stop`, { force: true });
      } catch (error) {
        setTaskLocalLogs(workspace, task, [
          ...(task.localLogs || oldJob?.logs || []),
          makeLogLine(`旧任务强制停止失败，仍会重新提交：${error.message}`),
        ]);
      }
    }

    detachTaskJob(workspace, task);
    setTaskLocalLogs(workspace, task, [
      ...(task.localLogs || []),
      makeLogLine('已重置任务，将从第 1 阶段重新提交。'),
    ]);

    if (workspace.activeTaskId !== task.id) {
      switchTask(task.id);
    } else {
      loadWorkspaceIntoPage(workspace.id);
      saveWorkspaceState();
      renderWorkspaceTabs();
    }

    appendLog('已从头重跑当前任务。');
    await startRun({ queuePriority: true });
  } finally {
    isRestartingTask = false;
    renderWorkspaceJobState(workspace);
  }
}

async function restartTaskFromCheckpoint(taskId) {
  if (isRestartingTask) return;
  const workspace = getActiveWorkspace();
  const task = getWorkspaceTasks(workspace).find((item) => item.id === taskId);
  if (!workspace || !task) return;

  const oldJob = getTaskJob(workspace, task);
  if (!oldJob) return;
  const total = Number(oldJob.stagesTotal) || countTaskValidStages(workspace, task);
  const resumeFromStage = Math.max(1, Math.min(total + 1, (Number(oldJob.stagesDone) || 0) + 1));
  if (resumeFromStage > total) {
    appendLog('该任务没有可续跑阶段。');
    return;
  }

  isRestartingTask = true;
  renderQueueList(workspace);

  try {
    if (workspace.activeTaskId === task.id) {
      saveDraft();
    } else {
      snapshotCurrentWorkspace();
    }

    const oldJobId = oldJob.id || task.jobId;
    if (oldJobId && isJobActive(oldJob)) {
      try {
        await postJson(`/api/jobs/${oldJobId}/stop`, { force: true });
      } catch (error) {
        setTaskLocalLogs(workspace, task, [
          ...(task.localLogs || oldJob.logs || []),
          makeLogLine(`旧任务强制停止失败，仍会从断点提交：${error.message}`),
        ]);
      }
    }

    detachTaskJob(workspace, task);
    setTaskLocalLogs(workspace, task, [
      ...(task.localLogs || oldJob.logs || []),
      makeLogLine(`已准备断点续跑，将从第 ${resumeFromStage} 阶段重新提交。`),
    ]);

    if (workspace.activeTaskId !== task.id) {
      switchTask(task.id);
    } else {
      loadWorkspaceIntoPage(workspace.id);
      saveWorkspaceState();
      renderWorkspaceTabs();
    }

    appendLog(`开始断点续跑：第 ${resumeFromStage} 阶段。`);
    await startRun({ resumeFromStage, queuePriority: true });
  } finally {
    isRestartingTask = false;
    renderWorkspaceJobState(workspace);
  }
}

function ensurePolling() {
  if (!workspaces.some(isWorkspaceJobActive)) {
    clearInterval(pollTimer);
    pollTimer = null;
    return;
  }
  if (pollTimer) return;
  clearInterval(pollTimer);
  pollTimer = setInterval(pollAllJobs, 1200);
  pollAllJobs();
}

async function pollAllJobs() {
  if (isPolling) return;
  isPolling = true;
  try {
    const activeWorkspaces = workspaces.filter(isWorkspaceJobActive);
    for (const workspace of activeWorkspaces) {
      await pollWorkspaceJobs(workspace);
    }
    renderWorkspaceTabs();
    saveWorkspaceState();
    if (!workspaces.some(isWorkspaceJobActive)) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  } finally {
    isPolling = false;
  }
}

async function pollWorkspaceJobs(workspace) {
  const activeJobs = getWorkspaceActiveJobs(workspace);
  if (!activeJobs.length) return;
  for (const job of activeJobs) {
    await pollWorkspaceJob(workspace, job.id);
  }
}

async function pollWorkspaceJob(workspace, jobId) {
  if (!workspace || !jobId) return;
  const existingJob = getWorkspaceJobs(workspace).find((item) => item.id === jobId);
  try {
    const response = await fetch(`/api/jobs/${jobId}`);
    const data = await response.json();
    if (!response.ok || !data.ok) {
      const error = new Error(data.message || '读取任务状态失败。');
      error.statusCode = response.status;
      throw error;
    }

    upsertWorkspaceJob(workspace, data.job);
    jobPollFailures.delete(jobId);
    if (workspace.id === activeWorkspaceId) {
      renderWorkspaceJobState(workspace);
    }
  } catch (error) {
    const failures = (jobPollFailures.get(jobId) || 0) + 1;
    jobPollFailures.set(jobId, failures);
    const shouldFail = error.statusCode === 404;
    const shouldAppendLog = shouldFail
      || failures <= JOB_POLL_FAILURE_LIMIT
      || failures % JOB_POLL_FAILURE_LOG_INTERVAL === 0;
    const baseLogs = existingJob?.logs || workspace.localLogs || [];
    const nextLogs = shouldAppendLog
      ? [
          ...baseLogs,
          makeLogLine(shouldFail
            ? `后台任务不存在，已标记失败：${error.message}`
            : `状态读取中断 ${failures} 次，后台任务继续保留追踪：${error.message}`),
        ]
      : baseLogs;

    upsertWorkspaceJob(workspace, {
      id: jobId,
      title: existingJob?.title || '',
      status: shouldFail ? 'failed' : (existingJob?.status || 'queued'),
      currentStage: shouldFail ? null : (existingJob?.currentStage || null),
      stagesTotal: existingJob?.stagesTotal || 0,
      stagesDone: existingJob?.stagesDone || 0,
      queue: existingJob?.queue || null,
      logs: nextLogs,
    });
    if (workspace.id === activeWorkspaceId) {
      renderWorkspaceJobState(workspace);
    }
  }
}

function renderJob(job) {
  statusEl.textContent = getJobStatusText(job);
  currentStageEl.textContent = job.currentStage ? `阶段 ${job.currentStage}` : '-';
  progressEl.textContent = `${job.stagesDone} / ${job.stagesTotal}`;
  const logs = Array.isArray(job.logs) ? job.logs : [];
  logBox.textContent = logs.length ? logs.join('\n') : '暂无日志。';
  logBox.scrollTop = logBox.scrollHeight;

  document.querySelectorAll('.stage-card').forEach((card) => {
    const index = Number(card.dataset.index);
    card.classList.toggle('is-active', job.currentStage === index);
    card.classList.toggle('is-done', index <= job.stagesDone);
  });
}

function renderQueueList(workspace) {
  if (!queueListEl) return;
  const tasks = getWorkspaceTasks(workspace);
  if (!tasks.length) {
    queueListEl.textContent = '暂无任务。';
    return;
  }

  queueListEl.innerHTML = '';
  for (const [index, task] of tasks.entries()) {
    const job = getTaskJob(workspace, task);
    const canDelete = tasks.length > 1 && !isJobActive(job);
    const canRestart = Boolean(job);
    const item = document.createElement('div');
    item.className = 'queue-item';
    item.classList.add('is-clickable');
    item.classList.toggle('is-active-task', task.id === workspace?.activeTaskId);
    item.classList.toggle('is-unsubmitted', !job);
    item.classList.toggle('is-running', job?.status === 'running');
    item.classList.toggle('is-queued', job?.status === 'queued');
    item.classList.toggle('is-failed', job?.status === 'failed');
    item.classList.toggle('is-done', ['completed', 'stopped'].includes(job?.status));
    item.addEventListener('click', () => switchTask(task.id));

    const main = document.createElement('div');
    main.className = 'queue-item-main';

    const title = document.createElement('strong');
    title.textContent = getTaskDisplayTitle(task, index);

    const meta = document.createElement('span');
    meta.textContent = getTaskListMeta(workspace, task, job);

    const actions = document.createElement('div');
    actions.className = 'queue-item-actions';

    const canRestore = Boolean(job?.id && job.status === 'failed');
    const resumeStage = job ? (Number(job.stagesDone) || 0) + 1 : null;
    const canResume = Boolean(
      job
      && !isJobActive(job)
      && !['completed'].includes(job.status)
      && resumeStage
      && resumeStage <= (Number(job.stagesTotal) || countTaskValidStages(workspace, task))
    );

    const restoreButton = document.createElement('button');
    restoreButton.type = 'button';
    restoreButton.className = 'task-restore-button';
    restoreButton.textContent = '恢复';
    restoreButton.title = canRestore
      ? '重新读取后台任务状态，不重新发送'
      : '只有失败任务需要恢复追踪';
    restoreButton.setAttribute('aria-label', restoreButton.title);
    restoreButton.disabled = !canRestore || isRestartingTask;
    restoreButton.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      restoreTaskTracking(task.id);
    });

    const resumeButton = document.createElement('button');
    resumeButton.type = 'button';
    resumeButton.className = 'task-resume-button';
    resumeButton.textContent = '续跑';
    resumeButton.title = canResume
      ? `从第 ${resumeStage} 阶段继续提交`
      : '当前任务没有可续跑阶段';
    resumeButton.setAttribute('aria-label', resumeButton.title);
    resumeButton.disabled = !canResume || isRestartingTask;
    resumeButton.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      restartTaskFromCheckpoint(task.id);
    });

    const restartButton = document.createElement('button');
    restartButton.type = 'button';
    restartButton.className = 'task-restart-button';
    restartButton.textContent = '重跑';
    restartButton.title = canRestart
      ? '停止旧任务并从第 1 阶段重新提交'
      : '未提交任务无需重跑';
    restartButton.setAttribute('aria-label', restartButton.title);
    restartButton.disabled = !canRestart || isRestartingTask;
    restartButton.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      restartTaskFromBeginning(task.id);
    });

    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.className = 'task-delete-button';
    deleteButton.textContent = '×';
    deleteButton.title = canDelete
      ? '删除任务'
      : (tasks.length <= 1 ? '至少保留一个任务' : '执行中或排队中不能删除');
    deleteButton.setAttribute('aria-label', deleteButton.title);
    deleteButton.disabled = !canDelete;
    deleteButton.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      void deleteTaskPage(task.id);
    });

    main.append(title, meta);
    if (canRestore) actions.appendChild(restoreButton);
    if (canResume) actions.appendChild(resumeButton);
    if (canRestart) actions.appendChild(restartButton);
    actions.appendChild(deleteButton);
    item.append(main, actions);
    queueListEl.appendChild(item);
  }
}

function getTaskJob(workspace, task) {
  if (!task) return null;
  if (task.job) return task.job;
  if (!task.jobId) return null;
  return getWorkspaceJobs(workspace).find((item) => item.id === task.jobId) || null;
}

function getTaskDisplayTitle(task, index) {
  const draft = task?.draft || {};
  const workflowName = String(draft.workflowName || '').trim();
  if (workflowName) return workflowName;
  const stageName = (draft.stages || []).find((stage) => String(stage?.name || '').trim())?.name;
  if (stageName) return stageName.trim();
  return `任务 ${index + 1}`;
}

function getTaskListMeta(workspace, task, job) {
  if (job) {
    return `${getJobStatusText(job)} · ${job.stagesDone || 0}/${job.stagesTotal || 0}`;
  }
  const total = Math.max((task?.draft?.stages || []).length, 1);
  const valid = countTaskValidStages(workspace, task);
  return `未提交 · ${valid}/${total} 阶段`;
}

function countTaskValidStages(workspace, task) {
  const stages = task?.draft?.stages || [];
  const fileSets = runtimeFilesByWorkspace.get(getTaskFileKey(workspace?.id, task?.id)) || [];
  const total = Math.max(stages.length, fileSets.length, 1);
  for (let index = 0; index < total; index += 1) {
    const visible = normalizeStageVisibility(stages[index] || {}).visible;
    const prompt = visible.source ? String(stages[index]?.prompt || '').trim() : '';
    const files = visible.files ? (fileSets[index]?.length || 0) : 0;
    if (!prompt && files === 0) return index;
  }
  return total;
}

function getJobStatusText(job) {
  if (!job) return '未开始';
  const base = statusLabel(job.status);
  if (job.status === 'queued') {
    if (job.queue?.paused) return '排队暂停，等待处理失败任务';
    const ahead = job.queue?.ahead;
    if (typeof ahead === 'number' && ahead > 0) return `${base}，前方 ${ahead} 个`;
  }
  if (job.status === 'running' && job.queue?.total > 1) {
    return `${base}，队列 ${job.queue.position || 1}/${job.queue.total}`;
  }
  return base;
}

function resolveLocalJobTitle(validCount = 0) {
  const workflowName = workflowNameEl.value.trim();
  if (workflowName) return workflowName;
  const stageName = getStageData().find((stage) => stage.name)?.name;
  if (stageName) return stageName;
  const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  return `任务 ${time}｜${validCount} 阶段`;
}

async function saveWorkflow() {
  if (isSavingWorkflow) return;

  const name = workflowNameEl.value.trim();
  if (!name) {
    workflowNameEl.focus();
    appendLog('工作流名称为空，无法保存。');
    return;
  }

  isSavingWorkflow = true;
  saveWorkflowButton.disabled = true;

  try {
    const payload = {
      name,
      browser: getBrowserConfig(),
      target: getTargetConfig(),
      stages: getStageData(),
      taskForm: collectTaskFormState(),
    };
    const data = await postJson('/api/workflows', payload);
    renderWorkflowOptionsFromList(data.workflows, name);
    workflowNameEl.value = data.workflow.name;
    saveDraft();
    appendLog(`工作流已保存到本地：${data.workflow.name}`);
  } catch (error) {
    appendLog(`保存失败：${error.message}`);
  } finally {
    isSavingWorkflow = false;
    saveWorkflowButton.disabled = false;
  }
}

function newWorkflow() {
  const workspace = getActiveWorkspace();
  const keepQueue = isWorkspaceJobActive(workspace);

  cleanupAllFilePreviews();
  workflowNameEl.value = '';
  initStages(DEFAULT_STAGE_COUNT);

  if (workspace) {
    const task = getActiveTask(workspace);
    runtimeFilesByWorkspace.delete(getTaskFileKey(workspace.id, task?.id));
    runtimeTaskFormFilesByWorkspace.delete(getTaskFileKey(workspace.id, task?.id));
    clearTaskFormFiles(workspace, task);
    if (!keepQueue) {
      detachTaskJob(workspace, task);
      setTaskLocalLogs(workspace, task, []);
      workspace.localLogs = [];
    }
  }

  workflowSelectEl.value = WORKFLOW_NEW_VALUE;
  saveDraft();
  renderWorkspaceJobState(workspace);
  appendLog('已进入新建工作流状态。');
  requestAnimationFrame(drawNodeLinks);
}

async function loadWorkflow() {
  const name = workflowSelectEl.value;
  if (!name || name === WORKFLOW_NEW_VALUE) {
    newWorkflow();
    return;
  }

  try {
    const response = await fetch(`/api/workflows/${encodeURIComponent(name)}`);
    const data = await response.json();
    if (!response.ok || !data.ok) {
      throw new Error(data.message || '读取工作流失败。');
    }

    const workflow = data.workflow;
    const keepEnvironment = isWorkspaceJobActive(getActiveWorkspace());
    if (!keepEnvironment) {
      applyBrowserConfig(workflow.browser || {});
      applyTargetConfig(workflow.target || {});
    }
    applyStageData(workflow.stages || []);
    renderTaskFormPanel(workflow.taskForm);
    clearTaskFormFiles(getActiveWorkspace(), getActiveTask(getActiveWorkspace()));
    workflowNameEl.value = workflow.name;
    saveDraft();
    appendLog(keepEnvironment
      ? `工作流已读取：${workflow.name}。当前页签队列运行中，已保留浏览器和目标平台。图片需要重新选择。`
      : `工作流已读取：${workflow.name}。图片需要重新选择。`);
  } catch (error) {
    appendLog(`读取失败：${error.message}`);
  }
}

async function deleteWorkflow() {
  const name = workflowSelectEl.value;
  if (!name || name === WORKFLOW_NEW_VALUE) {
    appendLog('新建工作流不是本地文件，无需删除。');
    return;
  }

  try {
    const response = await fetch(`/api/workflows/${encodeURIComponent(name)}`, {
      method: 'DELETE',
    });
    const data = await response.json();
    if (!response.ok || !data.ok) {
      throw new Error(data.message || '删除工作流失败。');
    }
    renderWorkflowOptionsFromList(data.workflows);
    if (workflowNameEl.value.trim() === name) {
      workflowNameEl.value = '';
      saveDraft();
    }
    appendLog(`工作流已删除：${name}`);
  } catch (error) {
    appendLog(`删除失败：${error.message}`);
  }
}

function clearPage() {
  const workspace = getActiveWorkspace();
  const keepQueue = isWorkspaceJobActive(workspace);

  initStages(DEFAULT_STAGE_COUNT);
  if (workspace) {
    const task = getActiveTask(workspace);
    runtimeFilesByWorkspace.delete(getTaskFileKey(workspace.id, task?.id));
    runtimeTaskFormFilesByWorkspace.delete(getTaskFileKey(workspace.id, task?.id));
    clearTaskFormFiles(workspace, task);
    if (!keepQueue) {
      detachTaskJob(workspace, task);
      setTaskLocalLogs(workspace, task, []);
      workspace.localLogs = [];
    }
  }
  saveDraft();
  appendLog('页面已清空，阶段数量已重置为 1。');
  renderWorkspaceJobState(workspace);
  renderWorkspaceTabs();
  requestAnimationFrame(drawNodeLinks);
}

function findFirstEmptyStage() {
  for (const card of getStageCards()) {
    const index = Number(card.dataset.index);
    const prompt = getStageEffectivePrompt(card).trim();
    const files = getStageEffectiveFiles(card).length;
    if (!prompt && files === 0) {
      return index;
    }
  }
  return null;
}

function getStageData() {
  refreshAllGeneratedPrompts();
  return getStageCards().map((card) => {
    const layout = getStageLayout(card);
    return {
      index: Number(card.dataset.index),
      name: card.querySelector('.stage-name').value,
      templatePrompt: card.querySelector('.stage-template-prompt')?.value || '',
      replacements: collectStageReplacements(card),
      prompt: getStageEffectivePrompt(card),
      mode: 'send',
      layoutMode: layout.layoutMode,
      visible: layout.visible,
      height: getStageHeight(card),
    };
  });
}

function restoreDraft() {
  isRestoringDraft = true;
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    const draft = raw ? JSON.parse(raw) : null;
    if (!draft || !Array.isArray(draft.stages) || draft.stages.length === 0) {
      initStages(DEFAULT_STAGE_COUNT);
      return null;
    }

    applyBrowserConfig(draft.browser || {});
    applyTargetConfig(draft.target || {});
    workflowNameEl.value = draft.workflowName || '';
    applyStageData(draft.stages);
    return draft;
  } catch (_error) {
    initStages(DEFAULT_STAGE_COUNT);
    return null;
  } finally {
    isRestoringDraft = false;
  }
}

function queueSaveDraft() {
  if (isRestoringDraft) return;
  clearTimeout(draftTimer);
  draftTimer = setTimeout(saveDraft, 120);
}

function saveDraft() {
  if (isRestoringDraft) return;
  clearTimeout(draftTimer);
  refreshAllGeneratedPrompts();
  snapshotCurrentWorkspace();
  const workspace = getActiveWorkspace();
  try {
    if (workspace?.draft) {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(workspace.draft));
    }
    saveWorkspaceState();
    renderWorkspaceTabs();
    renderTaskNavigator(workspace);
    renderQueueList(workspace);
  } catch (_error) {
    appendLog('页面状态自动保存失败。');
  }
}

function applyStageData(stages) {
  const normalized = Array.isArray(stages)
    ? stages
      .slice()
      .sort((a, b) => Number(a.index || 0) - Number(b.index || 0))
      .slice(0, MAX_STAGES)
    : [];

  cleanupAllFilePreviews();
  form.innerHTML = '';
  if (normalized.length === 0) {
    addStageAfter(null, null, { silent: true });
  } else {
    for (const stage of normalized) {
      addStageAfter(null, stage, { silent: true });
    }
  }

  for (const card of getStageCards()) {
    card.classList.remove('is-active', 'is-done');
    const filesInput = card.querySelector('.stage-files');
    filesInput.value = '';
    filesInput._selectedFiles = [];
    const fileListEl = card.querySelector('.file-list');
    resetFilePreview(fileListEl);
    fileListEl.textContent = '未选择文件';
  }
  renderTaskFormPanel();
  requestAnimationFrame(drawNodeLinks);
}

async function renderWorkflowOptions(selectedName = '') {
  try {
    const response = await fetch('/api/workflows');
    const data = await response.json();
    if (!response.ok || !data.ok) {
      throw new Error(data.message || '读取工作流列表失败。');
    }
    renderWorkflowOptionsFromList(data.workflows, selectedName);
  } catch (error) {
    workflowSelectEl.innerHTML = '<option value="">工作流列表读取失败</option>';
    appendLog(`工作流列表读取失败：${error.message}`);
  }
}

async function initBrowserOptions() {
  try {
    const response = await fetch('/api/health');
    const data = await response.json();
    if (!response.ok || !data.ok || !Array.isArray(data.browsers)) return;
    browserCatalog = data.browsers;
    renderBrowserOptions(browserCatalog, browserTypeEl.value || data.defaultBrowser || 'edge');
    renderWorkspaceTabs();
  } catch (_error) {
    updateBrowserHint();
  }
}

async function initTargetOptions() {
  try {
    const response = await fetch('/api/health');
    const data = await response.json();
    if (!response.ok || !data.ok || !Array.isArray(data.targets)) return;
    targetCatalog = data.targets;
    renderTargetOptions(targetCatalog, targetPlatformEl.value || data.defaultTarget || 'chatgpt');
    renderWorkspaceTabs();
  } catch (_error) {
    updateTargetHint();
  }
}

function renderBrowserOptions(browsers, selectedType = 'edge') {
  const previousValue = selectedType || browserTypeEl.value || 'edge';
  browserTypeEl.innerHTML = '';

  for (const browser of browsers) {
    const option = document.createElement('option');
    option.value = browser.type;
    option.textContent = browser.requiresPath
      ? browser.label
      : `${browser.label}${browser.installed ? '' : '（未检测到）'}`;
    browserTypeEl.appendChild(option);
  }

  if (!hasBrowserOption(previousValue)) {
    ensureBrowserOption(previousValue, previousValue);
  }
  browserTypeEl.value = previousValue;
  syncBrowserPathVisibility();
}

function renderTargetOptions(targets, selectedType = 'chatgpt') {
  const previousValue = selectedType || targetPlatformEl.value || 'chatgpt';
  targetPlatformEl.innerHTML = '';

  for (const target of targets) {
    const option = document.createElement('option');
    option.value = target.type;
    option.textContent = target.label;
    targetPlatformEl.appendChild(option);
  }

  if (!hasTargetOption(previousValue)) {
    const option = document.createElement('option');
    option.value = previousValue;
    option.textContent = previousValue;
    targetPlatformEl.appendChild(option);
  }
  targetPlatformEl.value = previousValue;
  syncTargetUrlVisibility();
}

function readBrowserOptionsFromSelect() {
  return [...browserTypeEl.options].map((option) => ({
    type: option.value,
    label: option.textContent,
    installed: true,
    executablePath: '',
    requiresPath: option.value === 'custom',
  }));
}

function readTargetOptionsFromSelect() {
  return [...targetPlatformEl.options].map((option) => ({
    type: option.value,
    label: option.textContent,
    url: '',
    requiresUrl: option.value === 'custom',
  }));
}

function hasBrowserOption(type) {
  return [...browserTypeEl.options].some((option) => option.value === type);
}

function hasTargetOption(type) {
  return [...targetPlatformEl.options].some((option) => option.value === type);
}

function ensureBrowserOption(type, label = type) {
  if (!type || hasBrowserOption(type)) return;
  const option = document.createElement('option');
  option.value = type;
  option.textContent = label;
  browserTypeEl.appendChild(option);
}

function renderWorkflowOptionsFromList(workflows, selectedName = '') {
  workflowSelectEl.innerHTML = '';
  const newWorkflowOption = document.createElement('option');
  newWorkflowOption.value = WORKFLOW_NEW_VALUE;
  newWorkflowOption.textContent = '新建工作流';
  if (!selectedName || selectedName === WORKFLOW_NEW_VALUE) newWorkflowOption.selected = true;
  workflowSelectEl.appendChild(newWorkflowOption);

  for (const item of workflows) {
    const option = document.createElement('option');
    option.value = item.name;
    option.textContent = item.name;
    if (item.name === selectedName) option.selected = true;
    workflowSelectEl.appendChild(option);
  }
}

function getBrowserConfig() {
  return {
    browserType: browserTypeEl.value,
    browserPath: browserPathEl.value.trim(),
    profileMode: profileModeEl.value === 'system' ? 'system' : 'isolated',
    isolatedProfileName: isolatedProfileNameEl.value.trim() || 'Default',
    profileDirectory: profileDirectoryEl.value.trim() || 'Default',
  };
}

function getTargetConfig() {
  return {
    targetPlatform: targetPlatformEl.value,
    targetUrl: targetUrlEl.value.trim(),
  };
}

function applyBrowserConfig(browser = {}) {
  const normalized = normalizeBrowserConfig(browser);
  const type = normalized.browserType || 'edge';
  ensureBrowserOption(type, normalized.label || type);
  browserTypeEl.value = hasBrowserOption(type) ? type : 'edge';
  browserPathEl.value = normalized.browserPath || '';
  profileModeEl.value = normalized.profileMode || 'isolated';
  isolatedProfileNameEl.value = normalized.isolatedProfileName || 'Default';
  profileDirectoryEl.value = normalized.profileDirectory || 'Default';
  syncBrowserPathVisibility();
}

function applyTargetConfig(target = {}) {
  const type = target.targetPlatform || target.targetType || 'chatgpt';
  if (!hasTargetOption(type)) {
    const option = document.createElement('option');
    option.value = type;
    option.textContent = type;
    targetPlatformEl.appendChild(option);
  }
  targetPlatformEl.value = hasTargetOption(type) ? type : 'chatgpt';
  targetUrlEl.value = target.targetUrl || '';
  syncTargetUrlVisibility();
}

function syncBrowserPathVisibility() {
  const isCustom = browserTypeEl.value === 'custom';
  const isSystemProfile = profileModeEl.value === 'system';
  browserPathEl.classList.toggle('hidden', !isCustom);
  browserPathHintEl.classList.toggle('hidden', !isCustom);
  isolatedProfileNameEl.classList.toggle('hidden', isSystemProfile);
  isolatedProfileHintEl.classList.toggle('hidden', isSystemProfile);
  profileDirectoryEl.classList.toggle('hidden', !isSystemProfile);
  systemProfileHintEl.classList.toggle('hidden', !isSystemProfile);
  updateBrowserHint();
}

function syncTargetUrlVisibility() {
  const isCustom = targetPlatformEl.value === 'custom';
  targetUrlEl.classList.toggle('hidden', !isCustom);
  updateTargetHint();
  updateOpenTargetButton();
}

function updateBrowserHint() {
  if (!browserHintEl) return;
  const current = browserCatalog.find((browser) => browser.type === browserTypeEl.value);
  const profileMode = profileModeEl.value === 'system' ? 'system' : 'isolated';

  if (browserTypeEl.value === 'custom') {
    browserHintEl.textContent = profileMode === 'isolated'
      ? '自定义路径，独立资料。'
      : '自定义路径，原资料。';
    return;
  }

  if (current?.installed && current.executablePath) {
    browserHintEl.textContent = profileMode === 'isolated'
      ? '已检测，独立资料。'
      : '已检测，原资料。';
    return;
  }

  if (current && current.installed === false) {
    browserHintEl.textContent = '未检测到，使用自定义路径。';
    return;
  }

  browserHintEl.textContent = '独立资料，不影响原浏览器。';
}

function updateTargetHint() {
  if (!targetHintEl) return;
  const current = targetCatalog.find((target) => target.type === targetPlatformEl.value);
  if (targetPlatformEl.value === 'custom') {
    targetHintEl.textContent = '发送到自定义平台。';
    return;
  }
  targetHintEl.textContent = `发送到 ${current?.label || getTargetLabel()}。`;
}

function updateOpenTargetButton() {
  if (!openChatGPTButton) return;
  openChatGPTButton.textContent = `新开 ${getTargetLabel()} 窗口`;
}

function getTargetLabel() {
  if (targetPlatformEl.value === 'custom') return '自定义平台';
  const current = targetCatalog.find((target) => target.type === targetPlatformEl.value);
  return current?.label || targetPlatformEl.options[targetPlatformEl.selectedIndex]?.textContent || '目标平台';
}

function setRunningUi(isRunning) {
  startButton.disabled = false;
  stopButton.disabled = !isRunning;
  browserTypeEl.disabled = isRunning;
  browserPathEl.disabled = isRunning;
  profileModeEl.disabled = isRunning;
  isolatedProfileNameEl.disabled = isRunning;
  profileDirectoryEl.disabled = isRunning;
  targetPlatformEl.disabled = isRunning;
  targetUrlEl.disabled = isRunning;
  syncStageButtons(false);
}

function setButtonsBusy(isBusy) {
  openChatGPTButton.disabled = isBusy;
  startButton.disabled = isBusy;
}

function syncStageButtons(forceDisabled = false) {
  const cards = getStageCards();
  const reachedMax = cards.length >= MAX_STAGES;
  const reachedMin = cards.length <= 1;
  cards.forEach((card) => {
    const addButton = card.querySelector('.add-stage-button');
    const removeButton = card.querySelector('.stage-remove-button');
    if (addButton) addButton.disabled = forceDisabled || reachedMax;
    if (removeButton) removeButton.disabled = forceDisabled || reachedMin;
  });
}

async function postJson(url, payload) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await response.json();
  if (!response.ok || !data.ok) {
    throw new Error(data.message || '请求失败。');
  }
  return data;
}

async function clearCurrentLogs() {
  const workspace = getActiveWorkspace();
  const task = getActiveTask(workspace);
  const jobId = task?.jobId || task?.job?.id || null;

  setTaskLocalLogs(workspace, task, []);
  if (jobId) {
    clearJobLogs(workspace, jobId);
    try {
      await postJson(`/api/jobs/${jobId}/logs/clear`, {});
    } catch (error) {
      setTaskLocalLogs(workspace, task, [makeLogLine(`日志清空失败：${error.message}`)]);
    }
  }

  saveWorkspaceState();
  renderWorkspaceJobState(workspace);
  logBox.textContent = '日志已清空。';
  logBox.scrollTop = logBox.scrollHeight;
  renderWorkspaceTabs();
  syncMonitorSummary();
}

function appendLog(message) {
  const line = makeLogLine(message);
  const workspace = getActiveWorkspace();
  if (workspace) {
    const task = getActiveTask(workspace);
    const currentLogs = task ? task.localLogs : workspace.localLogs;
    const nextLogs = [...(currentLogs || []), line].slice(-200);
    setTaskLocalLogs(workspace, task, nextLogs);
    workspace.updatedAt = new Date().toISOString();
    saveWorkspaceState();
    renderWorkspaceTabs();
  }
  logBox.textContent = logBox.textContent && logBox.textContent !== '等待操作。'
    ? `${logBox.textContent}\n${line}`
    : line;
  logBox.scrollTop = logBox.scrollHeight;
}

function makeLogLine(message) {
  const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  return `[${time}] ${message}`;
}

function statusLabel(status) {
  const map = {
    queued: '排队中',
    running: '执行中',
    completed: '已完成',
    failed: '失败',
    stopped: '已暂停',
  };
  return map[status] || status || '未开始';
}
