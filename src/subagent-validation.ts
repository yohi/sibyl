export type ParsedMaxPanes = { readonly ok: true; readonly value: number } | { readonly ok: false };

export class SubagentValidationError extends Error {
  readonly name = "SubagentValidationError";

  constructor(subject: string) {
    super(`Invalid subagent ${subject}`);
  }
}

export function parseMaxPanesValue(value: unknown): ParsedMaxPanes {
  if (typeof value !== "number" || !Number.isFinite(value)) return { ok: false };
  if (!Number.isInteger(value) || value < 0 || value > 8) return { ok: false };
  return { ok: true, value };
}

export function validateServerUrl(value: string): boolean {
  if (value.length === 0) return false;

  try {
    const url = new URL(value);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      url.username.length === 0 &&
      url.password.length === 0
    );
  } catch {
    return false;
  }
}

export function validateSessionId(value: string): boolean {
  return /^[A-Za-z0-9-]+$/.test(value);
}
