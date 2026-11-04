/**
 * [INPUT]: Existing licensed native SVG controls and nine explicit Lucide semantic aliases.
 * [OUTPUT]: SystemSvgIcon and complete 369-name Design System icon coverage.
 * [POS]: Maintained Design System source adapter; no font binaries, DOM replacement or host state.
 */
import { Circle, CirclePlus, CornerUpLeft, FolderSymlink, GitBranch, Images, MessageCircle, MessageCirclePlus, VolumeX } from "lucide-react";
import { NativeSvgIcon } from "../../canvas-runtime/adapters/native-icon";
import { nativeIcons } from "../../canvas-runtime/adapters/native-icons";
import type { ComponentProps } from "react";
export const systemIconAliases = {
  "ArrowBendUpLeft": CornerUpLeft,
  "Circle": Circle,
  "CirclesAdd": CirclePlus,
  "Comment": MessageCircle,
  "CommentFilled": MessageCirclePlus,
  "FolderLink": FolderSymlink,
  "Github": GitBranch,
  "Images": Images,
  "SpeakerSlash": VolumeX,
};
const icons = { ...nativeIcons, ...systemIconAliases };
export function SystemSvgIcon(props: ComponentProps<typeof NativeSvgIcon>) {
  return <NativeSvgIcon {...props} icons={icons} />;
}
