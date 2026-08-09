export interface SubagentLikeSession {
  readonly id: string;
  readonly parentID?: string | undefined;
  readonly time: { readonly created: number };
}

export interface SubagentSessionClient {
  list(signal?: AbortSignal): Promise<readonly SubagentLikeSession[]>;
}

export interface AttachTarget {
  readonly sessionId: string;
  readonly createdAt: number;
}

export interface SubagentPaneManager {
  open(target: AttachTarget): Promise<void>;
  close(sessionId: string): Promise<void>;
  listOpen(): readonly string[];
}
