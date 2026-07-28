export type PaneId = string

export type SplitDirection = "horizontal" | "vertical"

export interface PtyOptions {
  command: string
  args: string[]
  cwd?: string
  env?: Record<string, string | undefined>
  cols?: number
  rows?: number
}

export interface PaneModel {
  id: PaneId
  direction?: SplitDirection
  children?: PaneModel[]
  ptyOptions?: PtyOptions
}
