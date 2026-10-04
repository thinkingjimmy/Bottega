---
name: app-dev
displayName: App 开发协议
description: 在 App 的编辑 chat 里演进这个 App——改 AGENTS.md/skill/README、加列改视图、写自定义 GUI、发布前自检。仅用于编辑 App 自身；在使用 chat 里录入或查询数据用 base-ops，Save as App 后的首次协议生成用 create-app-skill。
requires: builtin-tools: read
---

# App 开发协议

你在一个 App 的**编辑 chat** 里：当前工作目录就是这个 App 的目录，你改的是这个
App 的配方，不是在帮用户处理业务数据。业务数据由**使用 chat** 处理。

分不清自己在哪种 chat？看两件事：目录里有 `app.json` 且用户在谈「加一列 / 改
skill / 换个页面」——是编辑；用户在说「记一笔 / 帮我查上个月」——那是使用 chat 的
活，按 App 自己的 skill 做，不要动包文件。

## App 的解剖

| 位置 | 是什么 | 谁读它 |
| --- | --- | --- |
| `app.json` | manifest：名字、图标、一句话介绍、`requirements` 依赖声明 | 产品（安装、分享、Apps 页卡片） |
| `AGENTS.md` | **恒加载**的短协议：App 是什么、列 id 对应什么、什么任务读哪个 skill | 三家 CLI 每一轮 |
| `CLAUDE.md` | 恒为一行 `@AGENTS.md`（Claude 的 memory import 语法） | Claude CLI |
| `.agents/skills/<slug>/SKILL.md` | 详细协议，按需加载 | Agent 判断需要时自读 |
| `README.md` | 给人看的：装之前判断要不要装，装之后知道怎么用 | 用户（Apps 页、分享页） |
| `data/base.json` | **只是安装种子**，灌进 Base 后即被删除 | 仅安装/分享流程 |
| `gui/` | 可选的静态前端；`index.html` 是独立“应用” Surface 固定入口 | 用户浏览 |

## 开发循环

1. **直接改 workspace 文件。** 没有「应用变更」按钮也不需要重建：AGENTS.md 与
   skill 的改动下一轮按约定自然加载，`gui/` 的增删在这一轮结束时被产品拉平；
   存在合法 `gui/index.html` 时详情页自动出现“应用 | 数据”，不需要创建 Base View。
2. **结构演进走 Base 工具，不改 `data/base.json`。** 加列用 `base_add_columns`、
   改视图用 `base_set_view`（需要 mutate 档），作用于用户正在用的那个 live Base。
   `data/base.json` 在运行目录里根本不存在——分享时产品会从 live Base 重新导出，
   任何「同步回种子」的动作都是白做工。
3. **改完跑 `validate_app` 自检。** 它与安装、分享共用同一套校验器，返回
   `errors`/`warnings`（每条带 `file` 与 `reason`）：
   - `errors` 必须清零，否则这个包装不上也分享不出去；
   - `warnings` 是「能用但会掉东西」，最典型的是白名单外文件——分享时会被剥离，
     用户拿到的包里没有它们。
   自检是低频动作：改完一批再跑，不要每写一个文件调一次。
4. **把结论告诉用户。** 改了什么、为什么、`validate_app` 是否干净，一句话说清。

## 文风纪律

- **AGENTS.md 恒短。** 它每一轮都占上下文。只留：App 是什么、Base 列 id 与含义、
  「遇到 X 任务先读 `.agents/skills/Y/SKILL.md`」。任何超过一屏的内容都属于 skill。
- **skill 的 description 要负向可判。** 写清什么时候**不**该用它，指向该用的东西。
  「与数据有关就用」这种描述等于没写，模型会在不相关的任务里误触发。
- **不写裸探测。** 协议里写「先 `base_describe` 拿 revision」是对的；写「试着调用
  看看返回什么」是错的——mutating 工具调用即真实执行。
- **README 随功能同步。** 加了一列、换了录入规则、加了 GUI 页，README 的使用步骤
  就已经过时了。它是用户装这个 App 前唯一能读到的东西，滞后等于误导。
- **示例一律合成。** README 与 skill 里的示例数据自己编，绝不从 Base 里复制真实行。

## 边界

- **不碰分享。** 分享是用户在界面上按两步走的动作（预览 → 确认发布），Agent 全程
  不参与，也没有对应工具。用户说「帮我发布」时，指路 App 详情页的分享入口。
- **`requirements` 可写，配置值不可读。** 你可以在 `app.json` 里声明这个 App 需要
  哪个 CLI 或哪个配置项（`kind`/`label`/`note`/`required`/`sensitive`/`configKey`），
  产品据此在安装时向用户要。但配置的**值**只在用户逐项勾选「允许 Agent 读取」后
  才会以 `APP_CONFIG_*` 环境变量出现，没勾就是没有——不要去翻文件找它。
- **不改记录字段。** `origin`、`sourceRepoUrl`、`publishedRepoUrl` 这些由产品写，
  改 `app.json` 只该动 `name`/`description`/`icon`/`requirements`。
- **改名走产品入口。** App 显示名与 Project、Base 名三处联动，手改 `app.json` 的
  `name` 只会改出一个不一致的中间态；让用户在详情页改。

## 与 create-app-skill 的分工

`create-app-skill` 是**出生仪式**：Save as App 之后跑一次，把当时的对话沉淀成
AGENTS.md 与第一个录入 skill，然后退场。此后这个 App 的每一次演进——加列、改规则、
写 GUI、补 README——都归本协议。

如果你发现 AGENTS.md 里还留着 `<!-- create-app-skill:pending -->` 标记，说明出生
仪式没跑完：先按 `create-app-skill` 把它补齐，再回到这里做演进。
