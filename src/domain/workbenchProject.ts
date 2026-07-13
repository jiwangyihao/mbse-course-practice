import type { AgentModelingSession, AgentSidecarEvent } from './agentSidecar';
import type { ConfirmedTianwen2Data, ModelGenerationResult, ModelSourceFile, ModelSourceSet } from './modelGeneration';
import type { ProjectExportBundle } from './projectExport';
import type { BundledSampleProject, ModelArtifact, SampleProjectManifest, SourceMaterial } from './workbench';

export interface PersistedProjectFile {
  path: string;
  content: string;
  mediaType: string;
}

export interface SavedWorkbenchProjectState {
  projectRoot: string | null;
  savedAt: string | null;
  manifestPath: string;
  manifest: SampleProjectManifest;
  sourceMaterials: SourceMaterial[];
  modelArtifacts: ModelArtifact[];
  confirmedData: ConfirmedTianwen2Data | null;
  generatedArtifacts: ModelGenerationResult | null;
  sidecarDraft: ModelGenerationResult | null;
  agentTraceSessions: AgentModelingSession[] | null;
  lastExportedBundle: ProjectExportBundle | null;
  files: PersistedProjectFile[];
}

export interface WorkbenchProjectResource {
  id: string;
  title: string;
  kind: '项目清单' | '源材料' | 'SysML v2' | '视图模型' | 'validation' | 'Sidecar 草案' | 'Agent 轨迹';
  path: string;
  mediaType: string;
  content: string;
}

export const MAX_PERSISTED_AGENT_TRACE_CHARACTERS = 2_000_000;

const MAX_PERSISTED_AGENT_TRACE_SESSIONS = 8;
const MAX_PERSISTED_AGENT_TRACE_EVENTS = 700;
const MAX_PERSISTED_AGENT_TRACE_PRIORITY_EVENTS = 200;
const MAX_PERSISTED_AGENT_TRACE_TEXT_CHARACTERS = 8_000;
const MAX_PERSISTED_AGENT_TRACE_PAYLOAD_CHARACTERS = 32_000;
const PRIORITY_TRACE_EVENT_TYPES = new Set<AgentSidecarEvent['type']>([
  'session-started',
  'session-finished',
  'phase',
  'progress',
  'suggestion',
  'extraction',
  'model-draft',
  'error',
  'reasoning-summary',
]);

function exceedsJsonCharacterBudget(value: unknown, budget: number) {
  const stack: unknown[] = [value];
  const seen = new WeakSet<object>();
  let estimate = 0;

  while (stack.length > 0) {
    const current = stack.pop();
    if (current === null || current === undefined) {
      estimate += 8;
    } else if (typeof current === 'string') {
      estimate += current.length + 8;
    } else if (typeof current === 'number' || typeof current === 'boolean') {
      estimate += 24;
    } else if (typeof current === 'object') {
      if (seen.has(current)) {
        return true;
      }
      seen.add(current);
      estimate += 16;
      if (Array.isArray(current)) {
        for (const item of current) stack.push(item);
      } else {
        for (const [key, nested] of Object.entries(current)) {
          estimate += key.length + 8;
          stack.push(nested);
        }
      }
    }
    if (estimate > budget) return true;
  }

  return false;
}

function truncatePersistedTraceText(value: string | undefined) {
  if (typeof value !== 'string' || value.length <= MAX_PERSISTED_AGENT_TRACE_TEXT_CHARACTERS) {
    return value;
  }
  const omitted = value.length - MAX_PERSISTED_AGENT_TRACE_TEXT_CHARACTERS;
  return `${value.slice(0, MAX_PERSISTED_AGENT_TRACE_TEXT_CHARACTERS)}\n…[持久化时截断 ${omitted} 字符]`;
}

function truncatePersistedTraceList(values: string[] | undefined) {
  return values?.slice(0, 50).map((value) => truncatePersistedTraceText(value) ?? '');
}

function projectTraceEventForPersistence(event: AgentSidecarEvent): AgentSidecarEvent {
  const message = truncatePersistedTraceText(event.message) ?? '';
  const payload = exceedsJsonCharacterBudget(event.payload, MAX_PERSISTED_AGENT_TRACE_PAYLOAD_CHARACTERS)
    ? null
    : event.payload;
  switch (event.type) {
    case 'model-draft':
      return {
        ...event,
        message,
        payload,
        executionReport: event.executionReport
          ? {
              summary: truncatePersistedTraceText(event.executionReport.summary),
              actions: truncatePersistedTraceList(event.executionReport.actions),
              verificationNotes: truncatePersistedTraceList(event.executionReport.verificationNotes),
            }
          : undefined,
      };
    case 'suggestion':
      return {
        ...event,
        message,
        payload,
        recommendation: truncatePersistedTraceText(event.recommendation) ?? '',
        sourceUrls: event.sourceUrls?.slice(0, 50),
        affectedElements: truncatePersistedTraceList(event.affectedElements),
      };
    case 'reasoning-delta':
    case 'reasoning-end':
    case 'output-delta':
      return {
        ...event,
        message,
        payload,
        text: truncatePersistedTraceText(event.text) ?? '',
      };
    case 'reasoning-summary':
      return {
        ...event,
        message,
        payload,
        summaryText: truncatePersistedTraceText(event.summaryText),
      };
    case 'tool-call-start':
      return {
        ...event,
        message,
        payload,
        argsSummary: truncatePersistedTraceText(event.argsSummary),
      };
    case 'tool-call-update':
      return {
        ...event,
        message,
        payload,
        argsSummary: truncatePersistedTraceText(event.argsSummary),
        partialSummary: truncatePersistedTraceText(event.partialSummary),
      };
    case 'tool-call-end':
      return {
        ...event,
        message,
        payload,
        argsSummary: truncatePersistedTraceText(event.argsSummary),
        resultSummary: truncatePersistedTraceText(event.resultSummary),
      };
    default:
      return { ...event, message, payload };
  }
}

function selectTraceEventsForPersistence(events: AgentSidecarEvent[]) {
  if (events.length <= MAX_PERSISTED_AGENT_TRACE_EVENTS) {
    return events.map(projectTraceEventForPersistence);
  }

  const firstStarted = events.find((event) => event.type === 'session-started');
  const priority = events
    .filter((event) => PRIORITY_TRACE_EVENT_TYPES.has(event.type))
    .slice(-MAX_PERSISTED_AGENT_TRACE_PRIORITY_EVENTS);
  const tail = events.slice(-(MAX_PERSISTED_AGENT_TRACE_EVENTS - MAX_PERSISTED_AGENT_TRACE_PRIORITY_EVENTS));
  const selected = new Map<string, AgentSidecarEvent>();
  for (const event of [firstStarted, ...priority, ...tail]) {
    if (!event) continue;
    selected.set(`${event.sessionId}:${event.sequence}:${event.type}`, event);
  }
  return [...selected.values()]
    .sort((left, right) => left.sequence - right.sequence)
    .map(projectTraceEventForPersistence);
}

function summarizeDomainTraceEvent(event: AgentSidecarEvent): AgentSidecarEvent {
  if (event.type !== 'extraction' && event.type !== 'model-draft') {
    return projectTraceEventForPersistence(event);
  }
  return {
    protocolVersion: event.protocolVersion,
    sessionId: event.sessionId,
    sequence: event.sequence,
    timestamp: event.timestamp,
    phase: event.phase,
    type: 'sdk-event',
    rawKind: `${event.rawKind}:persisted-summary`,
    message: `${truncatePersistedTraceText(event.message) ?? event.type}（完整领域结果已保存到项目状态与模型工件文件）`,
    payload: null,
  };
}

function compactAgentTraceSessions(sessions: AgentModelingSession[]) {
  return sessions.slice(-MAX_PERSISTED_AGENT_TRACE_SESSIONS).map((session) => ({
    ...session,
    events: selectTraceEventsForPersistence(session.events),
  }));
}

function summarizeAgentTraceSessions(sessions: AgentModelingSession[]) {
  return sessions.map((session) => ({
    ...session,
    events: session.events.map(summarizeDomainTraceEvent),
  }));
}

function minimalAgentTraceSessions(sessions: AgentModelingSession[]): AgentModelingSession[] {
  return sessions.map((session) => {
    const latest = session.events.at(-1);
    return {
      sessionId: session.sessionId,
      provider: session.provider,
      model: session.model,
      completedAt: session.completedAt,
      events: latest
        ? [{
            protocolVersion: latest.protocolVersion,
            sessionId: latest.sessionId,
            sequence: latest.sequence,
            timestamp: latest.timestamp,
            phase: latest.phase,
            type: 'sdk-event',
            rawKind: 'persisted-trace-summary',
            message: 'Agent 轨迹超过持久化上限；完整模型结果已保留，运行时增量轨迹已压缩。',
            payload: null,
          }]
        : [],
    };
  });
}

function prepareAgentTraceSessionsForPersistence(sessions: AgentModelingSession[] | null) {
  if (!sessions || sessions.length === 0) return null;
  if (!exceedsJsonCharacterBudget(sessions, MAX_PERSISTED_AGENT_TRACE_CHARACTERS)) {
    const content = JSON.stringify(sessions, null, 2);
    if (content.length <= MAX_PERSISTED_AGENT_TRACE_CHARACTERS) {
      return { sessions, content };
    }
  }

  let persistedSessions = compactAgentTraceSessions(sessions);
  if (exceedsJsonCharacterBudget(persistedSessions, MAX_PERSISTED_AGENT_TRACE_CHARACTERS)) {
    persistedSessions = summarizeAgentTraceSessions(persistedSessions);
  }
  if (exceedsJsonCharacterBudget(persistedSessions, MAX_PERSISTED_AGENT_TRACE_CHARACTERS)) {
    persistedSessions = minimalAgentTraceSessions(persistedSessions);
  }
  const content = JSON.stringify(persistedSessions, null, 2);
  return { sessions: persistedSessions, content };
}

export function createWorkbenchProjectState(
  project: BundledSampleProject,
  options: {
    confirmedData?: ConfirmedTianwen2Data | null;
    generatedArtifacts?: ModelGenerationResult | null;
    sidecarDraft?: ModelGenerationResult | null;
    agentTraceSessions?: AgentModelingSession[] | null;
    lastExportedBundle?: ProjectExportBundle | null;
    projectRoot?: string | null;
    savedAt?: string | null;
    sourceText?: string;
  } = {},
): SavedWorkbenchProjectState {
  const generatedArtifacts = options.generatedArtifacts ?? null;
  const sidecarDraft = options.sidecarDraft ?? null;
  const persistedAgentTrace = prepareAgentTraceSessionsForPersistence(options.agentTraceSessions ?? null);
  const agentTraceSessions = persistedAgentTrace?.sessions ?? null;
  const sourceMaterials = project.sourceMaterials.map((material, index) => ({
    ...material,
    content: index === 0 && typeof options.sourceText === 'string' ? options.sourceText : material.content,
  }));
  const modelArtifacts = project.modelArtifacts.map((artifact) => hydrateModelArtifact(artifact, generatedArtifacts));
  const manifestPath = `sample-projects/${project.manifest.id}/project.json`;
  const files: PersistedProjectFile[] = [
    {
      path: manifestPath,
      mediaType: 'application/json',
      content: JSON.stringify(project.manifest, null, 2),
    },
    ...sourceMaterials.map((material) => ({
      path: material.path,
      mediaType: 'text/markdown',
      content: material.content,
    })),
    ...modelArtifacts.map((artifact) => ({
      path: artifact.path,
      mediaType: artifact.kind === 'sysml-v2' ? 'text/x-sysml' : 'application/json',
      content: artifact.content,
    })),
  ];

  if (sidecarDraft) {
    files.push(
      ...buildSidecarDraftSourceFiles(project.manifest.id, sidecarDraft, files),
      {
        path: `sample-projects/${project.manifest.id}/sidecar/agent-model-draft-view-model.json`,
        mediaType: 'application/json',
        content: JSON.stringify(sidecarDraft.viewModel, null, 2),
      },
      {
        path: `sample-projects/${project.manifest.id}/sidecar/agent-model-draft-validation.json`,
        mediaType: 'application/json',
        content: JSON.stringify(sidecarDraft.validation, null, 2),
      },
    );
  }

  if (agentTraceSessions && agentTraceSessions.length > 0) {
    files.push({
      path: agentTraceSessionsPath(project.manifest.id),
      mediaType: 'application/json',
      content: persistedAgentTrace!.content,
    });
  }

  if (generatedArtifacts) {
    files.push({
      path: validationArtifactPath(project.manifest.id),
      mediaType: 'application/json',
      content: JSON.stringify(generatedArtifacts.validation, null, 2),
    });
  }

  return {
    projectRoot: options.projectRoot ?? null,
    savedAt: options.savedAt ?? null,
    manifestPath,
    manifest: { ...project.manifest },
    sourceMaterials,
    modelArtifacts,
    confirmedData: options.confirmedData ?? null,
    generatedArtifacts,
    sidecarDraft,
    agentTraceSessions,
    lastExportedBundle: options.lastExportedBundle ?? null,
    files,
  };
}

export function normalizeSavedWorkbenchProjectState(state: SavedWorkbenchProjectState): SavedWorkbenchProjectState {
  const normalizedGeneratedArtifacts = normalizeModelResultFromPersistedFiles(
    state.generatedArtifacts,
    buildGeneratedSourceSetFromPersistedFiles(state.manifest.id, state.files),
  );
  const normalizedSidecarDraft = normalizeModelResultFromPersistedFiles(
    state.sidecarDraft,
    buildSidecarDraftSourceSetFromPersistedFiles(state.manifest.id, state.files),
  );
  const normalizedAgentTraceSessions = normalizeAgentTraceSessions(
    state.agentTraceSessions,
    buildSidecarDraftSourceSetFromPersistedFiles(state.manifest.id, state.files),
  );

  if (
    normalizedGeneratedArtifacts === state.generatedArtifacts
    && normalizedSidecarDraft === state.sidecarDraft
    && normalizedAgentTraceSessions === state.agentTraceSessions
  ) {
    return state;
  }

  return {
    ...state,
    generatedArtifacts: normalizedGeneratedArtifacts,
    sidecarDraft: normalizedSidecarDraft,
    agentTraceSessions: normalizedAgentTraceSessions,
  };
}

export function listWorkbenchProjectResources(state: SavedWorkbenchProjectState): WorkbenchProjectResource[] {
  const normalizedState = normalizeSavedWorkbenchProjectState(state);
  const resources: WorkbenchProjectResource[] = [
    {
      id: 'project-manifest',
      title: '项目清单',
      kind: '项目清单',
      path: normalizedState.manifestPath,
      mediaType: 'application/json',
      content: JSON.stringify(normalizedState.manifest, null, 2),
    },
    ...normalizedState.sourceMaterials.map((material) => ({
      id: material.id,
      title: material.title,
      kind: '源材料' as const,
      path: material.path,
      mediaType: 'text/markdown',
      content: material.content,
    })),
    ...normalizedState.modelArtifacts.map((artifact) => ({
      id: artifact.id,
      title: artifact.title,
      kind: artifact.kind === 'sysml-v2' ? ('SysML v2' as const) : ('视图模型' as const),
      path: artifact.path,
      mediaType: artifact.kind === 'sysml-v2' ? 'text/x-sysml' : 'application/json',
      content: artifact.content,
    })),
  ];

  if (normalizedState.generatedArtifacts) {
    resources.push({
      id: 'generated-validation-result',
      title: 'validation 结果',
      kind: 'validation',
      path: validationArtifactPath(normalizedState.manifest.id),
      mediaType: 'application/json',
      content: JSON.stringify(normalizedState.generatedArtifacts.validation, null, 2),
    });
  }

  if (normalizedState.sidecarDraft) {
    const sidecarDraft = normalizedState.sidecarDraft;
    resources.push(
      ...buildSidecarDraftSourceResources(normalizedState.manifest.id, sidecarDraft, normalizedState.files),
      {
        id: 'sidecar-draft-view-model',
        title: 'Sidecar 草案视图模型 JSON',
        kind: 'Sidecar 草案',
        path: `sample-projects/${normalizedState.manifest.id}/sidecar/agent-model-draft-view-model.json`,
        mediaType: 'application/json',
        content: JSON.stringify(sidecarDraft.viewModel, null, 2),
      },
      {
        id: 'sidecar-draft-validation',
        title: 'Sidecar 草案 validation',
        kind: 'Sidecar 草案',
        path: `sample-projects/${normalizedState.manifest.id}/sidecar/agent-model-draft-validation.json`,
        mediaType: 'application/json',
        content: JSON.stringify(sidecarDraft.validation, null, 2),
      },
    );
  }

  if (normalizedState.agentTraceSessions && normalizedState.agentTraceSessions.length > 0) {
    resources.push({
      id: 'agent-trace-sessions',
      title: 'Agent 执行轨迹会话 JSON',
      kind: 'Agent 轨迹',
      path: agentTraceSessionsPath(normalizedState.manifest.id),
      mediaType: 'application/json',
      content: JSON.stringify(normalizedState.agentTraceSessions, null, 2),
    });
  }

  return resources;
}

export function findWorkbenchProjectResource(
  state: SavedWorkbenchProjectState,
  resourceId: string,
): WorkbenchProjectResource | undefined {
  return listWorkbenchProjectResources(state).find((resource) => resource.id === resourceId);
}

export function validationArtifactPath(projectId: string) {
  return `sample-projects/${projectId}/model/validation-result.json`;
}

export function agentTraceSessionsPath(projectId: string) {
  return `sample-projects/${projectId}/sidecar/agent-trace-sessions.json`;
}

function sidecarDraftLegacyEntryPath(projectId: string) {
  return `sample-projects/${projectId}/sidecar/agent-model-draft.sysml`;
}

function sidecarDraftSourceRoot(projectId: string, sourceSet: ModelSourceSet) {
  const base = `sample-projects/${projectId}/sidecar/agent-model-draft`;
  return sourceSet.rootDir === '' ? base : `${base}/${sourceSet.rootDir}`;
}

function sidecarDraftSourceFilePath(projectId: string, sourceSet: ModelSourceSet, relativePath: string) {
  return `${sidecarDraftSourceRoot(projectId, sourceSet)}/${relativePath}`;
}

function sidecarDraftSourceResourceId(relativePath: string) {
  return `sidecar-draft-source-${relativePath.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '')}`;
}

function buildSidecarDraftSourceFiles(projectId: string, draft: ModelGenerationResult, files: PersistedProjectFile[]): PersistedProjectFile[] {
  const sourceSet = readNormalizedSourceSet(draft, buildSidecarDraftSourceSetFromPersistedFiles(projectId, files));
  if (!sourceSet) {
    return [];
  }
  return sourceSet.files.map((file) => ({
    path: sidecarDraftSourceFilePath(projectId, sourceSet, file.path),
    mediaType: 'text/x-sysml',
    content: file.content,
  }));
}

function buildSidecarDraftSourceResources(projectId: string, draft: ModelGenerationResult, files: PersistedProjectFile[]): WorkbenchProjectResource[] {
  const sourceSet = readNormalizedSourceSet(draft, buildSidecarDraftSourceSetFromPersistedFiles(projectId, files));
  if (!sourceSet) {
    return [];
  }
  return sourceSet.files.map((file) => ({
    id: sidecarDraftSourceResourceId(file.path),
    title: `Sidecar 草案 SysML v2：${file.path}`,
    kind: 'Sidecar 草案',
    path: sidecarDraftSourceFilePath(projectId, sourceSet, file.path),
    mediaType: 'text/x-sysml',
    content: file.content,
  }));
}

function hydrateModelArtifact(artifact: ModelArtifact, generatedArtifacts: ModelGenerationResult | null): ModelArtifact {
  if (!generatedArtifacts) {
    return { ...artifact };
  }

  if (artifact.kind === 'sysml-v2') {
    const sourceSet = readNormalizedSourceSet(generatedArtifacts, null);
    const relativePath = artifact.path.replace(/^sample-projects\/[^/]+\/model\//, '');
    const file = sourceSet?.files.find((candidate) => candidate.path === relativePath)
      ?? sourceSet?.files.find((candidate) => candidate.path === sourceSet.entryPath);
    return {
      ...artifact,
      placeholder: false,
      content: file?.content ?? '',
    };
  }

  return {
    ...artifact,
    placeholder: false,
    content: JSON.stringify(generatedArtifacts.viewModel, null, 2),
  };
}

function normalizeModelResultFromPersistedFiles(
  result: ModelGenerationResult | null,
  fallbackSourceSet: ModelSourceSet | null,
): ModelGenerationResult | null {
  if (!result) {
    return null;
  }
  const sourceSet = readSourceSetLike(result);
  if (sourceSet) {
    return result;
  }
  return fallbackSourceSet ? { ...result, sourceSet: fallbackSourceSet } : null;
}

function normalizeAgentTraceSessions(
  sessions: AgentModelingSession[] | null,
  fallbackSourceSet: ModelSourceSet | null,
): AgentModelingSession[] | null {
  if (!sessions) {
    return null;
  }

  let changed = false;
  const normalizedSessions: AgentModelingSession[] = [];
  for (const session of sessions) {
    const nextEvents: AgentSidecarEvent[] = [];
    let sessionChanged = false;
    for (const event of session.events) {
      if (event.type !== 'model-draft') {
        nextEvents.push(event);
        continue;
      }
      const normalizedDraft = normalizeModelResultFromPersistedFiles(event.draft, fallbackSourceSet);
      if (!normalizedDraft) {
        changed = true;
        sessionChanged = true;
        continue;
      }
      if (normalizedDraft !== event.draft) {
        changed = true;
        sessionChanged = true;
        nextEvents.push({ ...event, draft: normalizedDraft });
        continue;
      }
      nextEvents.push(event);
    }
    if (sessionChanged) {
      normalizedSessions.push({ ...session, events: nextEvents });
    } else {
      normalizedSessions.push(session);
    }
  }

  return changed ? normalizedSessions : sessions;
}

function buildGeneratedSourceSetFromPersistedFiles(projectId: string, files: PersistedProjectFile[]) {
  return buildSourceSetFromPersistedFiles({
    entryPath: 'model.sysml',
    files,
    prefix: `sample-projects/${projectId}/model/`,
  });
}

function buildSidecarDraftSourceSetFromPersistedFiles(projectId: string, files: PersistedProjectFile[]) {
  return buildSourceSetFromPersistedFiles({
    entryPath: 'model.sysml',
    files,
    legacySinglePath: sidecarDraftLegacyEntryPath(projectId),
    prefix: `sample-projects/${projectId}/sidecar/agent-model-draft/`,
  });
}

function buildSourceSetFromPersistedFiles({
  files,
  prefix,
  legacySinglePath,
  entryPath,
}: {
  files: PersistedProjectFile[];
  prefix: string;
  legacySinglePath?: string;
  entryPath: string;
}): ModelSourceSet | null {
  const sourceFiles: ModelSourceFile[] = [];
  for (const file of files) {
    if (file.mediaType !== 'text/x-sysml' || file.content.trim() === '') {
      continue;
    }
    const normalizedPath = normalizePath(file.path);
    if (normalizedPath.startsWith(prefix)) {
      const relativePath = normalizedPath.slice(prefix.length);
      if (relativePath.trim() !== '') {
        sourceFiles.push({ path: relativePath, content: file.content });
      }
      continue;
    }
    if (legacySinglePath && normalizedPath === legacySinglePath) {
      sourceFiles.push({ path: entryPath, content: file.content });
    }
  }

  if (sourceFiles.length === 0) {
    return null;
  }

  sourceFiles.sort((left, right) => left.path.localeCompare(right.path));
  const resolvedEntryPath = sourceFiles.some((file) => file.path === entryPath) ? entryPath : sourceFiles[0]!.path;
  return {
    rootDir: '',
    entryPath: resolvedEntryPath,
    files: sourceFiles,
  };
}

function readNormalizedSourceSet(result: ModelGenerationResult, fallbackSourceSet: ModelSourceSet | null) {
  const sourceSetValue = readSourceSetLike(result);
  if (sourceSetValue) {
    return sourceSetValue;
  }
  return fallbackSourceSet;
}

function readSourceSetLike(result: ModelGenerationResult): ModelSourceSet | null {
  if (!isRecord(result) || !('sourceSet' in result)) {
    return null;
  }
  const sourceSetValue = result.sourceSet;
  if (!isRecord(sourceSetValue)) {
    return null;
  }
  const rootDir = typeof sourceSetValue.rootDir === 'string' ? normalizePath(sourceSetValue.rootDir) : '';
  const filesValue = sourceSetValue.files;
  if (!Array.isArray(filesValue)) {
    return null;
  }
  const files = filesValue.flatMap((file) => {
    if (!isRecord(file)) {
      return [];
    }
    const path = typeof file.path === 'string' ? normalizePath(file.path) : '';
    const content = typeof file.content === 'string' ? file.content : '';
    return path.trim() === '' || content.trim() === '' ? [] : [{ path, content }];
  });
  if (files.length === 0) {
    return null;
  }
  files.sort((left, right) => left.path.localeCompare(right.path));
  const entryCandidate = typeof sourceSetValue.entryPath === 'string' ? normalizePath(sourceSetValue.entryPath) : '';
  const entryPath = files.some((file) => file.path === entryCandidate) ? entryCandidate : files[0]!.path;
  return {
    rootDir,
    entryPath,
    files,
  };
}

function normalizePath(path: string) {
  return path.replace(/\\/g, '/');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
