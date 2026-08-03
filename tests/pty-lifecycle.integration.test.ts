import { expect, test } from "bun:test";
import { PtyManager } from "../src/pty-manager";

test.skipIf(process.platform === "win32")(
  "terminates a detached descendant when terminating its PTY",
  async () => {
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
      const timeout = setTimeout(
        () => reject(new Error("PTY did not report the child PID")),
        3_000,
      );
      const unsubscribe = pty.onData((data) => {
        output += data;
        const match = output.match(/CHILD:(\d+)/);
        if (match) {
          clearTimeout(timeout);
          unsubscribe();
          resolve(Number(match[1]));
        }
      });
    });

    try {
      await manager.terminate(pty.id);
    } finally {
      // Ensure descendant tracking stops even if the child ignored SIGTERM.
      manager.terminate(pty.id).catch(() => {});
    }

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
  },
);
