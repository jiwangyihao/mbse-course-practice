import path from 'node:path';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
// @ts-expect-error Node-only sidecar seam used by tests/sidecar, never browser bundle.
import { runSysml2Analysis } from '../../sidecar/sysml2-backend.mjs';
import {
  type ConfirmedInterface,
  type ConfirmedRequirement,
  type ConfirmedTianwen2Data,
  type GeneratedView,
  type GeneratedViewModel,
  type ModelGenerationResult,
  type ModelSourceFile,
  type ModelSourceSet,
  type ParameterBinding,
  type ParameterConstraint,
  type TraceabilityMatrixCell,
  type TraceabilityMatrixColumn,
  type TraceabilityMatrixRow,
  type ViewConnection,
  type ViewEdge,
  type ViewNode,
  type ViewPort,
  validateViewModel,
} from './modelGeneration';

export const MODEL_SOURCE_SET_ENTRY_FILE = 'model.sysml';
export const MODEL_SOURCE_SET_FILES = Object.freeze([
  MODEL_SOURCE_SET_ENTRY_FILE,
  'requirements.sysml',
  'structure.sysml',
  'behavior.sysml',
  'constraints.sysml',
]);

const PROJECT_INFO_METADATA = 'ProjectInfo';
const ELEMENT_INFO_METADATA = 'ElementInfo';
const RELATED_ELEMENT_METADATA = 'RelatedElement';
const REQUIRED_VIEW_KINDS = ['requirements', 'bdd', 'activity', 'traceability-matrix', 'ibd', 'parameter-constraints'] as const;

type SemanticMetadata = {
  type?: unknown;
  features?: Record<string, unknown>;
};

type SemanticEndpoint = {
  target?: unknown;
  featureChain?: unknown;
  multiplicity?: unknown;
};

type SemanticElement = Record<string, unknown> & {
  id?: unknown;
  name?: unknown;
  type?: unknown;
  parent?: unknown;
  typedBy?: unknown;
  prefixAppliedMetadata?: unknown;
  metadata?: unknown;
  resultExpression?: unknown;
  connectorSource?: unknown;
  connectorTarget?: unknown;
};

type SemanticRelationship = Record<string, unknown> & {
  id?: unknown;
  type?: unknown;
  sourceRaw?: unknown;
  targetRaw?: unknown;
  resolvedSource?: unknown;
  resolvedTarget?: unknown;
};

type SourceSetDerivationIssue = {
  code: string;
  message: string;
  source?: string;
};

type ElementInfo = {
  stableId: string;
  label?: string;
  text?: string;
  category?: string;
  kind?: string;
  unit?: string;
  unitSymbol?: string;
  interfaceId?: string;
};

type DiagramNodeInfo = ElementInfo & {
  stableId: string;
  label: string;
  qualifiedId: string;
};

type SemanticIndex = {
  projectId: string;
  packageName: string;
  issues: SourceSetDerivationIssue[];
  elements: SemanticElement[];
  relationships: SemanticRelationship[];
  byQualifiedId: Map<string, SemanticElement>;
  bySimpleName: Map<string, SemanticElement[]>;
  infoByQualifiedId: Map<string, ElementInfo>;
  relatedElementIdsByQualifiedId: Map<string, string[]>;
};

type PortSeed = {
  stableId: string;
  label: string;
  kind: ConfirmedInterface['kind'];
  interfaceId: string;
  ownerId: string;
  semanticName: string;
};

type IbdInstanceInfo = {
  usageName: string;
  stableId: string;
  typedByQualifiedId: string;
};

function toSysmlIdentifier(value: string) {
  return value.replace(/[^a-zA-Z0-9_]/g, '_').replace(/^([0-9])/, '_$1');
}

function quoteString(value: string) {
  return JSON.stringify(value);
}

function trimString(value: unknown) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : '';
}

function decodeMetadataScalar(value: unknown) {
  if (typeof value !== 'string') return '';
  try {
    const parsed = JSON.parse(value);
    return typeof parsed === 'string' ? parsed : value;
  } catch {
    return value;
  }
}

function normalizeLineEndings(value: string) {
  return value.replace(/\r\n/g, '\n').replace(/\n?$/, '\n');
}

function normalizeSourceRootDir(rootDir: string) {
  const candidate = rootDir.replace(/\\/g, '/').trim();
  if (candidate === '') {
    return '';
  }
  if (path.posix.isAbsolute(candidate)) {
    throw new Error(`source set 根目录不能是绝对路径：${rootDir}`);
  }
  const normalized = path.posix.normalize(candidate).replace(/^\/+|\/+$/g, '');
  if (normalized === '' || normalized === '.' || normalized === '..' || normalized.startsWith('../') || normalized.includes('/../')) {
    throw new Error(`source set 根目录越出允许范围：${rootDir}`);
  }
  return normalized;
}

function normalizeSourceFilePath(rootDir: string, filePath: string) {
  const normalizedRoot = normalizeSourceRootDir(rootDir);
  const candidate = filePath.replace(/\\/g, '/');
  if (path.posix.isAbsolute(candidate)) {
    throw new Error(`source set 文件不能是绝对路径：${filePath}`);
  }
  const normalized = path.posix.normalize(candidate).replace(/^\/+/, '');
  if (normalized === '' || normalized === '.' || normalized === '..' || normalized.startsWith('../') || normalized.includes('/../')) {
    throw new Error(`source set 文件越出根目录：${filePath}`);
  }
  if (!normalized.toLowerCase().endsWith('.sysml')) {
    throw new Error(`source set 文件必须是 .sysml：${filePath}`);
  }
  const full = normalizedRoot === '' ? normalized : `${normalizedRoot}/${normalized}`;
  const relative = normalizedRoot === '' ? full : path.posix.relative(normalizedRoot, full);
  if (relative === '' || relative === '.' || relative === '..' || relative.startsWith('../') || relative.includes('/../')) {
    throw new Error(`source set 文件越出根目录：${filePath}`);
  }
  return relative;
}

export function normalizeModelSourceSet(sourceSet: ModelSourceSet): ModelSourceSet {
  const rootDir = normalizeSourceRootDir(sourceSet.rootDir);
  const files = new Map<string, ModelSourceFile>();
  for (const file of sourceSet.files) {
    const normalizedPath = normalizeSourceFilePath(rootDir, file.path);
    if (files.has(normalizedPath)) {
      throw new Error(`source set 存在重复规范化路径：${normalizedPath}`);
    }
    files.set(normalizedPath, { path: normalizedPath, content: normalizeLineEndings(file.content) });
  }
  const entryPath = normalizeSourceFilePath(rootDir, sourceSet.entryPath);
  if (!files.has(entryPath)) {
    throw new Error(`source set 缺少入口文件：${entryPath}`);
  }
  return {
    rootDir,
    entryPath,
    files: Array.from(files.values()).sort((left, right) => left.path.localeCompare(right.path)),
  };
}

export function getModelSourceFile(sourceSet: ModelSourceSet, relativePath: string) {
  const normalized = normalizeSourceFilePath(sourceSet.rootDir, relativePath);
  return normalizeModelSourceSet(sourceSet).files.find((file) => file.path === normalized);
}

export function getModelSourceEntryContent(sourceSet: ModelSourceSet) {
  const file = getModelSourceFile(sourceSet, sourceSet.entryPath);
  if (!file) {
    throw new Error(`source set 缺少入口文件内容：${sourceSet.entryPath}`);
  }
  return file.content;
}

function appendMetadata(lines: string[], indent: string, metadataUsages: string[]) {
  for (const usage of metadataUsages) {
    for (const line of usage.split('\n')) {
      lines.push(`${indent}${line}`);
    }
  }
}

function buildMetadataUsage(type: string, features: Record<string, string | undefined>) {
  const assignments = Object.entries(features)
    .filter(([, value]) => typeof value === 'string' && value.trim() !== '')
    .map(([key, value]) => `  ${key} = ${quoteString(value as string)};`);
  if (assignments.length === 0) {
    return `@${type};`;
  }
  return [`@${type} {`, ...assignments, '}'].join('\n');
}

function buildElementInfoUsage(info: ElementInfo) {
  return buildMetadataUsage(ELEMENT_INFO_METADATA, {
    stableId: info.stableId,
    label: info.label,
    text: info.text,
    category: info.category,
    kind: info.kind,
    unit: info.unit,
    unitSymbol: info.unitSymbol,
    interfaceId: info.interfaceId,
  });
}

function buildRelatedElementUsages(relatedElementIds: string[]) {
  return relatedElementIds.map((elementId) => buildMetadataUsage(RELATED_ELEMENT_METADATA, { elementId }));
}

function buildPortsBySubsystem(interfaces: ConfirmedInterface[]) {
  const byScopedId = new Map<string, PortSeed>();
  for (const entry of interfaces) {
    byScopedId.set(`${entry.sourceSubsystemId}:${entry.sourcePortId}`, {
      stableId: entry.sourcePortId,
      label: entry.sourcePortLabel,
      kind: entry.kind,
      interfaceId: entry.interfaceId,
      ownerId: entry.sourceSubsystemId,
      semanticName: toSysmlIdentifier(entry.sourcePortId),
    });
    byScopedId.set(`${entry.targetSubsystemId}:${entry.targetPortId}`, {
      stableId: entry.targetPortId,
      label: entry.targetPortLabel,
      kind: entry.kind,
      interfaceId: entry.interfaceId,
      ownerId: entry.targetSubsystemId,
      semanticName: toSysmlIdentifier(entry.targetPortId),
    });
  }
  const grouped = new Map<string, PortSeed[]>();
  for (const port of byScopedId.values()) {
    const existing = grouped.get(port.ownerId) ?? [];
    existing.push(port);
    grouped.set(port.ownerId, existing);
  }
  return grouped;
}

function buildPortTypeResolver(confirmedData: ConfirmedTianwen2Data) {
  const reserved = new Set<string>([
    ...confirmedData.requirements.map((item) => toSysmlIdentifier(item.id)),
    ...confirmedData.subsystems.map((item) => toSysmlIdentifier(item.id)),
    ...confirmedData.activities.map((item) => toSysmlIdentifier(item.id)),
    ...confirmedData.constraints.map((item) => toSysmlIdentifier(item.id)),
    ...confirmedData.parameters.map((item) => toSysmlIdentifier(item.id)),
    ...confirmedData.bindings.map((item) => toSysmlIdentifier(item.id)),
    'system_context',
    'mission_sequence',
  ]);
  const byInterfaceId = new Map<string, string>();
  return (interfaceId: string) => {
    const existing = byInterfaceId.get(interfaceId);
    if (existing) return existing;
    const base = toSysmlIdentifier(interfaceId);
    let candidate = reserved.has(base) ? `${base}_port` : base;
    let suffix = 2;
    while (reserved.has(candidate)) {
      candidate = `${base}_port_${suffix}`;
      suffix += 1;
    }
    reserved.add(candidate);
    byInterfaceId.set(interfaceId, candidate);
    return candidate;
  };
}

function buildConstraintBody(constraint: ParameterConstraint) {
  const parameterName = toSysmlIdentifier(constraint.id.replace(/^constraint[-_]?/i, '').replace(/[-_]?budget$/i, '') || constraint.id);
  const comparator = constraint.expression.includes('<=') ? '<=' : constraint.expression.includes('>=') ? '>=' : '==';
  const number = constraint.expression.match(/(-?\d+(?:\.\d+)?)/)?.[1] ?? '0';
  return [
    `  constraint def ${toSysmlIdentifier(constraint.id)} {`,
    `    in ${parameterName};`,
    `    ${parameterName} ${comparator} ${number}`,
    '  }',
  ];
}

function cloneSourceFile(pathValue: string, content: string): ModelSourceFile {
  return { path: pathValue, content: normalizeLineEndings(content) };
}

function buildEntryFile(confirmedData: ConfirmedTianwen2Data) {
  return cloneSourceFile(
    MODEL_SOURCE_SET_ENTRY_FILE,
    [
      `metadata def ${PROJECT_INFO_METADATA} {`,
      '  attribute projectId;',
      '  attribute packageName;',
      '  attribute source;',
      '}',
      '',
      `metadata def ${ELEMENT_INFO_METADATA} {`,
      '  attribute stableId;',
      '  attribute label;',
      '  attribute text;',
      '  attribute category;',
      '  attribute kind;',
      '  attribute unit;',
      '  attribute unitSymbol;',
      '  attribute interfaceId;',
      '}',
      '',
      `metadata def ${RELATED_ELEMENT_METADATA} {`,
      '  attribute elementId;',
      '}',
      '',
      buildMetadataUsage(PROJECT_INFO_METADATA, {
        projectId: confirmedData.projectId,
        packageName: confirmedData.packageName,
        source: 'sysml-source-set-derived',
      }),
      `package ${confirmedData.packageName} {}`,
    ].join('\n'),
  );
}

function buildRequirementsFile(confirmedData: ConfirmedTianwen2Data) {
  const childrenByParent = new Map<string, ConfirmedRequirement[]>();
  for (const requirement of confirmedData.requirements) {
    if (!requirement.parentId) continue;
    const existing = childrenByParent.get(requirement.parentId) ?? [];
    existing.push(requirement);
    childrenByParent.set(requirement.parentId, existing);
  }

  const lines = [`package ${confirmedData.packageName} {`, ''];
  for (const requirement of confirmedData.requirements) {
    appendMetadata(lines, '  ', [
      buildElementInfoUsage({
        stableId: requirement.id,
        label: requirement.title,
        text: requirement.text,
        category: 'requirement',
      }),
    ]);
    lines.push(`  requirement def ${toSysmlIdentifier(requirement.id)} {`);
    for (const child of childrenByParent.get(requirement.id) ?? []) {
      lines.push(`    requirement ${toSysmlIdentifier(`${child.id}_child`)} : ${toSysmlIdentifier(child.id)};`);
    }
    lines.push('  }');
    lines.push('');
  }
  lines.push('}');
  return cloneSourceFile('requirements.sysml', lines.join('\n'));
}

function buildStructureFile(confirmedData: ConfirmedTianwen2Data) {
  const subsystemByName = new Map(confirmedData.subsystems.map((subsystem) => [subsystem.name, subsystem]));
  const rootSubsystem = confirmedData.subsystems.find((subsystem) => subsystem.parentId === null) ?? confirmedData.subsystems[0];
  const portsBySubsystem = buildPortsBySubsystem(confirmedData.interfaces);
  const resolvePortType = buildPortTypeResolver(confirmedData);
  const lines = [`package ${confirmedData.packageName} {`, ''];

  for (const interfaceId of Array.from(new Set(confirmedData.interfaces.map((entry) => entry.interfaceId)))) {
    lines.push(`  port def ${resolvePortType(interfaceId)};`);
  }
  if (confirmedData.interfaces.length > 0) {
    lines.push('');
  }

  for (const subsystem of confirmedData.subsystems) {
    appendMetadata(lines, '  ', [
      buildElementInfoUsage({
        stableId: subsystem.id,
        label: subsystem.name,
        category: subsystem.parentId === null ? 'system' : 'subsystem',
      }),
    ]);
    lines.push(`  part def ${toSysmlIdentifier(subsystem.id)} {`);
    if (subsystem.id === rootSubsystem?.id) {
      for (const child of confirmedData.subsystems.filter((candidate) => candidate.parentId === subsystem.id)) {
        lines.push(`    part ${toSysmlIdentifier(`${child.id}_member`)} : ${toSysmlIdentifier(child.id)};`);
      }
      if (confirmedData.subsystems.some((candidate) => candidate.parentId === subsystem.id)) {
        lines.push('');
      }
    }
    for (const port of portsBySubsystem.get(subsystem.id) ?? []) {
      appendMetadata(lines, '    ', [
        buildElementInfoUsage({
          stableId: port.stableId,
          label: port.label,
          category: 'port',
          kind: port.kind,
          interfaceId: port.interfaceId,
        }),
      ]);
      const conjugated = confirmedData.interfaces.some((entry) =>
        entry.targetSubsystemId === subsystem.id && entry.targetPortId === port.stableId
        && !confirmedData.interfaces.some((other) => other.sourceSubsystemId === subsystem.id && other.sourcePortId === port.stableId),
      );
      lines.push(`    port ${port.semanticName} : ${conjugated ? '~' : ''}${resolvePortType(port.interfaceId)};`);
    }
    lines.push('  }');
    lines.push('');
  }

  lines.push('  part system_context {');
  for (const subsystem of confirmedData.subsystems) {
    lines.push(`    part ${toSysmlIdentifier(`${subsystem.id}_instance`)} : ${toSysmlIdentifier(subsystem.id)};`);
  }
  if (confirmedData.subsystems.length > 0 && confirmedData.interfaces.length > 0) {
    lines.push('');
  }
  for (const entry of confirmedData.interfaces) {
    appendMetadata(lines, '    ', [
      buildElementInfoUsage({
        stableId: entry.id,
        label: entry.label,
        category: 'connection',
        kind: entry.kind,
        interfaceId: entry.interfaceId,
      }),
    ]);
    lines.push(
      `    connection ${toSysmlIdentifier(entry.id)} connect ${toSysmlIdentifier(`${entry.sourceSubsystemId}_instance`)}.${toSysmlIdentifier(entry.sourcePortId)} to ${toSysmlIdentifier(`${entry.targetSubsystemId}_instance`)}.${toSysmlIdentifier(entry.targetPortId)};`,
    );
  }
  lines.push('  }');
  lines.push('');

  for (const requirement of confirmedData.requirements) {
    for (const subsystemName of requirement.tracedTo) {
      const subsystem = subsystemByName.get(subsystemName);
      if (subsystem) {
        lines.push(`  satisfy ${toSysmlIdentifier(requirement.id)} by ${toSysmlIdentifier(subsystem.id)};`);
      }
    }
  }
  if (confirmedData.requirements.length > 0) {
    lines.push('');
  }
  for (const entry of confirmedData.interfaces) {
    for (const requirementId of entry.requirementIds) {
      lines.push(`  satisfy ${toSysmlIdentifier(requirementId)} by ${toSysmlIdentifier(entry.id)};`);
    }
  }

  lines.push('}');
  return cloneSourceFile('structure.sysml', lines.join('\n'));
}

function buildBehaviorFile(confirmedData: ConfirmedTianwen2Data) {
  const lines = [`package ${confirmedData.packageName} {`, ''];
  for (const activity of confirmedData.activities) {
    appendMetadata(lines, '  ', [
      buildElementInfoUsage({
        stableId: activity.id,
        label: activity.title,
        text: activity.text,
        category: 'activity',
      }),
      ...buildRelatedElementUsages(activity.performedBy),
    ]);
    lines.push(`  action def ${toSysmlIdentifier(activity.id)};`);
    lines.push('');
  }

  lines.push('  action def mission_sequence {');
  for (const activity of confirmedData.activities) {
    lines.push(`    action ${toSysmlIdentifier(`${activity.id}_step`)} : ${toSysmlIdentifier(activity.id)};`);
  }
  if (confirmedData.activities.length > 1) {
    lines.push('');
    for (let index = 0; index < confirmedData.activities.length - 1; index += 1) {
      lines.push(`    flow ${toSysmlIdentifier(`${confirmedData.activities[index].id}_step`)} to ${toSysmlIdentifier(`${confirmedData.activities[index + 1].id}_step`)};`);
    }
  }
  lines.push('  }');
  lines.push('');

  for (const activity of confirmedData.activities) {
    for (const requirementId of activity.requirementIds) {
      lines.push(`  satisfy ${toSysmlIdentifier(requirementId)} by ${toSysmlIdentifier(activity.id)};`);
    }
  }

  lines.push('}');
  return cloneSourceFile('behavior.sysml', lines.join('\n'));
}

function buildConstraintsFile(confirmedData: ConfirmedTianwen2Data) {
  const lines = [`package ${confirmedData.packageName} {`, ''];

  for (const constraint of confirmedData.constraints) {
    appendMetadata(lines, '  ', [
      buildElementInfoUsage({
        stableId: constraint.id,
        label: constraint.label,
        text: constraint.expression,
        category: 'constraint',
      }),
      ...buildRelatedElementUsages(constraint.relatedElementIds),
    ]);
    lines.push(...buildConstraintBody(constraint));
    lines.push('');
  }

  for (const parameter of confirmedData.parameters) {
    appendMetadata(lines, '  ', [
      buildElementInfoUsage({
        stableId: parameter.id,
        label: parameter.label,
        category: 'parameter',
        unit: parameter.unit,
        unitSymbol: parameter.unitSymbol,
      }),
      ...buildRelatedElementUsages(parameter.relatedElementIds),
    ]);
    lines.push(`  attribute def ${toSysmlIdentifier(parameter.id)};`);
    lines.push('');
  }

  for (const binding of confirmedData.bindings) {
    appendMetadata(lines, '  ', [
      buildElementInfoUsage({
        stableId: binding.id,
        label: binding.label,
        category: 'binding',
      }),
      ...buildRelatedElementUsages(binding.relatedElementIds),
    ]);
    lines.push(`  binding ${toSysmlIdentifier(binding.id)} of ${toSysmlIdentifier(binding.constraintId)} = ${toSysmlIdentifier(binding.parameterId)};`);
    lines.push('');
  }

  for (const constraint of confirmedData.constraints) {
    for (const requirementId of constraint.requirementIds) {
      lines.push(`  satisfy ${toSysmlIdentifier(requirementId)} by ${toSysmlIdentifier(constraint.id)};`);
    }
  }

  lines.push('}');
  return cloneSourceFile('constraints.sysml', lines.join('\n'));
}

export function buildTianwen2ModelSourceSet(
  confirmedData: ConfirmedTianwen2Data,
  options: { rootDir?: string; entryPath?: string } = {},
): ModelSourceSet {
  return normalizeModelSourceSet({
    rootDir: options.rootDir ?? '',
    entryPath: options.entryPath ?? MODEL_SOURCE_SET_ENTRY_FILE,
    files: [
      buildEntryFile(confirmedData),
      buildRequirementsFile(confirmedData),
      buildStructureFile(confirmedData),
      buildBehaviorFile(confirmedData),
      buildConstraintsFile(confirmedData),
    ],
  });
}

async function materializeSourceSet(sourceSet: ModelSourceSet) {
  const normalized = normalizeModelSourceSet(sourceSet);
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'mbse-source-set-'));
  const sourceRoot = normalized.rootDir === '' ? workspaceRoot : path.join(workspaceRoot, normalized.rootDir);
  await mkdir(sourceRoot, { recursive: true });
  await Promise.all(
    normalized.files.map(async (file) => {
      const absolutePath = path.join(sourceRoot, file.path);
      await mkdir(path.dirname(absolutePath), { recursive: true });
      await writeFile(absolutePath, file.content, 'utf8');
    }),
  );
  return {
    workspaceRoot,
    sourceRoot,
    entryAbsolutePath: path.join(sourceRoot, normalized.entryPath),
    sourceSet: normalized,
  };
}

function metadataEntries(element: SemanticElement, typeName: string) {
  return [
    ...(Array.isArray(element.prefixAppliedMetadata) ? element.prefixAppliedMetadata : []),
    ...(Array.isArray(element.metadata) ? element.metadata : []),
  ]
    .filter((entry): entry is SemanticMetadata => entry !== null && typeof entry === 'object' && !Array.isArray(entry))
    .filter((entry) => trimString(entry.type) === typeName);
}

function readElementInfo(element: SemanticElement) {
  const metadata = metadataEntries(element, ELEMENT_INFO_METADATA)[0];
  if (!metadata?.features) {
    return null;
  }
  const stableId = decodeMetadataScalar(metadata.features.stableId);
  if (stableId === '') {
    return null;
  }
  return {
    stableId,
    label: decodeMetadataScalar(metadata.features.label) || undefined,
    text: decodeMetadataScalar(metadata.features.text) || undefined,
    category: decodeMetadataScalar(metadata.features.category) || undefined,
    kind: decodeMetadataScalar(metadata.features.kind) || undefined,
    unit: decodeMetadataScalar(metadata.features.unit) || undefined,
    unitSymbol: decodeMetadataScalar(metadata.features.unitSymbol) || undefined,
    interfaceId: decodeMetadataScalar(metadata.features.interfaceId) || undefined,
  } satisfies ElementInfo;
}

function readRelatedElementIds(element: SemanticElement) {
  return metadataEntries(element, RELATED_ELEMENT_METADATA)
    .map((entry) => decodeMetadataScalar(entry.features?.elementId))
    .filter((value) => value !== '');
}

function resolveElementByRaw(index: SemanticIndex, raw: string) {
  if (raw === '') return undefined;
  if (index.byQualifiedId.has(raw)) {
    return index.byQualifiedId.get(raw);
  }
  const simpleMatches = index.bySimpleName.get(raw);
  if (simpleMatches?.length === 1) {
    return simpleMatches[0];
  }
  const suffixMatches = index.elements.filter((element) => trimString(element.id).endsWith(`::${raw}`));
  return suffixMatches.length === 1 ? suffixMatches[0] : undefined;
}

function resolveTypedBy(index: SemanticIndex, element: SemanticElement) {
  const typedByValues = Array.isArray(element.typedBy) ? element.typedBy.map(trimString).filter(Boolean) : [];
  for (const raw of typedByValues) {
    const resolved = resolveElementByRaw(index, raw);
    if (resolved) {
      return resolved;
    }
  }
  return undefined;
}

function getDiagramInfo(index: SemanticIndex, element: SemanticElement) {
  const qualifiedId = trimString(element.id);
  if (qualifiedId === '') return null;
  const info = index.infoByQualifiedId.get(qualifiedId);
  if (!info) return null;
  return {
    ...info,
    label: info.label || info.stableId,
    qualifiedId,
  } satisfies DiagramNodeInfo;
}

function asPortKind(value: string): ViewPort['kind'] {
  return value === 'sample' || value === 'data' || value === 'power' || value === 'thermal' || value === 'control' ? value : 'data';
}

function buildSemanticIndex(semanticDocuments: Array<Record<string, unknown>>, entryAbsolutePath: string): SemanticIndex {
  const issues: SourceSetDerivationIssue[] = [];
  const normalizedEntrySource = entryAbsolutePath.replace(/\\/g, '/');
  const entryDocument = semanticDocuments.find((document) => {
    const meta = document.meta;
    return meta !== null && typeof meta === 'object' && !Array.isArray(meta)
      && trimString((meta as Record<string, unknown>).source).replace(/\\/g, '/') === normalizedEntrySource;
  });
  if (!entryDocument) {
    return {
      projectId: '',
      packageName: '',
      issues: [{ code: 'missing-entry-document', message: `strict 分析缺少入口文件语义文档：${entryAbsolutePath}` }],
      elements: [],
      relationships: [],
      byQualifiedId: new Map(),
      bySimpleName: new Map(),
      infoByQualifiedId: new Map(),
      relatedElementIdsByQualifiedId: new Map(),
    };
  }

  const elements = semanticDocuments.flatMap((document) => (Array.isArray(document.elements) ? document.elements : []))
    .filter((element): element is SemanticElement => element !== null && typeof element === 'object' && !Array.isArray(element));
  const relationships = semanticDocuments.flatMap((document) => (Array.isArray(document.relationships) ? document.relationships : []))
    .filter((relationship): relationship is SemanticRelationship => relationship !== null && typeof relationship === 'object' && !Array.isArray(relationship));

  const byQualifiedId = new Map<string, SemanticElement>();
  const bySimpleName = new Map<string, SemanticElement[]>();
  const infoByQualifiedId = new Map<string, ElementInfo>();
  const relatedElementIdsByQualifiedId = new Map<string, string[]>();

  for (const element of elements) {
    const qualifiedId = trimString(element.id);
    const simpleName = trimString(element.name);
    if (qualifiedId !== '') {
      byQualifiedId.set(qualifiedId, element);
      relatedElementIdsByQualifiedId.set(qualifiedId, readRelatedElementIds(element));
      const info = readElementInfo(element);
      if (info) {
        infoByQualifiedId.set(qualifiedId, info);
      }
    }
    if (simpleName !== '') {
      const existing = bySimpleName.get(simpleName) ?? [];
      existing.push(element);
      bySimpleName.set(simpleName, existing);
    }
  }

  const entryPackages = (Array.isArray(entryDocument.elements) ? entryDocument.elements : [])
    .filter((element): element is SemanticElement => element !== null && typeof element === 'object' && !Array.isArray(element))
    .filter((element) => trimString(element.type) === 'Package');
  const taggedEntryPackages = entryPackages.flatMap((element) => metadataEntries(element, PROJECT_INFO_METADATA).map((metadata) => ({ element, metadata })));
  if (taggedEntryPackages.length !== 1) {
    issues.push({ code: 'invalid-project-info', message: `入口文件必须恰好包含一个 ${PROJECT_INFO_METADATA} package 前缀 metadata，当前为 ${taggedEntryPackages.length} 个。`, source: entryAbsolutePath });
  }

  let projectId = '';
  let packageName = '';
  if (taggedEntryPackages.length === 1) {
    const [{ element, metadata }] = taggedEntryPackages;
    projectId = decodeMetadataScalar(metadata.features?.projectId);
    packageName = decodeMetadataScalar(metadata.features?.packageName);
    const source = decodeMetadataScalar(metadata.features?.source);
    const packageElementName = trimString(element.name);
    if (projectId === '') {
      issues.push({ code: 'invalid-project-info', message: `${PROJECT_INFO_METADATA}.projectId 不能为空。`, source: entryAbsolutePath });
    }
    if (packageName === '') {
      issues.push({ code: 'invalid-project-info', message: `${PROJECT_INFO_METADATA}.packageName 不能为空。`, source: entryAbsolutePath });
    }
    if (source !== 'sysml-source-set-derived') {
      issues.push({ code: 'invalid-project-info', message: `${PROJECT_INFO_METADATA}.source 必须是 sysml-source-set-derived。`, source: entryAbsolutePath });
    }
    if (packageElementName === '' || packageElementName !== packageName) {
      issues.push({ code: 'package-name-mismatch', message: `入口 package 名称必须与 ${PROJECT_INFO_METADATA}.packageName 一致，当前为 ${packageElementName || '<empty>'}。`, source: entryAbsolutePath });
    }
  }

  const projectInfoOwners = elements
    .filter((element) => metadataEntries(element, PROJECT_INFO_METADATA).length > 0)
    .map((element) => trimString(element.id));
  for (const ownerId of projectInfoOwners) {
    if (taggedEntryPackages.length === 1 && ownerId === trimString(taggedEntryPackages[0].element.id)) {
      continue;
    }
    issues.push({ code: 'duplicate-project-info', message: `${PROJECT_INFO_METADATA} 只能出现在入口文件 package 上。` });
  }

  return {
    projectId,
    packageName,
    issues,
    elements,
    relationships,
    byQualifiedId,
    bySimpleName,
    infoByQualifiedId,
    relatedElementIdsByQualifiedId,
  };
}

function buildRequirementView(index: SemanticIndex): GeneratedView {
  const requirementDefs = index.elements
    .filter((element) => trimString(element.type) === 'RequirementDef')
    .map((element) => ({ element, info: getDiagramInfo(index, element) }))
    .filter((entry): entry is { element: SemanticElement; info: DiagramNodeInfo } => Boolean(entry.info))
    .sort((left, right) => left.info.stableId.localeCompare(right.info.stableId));
  const tracedTargets = new Map<string, DiagramNodeInfo>();
  const hierarchyEdges: ViewEdge[] = [];
  const traceEdges: ViewEdge[] = [];

  for (const element of index.elements.filter((candidate) => trimString(candidate.type) === 'Requirement')) {
    const parent = resolveElementByRaw(index, trimString(element.parent));
    const target = resolveTypedBy(index, element);
    const parentInfo = parent ? getDiagramInfo(index, parent) : null;
    const targetInfo = target ? getDiagramInfo(index, target) : null;
    if (parentInfo && targetInfo) {
      hierarchyEdges.push({
        id: `hierarchy-${parentInfo.stableId}-${targetInfo.stableId}`,
        kind: 'hierarchy',
        source: parentInfo.stableId,
        target: targetInfo.stableId,
        label: '需求层级',
      });
    }
  }

  for (const relationship of index.relationships.filter((candidate) => trimString(candidate.type) === 'Satisfy')) {
    const requirement = resolveElementByRaw(index, trimString(relationship.resolvedSource) || trimString(relationship.sourceRaw));
    const target = resolveElementByRaw(index, trimString(relationship.resolvedTarget) || trimString(relationship.targetRaw));
    const requirementInfo = requirement ? getDiagramInfo(index, requirement) : null;
    const targetInfo = target ? getDiagramInfo(index, target) : null;
    if (!requirementInfo || requirementInfo.category !== 'requirement' || !targetInfo) continue;
    if (targetInfo.category !== 'system' && targetInfo.category !== 'subsystem') continue;
    tracedTargets.set(targetInfo.stableId, targetInfo);
    traceEdges.push({
      id: `trace-${requirementInfo.stableId}-${targetInfo.stableId}`,
      kind: 'trace',
      source: requirementInfo.stableId,
      target: targetInfo.stableId,
      label: '追溯满足',
    });
  }

  return {
    id: 'requirements-view',
    title: '需求视图',
    kind: 'requirements',
    layout: 'auto',
    layoutEngine: 'deterministic-layered-layout',
    nodes: [
      ...requirementDefs.map(({ info }, indexValue) => ({
        id: info.stableId,
        kind: 'requirement',
        label: info.label,
        text: info.text,
        elementId: info.stableId,
        position: { x: 40, y: 40 + indexValue * 110 },
      } satisfies ViewNode)),
      ...Array.from(tracedTargets.values()).sort((left, right) => left.stableId.localeCompare(right.stableId)).map((info, indexValue) => ({
        id: info.stableId,
        kind: info.category === 'system' ? 'system' : 'subsystem',
        label: info.label,
        text: info.text,
        elementId: info.stableId,
        position: { x: 640, y: 40 + indexValue * 110 },
      } satisfies ViewNode)),
    ],
    edges: [...hierarchyEdges, ...traceEdges],
  };
}

function buildBddView(index: SemanticIndex): GeneratedView {
  const partDefs = index.elements
    .filter((element) => trimString(element.type) === 'PartDef')
    .map((element) => ({ element, info: getDiagramInfo(index, element) }))
    .filter((entry): entry is { element: SemanticElement; info: DiagramNodeInfo } => Boolean(entry.info))
    .filter((entry) => entry.info.category === 'system' || entry.info.category === 'subsystem')
    .sort((left, right) => left.info.stableId.localeCompare(right.info.stableId));

  const nodes = partDefs.map(({ info }, indexValue) => ({
    id: info.stableId,
    kind: info.category === 'system' ? 'system' : 'subsystem',
    label: info.label,
    text: info.text,
    elementId: info.stableId,
    position: info.category === 'system' ? { x: 320, y: 40 } : { x: 80 + indexValue * 220, y: 220 },
  } satisfies ViewNode));

  const edges: ViewEdge[] = [];
  for (const element of index.elements.filter((candidate) => trimString(candidate.type) === 'Part')) {
    const parent = resolveElementByRaw(index, trimString(element.parent));
    const typedBy = resolveTypedBy(index, element);
    const parentInfo = parent ? getDiagramInfo(index, parent) : null;
    const childInfo = typedBy ? getDiagramInfo(index, typedBy) : null;
    if (!parentInfo || !childInfo) continue;
    if (!['system', 'subsystem'].includes(parentInfo.category ?? '') || !['system', 'subsystem'].includes(childInfo.category ?? '')) continue;
    edges.push({
      id: `composition-${parentInfo.stableId}-${childInfo.stableId}`,
      kind: 'composition',
      source: parentInfo.stableId,
      target: childInfo.stableId,
      label: '组成',
    });
  }

  return {
    id: 'bdd-structure-view',
    title: 'BDD 结构视图',
    kind: 'bdd',
    layout: 'auto',
    layoutEngine: 'deterministic-layered-layout',
    nodes,
    edges,
  };
}

function buildActivityView(index: SemanticIndex): GeneratedView {
  const actionDefs = index.elements
    .filter((element) => trimString(element.type) === 'ActionDef')
    .map((element) => ({ element, info: getDiagramInfo(index, element) }))
    .filter((entry): entry is { element: SemanticElement; info: DiagramNodeInfo } => Boolean(entry.info))
    .filter((entry) => entry.info.category === 'activity')
    .sort((left, right) => left.info.stableId.localeCompare(right.info.stableId));

  const nodes = actionDefs.map(({ info }, indexValue) => ({
    id: info.stableId,
    kind: 'activity',
    label: info.label,
    text: info.text,
    elementId: info.stableId,
    position: { x: 80 + indexValue * 240, y: 140 },
  } satisfies ViewNode));

  const edges: ViewEdge[] = [];
  for (const relationship of index.relationships.filter((candidate) => trimString(candidate.type) === 'Flow')) {
    const sourceUsage = resolveElementByRaw(index, trimString(relationship.resolvedSource) || trimString(relationship.sourceRaw));
    const targetUsage = resolveElementByRaw(index, trimString(relationship.resolvedTarget) || trimString(relationship.targetRaw));
    const sourceDef = sourceUsage ? resolveTypedBy(index, sourceUsage) : null;
    const targetDef = targetUsage ? resolveTypedBy(index, targetUsage) : null;
    const sourceInfo = sourceDef ? getDiagramInfo(index, sourceDef) : null;
    const targetInfo = targetDef ? getDiagramInfo(index, targetDef) : null;
    if (!sourceInfo || !targetInfo) continue;
    edges.push({
      id: trimString(relationship.id) || `flow-${sourceInfo.stableId}-${targetInfo.stableId}`,
      kind: 'flow',
      source: sourceInfo.stableId,
      target: targetInfo.stableId,
      label: '活动流',
    });
  }

  return {
    id: 'activity-flow-view',
    title: '活动图',
    kind: 'activity',
    layout: 'auto',
    layoutEngine: 'deterministic-layered-layout',
    nodes,
    edges,
  };
}

function buildIbdView(index: SemanticIndex): GeneratedView {
  const systemContext = index.bySimpleName.get('system_context')?.[0];
  const instances = index.elements
    .filter((element) => trimString(element.type) === 'Part' && trimString(element.parent) === trimString(systemContext?.id))
    .map((element) => {
      const typedBy = resolveTypedBy(index, element);
      const typedByInfo = typedBy ? getDiagramInfo(index, typedBy) : null;
      if (!typedBy || !typedByInfo) return null;
      return {
        usageName: trimString(element.name),
        stableId: typedByInfo.stableId,
        typedByQualifiedId: trimString(typedBy.id),
      } satisfies IbdInstanceInfo;
    })
    .filter((entry): entry is IbdInstanceInfo => Boolean(entry));
  const instanceByName = new Map(instances.map((entry) => [entry.usageName, entry]));
  const portsByOwnerAndSemanticName = new Map<string, {
    ownerStableId: string;
    stableId: string;
    label: string;
    interfaceId: string;
    kind: ViewPort['kind'];
    semanticName: string;
  }>();

  for (const portElement of index.elements.filter((element) => trimString(element.type) === 'Port')) {
    const owner = resolveElementByRaw(index, trimString(portElement.parent));
    const ownerInfo = owner ? getDiagramInfo(index, owner) : null;
    const portInfo = readElementInfo(portElement);
    if (!ownerInfo || !portInfo) continue;
    const semanticName = trimString(portElement.name);
    portsByOwnerAndSemanticName.set(`${ownerInfo.stableId}:${semanticName}`, {
      ownerStableId: ownerInfo.stableId,
      stableId: portInfo.stableId,
      label: portInfo.label || portInfo.stableId,
      interfaceId: portInfo.interfaceId || '',
      kind: asPortKind(portInfo.kind || ''),
      semanticName,
    });
  }

  const nodes = instances.flatMap((instance, indexValue) => {
    const ownerElement = index.byQualifiedId.get(instance.typedByQualifiedId);
    const ownerInfo = ownerElement ? getDiagramInfo(index, ownerElement) : null;
    if (!ownerInfo) return [];
    return [{
      id: instance.stableId,
      kind: 'ibd-part',
      label: ownerInfo.label,
      text: ownerInfo.text,
      elementId: instance.stableId,
      position: { x: 80 + indexValue * 220, y: 160 },
    } satisfies ViewNode];
  });

  const ports = Array.from(portsByOwnerAndSemanticName.values())
    .sort((left, right) => `${left.ownerStableId}:${left.stableId}`.localeCompare(`${right.ownerStableId}:${right.stableId}`))
    .map((port) => ({
      id: port.stableId,
      label: port.label,
      kind: port.kind,
      ownerId: port.ownerStableId,
      interfaceId: port.interfaceId,
    } satisfies ViewPort));

  const connections: ViewConnection[] = [];
  const edges: ViewEdge[] = [];
  for (const element of index.elements.filter((candidate) => trimString(candidate.type) === 'Connection' && trimString(candidate.parent) === trimString(systemContext?.id))) {
    const info = getDiagramInfo(index, element);
    if (!info || info.category !== 'connection') continue;
    const sourceEndpoint = (element.connectorSource ?? {}) as SemanticEndpoint;
    const targetEndpoint = (element.connectorTarget ?? {}) as SemanticEndpoint;
    const sourceInstance = instanceByName.get(trimString(sourceEndpoint.target));
    const targetInstance = instanceByName.get(trimString(targetEndpoint.target));
    const sourcePort = sourceInstance ? portsByOwnerAndSemanticName.get(`${sourceInstance.stableId}:${trimString(sourceEndpoint.featureChain)}`) : undefined;
    const targetPort = targetInstance ? portsByOwnerAndSemanticName.get(`${targetInstance.stableId}:${trimString(targetEndpoint.featureChain)}`) : undefined;
    if (!sourceInstance || !targetInstance || !sourcePort || !targetPort) continue;
    const connection = {
      id: info.stableId,
      kind: 'connection',
      source: sourceInstance.stableId,
      target: targetInstance.stableId,
      sourcePort: sourcePort.stableId,
      targetPort: targetPort.stableId,
      label: info.label,
    } satisfies ViewConnection;
    connections.push(connection);
    edges.push({
      id: connection.id,
      kind: 'connection',
      source: connection.source,
      target: connection.target,
      sourcePort: connection.sourcePort,
      targetPort: connection.targetPort,
      label: connection.label,
    });
  }

  return {
    id: 'ibd-internal-block-view',
    title: 'IBD 内部块图',
    kind: 'ibd',
    layout: 'auto',
    layoutEngine: 'elk-layered',
    nodes,
    edges,
    ports,
    connections,
  };
}

function buildParameterConstraintView(index: SemanticIndex): GeneratedView {
  const constraints = index.elements
    .filter((element) => trimString(element.type) === 'ConstraintDef')
    .map((element) => ({ element, info: getDiagramInfo(index, element) }))
    .filter((entry): entry is { element: SemanticElement; info: DiagramNodeInfo } => Boolean(entry.info))
    .filter((entry) => entry.info.category === 'constraint')
    .sort((left, right) => left.info.stableId.localeCompare(right.info.stableId));
  const parameters = index.elements
    .filter((element) => trimString(element.type) === 'AttributeDef')
    .map((element) => ({ element, info: getDiagramInfo(index, element) }))
    .filter((entry): entry is { element: SemanticElement; info: DiagramNodeInfo } => Boolean(entry.info))
    .filter((entry) => entry.info.category === 'parameter')
    .sort((left, right) => left.info.stableId.localeCompare(right.info.stableId));
  const bindings = index.elements
    .filter((element) => trimString(element.type) === 'BindingConnector')
    .map((element) => ({ element, info: getDiagramInfo(index, element) }))
    .filter((entry): entry is { element: SemanticElement; info: DiagramNodeInfo } => Boolean(entry.info))
    .filter((entry) => entry.info.category === 'binding')
    .sort((left, right) => left.info.stableId.localeCompare(right.info.stableId));

  const constraintByName = new Map(constraints.map(({ element, info }) => [trimString(element.name), info]));
  const parameterByName = new Map(parameters.map(({ element, info }) => [trimString(element.name), info]));
  const bindingEdges: ViewEdge[] = [];
  const bindingRecords: ParameterBinding[] = [];

  for (const { element, info } of bindings) {
    const sourceEndpoint = (element.connectorSource ?? {}) as SemanticEndpoint;
    const targetEndpoint = (element.connectorTarget ?? {}) as SemanticEndpoint;
    const constraintInfo = constraintByName.get(trimString(sourceEndpoint.target));
    const parameterInfo = parameterByName.get(trimString(targetEndpoint.target));
    if (!constraintInfo || !parameterInfo) continue;
    bindingEdges.push({
      id: info.stableId,
      kind: 'binding',
      source: constraintInfo.stableId,
      target: parameterInfo.stableId,
      label: info.label,
    });
    bindingRecords.push({
      id: info.stableId,
      kind: 'binding',
      constraintId: constraintInfo.stableId,
      parameterId: parameterInfo.stableId,
      label: info.label,
      relatedElementIds: index.relatedElementIdsByQualifiedId.get(trimString(element.id)) ?? [],
    });
  }

  return {
    id: 'parameter-constraints-view',
    title: '参数约束视图',
    kind: 'parameter-constraints',
    layout: 'auto',
    layoutEngine: 'deterministic-layered-layout',
    nodes: [
      ...constraints.map(({ info }, indexValue) => ({
        id: info.stableId,
        kind: 'constraint',
        label: info.label,
        text: info.text,
        elementId: info.stableId,
        position: { x: 80, y: 80 + indexValue * 160 },
      } satisfies ViewNode)),
      ...parameters.map(({ info }, indexValue) => ({
        id: info.stableId,
        kind: 'parameter',
        label: info.label,
        text: info.unit ? `单位：${info.unit}` : info.text,
        elementId: info.stableId,
        position: { x: 420, y: 80 + indexValue * 160 },
      } satisfies ViewNode)),
    ],
    edges: bindingEdges,
    constraints: constraints.map(({ element, info }) => ({
      id: info.stableId,
      label: info.label,
      expression: trimString(element.resultExpression) || info.text || '',
      relatedElementIds: index.relatedElementIdsByQualifiedId.get(trimString(element.id)) ?? [],
      requirementIds: [],
    } satisfies ParameterConstraint)),
    parameters: parameters.map(({ element, info }) => ({
      id: info.stableId,
      label: info.label,
      unit: info.unit || info.unitSymbol || '',
      unitSymbol: info.unitSymbol || info.unit || '',
      relatedElementIds: index.relatedElementIdsByQualifiedId.get(trimString(element.id)) ?? [],
    })),
    bindings: bindingRecords,
  };
}

function buildTraceabilityMatrixView(index: SemanticIndex): GeneratedView {
  const rows: TraceabilityMatrixRow[] = index.elements
    .filter((element) => trimString(element.type) === 'RequirementDef')
    .map((element) => getDiagramInfo(index, element))
    .filter((entry): entry is DiagramNodeInfo => Boolean(entry))
    .sort((left, right) => left.stableId.localeCompare(right.stableId))
    .map((info) => ({ id: info.stableId, requirementId: info.stableId, label: info.label }));

  const columns: TraceabilityMatrixColumn[] = [
    ...index.elements
      .filter((element) => trimString(element.type) === 'PartDef')
      .map((element) => getDiagramInfo(index, element))
      .filter((entry): entry is DiagramNodeInfo => Boolean(entry))
      .filter((entry) => entry.category === 'system' || entry.category === 'subsystem')
      .map((info) => ({ id: info.stableId, elementId: info.stableId, kind: 'structure' as const, label: info.label })),
    ...index.elements
      .filter((element) => trimString(element.type) === 'ActionDef')
      .map((element) => getDiagramInfo(index, element))
      .filter((entry): entry is DiagramNodeInfo => Boolean(entry))
      .filter((entry) => entry.category === 'activity')
      .map((info) => ({ id: info.stableId, elementId: info.stableId, kind: 'behavior' as const, label: info.label })),
    ...index.elements
      .filter((element) => trimString(element.type) === 'Connection')
      .map((element) => getDiagramInfo(index, element))
      .filter((entry): entry is DiagramNodeInfo => Boolean(entry))
      .filter((entry) => entry.category === 'connection')
      .map((info) => ({ id: info.stableId, elementId: info.stableId, kind: 'interface' as const, label: info.label })),
    ...index.elements
      .filter((element) => trimString(element.type) === 'ConstraintDef')
      .map((element) => getDiagramInfo(index, element))
      .filter((entry): entry is DiagramNodeInfo => Boolean(entry))
      .filter((entry) => entry.category === 'constraint')
      .map((info) => ({ id: info.stableId, elementId: info.stableId, kind: 'constraint' as const, label: info.label })),
  ];

  const coverage = new Map<string, Set<string>>();
  for (const relationship of index.relationships.filter((candidate) => trimString(candidate.type) === 'Satisfy')) {
    const requirement = resolveElementByRaw(index, trimString(relationship.resolvedSource) || trimString(relationship.sourceRaw));
    const target = resolveElementByRaw(index, trimString(relationship.resolvedTarget) || trimString(relationship.targetRaw));
    const requirementInfo = requirement ? getDiagramInfo(index, requirement) : null;
    const targetInfo = target ? getDiagramInfo(index, target) : null;
    if (!requirementInfo || requirementInfo.category !== 'requirement' || !targetInfo) continue;
    if (!columns.some((column) => column.id === targetInfo.stableId)) continue;
    const existing = coverage.get(requirementInfo.stableId) ?? new Set<string>();
    existing.add(targetInfo.stableId);
    coverage.set(requirementInfo.stableId, existing);
  }

  const cells: TraceabilityMatrixCell[] = [];
  for (const row of rows) {
    const coveredColumns = coverage.get(row.requirementId) ?? new Set<string>();
    for (const column of columns) {
      const covered = coveredColumns.has(column.id);
      cells.push({
        rowId: row.id,
        requirementId: row.requirementId,
        columnId: column.id,
        covered,
        evidence: covered ? `${row.requirementId} satisfy ${column.id}` : undefined,
      });
    }
  }

  return {
    id: 'traceability-matrix-view',
    title: '需求追溯矩阵',
    kind: 'traceability-matrix',
    layout: 'auto',
    layoutEngine: 'matrix-layout',
    nodes: [],
    edges: [],
    rows,
    columns,
    cells,
  };
}

export function deriveViewModelFromSemanticDocuments(input: {
  semanticDocuments: Array<Record<string, unknown>>;
  entryAbsolutePath: string;
}): { viewModel?: GeneratedViewModel; issues: SourceSetDerivationIssue[] } {
  const index = buildSemanticIndex(input.semanticDocuments, input.entryAbsolutePath);
  if (index.projectId === '' || index.packageName === '' || index.issues.length > 0) {
    return { issues: index.issues };
  }

  const viewModel: GeneratedViewModel = {
    schemaVersion: '0.4.0',
    projectId: index.projectId,
    source: 'sysml-source-set-derived',
    generatedFrom: index.packageName,
    views: [
      buildRequirementView(index),
      buildBddView(index),
      buildActivityView(index),
      buildTraceabilityMatrixView(index),
      buildIbdView(index),
      buildParameterConstraintView(index),
    ],
    validation: {
      status: 'passed',
      checkedRules: ['schema', 'semantic-source-set', 'strict-sysml2', 'reference-integrity', 'traceability', 'ibd-endpoints', 'parameter-bindings'],
    },
  };

  const actualKinds = new Set(viewModel.views.map((view) => view.kind));
  for (const requiredKind of REQUIRED_VIEW_KINDS) {
    if (!actualKinds.has(requiredKind)) {
      index.issues.push({ code: 'missing-view', message: `派生视图缺少 kind=${requiredKind}。` });
    }
  }
  if (index.issues.length > 0) {
    return { issues: index.issues };
  }

  const validation = validateViewModel(viewModel);
  return {
    viewModel: {
      ...viewModel,
      validation: {
        ...viewModel.validation,
        status: validation.valid ? 'passed' : 'failed',
      },
    },
    issues: index.issues,
  };
}

export async function generateTianwen2ModelArtifacts(
  confirmedData: ConfirmedTianwen2Data,
  options: { rootDir?: string; entryPath?: string } = {},
): Promise<ModelGenerationResult> {
  const sourceSet = buildTianwen2ModelSourceSet(confirmedData, options);
  const materialized = await materializeSourceSet(sourceSet);
  try {
    const analysis = await runSysml2Analysis({
      workspaceRoot: materialized.sourceRoot,
      filePath: materialized.entryAbsolutePath,
      timeoutMs: 120_000,
    });
    if (!analysis.valid) {
      throw new Error(analysis.diagnostics.map((diagnostic: { filePath: string; line: number; column: number; message: string }) => `${diagnostic.filePath}:${diagnostic.line}:${diagnostic.column} ${diagnostic.message}`).join('\n'));
    }
    const derived = deriveViewModelFromSemanticDocuments({
      semanticDocuments: analysis.semanticDocuments,
      entryAbsolutePath: materialized.entryAbsolutePath,
    });
    if (!derived.viewModel || derived.issues.length > 0) {
      throw new Error(derived.issues.map((issue) => `${issue.code} ${issue.source ?? ''} ${issue.message}`.trim()).join('\n'));
    }
    const validation = validateViewModel(derived.viewModel);
    return {
      sourceSet,
      viewModel: {
        ...derived.viewModel,
        validation: {
          ...derived.viewModel.validation,
          status: validation.valid ? 'passed' : 'failed',
        },
      },
      validation,
    };
  } finally {
    await rm(materialized.workspaceRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}
