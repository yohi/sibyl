const REDACTED = "[redacted]";
const SENSITIVE_NAME = `(?:authorization|password|secret|token|api[_-]?key|apikey)`;
const NAMED_VALUE_PATTERN = new RegExp(
  `\\b(${SENSITIVE_NAME})(\\s*[:=]\\s*)(?:"[^"]*"|'[^']*'|[^\\s,;]+)`,
  "giu",
);

export const LATEST_TEXT_LIMIT = 160;
export const REASONING_SUMMARY_LIMIT = 160;
export const DISPLAY_IDENTIFIER_LIMIT = 64;
export const TOOL_NAME_LIMIT = 64;
export const CORRELATION_ID_LIMIT = 128;

function redactNamedValues(text: string): string {
  return text.replace(
    NAMED_VALUE_PATTERN,
    (_match, name: string, separator: string) => `${name}${separator}${REDACTED}`,
  );
}

function redactAuthorizationSchemes(text: string): string {
  return text.replace(
    /\b(Basic|Bearer|Digest|Token)\s+[^\s,;]+/giu,
    (_match, scheme: string) => `${scheme} ${REDACTED}`,
  );
}

function redactRecognizedTokens(text: string): string {
  return text
    .replace(
      /\b(?:sk|pk|ghp|gho|ghu|ghs|ghr|github_pat|xox[abprs])[-_][A-Za-z0-9_-]{8,}\b/gu,
      REDACTED,
    )
    .replace(/\bAKIA[A-Z0-9]{16}\b/gu, REDACTED)
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/gu, REDACTED);
}

function redactEnvironmentAssignments(text: string): string {
  return text.replace(
    /\b([A-Z][A-Z0-9_]*(?:AUTHORIZATION|PASSWORD|SECRET|TOKEN|API_KEY|APIKEY)[A-Z0-9_]*)(=)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gu,
    (_match, name: string, separator: string) => `${name}${separator}${REDACTED}`,
  );
}

export function redactAndTruncate(text: string, maxLength: number): string {
  const redacted = redactEnvironmentAssignments(
    redactRecognizedTokens(redactAuthorizationSchemes(redactNamedValues(text))),
  );
  if (redacted.length <= maxLength) return redacted;
  if (maxLength <= 0) return "";
  if (maxLength === 1) return "…";
  return `${redacted.slice(0, maxLength - 1)}…`;
}
