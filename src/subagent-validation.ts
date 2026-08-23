export type ObserverIntegerName =
  | "maxVisibleSubagents"
  | "maxTrackedSubagents"
  | "activityLimit"
  | "idleRetentionMs";

export type ObserverBooleanName =
  | "enabled"
  | "showModel"
  | "showProvider"
  | "showLatestText"
  | "showReasoningSummary";

const INTEGER_BOUNDS: Record<ObserverIntegerName, readonly [number, number]> = {
  maxVisibleSubagents: [1, 8],
  maxTrackedSubagents: [8, 256],
  activityLimit: [1, 20],
  idleRetentionMs: [0, 3_600_000],
};

export class SubagentValidationError extends Error {
  readonly name = "SubagentValidationError";

  constructor(subject: string) {
    super(`Invalid ${subject}`);
  }
}

export function parseObserverBoolean(
  name: ObserverBooleanName,
  value: unknown,
  fromEnvironment: boolean,
): boolean {
  if (!fromEnvironment && typeof value === "boolean") return value;
  if (fromEnvironment && value === "true") return true;
  if (fromEnvironment && value === "1") return true;
  if (fromEnvironment && value === "false") return false;
  if (fromEnvironment && value === "0") return false;
  throw new SubagentValidationError(`observer ${name}`);
}

export function parseObserverInteger(
  name: ObserverIntegerName,
  value: unknown,
  fromEnvironment: boolean,
): number {
  const parsed =
    fromEnvironment && typeof value === "string" && /^\d+$/u.test(value) ? Number(value) : value;
  const [minimum, maximum] = INTEGER_BOUNDS[name];
  if (
    typeof parsed !== "number" ||
    !Number.isSafeInteger(parsed) ||
    parsed < minimum ||
    parsed > maximum
  ) {
    throw new SubagentValidationError(`observer ${name}`);
  }
  return parsed;
}

export function validateObserverCapacity(
  maxVisibleSubagents: number,
  maxTrackedSubagents: number,
): void {
  if (maxTrackedSubagents < maxVisibleSubagents) {
    throw new SubagentValidationError("observer maxTrackedSubagents");
  }
}
