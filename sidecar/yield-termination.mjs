function isSuccessfulTerminalYield(event) {
  if (
    event.type !== 'tool_execution_end'
    || event.toolName !== 'yield'
    || event.isError === true
    || !event.result?.details
    || typeof event.result.details !== 'object'
  ) {
    return false;
  }
  const details = event.result.details;
  return details.status === 'success' && !Array.isArray(details.type);
}

export async function promptUntilSuccessfulYield({ session, promptText, onEvent }) {
  let successfulYield = false;
  let abortPromise;
  const unsubscribe = session.subscribe((event) => {
    if (successfulYield) return;
    onEvent?.(event);
    if (isSuccessfulTerminalYield(event)) {
      successfulYield = true;
      abortPromise = session.abort({ goalReason: 'internal' });
    }
  });

  try {
    try {
      await session.prompt(promptText);
      if (!successfulYield) {
        await session.waitForIdle();
      }
    } catch (error) {
      if (!successfulYield) throw error;
    }
    if (abortPromise) {
      await abortPromise;
    }
    return { terminatedByYield: successfulYield };
  } finally {
    unsubscribe();
  }
}
