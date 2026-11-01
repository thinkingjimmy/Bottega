/**
 * [INPUT]: Shared licensed Canvas SVG renderer, pinned Lucide exports and explicit Slides aliases.
 * [OUTPUT]: SlidesSvgIcon and vector image data for native authored icons and PPTX delivery.
 * [POS]: Slides icon adapter; original control metrics and authored placement remain intact.
 */
import { nativeIcons } from "../../canvas-runtime/adapters/native-icons";
import { NativeSvgIcon } from "../../canvas-runtime/adapters/native-icon";
import { Circle, CirclePlus, CornerUpLeft, FlaskConical, FolderSymlink, GitBranch, Images, MessageSquare, MessageSquareText, RotateCw, Sparkles, VolumeX } from "lucide-react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ComponentProps } from "react";
const aliases: Record<string, string> = {
  AddBold: "Add", AddSmall: "Add", ArrowDownSmall: "ArrowDown", ArrowLeftSmall: "ArrowLeft",
  ArrowRightSmall: "ArrowRight", ArrowUpRightSmall: "ArrowUpRight", ArrowUpSmall: "ArrowUp",
  ArtifactFile: "Artifacts", Branch: "GitBranch", CaretDownSmall: "CaretDown", CaretLeftSmall: "CaretLeft",
  CaretRightSmall: "CaretRight", CaretUpSmall: "CaretUp",
  DotsHorizontalSmall: "DotsHorizontal", DotsVerticalSmall: "DotsVertical",
  Knowledge: "Book", MinusSmall: "Minus", PlaySmall: "Play",
  PullRequestClosed: "GitPullRequestClosed", PullRequestDraft: "GitPullRequestDraft",
  StopSmall: "Stop", TextBoldSelected: "TextBold", TextItalicsSelected: "TextItalics",
  TextUnderlineSelected: "TextUnderline", XSmall: "X",
};
export const slidesIcons = { ...nativeIcons, ArrowBendUpLeft: CornerUpLeft, Circle: Circle, CirclesAdd: CirclePlus,
  Comment: MessageSquare, CommentFilled: MessageSquareText, FolderLink: FolderSymlink, Github: GitBranch, Images: Images, SpeakerSlash: VolumeX, Claudification: Sparkles, Experimental: FlaskConical, Feedback: MessageSquare, Reload: RotateCw };
for (const [name, target] of Object.entries(aliases)) {
  const glyph = nativeIcons[target];
  if (!glyph) throw new Error("Missing explicit Slides icon alias: " + name + " -> " + target);
  Object.assign(slidesIcons, { [name]: glyph });
}
export function SlidesSvgIcon(props: ComponentProps<typeof NativeSvgIcon>) {
  return <NativeSvgIcon {...props} icons={slidesIcons} />;
}
export function slidesIconData(name: string, color: string, opacity: number): string {
  const svg = renderToStaticMarkup(<SlidesSvgIcon name={name} pixelSize={100} style={{ width: 100, height: 100, color, opacity }} />);
  return "data:image/svg+xml;base64," + btoa(svg);
}
