/**
 * [INPUT]: Dependence when not running
 * [OUTPUT]: Provides ChartSkeleton The only occupational form of a graph space
 * [POS]: The only source of truth for the waiting mode of components/charts; Suspense shared by chart-fence-renderers with the streamline branch of chart-code-block
 */

/**
 * 「正文还没流完」与「渲染器还没到」在用户眼里是同一种等待，因此只能有
 * 一块骨架。它留在首包（十几个字节）正是为了这一点：懒边界两侧都要用它，
 * 复制一份就等于允许两种等待长得不一样。
 */
export function ChartSkeleton() {
  return (
    <div
      aria-label="图表生成中"
      className="h-[280px] animate-pulse rounded-xl border bg-muted/40 motion-reduce:animate-none"
      role="status"
    />
  );
}
