export interface SubagentLogger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export const consoleSubagentLogger: SubagentLogger = {
  info(message) {
    console.info(message);
  },
  warn(message) {
    console.warn(message);
  },
  error(message) {
    console.error(message);
  },
};

export function sanitizeSessionId(sessionId: string): string {
  return `${sessionId.slice(0, 4)}…`;
}

export function truncate(text: string, max = 200): string {
  if (text.length <= max) return text;
  if (max < 3) return text.slice(0, Math.max(0, max));
  return `${text.slice(0, max - 3)}...`;
}

export function sanitizeError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const redacted = raw
    .replace(/https?:\/\/[^\s]+/giu, "[redacted-url]")
    .replace(/\b(password|token|secret|authorization)=\S+/giu, "$1=[redacted]");
  return truncate(redacted);
}

export function formatSubagentError(operation: string, error: unknown): string {
  return truncate(`[subagent] ${operation}: ${sanitizeError(error)}`);
}
