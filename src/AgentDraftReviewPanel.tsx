import { Alert, Card, Descriptions, Space, Tag, Typography } from 'antd';
import AgentExecutionTrace from './AgentExecutionTrace';
import { findLatestAgentEvent, type AgentModelingSession } from './domain/agentSidecar';

const { Paragraph, Text } = Typography;

export default function AgentDraftReviewPanel({
  sessions,
  busy,
}: {
  sessions: AgentModelingSession[];
  busy: boolean;
}) {
  const extractionEvent = findLatestAgentEvent(sessions, 'extraction');
  const draftEvent = findLatestAgentEvent(sessions, 'model-draft');
  const allEvents = sessions.flatMap((session) => session.events);
  const errorEvents = allEvents.filter((event) => event.type === 'error');
  const suggestionEvents = allEvents.filter((event) => event.type === 'suggestion');
  const hasResult = Boolean(extractionEvent || draftEvent);

  return (
    <Space orientation="vertical" size={12} className="agent-draft-review">
      <Alert
        type={hasResult ? 'success' : 'info'}
        showIcon
        title={
          draftEvent
            ? 'SDK Agent 最终模型工件（待确认保存）'
            : extractionEvent
              ? 'SDK Agent 候选抽取结果（待确认）'
              : 'SDK Agent 正在执行，等待可确认结果'
        }
        description={
          draftEvent
            ? '当前 Sidecar 返回的是由 oh-my-pi SDK 管理的真实建模 Agent 工件；只有通过确定性校验后才允许保存。'
            : extractionEvent
              ? '当前 Sidecar 返回的是由 oh-my-pi SDK 管理的真实建模 Agent 候选；请先确认候选，再生成最终模型工件。'
              : busy
                ? '当前仅展示实时轨迹；尚未返回候选或最终工件，因此还不能确认。'
                : '当前还没有可确认结果；请先发起候选抽取或等待正在进行中的会话返回。'
        }
      />
      <AgentExecutionTrace sessions={sessions} busy={busy} />
      {extractionEvent ? (
        <>
          <Card size="small" title="候选使命">
            <Paragraph>{extractionEvent.confirmedData.mission}</Paragraph>
          </Card>
          <Card size="small" title="候选需求">
            <div className="candidate-list">
              {extractionEvent.confirmedData.requirements.map((requirement) => (
                <div className="candidate-row" key={requirement.id}>
                  <Text code>{requirement.id}</Text>
                  <Text strong>{requirement.title}</Text>
                </div>
              ))}
            </div>
          </Card>
          <Card size="small" title="候选分系统">
            <Space wrap>
              {extractionEvent.confirmedData.subsystems.map((subsystem) => (
                <Tag key={subsystem.id}>{subsystem.name}</Tag>
              ))}
            </Space>
          </Card>
        </>
      ) : null}
      {draftEvent ? (
        <Card size="small" title="SDK Agent 最终模型摘要">
          <Descriptions
            bordered
            size="small"
            column={1}
            items={[
              { key: 'provider', label: 'provider', children: draftEvent.draft.provenance?.provider ?? 'unknown' },
              { key: 'model', label: 'model', children: draftEvent.draft.provenance?.model ?? 'unknown' },
              { key: 'sdkSessionId', label: 'SDK sessionId', children: draftEvent.draft.provenance?.sdkSessionId ?? 'unknown' },
              { key: 'completedAt', label: '完成时间', children: draftEvent.draft.provenance?.completedAt ?? 'unknown' },
              { key: 'sysml', label: 'SysML 源文件', children: `${draftEvent.draft.sourceSet.files.length} 个文件` },
              { key: 'views', label: '视图模型', children: `${draftEvent.draft.viewModel.views.length} 个视图` },
              { key: 'validation', label: '确定性校验', children: draftEvent.draft.validation.valid ? '通过' : '失败' },
            ]}
          />
        </Card>
      ) : null}
      {suggestionEvents.length > 0 ? (
        <Card size="small" title="候选依据、建模假设与待确认项">
          <div className="candidate-list">
            {suggestionEvents.map((event) => (
              <div className="candidate-row" key={`${event.sessionId}:${event.sequence}`}>
                <Tag color={event.severity === 'warning' ? 'gold' : 'blue'}>{event.category ?? event.target}</Tag>
                <Tag color={event.severity === 'warning' ? 'gold' : 'blue'}>{event.severity}</Tag>
                <Text>{event.recommendation}</Text>
              </div>
            ))}
          </div>
        </Card>
      ) : null}
      {errorEvents.map((event) => (
        <Alert key={`${event.sessionId}:${event.sequence}`} type="warning" showIcon title={event.message} />
      ))}
    </Space>
  );
}
