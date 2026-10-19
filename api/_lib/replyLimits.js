// Technischer Antwortspielraum; keine Vorgabe für die Antwortlänge im Prompt.
export const MIN_REPLY_TOKENS = 4096;
export const MAX_REPLY_TOKENS = 8192;

export function replyTokenLimit(configured) {
  const value = Number(configured);
  if (!Number.isSafeInteger(value) || value < MIN_REPLY_TOKENS) return MIN_REPLY_TOKENS;
  return Math.min(value, MAX_REPLY_TOKENS);
}

export function replyCompletion(provider, data) {
  const stopReason = provider === "claude"
    ? data?.stop_reason ?? null
    : data?.choices?.[0]?.finish_reason ?? null;
  return { stopReason, truncated: stopReason === "max_tokens" || stopReason === "length" };
}
