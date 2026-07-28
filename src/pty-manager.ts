import type { IPty } from "node-pty"
import type { PtyOptions } from "./types.js"

export type PtyId = string
type PtyModule = Pick<typeof import("node-pty"), "spawn">

export interface PtyHandle {
  id: PtyId
  write(data: string): void
  resize(cols: number, rows: number): void
  onData(callback: (data: string) => void): () => void
  onExit(callback: (event: { exitCode: number; signal?: number }) => void): () => void
}

export class PtyManager {
  private terminals = new Map<PtyId, IPty>()
  private dataSubscriptions = new Map<PtyId, ReturnType<IPty["onData"]>>()
  private exitSubscriptions = new Map<PtyId, ReturnType<IPty["onExit"]>>()
  private dataCallbacks = new Map<PtyId, Set<(data: string) => void>>()
  private exitCallbacks = new Map<
    PtyId,
    Set<(event: { exitCode: number; signal?: number }) => void>
  >()
  private exited = new Set<PtyId>()
  private idCounter = 0
  private nodePtyModule?: Promise<PtyModule>

  constructor(
    private readonly loadBunPtyAdapter?: () => Promise<PtyModule>,
    private readonly loadNodePty: () => Promise<PtyModule> = () => import("node-pty"),
  ) {}

  async spawn(options: PtyOptions): Promise<PtyHandle> {
    const id = `pty-${++this.idCounter}`
    const { spawn } = await this.loadPtyModule()
    const terminal = spawn(options.command, options.args, {
      name: "xterm-256color",
      cols: options.cols ?? 80,
      rows: options.rows ?? 24,
      cwd: options.cwd ?? process.cwd(),
      env: {
        ...process.env,
        TERM: "xterm-256color",
        ...options.env,
      },
      encoding: "utf8",
    })

    this.terminals.set(id, terminal)

    // 新しい購読者が登録される前に発生したデータ/終了イベントを
    // 保持するため、コールバック集合に加えてバッファで蓄積する。
    // Pane コンポーネントは spawn() 解決後に onData/onExit を登録する
    // 可能性があるため、バッファをリプレイしないと起動直後の出力や
    // 即時終了が見逃される。
    const pendingData: string[] = []
    let pendingExit: { exitCode: number; signal?: number } | undefined

    const dataSub = terminal.onData((data) => {
      if (!this.exited.has(id)) {
        pendingData.push(data)
        this.emitData(id, data)
      }
    })
    this.dataSubscriptions.set(id, dataSub)

    const exitSub = terminal.onExit((event) => {
      this.exited.add(id)
      pendingExit = event
      this.emitExit(id, event)
    })
    this.exitSubscriptions.set(id, exitSub)

    // 購読登録時にバッファをリプレイしてから通常の購読フローを開始する。
    const handle = this.createHandle(id, terminal)
    return this.withReplay(id, handle, pendingData, pendingExit)
  }

  async terminate(id: PtyId, gracefulTimeoutMs = 1500): Promise<void> {
    const terminal = this.terminals.get(id)
    if (!terminal) {
      this.dispose(id)
      return
    }

    let resolveExit = () => {}
    const exitPromise = new Promise<void>((resolve) => {
      resolveExit = resolve
    })
    let exitListener: ReturnType<IPty["onExit"]> | undefined
    exitListener = terminal.onExit(() => {
      exitListener?.dispose()
      resolveExit()
    })

    // onExit を先に登録する。すでに終了済みなら待機せずに解決する。
    if (this.exited.has(id)) {
      exitListener?.dispose()
      resolveExit()
      await exitPromise
      this.dispose(id)
      return
    }

    if (process.platform === "win32") {
      terminal.kill()
    } else {
      terminal.kill("SIGTERM")

      await Promise.race([
        exitPromise,
        new Promise<void>((resolve) => setTimeout(resolve, gracefulTimeoutMs)),
      ])

      if (!this.exited.has(id)) {
        terminal.kill("SIGKILL")
      }
    }

    await exitPromise
    this.dispose(id)
  }

  terminateAll(): Promise<void> {
    const promises = Array.from(this.terminals.keys()).map((id) => this.terminate(id))
    return Promise.all(promises).then(() => undefined)
  }

  private emitData(_id: PtyId, _data: string): void {
    for (const callback of this.dataCallbacks.get(_id) ?? []) {
      callback(_data)
    }
  }

  private emitExit(_id: PtyId, _event: { exitCode: number; signal?: number }): void {
    for (const callback of this.exitCallbacks.get(_id) ?? []) {
      callback(_event)
    }
  }

  private createHandle(id: PtyId, terminal: IPty): PtyHandle {
    return {
      id,
      write: (data) => terminal.write(data),
      resize: (cols, rows) => {
        if (cols > 0 && rows > 0 && !this.exited.has(id)) {
          try {
            terminal.resize(cols, rows)
          } catch (error) {
            if (!this.exited.has(id)) {
              throw error
            }
          }
        }
      },
      onData: (callback) => {
        const callbacks =
          this.dataCallbacks.get(id) ?? new Set<(data: string) => void>()
        callbacks.add(callback)
        this.dataCallbacks.set(id, callbacks)
        return () => {
          callbacks.delete(callback)
          if (callbacks.size === 0) {
            this.dataCallbacks.delete(id)
          }
        }
      },
      onExit: (callback) => {
        const callbacks =
          this.exitCallbacks.get(id) ??
          new Set<(event: { exitCode: number; signal?: number }) => void>()
        callbacks.add(callback)
        this.exitCallbacks.set(id, callbacks)
        return () => {
          callbacks.delete(callback)
          if (callbacks.size === 0) {
            this.exitCallbacks.delete(id)
          }
        }
      },
    }
  }

  private withReplay(
    id: PtyId,
    handle: PtyHandle,
    pendingData: string[],
    pendingExit: { exitCode: number; signal?: number } | undefined,
  ): PtyHandle {
    const originalOnData = handle.onData.bind(handle)
    const originalOnExit = handle.onExit.bind(handle)
    const dataReplayedCallbacks = new Set<(data: string) => void>()
    const exitReplayedCallbacks = new Set<
      (event: { exitCode: number; signal?: number }) => void
    >()
    return {
      ...handle,
      onData: (callback) => {
        if (this.dataCallbacks.get(id)?.has(callback)) {
          return originalOnData(callback)
        }
        if (!dataReplayedCallbacks.has(callback)) {
          dataReplayedCallbacks.add(callback)
          for (const data of pendingData) callback(data)
        }
        return originalOnData(callback)
      },
      onExit: (callback) => {
        if (this.exitCallbacks.get(id)?.has(callback)) {
          return originalOnExit(callback)
        }
        if (!exitReplayedCallbacks.has(callback)) {
          exitReplayedCallbacks.add(callback)
          if (pendingExit) callback(pendingExit)
        }
        return originalOnExit(callback)
      },
    }
  }

  private dispose(id: PtyId): void {
    this.dataSubscriptions.get(id)?.dispose()
    this.exitSubscriptions.get(id)?.dispose()
    this.dataSubscriptions.delete(id)
    this.exitSubscriptions.delete(id)
    this.dataCallbacks.delete(id)
    this.exitCallbacks.delete(id)
    this.terminals.delete(id)
    this.exited.delete(id)
  }

  private async loadPtyModule(): Promise<PtyModule> {
    if (typeof process.versions.bun === "string" && this.loadBunPtyAdapter) {
      return this.loadBunPtyAdapter()
    }
    this.nodePtyModule ??= this.loadNodePty().catch((error: unknown) => {
      throw new Error("No compatible PTY adapter is available", { cause: error })
    })
    return this.nodePtyModule
  }
}
