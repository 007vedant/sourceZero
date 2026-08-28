export interface Disposable {
  dispose(): void | Promise<void>;
}

export type Dispose = () => void | Promise<void>;

export function toDisposable(dispose: Dispose): Disposable {
  let disposed = false;

  return {
    async dispose(): Promise<void> {
      if (disposed) {
        return;
      }

      disposed = true;
      await dispose();
    },
  };
}
