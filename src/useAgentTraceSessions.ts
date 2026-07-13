import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import {
  appendAgentEventsToSessions,
  getLatestAgentProgress,
  getLatestAgentSession,
  mergeAgentModelingSessionList,
  type AgentModelingSession,
  type AgentSidecarEvent,
} from './domain/agentSidecar';

const liveTraceFlushIntervalMs = 100;

type ListenerRegistrationGate = {
  promise: Promise<Error | null>;
  settle: (error: Error | null) => void;
};

function createListenerRegistrationGate(enabled: boolean): ListenerRegistrationGate {
  let settled = !enabled;
  const deferred = enabled ? Promise.withResolvers<Error | null>() : null;
  const promise = deferred?.promise ?? Promise.resolve(null);
  return {
    promise,
    settle(error) {
      if (settled) {
        return;
      }
      settled = true;
      deferred?.resolve(error);
    },
  };
}

function normalizeListenerRegistrationError(error: unknown) {
  return error instanceof Error
    ? error
    : new Error(`Agent 实时事件监听注册失败：${String(error)}`);
}

function normalizeSessionArray(incoming: AgentModelingSession | AgentModelingSession[] | null | undefined) {
  return mergeAgentModelingSessionList([], incoming ?? []);
}

export function useAgentTraceSessions(enabled: boolean) {
  const [sessions, setSessions] = useState<AgentModelingSession[]>([]);
  const pendingEventsRef = useRef<AgentSidecarEvent[]>([]);
  const scheduledFlushRef = useRef<number | null>(null);
  const ignoredSessionIdsRef = useRef<Set<string>>(new Set());
  const observedSessionIdsRef = useRef<Set<string>>(new Set());
  const sessionsRef = useRef<AgentModelingSession[]>([]);
  const acceptingLiveEventsRef = useRef(false);
  const listenerRegistrationGate = useMemo(() => createListenerRegistrationGate(enabled), [enabled]);

  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

  const beginLiveEventCapture = useCallback(() => {
    acceptingLiveEventsRef.current = true;
  }, []);

  const endLiveEventCapture = useCallback(() => {
    acceptingLiveEventsRef.current = false;
  }, []);

  const cancelScheduledFlush = useCallback(() => {
    const scheduled = scheduledFlushRef.current;
    if (scheduled === null) {
      return;
    }
    window.clearTimeout(scheduled);
    scheduledFlushRef.current = null;
  }, []);

  const clearPendingEvents = useCallback(() => {
    cancelScheduledFlush();
    pendingEventsRef.current = [];
  }, [cancelScheduledFlush]);

  const flushPendingEvents = useCallback(() => {
    cancelScheduledFlush();
    if (pendingEventsRef.current.length === 0) {
      return;
    }
    const events = pendingEventsRef.current;
    pendingEventsRef.current = [];
    startTransition(() => {
      setSessions((current) => appendAgentEventsToSessions(current, events));
    });
  }, [cancelScheduledFlush]);

  const scheduleFlush = useCallback(() => {
    if (scheduledFlushRef.current !== null) {
      return;
    }
    scheduledFlushRef.current = window.setTimeout(() => {
      scheduledFlushRef.current = null;
      flushPendingEvents();
    }, liveTraceFlushIntervalMs);
  }, [flushPendingEvents]);

  const ignoreKnownSessions = useCallback(() => {
    for (const session of sessionsRef.current) {
      ignoredSessionIdsRef.current.add(session.sessionId);
    }
    for (const sessionId of observedSessionIdsRef.current) {
      ignoredSessionIdsRef.current.add(sessionId);
    }
    observedSessionIdsRef.current.clear();
  }, []);

  const resetSessions = useCallback(() => {
    clearPendingEvents();
    ignoreKnownSessions();
    setSessions([]);
  }, [clearPendingEvents, ignoreKnownSessions]);

  const replaceSessions = useCallback((incoming: AgentModelingSession | AgentModelingSession[] | null | undefined) => {
    clearPendingEvents();
    const nextSessions = normalizeSessionArray(incoming);
    for (const session of nextSessions) {
      ignoredSessionIdsRef.current.delete(session.sessionId);
      observedSessionIdsRef.current.add(session.sessionId);
    }
    setSessions(nextSessions);
  }, [clearPendingEvents]);

  const mergeSessions = useCallback((incoming: AgentModelingSession | AgentModelingSession[] | null | undefined) => {
    clearPendingEvents();
    const nextSessions = normalizeSessionArray(incoming);
    for (const session of nextSessions) {
      ignoredSessionIdsRef.current.delete(session.sessionId);
      observedSessionIdsRef.current.add(session.sessionId);
    }
    setSessions((current) => mergeAgentModelingSessionList(current, nextSessions));
  }, [clearPendingEvents]);

  const discardSessions = useCallback(() => {
    resetSessions();
  }, [resetSessions]);

  useEffect(() => {
    if (!enabled) {
      return undefined;
    }

    let disposed = false;
    let unlisten: (() => void) | undefined;

    void listen<AgentSidecarEvent>('agent-sidecar-event', ({ payload }) => {
      if (disposed || !acceptingLiveEventsRef.current || ignoredSessionIdsRef.current.has(payload.sessionId)) {
        return;
      }
      observedSessionIdsRef.current.add(payload.sessionId);
      pendingEventsRef.current.push(payload);
      scheduleFlush();
    }).then((stopListening) => {
      if (disposed) {
        stopListening();
        return;
      }
      unlisten = stopListening;
      listenerRegistrationGate.settle(null);
    }).catch((error: unknown) => {
      if (!disposed) {
        listenerRegistrationGate.settle(normalizeListenerRegistrationError(error));
      }
    });

    return () => {
      disposed = true;
      flushPendingEvents();
      clearPendingEvents();
      unlisten?.();
    };
  }, [clearPendingEvents, enabled, flushPendingEvents, listenerRegistrationGate, scheduleFlush]);

  const waitForListenerReady = useCallback(async () => {
    const registrationError = await listenerRegistrationGate.promise;
    if (registrationError) {
      throw registrationError;
    }
  }, [listenerRegistrationGate]);

  const latestSession = useMemo(() => getLatestAgentSession(sessions), [sessions]);
  const latestProgress = useMemo(() => getLatestAgentProgress(sessions), [sessions]);

  return {
    sessions,
    latestSession,
    latestProgress,
    flushPendingEvents,
    resetSessions,
    replaceSessions,
    mergeSessions,
    discardSessions,
    beginLiveEventCapture,
    endLiveEventCapture,
    waitForListenerReady,
  };
}
