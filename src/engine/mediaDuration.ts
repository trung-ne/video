export function parseContainerDurationSeconds(payload: unknown): number | undefined {
  const seconds = Number((payload as { format?: { duration?: unknown } } | null)?.format?.duration);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : undefined;
}

export function parseVideoStreamDurationSeconds(payload: unknown): number | undefined {
  const stream = (payload as { streams?: Array<{ duration?: unknown }> } | null)?.streams?.[0];
  const seconds = Number(stream?.duration);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : undefined;
}
