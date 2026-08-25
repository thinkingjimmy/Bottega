/**
 * [INPUT]: Accepts injectable ECharts Factory, ResizeObserver constructor, DOM node and option
 * [OUTPUT]: Provides createChartLifecycle, unified init/setOption/resize/pre-ordered to observe and then dispose of the chords
 * [POS]: The lifecycle core of the rendering instances of lib/charts; ChartCore is just React thin-skinned
 */

export type ChartLike = {
  setOption(option: unknown, options: { notMerge: true }): void;
  resize(): void;
  dispose(): void;
};

export type ResizeObserverLike = {
  observe(target: Element): void;
  disconnect(): void;
};

export function createChartLifecycle({
  element,
  init,
  createResizeObserver,
}: {
  element: HTMLElement;
  init(element: HTMLElement): ChartLike;
  createResizeObserver(callback: () => void): ResizeObserverLike;
}) {
  const chart = init(element);
  let destroyed = false;
  const observer = createResizeObserver(() => {
    if (!destroyed) chart.resize();
  });
  observer.observe(element);
  return {
    setOption(option: unknown) {
      if (!destroyed) chart.setOption(option, { notMerge: true });
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      observer.disconnect();
      chart.dispose();
    },
  };
}
