/**
 * [INPUT]: Depends on Apps README IPC, Apps i18n, AppDialog primitives, and secure lazy Markdown rendering
 * [OUTPUT]: Provides SafeReadme, readmeBody, useAppReadme, the controlled ReadmeDialog, and AppReadmeAdornment
 * [POS]: Secure Apps README presentation boundary shared by install details, installed-App title adornments, and menu-hosted entries that must own the dialog's open state themselves
 */

import { useEffect, useState, type ReactNode } from "react";
import { InfoIcon } from "lucide-react";
import {
  AppDialogBody,
  AppDialogContent,
} from "@ai-chat/ui/components/ui/app-dialog";
import { Button } from "@ai-chat/ui/components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@ai-chat/ui/components/ui/dialog";
import { cn } from "@ai-chat/ui/lib/utils";
import { readAppReadme } from "@/lib/apps-client";
import { useAppTranslation } from "@/components/providers/i18n-provider";

type ReadmeMarkdownComponent = typeof import(
  "@ai-chat/ui/components/ai-elements/message"
)["MessageResponse"];
let loadedReadmeMarkdown: ReadmeMarkdownComponent | null = null;
let readmeMarkdownPromise: Promise<ReadmeMarkdownComponent> | null = null;

const loadReadmeMarkdown = () => {
  readmeMarkdownPromise ??= import(
    "@ai-chat/ui/components/ai-elements/message"
  ).then(({ MessageResponse }) => {
    loadedReadmeMarkdown = MessageResponse;
    return MessageResponse;
  });
  return readmeMarkdownPromise;
};

export function SafeReadme({
  children,
  className,
}: {
  children: string;
  className?: string;
}) {
  const [Markdown, setMarkdown] = useState<ReadmeMarkdownComponent | null>(
    () => loadedReadmeMarkdown
  );
  useEffect(() => {
    if (Markdown) return;
    let active = true;
    void loadReadmeMarkdown().then((component) => {
      if (active) setMarkdown(() => component);
    });
    return () => {
      active = false;
    };
  }, [Markdown]);
  return Markdown ? (
    <Markdown className={className}>{children}</Markdown>
  ) : (
    <pre className={cn("whitespace-pre-wrap text-sm text-foreground", className)}>
      {children}
    </pre>
  );
}

/* README 的第一行按惯例就是它自己的名字。当宿主表面（弹窗标题、页头）
   已经写过这个名字时，正文再来一个 H1 就是同一句话喊两遍——而且喊得更大声，
   层级因此倒挂。摘掉它不是删信息，是把标题权交还给已经承担标题职责的那一层。 */
export function readmeBody(readme: string) {
  return readme.replace(/^\s*#\s+[^\n]*\n?/, "").trimStart();
}

/** README 取回：谁要决定「入口该不该出现」，谁就得先拿到正文。 */
export function useAppReadme(appId: string) {
  const [readme, setReadme] = useState("");
  useEffect(() => {
    let active = true;
    void readAppReadme(appId)
      .then((content) => {
        if (active) setReadme(content ?? "");
      })
      .catch(() => {
        if (active) setReadme("");
      });
    return () => {
      active = false;
    };
  }, [appId]);
  return readme;
}

/* 受控，触发器可缺席：入口若落在下拉菜单里，菜单一关就会把触发器连同它
   持有的 open 一起卸掉，弹窗于是永远开不起来——那条路径只传 open，不传
   children。仍有常驻按钮的调用方把 DialogTrigger 塞进 children，Radix 的
   aria-haspopup/expanded/controls 便一件不少。 */
export function ReadmeDialog({
  appName,
  readme,
  open,
  onOpenChange,
  children,
}: {
  appName: string;
  readme: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children?: ReactNode; // 触发器插槽；菜单入口留空
}) {
  const { t } = useAppTranslation();
  if (!readme) return null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {children}
      <AppDialogContent className="sm:max-w-3xl">
        {/* README 自带标题层级：H1 就是它的名字。弹窗再摆一个可见 header，
            同一句话就有了两个声音，且小号 chrome 标题压在大号正文标题上，
            读起来像面包屑而非标题。故 header 只留给读屏器——Radix 要求
            Content 有可访问名，视觉标题让给正文，重复自然消失。 */}
        <DialogHeader className="sr-only">
          <DialogTitle>{appName}</DialogTitle>
          <DialogDescription>{t("apps.readme.description")}</DialogDescription>
        </DialogHeader>
        {/* mt 是给右上角那颗 × 让位，而且必须让纵向、不能让横向。
            header 降成 sr-only 后正文层顶到了最上面，滚动沟槽的头一段正好从
            × 身后穿过——两者横向本就同处右缘一条窄带，挤是挤不开的（× 宽
            24px，沟槽只有 8px 且整个落在它区间内），只有错开高度才分得清。
            带 header 的弹窗天然没这问题：正文起始于标题之下，早在 × 下方了。
            让纵向的另一个好处是文字左右仍对称，横向内缩会把整段推歪。 */}
        {/* pr 是给滚动条让路：沟槽占的是正文层内侧，不给右内边距，文字就直接
            贴着拇指。左 24px / 右 40px 的不对称是滚动文档的常态——拇指本身
            占掉那 8px，视觉上补回来了。 */}
        <AppDialogBody className="mt-5 pr-3 pl-1">
          <SafeReadme>{readme}</SafeReadme>
        </AppDialogBody>
      </AppDialogContent>
    </Dialog>
  );
}

/** 正文为空即不渲染入口：没有 README 就没有可看的东西，不摆一个空弹窗。 */
function ReadmeAdornment({
  appName,
  readme,
}: {
  appName: string;
  readme: string;
}) {
  const { t } = useAppTranslation();
  const [open, setOpen] = useState(false);
  if (!readme) return null;
  return (
    <ReadmeDialog
      appName={appName}
      onOpenChange={setOpen}
      open={open}
      readme={readme}
    >
      <DialogTrigger asChild>
        <Button
          aria-label={t("apps.readme.open", { name: appName })}
          size="icon-sm"
          type="button"
          variant="ghost"
        >
          <InfoIcon />
        </Button>
      </DialogTrigger>
    </ReadmeDialog>
  );
}

export function AppReadmeAdornment({
  appId,
  appName,
}: {
  appId: string;
  appName: string;
}) {
  const readme = useAppReadme(appId);
  return <ReadmeAdornment appName={appName} readme={readme} />;
}
