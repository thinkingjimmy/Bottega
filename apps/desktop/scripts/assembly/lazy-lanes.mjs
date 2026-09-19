/**
 * [INPUT]: No runtime dependencies; a declarative table only.
 * [OUTPUT]: LAZY_LANES — every renderer first-load boundary as a name, a module-id pattern and one sample module id.
 * [POS]: Shared declaration beside output-root.mjs; the renderer budget gate enforces it and the release export fixture derives its module report from it, so neither can drift from the other.
 */

/**
 * 闸门只说「胖了」，说不出「为什么不该胖」。所以数字之外还有一张懒边界表：
 * 每一条都声明「这类模块必须存在、且只能在动态边界之后」。数字防的是缓慢
 * 增重，结构断言防的是某次重构悄悄把整条边界拆掉——后者才是首包真正的死因。
 * 新增一条懒边界，就是往表里加一行，而不是再抄一遍三十行遍历。
 *
 * `sample` 是这条边界的代表模块 id：既喂给闸门自己的负向自检，也喂给
 * 导出夹具的假 Rollup 报告。两边都从这里读，加一条边界不必再改第二处。
 */
export const LAZY_LANES = Object.freeze([
  { name: "Queue drag runtime", pattern: /@dnd-kit\/core\//, sample: "node_modules/@dnd-kit/core/dist/core.esm.js" },
  { name: "Model menu content", pattern: /packages\/chat-ui\/src\/ui\/composer\/models\/(?:menu|list-menu)\.tsx$/, sample: "packages/chat-ui/src/ui/composer/models/menu.tsx" },
  { name: "Remote draft execution", pattern: /src\/components\/chat\/remote\/draft\/execution\.tsx$/, sample: "src/components/chat/remote/draft/execution.tsx" },
  { name: "Model slider", pattern: /@radix-ui\/react-slider\//, sample: "node_modules/@radix-ui/react-slider/dist/index.mjs" },
  { name: "Sketch editor", pattern: /chat-ui\/src\/sketch\/(?:editor|render)\//, sample: "packages/chat-ui/src/sketch/editor/state.ts" },
  { name: "Sketch history", pattern: /chat-ui\/src\/sketch\/model\/history\.ts$/, sample: "packages/chat-ui/src/sketch/model/history.ts" },
  { name: "Base compute", pattern: /base-ui\/src\/compute\//, sample: "packages/base-ui/src/compute/formula.ts" },
  { name: "Base schema", pattern: /base-ui\/src\/model\/bases-schema\.ts$/, sample: "packages/base-ui/src/model/bases-schema.ts" },
  { name: "App compatibility dialog", pattern: /components\/apps\/compatibility\/update-content\.tsx$/, sample: "src/components/apps/compatibility/update-content.tsx" },
  { name: "Save as App dialog", pattern: /components\/apps\/dialogs\/save-as-app-dialog\.tsx$/, sample: "src/components/apps/dialogs/save-as-app-dialog.tsx" },
  { name: "Base panel actions", pattern: /side-panel\/catalog\/base-actions\.tsx$/, sample: "src/components/chat/side-panel/catalog/base-actions.tsx" },
  { name: "Non-English shared workspace copy", pattern: /ui\/src\/components\/workspace\/copy\/(?:zh-cn|ja|fr|es)\.ts$/, sample: "packages/ui/src/components/workspace/copy/ja.ts" },
  { name: "Non-English composer catalogs", pattern: /packages\/chat-ui\/src\/ui\/composer\/controls\/copy\/(?:zh-cn|ja|fr|es)\.ts$/, sample: "packages/chat-ui/src/ui/composer/controls/copy/ja.ts" },
  { name: "Artifact previews", pattern: /packages\/chat-ui\/src\/artifacts\/(?:card|frame|import-dialog)\.tsx$/, sample: "packages/chat-ui/src/artifacts/card.tsx" },
  {
    name: "Konva",
    pattern: /(?:^|\/)konva(?:@[^/]+)?\//,
    sample: "node_modules/konva/lib/index.js",
  },
  {
    name: "React-Konva",
    pattern: /(?:^|\/)react-konva(?:@[^/]+)?\//,
    sample: "node_modules/react-konva/lib/ReactKonva.js",
  },
  {
    name: "ECharts",
    pattern: /(?:^|\/)(?:echarts(?:@[^/]+)?\/|node_modules\/echarts\/)/,
    sample: "node_modules/echarts/core.js",
  },
  /* 整棵子树，不只是五个入口文件：feature 目录一旦同时被 en.ts 与懒 locale 引用，
     Rollup 就把它提升到公共祖先——也就是 entry chunk。旧 pattern 只断言入口，
     于是 2026-09-17 之前有 90 KB 四语言文案看着在懒边界后、实际躺在首包里。 */
  {
    name: "非 en 语言目录",
    pattern: /shared\/i18n\/locales\/(?:.*\/)?(?:zh-cn|ja|fr|es)\.ts$/,
    sample: "shared/i18n/locales/memory/ja.ts",
  },
]);
