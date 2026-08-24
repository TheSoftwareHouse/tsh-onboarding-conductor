/**
 * jsdom does not implement ResizeObserver, which @xyflow/react uses to measure each node on
 * mount, and it always reports `offsetWidth`/`offsetHeight` as 0, since it never lays anything
 * out. Left alone, React Flow treats every node as unmeasured and keeps it hidden. The stub below
 * fires synchronously with the observed element so React Flow's own measurement code reads a
 * fixed, non-zero size from it and reveals the node.
 */
class ResizeObserverStub implements ResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}

  observe(target: Element): void {
    this.callback(
      [{ target, contentRect: target.getBoundingClientRect() } as ResizeObserverEntry],
      this,
    );
  }

  unobserve(): void {}
  disconnect(): void {}
}

globalThis.ResizeObserver ??= ResizeObserverStub;

Object.defineProperties(HTMLElement.prototype, {
  offsetWidth: { configurable: true, get: () => 248 },
  offsetHeight: { configurable: true, get: () => 88 },
});

/**
 * jsdom has no DOMMatrixReadOnly, which React Flow uses to read the zoom level back out of its
 * viewport's `transform` style. Only the `m22` (scale) component it actually reads is stubbed.
 */
class DOMMatrixReadOnlyStub {
  readonly m22: number;

  constructor(transform: string) {
    const scale = /scale\(([\d.]+)/.exec(transform);
    this.m22 = scale ? Number(scale[1]) : 1;
  }
}

globalThis.DOMMatrixReadOnly ??= DOMMatrixReadOnlyStub as unknown as typeof DOMMatrixReadOnly;
