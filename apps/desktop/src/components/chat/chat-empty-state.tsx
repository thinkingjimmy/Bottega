/**
 * [INPUT]: Depends on i18n, product single graphics for lib/brand, composer controller Project projection and ChatProject Menu
 * [OUTPUT]: Provides ChatEmptyState: Product Logo + the guides in the upper and lower levels, and the name of the Project in the guides can be changed locally
 * [POS]: Chat's empty chat screen, which is interspersed with ChatTranscript, occupies the same vertical slot; App dashboard with title/description
 */

import { useAppTranslation } from "@/components/providers/i18n-provider";
import {
  PRODUCT_MARK_SIZE,
  PRODUCT_MARK_URL,
  PRODUCT_NAME,
} from "@/lib/brand";
import { ChatProjectMenu } from "./composer/chat-project-selector";
import type { ChatSessionController } from "./runtime/use-chat-session";

type ComposerController = ChatSessionController["composer"];

/* 句序随语言变（英语的 "in X" 在日语里是 "X で"），所以 Project 名不能靠
   拼接两截文案，只能在整句译文里留一个槽位、就地劈开。槽位取不可见字符：
   任何语言的正文都写不出它，劈开因此永远劈在译者放它的地方。 */
const NAME_SLOT = "\u0000";

function ProjectPrompt({
  composer,
  name,
}: {
  composer: ComposerController;
  name: string;
}) {
  const { t } = useAppTranslation();
  const [before, after] = t("chat.emptyPromptInProject", {
    name: NAME_SLOT,
  }).split(NAME_SLOT);
  return (
    <>
      {before}
      <ChatProjectMenu
        projects={composer.projects}
        selectedProjectId={composer.selectedProjectId}
        // 已落盘的聊天，Project 归属由记录说了算，此处只剩陈述
        disabled={
          composer.loading ||
          composer.persisted ||
          composer.projectsLoading ||
          composer.project.kind !== "selectable"
        }
        onChange={composer.selectProject}
        onNewProject={composer.createProject}
        side="bottom"
      >
        <button
          aria-label={t("chat.changeProject", { name })}
          className="rounded-sm underline decoration-2 decoration-muted-foreground/30 underline-offset-[6px] transition-colors hover:decoration-foreground focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-4 data-[state=open]:decoration-foreground disabled:cursor-default disabled:no-underline"
          type="button"
        >
          {name}
        </button>
      </ChatProjectMenu>
      {after}
    </>
  );
}

export function ChatEmptyState({
  composer,
  description,
  title,
}: {
  composer: ComposerController;
  /** App 面板自带说明；普通聊天只留一句问话 */
  description?: string;
  /** 缺省即用「要做点什么」引导语，并在选中 Project 时带上它的名字 */
  title?: string;
}) {
  const { t } = useAppTranslation();
  const project = composer.projects.find(
    (item) => item.id === composer.selectedProjectId
  );
  return (
    <div
      className="flex min-h-0 flex-1 flex-col items-center justify-center gap-5 p-8 text-center"
      data-testid="chat-empty-state"
    >
      <img
        alt={PRODUCT_NAME}
        className="pointer-events-none size-20 select-none object-contain"
        draggable={false}
        height={PRODUCT_MARK_SIZE.height}
        src={PRODUCT_MARK_URL}
        width={PRODUCT_MARK_SIZE.width}
      />
      <div className="space-y-2">
        <h2 className="text-balance font-medium text-xl">
          {title ??
            (project ? (
              <ProjectPrompt composer={composer} name={project.name} />
            ) : (
              t("chat.emptyPrompt")
            ))}
        </h2>
        {description && (
          <p className="max-w-md text-balance text-muted-foreground text-sm">
            {description}
          </p>
        )}
      </div>
    </div>
  );
}
