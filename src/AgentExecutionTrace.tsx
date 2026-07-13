import {
  BulbOutlined,
  CheckCircleFilled,
  CloseCircleFilled,
  CodeOutlined,
  LoadingOutlined,
  MessageOutlined,
  ToolOutlined,
} from '@ant-design/icons';
import { Alert, Card, Collapse, Progress, Space, Tag, Typography, type CollapseProps } from 'antd';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  getLatestAgentProgress,
  getLatestAgentSession,
  type AgentModelingSession,
  type AgentOutputChannel,
  type AgentSidecarEvent,
  type AgentTracePhase,
  type JsonSafeValue,
} from './domain/agentSidecar';

const { Text } = Typography;

type PhaseGroup = {
  key: string;
  title: string;
  phase: AgentTracePhase;
  events: AgentSidecarEvent[];
};

type BlockStatus = 'running' | 'success' | 'error' | 'cancelled';

type ReasoningBlock = {
  kind: 'reasoning';
  key: string;
  contentIndex?: number;
  text: string;
  status: BlockStatus;
  startSequence: number;
  endSequence: number;
};

type AssistantBlock = {
  kind: 'assistant';
  key: string;
  channel: AgentOutputChannel;
  contentIndex?: number;
  text: string;
  status: BlockStatus;
  startSequence: number;
  endSequence: number;
};

type ToolBlock = {
  kind: 'tool';
  key: string;
  toolCallId: string;
  toolName: string;
  args?: string;
  result?: string;
  message: string;
  status: BlockStatus;
  startSequence: number;
  endSequence: number;
};

type ProgressBlock = {
  kind: 'progress';
  key: string;
  message: string;
  percent: number;
  startSequence: number;
  endSequence: number;
};

type PhaseStatusBlock = {
  kind: 'phase-status';
  key: string;
  step: string;
  message: string;
  status: BlockStatus;
  startSequence: number;
  endSequence: number;
};

type SuggestionBlock = {
  kind: 'suggestion';
  key: string;
  message: string;
  recommendation: string;
  severity: 'info' | 'warning';
};

type ResultBlock = {
  kind: 'result';
  key: string;
  title: string;
  summary: string;
  status: BlockStatus;
};

type ErrorBlock = {
  kind: 'error';
  key: string;
  message: string;
  code?: string;
  recoverable: boolean;
};

type SessionStatusBlock = {
  kind: 'session-status';
  key: string;
  message: string;
  status: BlockStatus;
};

type SemanticTraceBlock =
  | ReasoningBlock
  | AssistantBlock
  | ToolBlock
  | ProgressBlock
  | PhaseStatusBlock
  | SuggestionBlock
  | ResultBlock
  | ErrorBlock
  | SessionStatusBlock;

export default function AgentExecutionTrace({
  sessions,
  busy,
  embedded = false,
}: {
  sessions: AgentModelingSession[];
  busy: boolean;
  embedded?: boolean;
}) {
  const latestSession = getLatestAgentSession(sessions);
  const latestProgress = getLatestAgentProgress(sessions);

  const content = (
    <div className="agent-trace-panel">
      {sessions.map((session) => {
        const isLatest = latestSession?.sessionId === session.sessionId;
        const phaseGroups = buildPhaseGroups(session.events);
        const currentPhaseKey = busy && isLatest ? phaseGroups.at(-1)?.key : undefined;
        return (
          <section className="agent-trace-session" key={session.sessionId} style={{ gap: 16 }}>
            <header className="agent-trace-session-header">
              <div className="agent-trace-session-identity">
                <Space wrap size={8}>
                  <Tag color={isLatest ? 'blue' : 'default'}>{isLatest ? '当前会话' : '历史会话'}</Tag>
                  <Text code>{session.sessionId}</Text>
                  <Tag>{session.provider ?? 'unknown-provider'}</Tag>
                  <Tag>{session.model ?? 'unknown-model'}</Tag>
                </Space>
              </div>
              <div className="agent-trace-session-meta" aria-label="会话摘要">
                <SessionMeta label="完成时间" value={session.completedAt ?? '进行中'} />
                <SessionMeta label="执行阶段" value={`${phaseGroups.length}`} />
                <SessionMeta label="状态" value={session.completedAt ? '已完成' : '运行中'} />
              </div>
            </header>
            <Collapse
              className="agent-trace-phase-collapse"
              key={currentPhaseKey ?? `${session.sessionId}:collapsed`}
              size="small"
              destroyOnHidden
              items={phaseGroups.map((group) => {
                const active = busy && isLatest && group.key === currentPhaseKey;
                return {
                  key: group.key,
                  label: <PhaseLabel group={group} active={active} />,
                  children: <PhaseTrace events={group.events} active={active} />,
                };
              })}
              defaultActiveKey={currentPhaseKey ? [currentPhaseKey] : []}
            />
          </section>
        );
      })}
    </div>
  );

  if (embedded) {
    return <div className="agent-trace-embedded" style={{ padding: '16px 20px' }}>{content}</div>;
  }

  return (
    <Card
      className="agent-trace-card"
      size="small"
      styles={{ body: { padding: '16px 20px' }, header: { paddingInline: 20 } }}
      title="Agent 执行轨迹"
      extra={
        <Space wrap size={8}>
          <Tag color={busy ? 'processing' : 'default'}>{busy ? '流式进行中' : '等待确认'}</Tag>
          <Tag color="blue">会话 {sessions.length}</Tag>
          {latestProgress ? <Tag color="cyan">进度 {latestProgress.percent}%</Tag> : null}
        </Space>
      }
    >
      {content}
    </Card>
  );
}

function SessionMeta({ label, value }: { label: string; value: string }) {
  return (
    <div className="agent-trace-session-meta-item">
      <Text className="agent-trace-session-meta-label" type="secondary">{label}</Text>
      <Text className="agent-trace-session-meta-value" ellipsis={{ tooltip: value }}>{value}</Text>
    </div>
  );
}

function PhaseLabel({ group, active }: { group: PhaseGroup; active: boolean }) {
  const blockCount = buildSemanticBlocks(group.events).length;
  return (
    <div className="agent-trace-phase-label">
      <Space size={8}>
        {active ? <LoadingOutlined spin /> : <CheckCircleFilled className="agent-trace-phase-complete-icon" />}
        <Text strong>{group.title}</Text>
      </Space>
      <Space size={8}>
        <Text type="secondary">{blockCount} 个执行步骤</Text>
        <Tag color={active ? 'processing' : 'success'}>{active ? '进行中' : '已完成'}</Tag>
      </Space>
    </div>
  );
}

function PhaseTrace({ events, active }: { events: AgentSidecarEvent[]; active: boolean }) {
  const firstEvent = events[0];
  if (!firstEvent) {
    return null;
  }
  const blocks = buildSemanticBlocks(events);
  return (
    <div className="agent-trace-phase-content">
      <div className="agent-trace-block-list">
        {blocks.length > 0 ? blocks.map((block) => (
          <SemanticBlockView block={block} active={active} key={block.key} />
        )) : (
          <Text className="agent-trace-empty" type="secondary">当前阶段尚无可展示内容。</Text>
        )}
      </div>
      <DebugTrace events={events} />
    </div>
  );
}

function SemanticBlockView({ block, active }: { block: SemanticTraceBlock; active: boolean }) {
  switch (block.kind) {
    case 'reasoning': {
      const status = effectiveStatus(block.status, active);
      return (
        <article
          className="agent-trace-block agent-trace-reasoning-block"
          data-testid={`trace-reasoning-${block.contentIndex ?? block.startSequence}`}
        >
          <BlockHeader icon={<BulbOutlined />} title="思考过程" status={status} />
          <MarkdownContent
            className="agent-trace-reasoning-text"
            text={block.text || (status === 'running' ? '正在分析当前任务…' : '未返回可展示的思考内容。')}
          />
        </article>
      );
    }
    case 'assistant': {
      const status = effectiveStatus(block.status, active);
      return (
        <article
          className="agent-trace-block agent-trace-assistant-block"
          data-testid={`trace-assistant-${block.contentIndex ?? block.startSequence}`}
        >
          <BlockHeader icon={<MessageOutlined />} title={assistantBlockTitle(block.channel)} status={status} />
          <MarkdownContent className="agent-trace-assistant-text" text={block.text || '正在生成内容…'} />
        </article>
      );
    }
    case 'tool': {
      const status = effectiveStatus(block.status, active);
      return (
        <article
          className={`agent-trace-block agent-trace-tool-block agent-trace-tool-${status}`}
          data-testid={`tool-call-${block.toolCallId.trim() || `sequence-${block.startSequence}`}`}
        >
          <BlockHeader
            icon={<ToolOutlined />}
            title={toolDisplayName(block.toolName)}
            subtitle={block.toolName}
            status={status}
          />
          <ToolDetails block={block} status={status} />
        </article>
      );
    }
    case 'progress':
      return (
        <div className="agent-trace-block agent-trace-progress-block">
          <div className="agent-trace-progress-title">
            <Text>{block.message}</Text>
            <Text strong>{block.percent}%</Text>
          </div>
          <Progress percent={block.percent} showInfo={false} size="small" status={block.percent >= 100 ? 'success' : 'active'} />
        </div>
      );
    case 'phase-status': {
      const status = effectiveStatus(block.status, active);
      return (
        <div className="agent-trace-block agent-trace-status-block">
          <BlockHeader icon={statusIcon(status)} title={block.step} status={status} />
          {block.message && block.message !== block.step ? <Text type="secondary">{block.message}</Text> : null}
        </div>
      );
    }
    case 'suggestion':
      return (
        <Alert
          className="agent-trace-alert"
          showIcon
          type={block.severity === 'warning' ? 'warning' : 'info'}
          title={block.message}
          description={block.recommendation}
        />
      );
    case 'result':
      return (
        <Alert
          className="agent-trace-alert"
          showIcon
          type={block.status === 'error' ? 'error' : 'success'}
          title={block.title}
          description={block.summary}
        />
      );
    case 'error':
      return (
        <Alert
          className="agent-trace-alert"
          showIcon
          type="error"
          title={block.message}
          description={[block.code, block.recoverable ? '可以重试' : '需要终止当前操作'].filter(Boolean).join(' · ')}
        />
      );
    case 'session-status':
      return (
        <div className={`agent-trace-block agent-trace-session-status agent-trace-session-${block.status}`}>
          <BlockHeader icon={statusIcon(block.status)} title={block.message} status={block.status} />
        </div>
      );
  }
}

function BlockHeader({
  icon,
  title,
  subtitle,
  status,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  status: BlockStatus;
}) {
  return (
    <div className="agent-trace-block-header">
      <Space size={8}>
        <span className="agent-trace-block-icon">{icon}</span>
        <Text strong>{title}</Text>
        {subtitle && subtitle !== title ? <Text code>{subtitle}</Text> : null}
      </Space>
      <StatusTag status={status} />
    </div>
  );
}

function StatusTag({ status }: { status: BlockStatus }) {
  switch (status) {
    case 'running':
      return <Tag icon={<LoadingOutlined spin />} color="processing">进行中</Tag>;
    case 'error':
      return <Tag icon={<CloseCircleFilled />} color="error">失败</Tag>;
    case 'cancelled':
      return <Tag color="default">已取消</Tag>;
    case 'success':
      return <Tag icon={<CheckCircleFilled />} color="success">已完成</Tag>;
  }
}

function ToolDetails({ block, status }: { block: ToolBlock; status: BlockStatus }) {
  const args = decodeToolValue(block.args);
  const result = decodeToolValue(block.result);
  if (args === undefined && result === undefined) {
    return <Text type="secondary">{block.message}</Text>;
  }
  switch (block.toolName) {
    case 'web_search':
    case 'web-search':
      return <WebSearchToolDetails args={args} result={result} />;
    case 'read':
      return <ReadToolDetails args={args} result={result} />;
    case 'write':
    case 'edit':
      return <WriteToolDetails args={args} result={result} toolName={block.toolName} />;
    case 'grep':
    case 'search':
    case 'glob':
      return <SearchToolDetails args={args} result={result} toolName={block.toolName} />;
    case 'bash':
      return <BashToolDetails args={args} result={result} />;
    default: {
      const argsText = semanticToolDisplay(block.args);
      const resultText = semanticToolDisplay(block.result);
      return (
        <>
          {argsText ? <ToolSection label="调用参数"><MarkdownContent text={argsText} /></ToolSection> : null}
          {resultText ? <ToolSection label={status === 'running' ? '实时结果' : '结果概览'}><MarkdownContent text={resultText} /></ToolSection> : null}
          {!argsText && !resultText ? <Text type="secondary">{block.message}</Text> : null}
        </>
      );
    }
  }
}

function WebSearchToolDetails({ args, result }: { args: JsonSafeValue | undefined; result: JsonSafeValue | undefined }) {
  const argRecord = recordValue(args);
  const resultRecord = recordValue(result);
  const details = recordValue(resultRecord?.details);
  const query = stringValue(argRecord?.query) ?? (typeof args === 'string' ? args : undefined);
  const answer = fullToolContentText(result) ?? (typeof result === 'string' ? result : undefined);
  const sources = toolSourceRecords(details?.sources ?? resultRecord?.sources);
  const metadata = [
    { label: 'Provider', value: stringValue(details?.provider) },
    { label: 'Model', value: stringValue(details?.model) },
    { label: '认证', value: stringValue(details?.auth) },
    { label: '用量', value: details?.usage === undefined ? undefined : conciseToolValue(details.usage) },
  ];
  return (
    <>
      <ToolFields
        label="检索参数"
        fields={[
          { label: '查询词', value: query },
          { label: '时间范围', value: stringValue(argRecord?.recency) },
          { label: '结果数量', value: scalarToolValue(argRecord?.num_search_results ?? argRecord?.limit) },
        ]}
      />
      {answer ? (
        <ToolSection label="检索结果">
          <MarkdownContent text={truncateToolText(answer, TOOL_CONTENT_PREVIEW_LIMIT)} />
        </ToolSection>
      ) : null}
      {sources.length > 0 ? <ToolSources sources={sources} /> : null}
      <ToolFields label="执行信息" fields={metadata} compact />
    </>
  );
}

function ReadToolDetails({ args, result }: { args: JsonSafeValue | undefined; result: JsonSafeValue | undefined }) {
  const argRecord = recordValue(args);
  const path = stringValue(argRecord?.path);
  const resultText = fullToolContentText(result) ?? (typeof result === 'string' ? result : undefined);
  return (
    <>
      <ToolFields
        label="读取范围"
        fields={[
          { label: '文件', value: path },
          { label: '选择器', value: stringValue(argRecord?.selector) },
          { label: '起始位置', value: scalarToolValue(argRecord?.offset) },
          { label: '读取数量', value: scalarToolValue(argRecord?.limit) },
        ]}
      />
      {resultText ? <ToolCodePreview label="文件内容" text={resultText} language={fileLanguage(path)} /> : null}
      {!resultText && result !== undefined ? <GenericToolResult value={result} /> : null}
    </>
  );
}

function WriteToolDetails({
  args,
  result,
  toolName,
}: {
  args: JsonSafeValue | undefined;
  result: JsonSafeValue | undefined;
  toolName: string;
}) {
  const argRecord = recordValue(args);
  const path = stringValue(argRecord?.path);
  const content = stringValue(argRecord?.content)
    ?? stringValue(argRecord?.text)
    ?? stringValue(argRecord?.patch);
  const resultText = fullToolContentText(result) ?? (typeof result === 'string' ? result : undefined);
  return (
    <>
      <ToolFields
        label={toolName === 'edit' ? '修改目标' : '写入目标'}
        fields={[
          { label: '文件', value: path },
          { label: '语言', value: fileLanguage(path) },
          { label: '内容行数', value: content ? `${lineCount(content)} 行` : undefined },
        ]}
      />
      {content ? (
        <ToolCodePreview
          label={toolName === 'edit' ? '修改内容预览' : '写入内容预览'}
          text={content}
          language={fileLanguage(path)}
        />
      ) : null}
      {resultText ? <ToolSection label="执行结果"><MarkdownContent text={truncateToolText(resultText, TOOL_CONTENT_PREVIEW_LIMIT)} /></ToolSection> : null}
      {!resultText && result !== undefined ? <GenericToolResult value={result} /> : null}
    </>
  );
}

function SearchToolDetails({
  args,
  result,
  toolName,
}: {
  args: JsonSafeValue | undefined;
  result: JsonSafeValue | undefined;
  toolName: string;
}) {
  const argRecord = recordValue(args);
  const resultText = fullToolContentText(result) ?? (typeof result === 'string' ? result : undefined);
  const isGlob = toolName === 'glob';
  return (
    <>
      <ToolFields
        label={isGlob ? '查找条件' : '搜索条件'}
        fields={[
          { label: isGlob ? 'Glob 模式' : '搜索模式', value: isGlob ? stringValue(argRecord?.path) : stringValue(argRecord?.pattern) },
          { label: '搜索路径', value: isGlob ? undefined : toolPaths(argRecord?.paths ?? argRecord?.path) },
          { label: '区分大小写', value: booleanToolValue(argRecord?.case) },
          { label: '包含隐藏文件', value: booleanToolValue(argRecord?.hidden) },
          { label: '遵循 gitignore', value: booleanToolValue(argRecord?.gitignore) },
          { label: '跳过结果', value: scalarToolValue(argRecord?.skip) },
          { label: '数量上限', value: scalarToolValue(argRecord?.limit) },
        ]}
      />
      {resultText ? <ToolCodePreview label="匹配结果" text={resultText} /> : null}
      {!resultText && result !== undefined ? <GenericToolResult value={result} /> : null}
    </>
  );
}

function BashToolDetails({ args, result }: { args: JsonSafeValue | undefined; result: JsonSafeValue | undefined }) {
  const argRecord = recordValue(args);
  const command = stringValue(argRecord?.command);
  const environment = recordValue(argRecord?.env);
  const resultText = fullToolContentText(result) ?? (typeof result === 'string' ? result : undefined);
  return (
    <>
      <ToolFields
        label="执行环境"
        fields={[
          { label: '工作目录', value: stringValue(argRecord?.cwd) },
          { label: '环境变量', value: environment ? Object.keys(environment).join('、') : undefined },
        ]}
      />
      {command ? <ToolCodePreview label="命令" text={command} language="shell" /> : null}
      {resultText ? <ToolCodePreview label="命令输出" text={resultText} /> : null}
      {!resultText && result !== undefined ? <GenericToolResult value={result} /> : null}
    </>
  );
}

function GenericToolResult({ value }: { value: JsonSafeValue }) {
  const text = semanticJsonToolDisplay(value);
  return text ? <ToolSection label="结果概览"><MarkdownContent text={text} /></ToolSection> : null;
}

function ToolFields({
  label,
  fields,
  compact = false,
}: {
  label: string;
  fields: Array<{ label: string; value: string | undefined }>;
  compact?: boolean;
}) {
  const visibleFields = fields.filter((field): field is { label: string; value: string } => Boolean(field.value));
  if (visibleFields.length === 0) return null;
  return (
    <ToolSection label={label}>
      <dl className={`agent-trace-tool-fields${compact ? ' agent-trace-tool-fields-compact' : ''}`}>
        {visibleFields.map((field) => (
          <div className="agent-trace-tool-field" key={field.label}>
            <dt>{field.label}</dt>
            <dd>{field.value}</dd>
          </div>
        ))}
      </dl>
    </ToolSection>
  );
}

function ToolCodePreview({ label, text, language }: { label: string; text: string; language?: string }) {
  const preview = truncateToolText(text, 4000);
  const truncated = preview.length < text.length;
  return (
    <ToolSection label={label}>
      <div className="agent-trace-tool-preview-meta">
        <Text type="secondary">{language ? `${language} · ` : ''}{lineCount(text)} 行</Text>
        {truncated ? <Text type="secondary">预览前 4000 个字符</Text> : null}
      </div>
      <pre className="agent-trace-tool-code"><code>{preview}</code></pre>
      {truncated ? (
        <Collapse
          className="agent-trace-tool-full-collapse"
          destroyOnHidden
          ghost
          size="small"
          items={[{
            key: 'full-content',
            label: `查看完整内容（${lineCount(text)} 行）`,
            children: <pre className="agent-trace-tool-code agent-trace-tool-code-full"><code>{text}</code></pre>,
          }]}
        />
      ) : null}
    </ToolSection>
  );
}

function ToolSources({ sources }: { sources: Array<Record<string, JsonSafeValue>> }) {
  return (
    <ToolSection label="来源">
      <ul className="agent-trace-tool-sources">
        {sources.map((source, index) => {
          const url = stringValue(source.url);
          const title = stringValue(source.title) ?? url ?? `来源 ${index + 1}`;
          const meta = [stringValue(source.domain), stringValue(source.date), stringValue(source.publishedAt)]
            .filter(Boolean)
            .join(' · ');
          return (
            <li key={`${url ?? title}:${index}`}>
              {url && /^https?:\/\//.test(url) ? <a href={url}>{title}</a> : <span>{title}</span>}
              {meta ? <Text type="secondary">{meta}</Text> : null}
            </li>
          );
        })}
      </ul>
    </ToolSection>
  );
}

function ToolSection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="agent-trace-tool-section">
      <Text className="agent-trace-tool-section-label" type="secondary">{label}</Text>
      <div className="agent-trace-tool-value">{children}</div>
    </div>
  );
}

function decodeToolValue(value: string | undefined): JsonSafeValue | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  try {
    const parsed = JSON.parse(trimmed) as JsonSafeValue;
    return isHiddenTraceValue(parsed) ? undefined : parsed;
  } catch {
    return looksLikeRawJson(trimmed) ? undefined : trimmed;
  }
}

function fullToolContentText(value: JsonSafeValue | undefined): string | undefined {
  const content = recordValue(value)?.content;
  if (!Array.isArray(content)) return undefined;
  const text = content
    .map((item) => typeof item === 'string' ? item : stringValue(recordValue(item)?.text))
    .filter((item): item is string => Boolean(item))
    .join('\n\n');
  return text || undefined;
}

function toolSourceRecords(value: JsonSafeValue | undefined) {
  return Array.isArray(value)
    ? value.map((item) => recordValue(item)).filter((item): item is Record<string, JsonSafeValue> => Boolean(item))
    : [];
}

function scalarToolValue(value: JsonSafeValue | undefined): string | undefined {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
    ? String(value)
    : undefined;
}

function booleanToolValue(value: JsonSafeValue | undefined): string | undefined {
  return typeof value === 'boolean' ? (value ? '是' : '否') : undefined;
}

function toolPaths(value: JsonSafeValue | undefined): string | undefined {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return undefined;
  const paths = value.filter((item): item is string => typeof item === 'string');
  return paths.length > 0 ? paths.join('、') : undefined;
}

function lineCount(value: string) {
  return value.length === 0 ? 0 : value.split(/\r?\n/).length;
}

function fileLanguage(path: string | undefined) {
  const extension = path?.split('.').pop()?.toLowerCase();
  const languages: Record<string, string> = {
    css: 'CSS',
    html: 'HTML',
    js: 'JavaScript',
    json: 'JSON',
    jsx: 'JSX',
    md: 'Markdown',
    mjs: 'JavaScript',
    py: 'Python',
    rs: 'Rust',
    sysml: 'SysML',
    ts: 'TypeScript',
    tsx: 'TSX',
    yaml: 'YAML',
    yml: 'YAML',
  };
  return extension ? languages[extension] ?? extension.toUpperCase() : undefined;
}

function MarkdownContent({ className, text }: { className?: string; text: string }) {
  return (
    <div className={['agent-trace-markdown', className].filter(Boolean).join(' ')}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
    </div>
  );
}

function DebugTrace({ events }: { events: AgentSidecarEvent[] }) {
  const firstEvent = events[0]!;
  const items: CollapseProps['items'] = [{
    key: 'debug-events',
    label: (
      <Space size={8}>
        <CodeOutlined />
        <Text type="secondary">事件调试</Text>
        <Text type="secondary">{events.length} 个原始事件</Text>
      </Space>
    ),
    children: (
      <div
        className="agent-trace-event-list"
        data-testid={`event-timeline-${firstEvent.sessionId}-${firstEvent.sequence}`}
      >
        {events.map((event) => (
          <TraceEventRow event={event} key={`${event.sessionId}:${event.sequence}`} />
        ))}
      </div>
    ),
  }];
  return <Collapse className="agent-trace-debug-collapse" destroyOnHidden ghost size="small" items={items} />;
}

function TraceEventRow({ event }: { event: AgentSidecarEvent }) {
  return (
    <div className={`agent-trace-event-row agent-trace-event-${event.type}`}>
      <div className="agent-trace-event-meta">
        <Text code>#{event.sequence}</Text>
        <Text type="secondary">{event.timestamp}</Text>
        <Tag color={phaseTagColor(event.phase)}>{event.phase}</Tag>
        <Tag color={typeTagColor(event.type)}>{event.type}</Tag>
      </div>
      <div className="agent-trace-event-body">
        <Text strong>{event.message}</Text>
        <div className="agent-trace-event-detail">{renderEventDetail(event)}</div>
        {renderPayloadDetails(event.payload, `${event.sessionId}:${event.sequence}`)}
      </div>
    </div>
  );
}

function renderEventDetail(event: AgentSidecarEvent) {
  switch (event.type) {
    case 'progress':
      return <DetailText value={`${event.percent}%`} />;
    case 'phase':
      return <DetailText value={`${event.phaseStatus} · ${event.step}`} />;
    case 'suggestion':
      return <DetailText value={`${event.target} · ${event.severity} · ${event.recommendation}`} />;
    case 'tool-call-start':
      return <DetailText value={`${event.toolName}${event.argsSummary ? ` · ${event.argsSummary}` : ''}`} />;
    case 'tool-call-update':
      return <DetailText value={`${event.toolName}${event.partialSummary ? ` · ${event.partialSummary}` : ''}`} />;
    case 'tool-call-end':
      return <DetailText value={`${event.toolName} · ${event.isError ? '失败' : '完成'}${event.resultSummary ? ` · ${event.resultSummary}` : ''}`} />;
    case 'output-delta':
      return <DetailText value={`${event.channel} · ${event.text}`} />;
    case 'reasoning-start':
      return <DetailText value={event.contentIndex === undefined ? '开始' : `contentIndex=${event.contentIndex}`} />;
    case 'reasoning-delta':
    case 'reasoning-end':
      return <DetailText value={`${event.contentIndex === undefined ? '' : `contentIndex=${event.contentIndex} · `}${event.text}`} />;
    case 'reasoning-summary':
      return <DetailText value={event.summaryText ?? (event.hasContent ? '已返回可展示 summary。' : '仅返回 reasoning 状态。')} />;
    case 'error':
      return <DetailText value={event.code ? `${event.code} · ${event.recoverable ? 'recoverable' : 'fatal'}` : (event.recoverable ? 'recoverable' : 'fatal')} />;
    case 'session-started':
      return <DetailText value={`${event.provider ?? 'unknown-provider'} / ${event.model ?? 'unknown-model'}`} />;
    case 'session-finished':
      return <DetailText value={`${event.status} · ${event.completedAt ?? 'unknown-time'}`} />;
    case 'sdk-event':
      return <DetailText value={event.rawKind} />;
    case 'extraction':
      return <DetailText value={`requirements ${event.confirmedData.requirements.length} · subsystems ${event.confirmedData.subsystems.length} · activities ${event.confirmedData.activities.length}`} />;
    case 'model-draft':
      return <DetailText value={`source files ${event.draft.sourceSet.files.length} · views ${event.draft.viewModel.views.length} · validation ${event.draft.validation.valid ? 'passed' : 'failed'}`} />;
  }
}

function renderPayloadDetails(payload: JsonSafeValue, key: string) {
  const items: CollapseProps['items'] = [{
    key,
    label: '原始 payload',
    children: <PayloadContent payload={payload} />,
  }];
  return <Collapse className="agent-trace-payload-collapse" destroyOnHidden size="small" ghost items={items} />;
}

function PayloadContent({ payload }: { payload: JsonSafeValue }) {
  return <pre className="agent-trace-payload">{serializePayload(payload)}</pre>;
}

function DetailText({ value }: { value: string }) {
  return <Text className="agent-trace-detail-text" type="secondary">{value}</Text>;
}

function buildSemanticBlocks(events: AgentSidecarEvent[]): SemanticTraceBlock[] {
  const blocks: SemanticTraceBlock[] = [];
  const reasoningBlocks = new Map<string, ReasoningBlock>();
  const assistantBlocks = new Map<string, AssistantBlock>();
  const toolBlocks = new Map<string, ToolBlock>();
  const phaseBlocks = new Map<string, PhaseStatusBlock>();
  let progressBlock: ProgressBlock | undefined;
  let messageEpoch = 0;

  for (const event of events) {
    if (event.type === 'sdk-event' && event.rawKind === 'message_start') {
      messageEpoch += 1;
      continue;
    }

    switch (event.type) {
      case 'session-started':
        break;
      case 'progress': {
        if (!progressBlock) {
          progressBlock = {
            kind: 'progress',
            key: `progress:${event.sequence}`,
            message: event.message,
            percent: event.percent,
            startSequence: event.sequence,
            endSequence: event.sequence,
          };
          blocks.push(progressBlock);
        } else {
          progressBlock.message = event.message;
          progressBlock.percent = event.percent;
          progressBlock.endSequence = event.sequence;
        }
        break;
      }
      case 'phase': {
        const key = `phase:${event.step}`;
        const existing = phaseBlocks.get(key);
        if (existing) {
          existing.message = event.message;
          existing.status = event.phaseStatus === 'completed' ? 'success' : 'running';
          existing.endSequence = event.sequence;
        } else {
          const block: PhaseStatusBlock = {
            kind: 'phase-status',
            key,
            step: event.step,
            message: event.message,
            status: event.phaseStatus === 'completed' ? 'success' : 'running',
            startSequence: event.sequence,
            endSequence: event.sequence,
          };
          phaseBlocks.set(key, block);
          blocks.push(block);
        }
        break;
      }
      case 'reasoning-start':
      case 'reasoning-delta':
      case 'reasoning-end': {
        const contentIndex = event.contentIndex ?? assistantContentIndex(event.payload);
        const key = `${messageEpoch}:reasoning:${contentIndex ?? 0}`;
        let block = reasoningBlocks.get(key);
        if (!block || (block.status !== 'running' && event.type !== 'reasoning-end')) {
          block = {
            kind: 'reasoning',
            key: `reasoning:${event.sequence}`,
            contentIndex,
            text: '',
            status: 'running',
            startSequence: event.sequence,
            endSequence: event.sequence,
          };
          reasoningBlocks.set(key, block);
          blocks.push(block);
        }
        const fullText = assistantBlockText(event.payload, contentIndex, 'thinking');
        if (event.type === 'reasoning-delta') {
          block.text = fullText ?? `${block.text}${event.text}`;
        } else if (event.type === 'reasoning-end') {
          block.text = event.text || fullText || block.text;
          block.status = 'success';
        } else if (fullText) {
          block.text = fullText;
        }
        block.endSequence = event.sequence;
        break;
      }
      case 'reasoning-summary': {
        const block: ReasoningBlock = {
          kind: 'reasoning',
          key: `reasoning-summary:${event.sequence}`,
          text: event.summaryText ?? (event.hasContent ? '模型已完成思考。' : ''),
          status: 'success',
          startSequence: event.sequence,
          endSequence: event.sequence,
        };
        blocks.push(block);
        break;
      }
      case 'output-delta': {
        if (event.channel === 'assistant-toolcall') {
          mergeToolSnapshotFromPayload(event, messageEpoch, blocks, toolBlocks);
          break;
        }
        const contentIndex = assistantContentIndex(event.payload);
        const key = `${messageEpoch}:assistant:${event.channel}:${contentIndex ?? 0}`;
        let block = assistantBlocks.get(key);
        if (!block || block.status !== 'running') {
          block = {
            kind: 'assistant',
            key: `assistant:${event.sequence}`,
            channel: event.channel,
            contentIndex,
            text: '',
            status: 'running',
            startSequence: event.sequence,
            endSequence: event.sequence,
          };
          assistantBlocks.set(key, block);
          blocks.push(block);
        }
        const fullText = assistantBlockText(event.payload, contentIndex, 'text');
        block.text = fullText ?? `${block.text}${event.text}`;
        block.endSequence = event.sequence;
        break;
      }
      case 'tool-call-start':
      case 'tool-call-update':
      case 'tool-call-end': {
        mergeToolEvent(event, blocks, toolBlocks);
        break;
      }
      case 'suggestion':
        blocks.push({
          kind: 'suggestion',
          key: `suggestion:${event.sequence}`,
          message: event.message,
          recommendation: event.recommendation,
          severity: event.severity,
        });
        break;
      case 'extraction':
        blocks.push({
          kind: 'result',
          key: `extraction:${event.sequence}`,
          title: '候选数据已生成',
          summary: `需求 ${event.confirmedData.requirements.length} 项 · 分系统 ${event.confirmedData.subsystems.length} 项 · 活动 ${event.confirmedData.activities.length} 项`,
          status: 'success',
        });
        break;
      case 'model-draft':
        blocks.push({
          kind: 'result',
          key: `model-draft:${event.sequence}`,
          title: event.draft.validation.valid ? '模型工件已生成并通过校验' : '模型工件已生成，但校验未通过',
          summary: `源文件 ${event.draft.sourceSet.files.length} 个 · 视图 ${event.draft.viewModel.views.length} 个`,
          status: event.draft.validation.valid ? 'success' : 'error',
        });
        break;
      case 'error':
        blocks.push({
          kind: 'error',
          key: `error:${event.sequence}`,
          message: event.message,
          code: event.code,
          recoverable: event.recoverable,
        });
        break;
      case 'session-finished': {
        const status = sessionStatus(event.status);
        blocks.push({
          kind: 'session-status',
          key: `session-finished:${event.sequence}`,
          message: sessionStatusText(event.status),
          status,
        });
        for (const block of reasoningBlocks.values()) {
          if (block.status === 'running') block.status = status;
        }
        for (const block of assistantBlocks.values()) {
          if (block.status === 'running') block.status = status;
        }
        for (const block of toolBlocks.values()) {
          if (block.status === 'running') block.status = status;
        }
        break;
      }
      case 'sdk-event': {
        if (event.rawKind === 'text_end') {
          const contentIndex = assistantContentIndex(event.payload);
          const block = assistantBlocks.get(`${messageEpoch}:assistant:assistant-text:${contentIndex ?? 0}`);
          if (block) block.status = 'success';
        } else if (event.rawKind === 'message_end') {
          for (const block of reasoningBlocks.values()) {
            if (block.status === 'running') block.status = 'success';
          }
          for (const block of assistantBlocks.values()) {
            if (block.status === 'running') block.status = 'success';
          }
        }
        break;
      }
    }
  }

  return blocks;
}

function mergeToolEvent(
  event: Extract<AgentSidecarEvent, { type: 'tool-call-start' | 'tool-call-update' | 'tool-call-end' }>,
  blocks: SemanticTraceBlock[],
  toolBlocks: Map<string, ToolBlock>,
) {
  const toolCallId = event.toolCallId.trim();
  const lookupKey = toolCallId || `sequence:${event.sequence}`;
  const args = toolEventArgs(event);
  const result = toolEventResult(event);
  let block = toolBlocks.get(lookupKey);
  if (!block) {
    block = {
      kind: 'tool',
      key: `tool:${lookupKey}`,
      toolCallId: event.toolCallId,
      toolName: event.toolName,
      args,
      result,
      message: event.message,
      status: event.type === 'tool-call-end' ? (event.isError ? 'error' : 'success') : 'running',
      startSequence: event.sequence,
      endSequence: event.sequence,
    };
    toolBlocks.set(lookupKey, block);
    blocks.push(block);
    return;
  }
  block.toolName = event.toolName;
  block.message = event.message;
  block.args = args ?? block.args;
  block.result = result ?? block.result;
  if (event.type === 'tool-call-end') {
    block.status = event.isError ? 'error' : 'success';
  }
  block.endSequence = event.sequence;
}

function toolEventArgs(
  event: Extract<AgentSidecarEvent, { type: 'tool-call-start' | 'tool-call-update' | 'tool-call-end' }>,
) {
  const payloadArgs = recordValue(event.payload)?.args;
  return formatToolValue(payloadArgs) ?? normalizeToolSummary(event.argsSummary);
}

function toolEventResult(
  event: Extract<AgentSidecarEvent, { type: 'tool-call-start' | 'tool-call-update' | 'tool-call-end' }>,
) {
  if (event.type === 'tool-call-start') {
    return undefined;
  }
  const payload = recordValue(event.payload);
  const payloadResult = event.type === 'tool-call-update' ? payload?.partialResult : payload?.result;
  const summary = event.type === 'tool-call-update' ? event.partialSummary : event.resultSummary;
  return formatToolValue(payloadResult) ?? normalizeToolSummary(summary);
}

function normalizeToolSummary(value: string | undefined) {
  if (!value) return undefined;
  try {
    return isHiddenTraceValue(JSON.parse(value) as JsonSafeValue) ? undefined : value;
  } catch {
    return value;
  }
}

function mergeToolSnapshotFromPayload(
  event: Extract<AgentSidecarEvent, { type: 'output-delta' }>,
  messageEpoch: number,
  blocks: SemanticTraceBlock[],
  toolBlocks: Map<string, ToolBlock>,
) {
  const contentIndex = assistantContentIndex(event.payload);
  const content = assistantContentBlock(event.payload, contentIndex);
  if (!content || content.type !== 'toolCall') {
    return;
  }
  const toolCallId = stringValue(content.id) ?? '';
  const lookupKey = toolCallId || `message:${messageEpoch}:${contentIndex ?? 0}`;
  const args = formatToolValue(content.arguments) ?? stringValue(content.partialJson);
  const existing = toolBlocks.get(lookupKey);
  if (existing) {
    existing.args = args ?? existing.args;
    existing.endSequence = event.sequence;
    return;
  }
  const block: ToolBlock = {
    kind: 'tool',
    key: `tool:${lookupKey}`,
    toolCallId,
    toolName: stringValue(content.name) ?? 'unknown-tool',
    args,
    message: event.message,
    status: 'running',
    startSequence: event.sequence,
    endSequence: event.sequence,
  };
  toolBlocks.set(lookupKey, block);
  blocks.push(block);
}

function assistantContentIndex(payload: JsonSafeValue): number | undefined {
  const assistantEvent = recordValue(recordValue(payload)?.assistantMessageEvent);
  const contentIndex = assistantEvent?.contentIndex;
  return typeof contentIndex === 'number' && Number.isInteger(contentIndex) ? contentIndex : undefined;
}

function assistantContentBlock(payload: JsonSafeValue, contentIndex: number | undefined): Record<string, JsonSafeValue> | undefined {
  if (contentIndex === undefined) return undefined;
  const message = recordValue(recordValue(payload)?.message);
  const content = message?.content;
  if (!Array.isArray(content)) return undefined;
  return recordValue(content[contentIndex]);
}

function assistantBlockText(
  payload: JsonSafeValue,
  contentIndex: number | undefined,
  kind: 'text' | 'thinking',
): string | undefined {
  const block = assistantContentBlock(payload, contentIndex);
  if (!block || block.type !== kind) return undefined;
  const value = kind === 'thinking' ? block.thinking : block.text;
  return typeof value === 'string' ? value : undefined;
}

function recordValue(value: JsonSafeValue | undefined): Record<string, JsonSafeValue> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, JsonSafeValue>
    : undefined;
}

function stringValue(value: JsonSafeValue | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function formatToolValue(value: JsonSafeValue | undefined): string | undefined {
  if (value === undefined || isHiddenTraceValue(value)) return undefined;
  return typeof value === 'string' ? value : JSON.stringify(value);
}

const TOOL_CONTENT_PREVIEW_LIMIT = 2400;
const TOOL_FIELD_PREVIEW_LIMIT = 240;
const TOOL_CONTENT_FIELDS = new Set(['content', 'text', 'body', 'data', 'payload', 'schema', 'prompt', 'code']);

function semanticToolDisplay(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  try {
    return semanticJsonToolDisplay(JSON.parse(trimmed) as JsonSafeValue);
  } catch {
    return looksLikeRawJson(trimmed) ? undefined : truncateToolText(trimmed, TOOL_CONTENT_PREVIEW_LIMIT);
  }
}

function semanticJsonToolDisplay(value: JsonSafeValue): string | undefined {
  if (value === null || isHiddenTraceValue(value)) return undefined;
  if (typeof value === 'string') return truncateToolText(value, TOOL_CONTENT_PREVIEW_LIMIT);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  const contentText = extractToolContentText(value);
  if (contentText) return contentText;
  if (Array.isArray(value)) {
    const items = value
      .slice(0, 8)
      .map((item) => conciseToolValue(item))
      .filter((item): item is string => Boolean(item));
    return items.length > 0 ? items.map((item) => `- ${escapeMarkdownInline(item)}`).join('\n') : undefined;
  }
  const lines = Object.entries(value)
    .filter(([key, item]) => key !== '$mbseAgentTrace' && item !== null && !isHiddenTraceValue(item))
    .slice(0, 8)
    .map(([key, item]) => {
      const summary = conciseToolField(key, item);
      return summary ? `- **${toolFieldLabel(key)}**：${escapeMarkdownInline(summary)}` : undefined;
    })
    .filter((line): line is string => Boolean(line));
  return lines.length > 0 ? lines.join('\n') : undefined;
}

function extractToolContentText(value: JsonSafeValue): string | undefined {
  const content = recordValue(value)?.content;
  if (!Array.isArray(content)) return undefined;
  const text = content
    .map((item) => typeof item === 'string' ? item : stringValue(recordValue(item)?.text))
    .filter((item): item is string => Boolean(item))
    .join('\n\n');
  return text ? truncateToolText(text, TOOL_CONTENT_PREVIEW_LIMIT) : undefined;
}

function conciseToolField(key: string, value: JsonSafeValue): string | undefined {
  if (TOOL_CONTENT_FIELDS.has(key)) {
    if (typeof value === 'string' && value.length > TOOL_FIELD_PREVIEW_LIMIT) {
      return `${value.length} 个字符，已省略`;
    }
    if (Array.isArray(value) && value.length > 8) {
      return `${value.length} 项内容，已省略`;
    }
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      return '结构化内容已省略';
    }
  }
  return conciseToolValue(value);
}

function conciseToolValue(value: JsonSafeValue): string | undefined {
  if (value === null || isHiddenTraceValue(value)) return undefined;
  if (typeof value === 'string') return truncateToolText(value, TOOL_FIELD_PREVIEW_LIMIT);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    const primitiveItems = value
      .slice(0, 8)
      .map((item) => typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean' ? String(item) : undefined)
      .filter((item): item is string => Boolean(item));
    return primitiveItems.length === value.length
      ? truncateToolText(primitiveItems.join('、'), TOOL_FIELD_PREVIEW_LIMIT)
      : `${value.length} 项`;
  }
  const contentText = extractToolContentText(value);
  if (contentText) return truncateToolText(contentText, TOOL_FIELD_PREVIEW_LIMIT);
  const visibleEntries = Object.entries(value)
    .filter(([key, item]) => key !== '$mbseAgentTrace' && item !== null && !isHiddenTraceValue(item));
  if (visibleEntries.length === 0) return undefined;
  return truncateToolText(
    visibleEntries
      .slice(0, 3)
      .map(([key, item]) => `${toolFieldLabel(key)}：${conciseToolField(key, item) ?? '已提供'}`)
      .join('；'),
    TOOL_FIELD_PREVIEW_LIMIT,
  );
}

function truncateToolText(value: string, limit: number) {
  return value.length > limit ? `${value.slice(0, limit - 1)}…` : value;
}

function isHiddenTraceValue(value: JsonSafeValue | undefined) {
  const tag = recordValue(recordValue(value)?.$mbseAgentTrace);
  return tag?.type === 'undefined';
}

function looksLikeRawJson(value: string) {
  return value.startsWith('{') || /^\[\s*[\{\"]/.test(value);
}

function escapeMarkdownInline(value: string) {
  return value.replace(/[\\`*_[\]<>#]/g, '\\$&');
}

function toolFieldLabel(key: string) {
  const labels: Record<string, string> = {
    query: '查询词',
    path: '路径',
    url: '地址',
    command: '命令',
    cwd: '工作目录',
    selector: '范围',
    pattern: '搜索模式',
    recency: '时间范围',
    limit: '数量上限',
    max_tokens: '最大文本量',
    num_search_results: '结果数量',
    action: '操作',
    status: '状态',
    ok: '成功',
    bytes: '字节数',
    content: '内容',
    text: '文本',
    body: '正文',
    data: '数据',
    code: '代码',
  };
  return labels[key] ?? key;
}

function effectiveStatus(status: BlockStatus, active: boolean): BlockStatus {
  return status === 'running' && !active ? 'success' : status;
}

function statusIcon(status: BlockStatus) {
  if (status === 'running') return <LoadingOutlined spin />;
  if (status === 'error') return <CloseCircleFilled />;
  return <CheckCircleFilled />;
}

function assistantBlockTitle(channel: AgentOutputChannel) {
  switch (channel) {
    case 'tool-output':
      return '工具输出';
    case 'agent-note':
      return 'Agent 说明';
    case 'assistant-toolcall':
      return '工具调用';
    case 'assistant-text':
      return 'Agent 输出';
  }
}

function toolDisplayName(toolName: string) {
  const names: Record<string, string> = {
    read: '读取文件',
    write: '写入文件',
    edit: '编辑文件',
    bash: '执行命令',
    eval: '运行代码',
    grep: '搜索内容',
    glob: '查找文件',
    web_search: '联网检索',
    browser: '浏览网页',
    yield: '提交结果',
  };
  return names[toolName] ?? `执行工具 ${toolName}`;
}

function sessionStatus(status: Extract<AgentSidecarEvent, { type: 'session-finished' }>['status']): BlockStatus {
  if (status === 'success') return 'success';
  if (status === 'cancelled') return 'cancelled';
  return 'error';
}

function sessionStatusText(status: Extract<AgentSidecarEvent, { type: 'session-finished' }>['status']) {
  if (status === 'success') return 'Agent 会话已完成';
  if (status === 'cancelled') return 'Agent 会话已取消';
  return 'Agent 会话执行失败';
}

function buildPhaseGroups(events: AgentSidecarEvent[]): PhaseGroup[] {
  const groups: PhaseGroup[] = [];
  const occurrences = new Map<AgentTracePhase, number>();
  for (const event of events) {
    const last = groups[groups.length - 1];
    if (last && last.phase === event.phase) {
      last.events.push(event);
      continue;
    }
    const occurrence = (occurrences.get(event.phase) ?? 0) + 1;
    occurrences.set(event.phase, occurrence);
    const baseTitle = phaseTitle(event.phase);
    groups.push({
      key: `${event.sessionId}:${event.phase}:${event.sequence}`,
      title: occurrence > 1 ? `${baseTitle} · 第 ${occurrence} 段` : baseTitle,
      phase: event.phase,
      events: [event],
    });
  }
  return groups;
}

function phaseTitle(phase: AgentTracePhase) {
  switch (phase) {
    case 'bootstrap':
      return '环境准备';
    case 'extraction':
      return '需求抽取';
    case 'model-draft':
      return '模型生成';
    case 'workspace':
      return '工作区更新';
    case 'validation':
      return '结果校验';
    case 'session':
      return '会话状态';
    case 'unknown':
      return '其他步骤';
  }
}

function serializePayload(payload: JsonSafeValue) {
  return JSON.stringify(payload, null, 2);
}

function phaseTagColor(phase: AgentTracePhase) {
  switch (phase) {
    case 'extraction':
      return 'blue';
    case 'model-draft':
      return 'green';
    case 'validation':
      return 'gold';
    case 'workspace':
      return 'purple';
    case 'session':
      return 'cyan';
    default:
      return 'default';
  }
}

function typeTagColor(type: AgentSidecarEvent['type']) {
  switch (type) {
    case 'error':
      return 'red';
    case 'suggestion':
      return 'gold';
    case 'model-draft':
      return 'green';
    case 'extraction':
      return 'blue';
    case 'tool-call-start':
    case 'tool-call-update':
    case 'tool-call-end':
      return 'purple';
    case 'output-delta':
      return 'cyan';
    case 'reasoning-start':
    case 'reasoning-delta':
    case 'reasoning-end':
      return 'magenta';
    case 'session-finished':
      return 'success';
    default:
      return 'default';
  }
}
