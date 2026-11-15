/**
 * [INPUT]: React content slots and the store stylesheet.
 * [OUTPUT]: StoreFeature (featured banner), StoreSection (titled two-column grid), StoreRow (icon, name, one-line subtitle, pill action) and StorePill.
 * [POS]: Mac App Store–style presentation shared by the Plugins page's Apps and Widgets tabs; owns no data or actions.
 */
import type { ComponentProps, CSSProperties, ReactNode } from "react";
import "./store.css";

export function StoreFeature({ title, description, art, action, tone = "app", tint }: {
  title: string; description: string; art: ReactNode; action: ReactNode; tone?: "app" | "wall"; tint?: string;
}) {
  return <article className="store-feature" data-tone={tone} style={tint ? { "--store-tint": tint } as CSSProperties : undefined}>
    <div className="store-feature-copy"><h2>{title}</h2><p>{description}</p>{action}</div>
    <div className="store-feature-art">{art}</div>
  </article>;
}

export function StoreSection({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return <section className="store-section">
    <header><h2>{title}</h2>{action}</header>
    {children}
  </section>;
}

export function StoreGrid({ children }: { children: ReactNode }) {
  return <ul className="store-grid">{children}</ul>;
}

export function StoreRow({ icon, tint, title, subtitle, subtitleTone, action, dashed, wall, ...props }: {
  icon: ReactNode; tint?: string; title: string; subtitle?: string; subtitleTone?: "busy"; action: ReactNode; dashed?: boolean; wall?: boolean;
} & Omit<ComponentProps<"li">, "title">) {
  return <li className="store-row" {...props}>
    <span className="store-icon" data-dashed={dashed || undefined} data-wall={wall || undefined} style={tint ? { "--store-tint": tint } as CSSProperties : undefined}>{icon}</span>
    <div><h3 title={title}>{title}</h3>{subtitle && <p data-tone={subtitleTone}>{subtitle}</p>}</div>
    {action}
  </li>;
}

export function StorePill({ tone = "accent", className, ...props }: ComponentProps<"button"> & { tone?: "accent" | "plain" | "solid" }) {
  return <button type="button" data-tone={tone} className={["store-pill", className].filter(Boolean).join(" ")} {...props} />;
}
