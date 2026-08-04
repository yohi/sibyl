export function createDeferred<T>() {
  let resolvePromise: ((value: T) => void) | undefined;
  let rejectPromise: ((reason?: unknown) => void) | undefined;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });

  return {
    promise,
    resolve(value: T): void {
      if (!resolvePromise) throw new Error("Deferred promise is not initialized");
      resolvePromise(value);
    },
    reject(reason?: unknown): void {
      if (!rejectPromise) throw new Error("Deferred promise is not initialized");
      rejectPromise(reason);
    },
  };
}
