/**
 * [INPUT]: Depends on react by createContext/useContext
 * [OUTPUT]: Provides SidebarActivePathContext and useSidebarActivePath
 * [POS]: The only reading point in the components/sidebar is "Which line is shining?"AppSidebar supplies, consumes units, and replaces their respective useLocation
 */

import { createContext, useContext } from "react";

/* ============================================================
 * 侧栏在任一时刻只有一个当前目的地。
 *
 * 应用面板改成「只隐藏不卸载」之后，「我被设置盖住了」这条事实就再没
 * 有人告诉行单元——它们各自去问 router 要 pathname，于是设置亮着一档、
 * 被盖住的应用面板同时还亮着一行。用户看不见（display:none 且
 * aria-hidden），但 DOM 从此说了假话，而 DOM 正是这一族 bug 唯一的验收
 * 面：断言只能读到「谁在亮」，读不到「谁本该在亮」。
 *
 * 折成一个值之后，「同时亮两行」在结构上就不成立：被盖住时这里是空串
 * ——一条永不匹配的路径。用空串而不是 null，是为了让每一行仍然只比一个
 * 等号，不必再多问一句「我是不是被盖住了」；能消失的分支永远比能写对
 * 的分支更优雅。
 * ============================================================ */
export const SidebarActivePathContext = createContext("");

/** 行单元判「我亮不亮」的唯一来源：一律与它比，不许再各自 useLocation。 */
export const useSidebarActivePath = () => useContext(SidebarActivePathContext);
