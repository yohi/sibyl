import { expect, test } from "bun:test";
import { PtyManager } from "../src/pty-manager";

test("terminates a detached descendant when terminating its PTY", async () => {
  if (process.platform === "win32") return;

  const manager = new PtyManager();
  const pty = await manager.spawn({
    command: "sh",
    // macOS には setsid(util-linux)が存在しないため、perl の POSIX::setsid で
    // 新セッションへ脱離させる(macOS / Linux 両方に perl は標準搭載)。
    args: [
      "-c",
      "perl -e 'use POSIX qw(setsid); setsid(); exec @ARGV' sh -c 'trap \"\" HUP TERM; echo CHILD:$$; sleep 30' & sleep 0.2",
    ],
  });
  const childPid = await new Promise<number>((resolve, reject) => {
    let output = "";
    const timeout = setTimeout(() => reject(new Error("PTY did not report the child PID")), 3_000);
    pty.onData((data) => {
      output += data;
      const match = output.match(/CHILD:(\d+)/);
      if (match) {
        clearTimeout(timeout);
        resolve(Number(match[1]));
      }
    });
  });
  await manager.terminate(pty.id);

  let childAlive = false;
  try {
    process.kill(childPid, 0);
    childAlive = true;
  } catch (error) {
    if (!(error instanceof Error)) throw error;
  } finally {
    if (childAlive) process.kill(childPid, "SIGKILL");
  }

  expect(childAlive).toBe(false);
});
