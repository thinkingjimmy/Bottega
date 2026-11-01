/**
 * [INPUT]: Lucide's ISC-licensed SVG factory and explicit directional table/corner geometry.
 * [OUTPUT]: Custom SVG controls whose insertion, deletion and corner directions remain distinct.
 * [POS]: Native icon mapping leaf; all paths use the same 24px currentColor stroke contract.
 */
import { createLucideIcon, type IconNode } from "lucide-react";
const icon = (name: string, nodes: IconNode) => createLucideIcon(name, nodes);
export const customIcons = {
  TableColumnInsertLeft: icon("TableColumnInsertLeft", [["rect",{x:"8",y:"4",width:"13",height:"16",rx:"1",key:"a"}],["path",{d:"M14 4v16M1 12h5M3.5 9.5v5",key:"b"}]]),
  TableColumnInsertRight: icon("TableColumnInsertRight", [["rect",{x:"3",y:"4",width:"13",height:"16",rx:"1",key:"a"}],["path",{d:"M9 4v16M18 12h5M20.5 9.5v5",key:"b"}]]),
  TableRowInsertAbove: icon("TableRowInsertAbove", [["rect",{x:"4",y:"8",width:"16",height:"13",rx:"1",key:"a"}],["path",{d:"M4 14h16M12 1v5M9.5 3.5h5",key:"b"}]]),
  TableRowInsertBelow: icon("TableRowInsertBelow", [["rect",{x:"4",y:"3",width:"16",height:"13",rx:"1",key:"a"}],["path",{d:"M4 9h16M12 18v5M9.5 20.5h5",key:"b"}]]),
  TableColumnDelete: icon("TableColumnDelete", [["rect",{x:"3",y:"4",width:"18",height:"16",rx:"1",key:"a"}],["path",{d:"M8 4v16M16 4v16M10 10l4 4m0-4-4 4",key:"b"}]]),
  TableRowDelete: icon("TableRowDelete", [["rect",{x:"4",y:"3",width:"16",height:"18",rx:"1",key:"a"}],["path",{d:"M4 8h16M4 16h16M10 10l4 4m0-4-4 4",key:"b"}]]),
  LaptopSlash: icon("LaptopSlash", [["path",{d:"M5 16V6a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v10M3 17h18l1 3H2l1-3M3 3l18 18",key:"a"}]]),
  LocationQuestionMark: icon("LocationQuestionMark", [["path",{d:"M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Z",key:"a"}],["path",{d:"M10.5 8a1.6 1.6 0 1 1 2.8 1.1c-.8.5-1.3.9-1.3 1.9M12 14h.01",key:"b"}]]),
  CornerTopLeft: icon("CornerTopLeft", [["path",{d:"M5 20v-9a6 6 0 0 1 6-6h9",key:"a"}]]),
  CornerTopRight: icon("CornerTopRight", [["path",{d:"M4 5h9a6 6 0 0 1 6 6v9",key:"a"}]]),
  CornerBottomRight: icon("CornerBottomRight", [["path",{d:"M19 4v9a6 6 0 0 1-6 6H4",key:"a"}]]),
  CornerBottomLeft: icon("CornerBottomLeft", [["path",{d:"M20 19h-9a6 6 0 0 1-6-6V4",key:"a"}]]),
};
