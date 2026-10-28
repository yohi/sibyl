import { RGBA } from "@opentui/core";

export function agentColor(color: string, theme: Readonly<Record<string, RGBA>>): RGBA | undefined {
  if (Object.hasOwn(theme, color)) return theme[color];
  if (!/^#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(color)) return undefined;
  return RGBA.fromHex(color);
}
