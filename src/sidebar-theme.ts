import type { RGBA } from "@opentui/core";

export interface SidebarTheme {
  readonly primary: RGBA;
  readonly secondary: RGBA;
  readonly accent: RGBA;
  readonly error: RGBA;
  readonly warning: RGBA;
  readonly success: RGBA;
  readonly info: RGBA;
  readonly text: RGBA;
  readonly textMuted: RGBA;
  readonly backgroundPanel: RGBA;
}
