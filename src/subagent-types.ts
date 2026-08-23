export type ObserverRuntimeStatus = "busy" | "idle" | "retry" | "error" | "unknown";

export type ObserverToolState = "pending" | "running" | "completed" | "error";

export interface SafeSessionProjection {
  readonly id: string;
  readonly parentSessionId?: string;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export type SafeModelCandidate =
  | { readonly providerId: string; readonly modelId: string }
  | { readonly providerId?: never; readonly modelId?: never };

export type SafeMessageProjection =
  | ({
      readonly id: string;
      readonly sessionId: string;
      readonly role: "user";
      readonly createdAt: number;
      readonly agentName: string;
    } & SafeModelCandidate)
  | ({
      readonly id: string;
      readonly sessionId: string;
      readonly role: "assistant";
      readonly createdAt: number;
      readonly completedAt?: number;
      readonly hasError: boolean;
    } & SafeModelCandidate);

export interface ObserverToolActivity {
  readonly id: string;
  readonly toolName: string;
  readonly state: ObserverToolState;
  readonly updatedAt: number;
}

export interface SubagentRuntimeView {
  readonly sessionId: string;
  readonly parentSessionId: string;
  readonly agentName: string;
  readonly providerId?: string;
  readonly modelId?: string;
  readonly status: ObserverRuntimeStatus;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly currentActivity?: ObserverToolActivity;
  readonly recentActivity: readonly ObserverToolActivity[];
  readonly latestAssistantText?: string;
  readonly publicReasoningSummary?: string;
}

export interface ObserverRegistrySnapshot {
  readonly parentSessionId?: string;
  readonly ready: boolean;
  readonly views: readonly SubagentRuntimeView[];
  readonly overflowCount: number;
}

export type SafePartProjection =
  | {
      readonly kind: "agent";
      readonly sessionId: string;
      readonly messageId: string;
      readonly partId: string;
      readonly name: string;
      readonly observedAt: number;
    }
  | {
      readonly kind: "subtask";
      readonly sessionId: string;
      readonly messageId: string;
      readonly partId: string;
      readonly agent: string;
      readonly observedAt: number;
    }
  | {
      readonly kind: "assistant-text";
      readonly sessionId: string;
      readonly messageId: string;
      readonly partId: string;
      readonly text: string;
      readonly observedAt: number;
    }
  | {
      readonly kind: "public-reasoning-summary";
      readonly sessionId: string;
      readonly messageId: string;
      readonly partId: string;
      readonly text: string;
      readonly observedAt: number;
    }
  | {
      readonly kind: "tool";
      readonly sessionId: string;
      readonly messageId: string;
      readonly partId: string;
      readonly activity: ObserverToolActivity;
    };
