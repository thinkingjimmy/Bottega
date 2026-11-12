/**
 * [INPUT]: Depends on lucide icons, Settings layout, Setup, Provider diagnostics, shared CLI update state and row, localized copy, the report-issue button and plugin detail.
 * [OUTPUT]: Provides PluginBanners, HealthDot, HealthSection with one list for Provider status and CLI updates, AboutSection, CapabilitiesSection, WorksWithSection and InformationSection.
 * [POS]: Read-only parts of the plugin pages; about.tsx and settings-page.tsx place them. Dependencies read as sentences (who meets
 *        each need, or why nothing does), with the contract id as small print.
 */
import type { ReactNode } from "react";
import { ArrowUpRight, Check, Lock, RefreshCw, TriangleAlert, X } from "lucide-react";
import { formatWorkbench, type WorkbenchCopy } from "@ai-chat/ui/lib/workbench-copy";
import { cn } from "@ai-chat/ui/lib/utils";
import { SettingsButton, SettingsList, SettingsSection } from "@/components/settings/settings-layout";
import { useSetup } from "@/components/providers/setup-provider";
import { useAppTranslation } from "@/components/providers/preferences/i18n-provider";
import { providerHealth } from "@/components/settings/providers/provider-row";
import { CliUpdateRow } from "@/components/settings/updates/cli-update-row";
import { ReportIssueButton } from "@/components/report-issue-button";
import { backendLabel, isAgentBackendId } from "@/lib/agent/agent-backends";
import { isUpdatableCli } from "@/lib/updates/cli-updates";
import type { PluginDetail, PluginView } from "@ai-chat/cloud-protocol/contracts/plugins/catalog";
import { blockReasonLabel, pluginPublisher, pluginText } from "../copy";

type Props = { detail: PluginDetail; workbench: WorkbenchCopy };
type Related = PluginDetail["related"][number];
const LEVEL_DOT = { ok: "bg-emerald-500", attention: "bg-amber-500", error: "bg-destructive", unknown: "bg-muted-foreground/40" } as const;

export const HealthDot = ({ level }: { level: keyof typeof LEVEL_DOT }) => <span aria-hidden className={cn("size-2 shrink-0 rounded-full", LEVEL_DOT[level])} />;

const Row = ({ label, children, className }: { label?: string; children: ReactNode; className?: string }) => (
  <div className={cn("flex min-w-0 items-start gap-4 px-4 py-3 text-sm", className)}>
    {label && <span className="w-32 shrink-0 pt-px text-muted-foreground text-xs">{label}</span>}
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">{children}</div>
  </div>
);

function Banner({ tone, icon, children, action }: { tone: "warn" | "info" | "danger"; icon: ReactNode; children: ReactNode; action?: ReactNode }) {
  return (
    <div role="status" className={cn("flex items-center gap-3 rounded-lg border px-3.5 py-3 text-sm",
      tone === "warn" ? "border-amber-500/30 bg-amber-500/10 text-amber-900 dark:text-amber-200"
        : tone === "danger" ? "border-destructive/30 bg-destructive/5 text-destructive" : "bg-muted/60 text-foreground")}>
      <span aria-hidden className="shrink-0 [&_svg]:size-4">{icon}</span>
      <span className="min-w-0 flex-1 text-pretty">{children}</span>
      {action}
    </div>
  );
}

/** Only the most urgent state is shown, so the page never stacks a column of banners. */
export function PluginBanners({ detail, workbench, note, onOpenRelated: _onOpenRelated }: Props & { note?: "busy" | "reinstall"; onOpenRelated(section: Related): void }) {
  const copy = workbench.plugins;
  const name = pluginText(detail.name, workbench);
  const blocked = detail.enabled && detail.availability.state === "blocked" ? detail.availability.blockedBy : [];
  if (note === "reinstall") {
    return <Banner tone="danger" icon={<TriangleAlert />} action={<ReportIssueButton title={formatWorkbench(copy.reinstallIssueTitle, { name })} body={`Plugin: ${name}\nError: plugin-reinstall-required`} />}>
      {formatWorkbench(copy.reinstallRequired, { name })} {copy.reinstallHelp}</Banner>;
  }
  if (blocked.length) {
    return <Banner tone="warn" icon={<TriangleAlert />}>
      <span data-plugin-blocked="">{formatWorkbench(copy.blockedBanner, { name, reason: blockReasonLabel(blocked[0]!.reason, copy) })}</span></Banner>;
  }
  if (note === "busy") return <Banner tone="warn" icon={<TriangleAlert />}>{formatWorkbench(copy.busyNote, { name })}</Banner>;
  if (detail.availability.state === "unsupported") return <Banner tone="info" icon={<Lock />}>{pluginText(detail.availability.detail, workbench)}</Banner>;
  if (detail.source === "agent-native") return <Banner tone="info" icon={<Lock />}>{formatWorkbench(copy.nativeReadOnly, { agent: backendLabel(detail.managedBy ?? "") })}</Banner>;
  if (detail.settings?.pendingRestart) return <Banner tone="info" icon={<RefreshCw />}><span data-plugin-pending-restart="">{formatWorkbench(copy.pendingRestart, { name })}</span></Banner>;
  return null;
}

export function HealthSection({ detail, workbench, locale }: Props & { locale: string }) {
  const copy = workbench.plugins;
  const { t } = useAppTranslation();
  const setup = useSetup();
  const builtinProvider = detail.kind === "provider" && isAgentBackendId(detail.id);
  const backend = builtinProvider ? setup.status?.backends.find(info => info.id === detail.id) : undefined;
  const provider = backend ? providerHealth(backend, setup.now) : null;
  const cli = backend && isUpdatableCli(backend) ? backend : null;
  const { health } = detail;
  const summary = pluginText(health.summary, workbench);
  const summaryKey = "key" in health.summary ? health.summary.key : null;
  const signIn = builtinProvider ? health.facts.find(fact => "key" in fact.label && fact.label.key === "plugins.health.signIn") : undefined;
  const facts = health.facts.filter(fact => !builtinProvider || (
    fact !== signIn &&
    !(cli && "key" in fact.label && fact.label.key === "plugins.health.cliVersion") &&
    !("key" in fact.value && fact.value.key === summaryKey)
  ));
  const note = provider?.noteKey ? t(provider.noteKey, { backend: backendLabel(detail.id) }) : null;
  const checked = health.checkedAt ? <span className="text-muted-foreground text-xs tabular-nums">
    {formatWorkbench(copy.checkedAt, { time: new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit" }).format(health.checkedAt) })}
  </span> : null;
  return (
    <SettingsSection title={copy.sectionHealth} action={builtinProvider ? checked : undefined}>
      <SettingsList>
        <Row>
          <HealthDot level={health.level} />
          {signIn && summaryKey?.startsWith("plugins.health.auth.") && <span className="text-muted-foreground text-xs">{copy.health.signIn}</span>}
          <span className={cn("min-w-0 wrap-anywhere font-medium", !builtinProvider && "flex-1")} data-plugin-health={health.level}>{summary}</span>
          {signIn && summaryKey === "plugins.health.ready" && <span className="text-muted-foreground text-xs">
            <span aria-hidden>· </span>{pluginText(signIn.value, workbench)}
          </span>}
          {!builtinProvider && checked}
          {provider?.fix === "setup" && <SettingsButton variant="outline" className="ml-auto" onClick={() => setup.openOnboarding("agent")}>{copy.setUp}</SettingsButton>}
        </Row>
        {cli && <CliUpdateRow backend={cli} compactLabel={copy.health.cliVersion} />}
        {facts.map(fact => (
          <Row key={pluginText(fact.label, workbench)} label={pluginText(fact.label, workbench)}>
            {fact.level && (!builtinProvider || fact.level !== "ok") && <HealthDot level={fact.level} />}
            <span className="wrap-anywhere">{pluginText(fact.value, workbench)}</span>
          </Row>
        ))}
        {note && note !== summary && <Row className="wrap-anywhere text-muted-foreground text-xs">{note}</Row>}
      </SettingsList>
    </SettingsSection>
  );
}

/* ---------- the introduction ---------- */

const IntroSection = ({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) => (
  <section className="flex flex-col gap-3">
    <div className="flex items-center justify-between gap-3"><h2 className="font-semibold text-[15px]">{title}</h2>{action}</div>
    {children}
  </section>
);

export function AboutSection({ detail, workbench }: Props) {
  const text = pluginText(detail.description, workbench) || pluginText(detail.summary, workbench);
  if (!text) return null;
  return (
    <IntroSection title={workbench.plugins.about}>
      {text.split(/\n{2,}/).map(paragraph => <p key={paragraph} className="max-w-[65ch] text-pretty text-sm leading-relaxed">{paragraph}</p>)}
    </IntroSection>
  );
}

export function CapabilitiesSection({ detail, workbench }: Props) {
  const copy = workbench.plugins;
  return (
    <IntroSection title={detail.source === "agent-native" ? copy.sectionIncludes : copy.sectionCanDo}>
      {detail.capabilities.length ? <ul className="flex flex-col gap-2">{detail.capabilities.map(item => {
        const label = pluginText(item.label, workbench);
        return (
          <li key={`${label}:${item.id ?? ""}`} className="flex items-start gap-2 text-sm">
            <Check aria-hidden className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
            <span>{label}{item.id && item.id !== label && <code className="ml-2 text-[11px] text-muted-foreground">{item.id}</code>}</span>
          </li>
        );
      })}</ul> : <p className="text-muted-foreground text-sm">{copy.capabilitiesNone}</p>}
    </IntroSection>
  );
}

export function WorksWithSection({ detail, workbench, names, onOpenPlugin }: Props & { names: ReadonlyMap<string, PluginView>; onOpenPlugin(id: string): void }) {
  const copy = workbench.plugins;
  const nameOf = (id: string) => { const view = names.get(id); return view ? pluginText(view.name, workbench) : id; };
  const blocked = detail.availability.state === "blocked" ? detail.availability.blockedBy : [];
  if (!detail.requires.length && !detail.dependents.length) {
    return <IntroSection title={copy.sectionWorksWith}><p className="text-muted-foreground text-sm">{copy.worksAlone}</p></IntroSection>;
  }
  return (
    <IntroSection title={copy.sectionWorksWith}>
      {detail.requires.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="text-muted-foreground text-xs">{copy.depRequires}</h3>
          <ul className="flex flex-col gap-2.5">{detail.requires.map(item => {
            const reason = blocked.find(entry => entry.contract === item.contract)?.reason;
            const met = item.satisfiedBy.length > 0 && !reason;
            return (
              <li key={item.contract} className="flex items-start gap-2 text-sm" data-plugin-requires={item.contract} data-met={met ? "true" : "false"}>
                {met ? <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-emerald-600" /> : <X aria-hidden className="mt-0.5 size-4 shrink-0 text-destructive" />}
                <span className="flex flex-col gap-0.5">
                  <span className={cn(!met && "text-destructive")}>{met ? formatWorkbench(copy.depSatisfiedBy, { plugins: item.satisfiedBy.map(nameOf).join(", ") })
                    : blockReasonLabel(reason ?? "missing", copy)}</span>
                  <code className="text-[11px] text-muted-foreground">{item.contract}</code>
                </span>
              </li>
            );
          })}</ul>
          {detail.source === "package" && <p className="text-muted-foreground text-xs">{copy.depHostNote}</p>}
        </div>
      )}
      {detail.dependents.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="text-muted-foreground text-xs">{copy.depDependents}</h3>
          <div className="flex flex-wrap gap-1.5">{detail.dependents.map(id => (
            <button key={id} type="button" onClick={() => onOpenPlugin(id)}
              className="inline-flex h-7 items-center rounded-full border px-2.5 text-xs hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring">{nameOf(id)}</button>
          ))}</div>
        </div>
      )}
    </IntroSection>
  );
}



const RELATED_LABEL = { providers: "relatedProviders", usage: "relatedUsage", skills: "relatedSkills", memory: "relatedMemory", dock: "relatedDock" } as const;

export function InformationSection({ detail, workbench, onOpen }: Props & { onOpen(section: Related): void }) {
  const copy = workbench.plugins;
  const rows: Array<[string, ReactNode]> = [
    [copy.aboutPublisher, pluginPublisher(detail, workbench)],
    [copy.aboutVersion, detail.source === "builtin" && !detail.origin ? formatWorkbench(copy.versionWithApp, { version: detail.version ?? "—" }) : detail.version ?? "—"],
    [copy.aboutKind, detail.kind === "provider" ? copy.kindProvider : copy.kindFeature],
    [copy.aboutSource, detail.origin && detail.source !== "agent-native" ? copy.sourceLocalLong : detail.source === "builtin" ? copy.sourceBuiltinLong : detail.source === "package" ? copy.sourcePackageLong : copy.sourceNativeLong],
    ...(detail.origin ? [[copy.aboutLocation, <code key="origin" className="break-all text-[11px]">{detail.origin}</code>] as [string, ReactNode]] : []),
    [copy.aboutId, <code key="id" className="break-all text-[11px]">{detail.id}</code>],
    ...detail.health.facts.map((fact): [string, ReactNode] => [pluginText(fact.label, workbench),
      <span key={pluginText(fact.label, workbench)} className="flex min-w-0 items-center gap-2">
        {fact.level && <HealthDot level={fact.level} />}
        <span className="break-all">{pluginText(fact.value, workbench)}</span>
      </span>]),
  ];
  return (
    <IntroSection title={copy.sectionInformation}>
      <dl className="grid grid-cols-1 gap-x-6 gap-y-4 rounded-lg border p-4 @lg:grid-cols-3" aria-label={copy.about}>{rows.map(([term, value]) => (
        <div key={term} className="flex min-w-0 flex-col gap-0.5"><dt className="text-muted-foreground text-xs">{term}</dt><dd className="text-sm">{value}</dd></div>
      ))}</dl>
      {detail.related.length > 0 && (
        <div className="flex flex-wrap gap-x-4 gap-y-1">{detail.related.map(section => (
          <button key={section} type="button" onClick={() => onOpen(section)}
            className="inline-flex items-center gap-1 rounded text-sm hover:underline focus-visible:outline-2 focus-visible:outline-ring">
            {copy[RELATED_LABEL[section]]}<ArrowUpRight aria-hidden className="size-3.5 text-muted-foreground" /></button>
        ))}</div>
      )}
    </IntroSection>
  );
}
