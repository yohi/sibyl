import type {
  ObserverRuntimeStatus,
  SafeMessageProjection,
  SafePartProjection,
  SafeSessionProjection,
} from "./subagent-types.js";

export type NormalizedObserverEvent =
  | {
      readonly type: "session.upsert";
      readonly sequence: number;
      readonly observedAt: number;
      readonly session: SafeSessionProjection;
    }
  | {
      readonly type: "session.deleted";
      readonly sequence: number;
      readonly observedAt: number;
      readonly sessionId: string;
    }
  | {
      readonly type: "message.upsert";
      readonly sequence: number;
      readonly observedAt: number;
      readonly message: SafeMessageProjection;
    }
  | {
      readonly type: "message.removed";
      readonly sequence: number;
      readonly observedAt: number;
      readonly sessionId: string;
      readonly messageId: string;
    }
  | {
      readonly type: "part.upsert";
      readonly sequence: number;
      readonly observedAt: number;
      readonly part: SafePartProjection;
    }
  | {
      readonly type: "part.refresh";
      readonly sequence: number;
      readonly observedAt: number;
      readonly sessionId: string;
      readonly messageId: string;
      readonly partId: string;
    }
  | {
      readonly type: "part.removed";
      readonly sequence: number;
      readonly observedAt: number;
      readonly sessionId: string;
      readonly messageId: string;
      readonly partId: string;
    }
  | {
      readonly type: "status.changed";
      readonly sequence: number;
      readonly observedAt: number;
      readonly sessionId: string;
      readonly status: ObserverRuntimeStatus;
    }
  | {
      readonly type: "session.idle";
      readonly sequence: number;
      readonly observedAt: number;
      readonly sessionId: string;
    }
  | {
      readonly type: "session.error";
      readonly sequence: number;
      readonly observedAt: number;
      readonly sessionId: string;
    }
  | {
      readonly type: "session.retry";
      readonly sequence: number;
      readonly observedAt: number;
      readonly sessionId: string;
      readonly attempt: number;
    };

export interface ObserverEventSource {
  start(): void;
  stop(): Promise<void>;
  onEvent(handler: (event: NormalizedObserverEvent) => void): () => void;
  onReconnectRequired(handler: () => Promise<void> | void): () => void;
}
