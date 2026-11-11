/**
 * [INPUT]: Plugin identity, introduction, optional controls/footer and catalog navigation callbacks.
 * [OUTPUT]: One equal-height catalog card layout with a two-line introduction and independent controls.
 * [POS]: Shared presentation for canonical plugin cards and legacy Provider/Dock cards; owns no lifecycle state.
 */
import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@ai-chat/ui/lib/utils';

type Props = Omit<ComponentProps<'div'>, 'children' | 'onClick'> & {
  name: string;
  publisher: ReactNode;
  summary: string;
  icon: ReactNode;
  control?: ReactNode;
  footer?: ReactNode;
  onOpen(): void;
};

export function PluginCardFrame({ name, publisher, summary, icon, control, footer, onOpen, className, ...attributes }: Props) {
  return <div {...attributes} data-plugin-card="" className={cn('group/card relative flex h-44 min-w-0 flex-col gap-3 rounded-md border bg-card p-4 transition-[border-color,box-shadow] hover:border-foreground/20 hover:shadow-sm has-[[data-card-open]:focus-visible]:ring-2 has-[[data-card-open]:focus-visible]:ring-ring/50 motion-reduce:transition-none', className)}>
    <div className="flex h-9 min-w-0 shrink-0 items-center gap-2.5">
      {icon}
      <span className="flex min-w-0 flex-1 flex-col">
        <button type="button" data-card-open="" onClick={onOpen} className="min-w-0 cursor-pointer truncate text-left text-[13px] font-semibold leading-5 outline-none after:absolute after:inset-0 after:cursor-pointer after:rounded-md after:content-['']">{name}</button>
        <span className="truncate text-xs text-muted-foreground">{publisher}</span>
      </span>
      {control && <span className="pointer-events-none relative z-10 flex min-h-5 max-w-1/2 shrink-0 items-center self-start">{control}</span>}
    </div>
    <p data-plugin-card-summary="" className="line-clamp-2 h-9 shrink-0 text-pretty text-xs leading-[18px] text-muted-foreground">{summary}</p>
    <div className="mt-auto flex h-9 min-w-0 shrink-0 flex-col justify-end text-xs leading-[18px]">{footer}</div>
  </div>;
}
