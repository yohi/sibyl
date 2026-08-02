import { expect, test } from "bun:test";
import { PtyManager } from "../src/pty-manager";

test("terminates a descendant after its PTY leader exits", async () => {
  if (process.platform === "win32") return;

  const manager = new PtyManager();
  const pty = await manager.spawn({
    command: "sh",
    args: ["-c", "sh -c 'trap \"\" HUP TERM; sleep 30' & echo CHILD:$!"],
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
  await new Promise<void>((resolve) => {
    pty.onExit(() => resolve());
  });

  await manager.terminate(pty.id, 10);

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
