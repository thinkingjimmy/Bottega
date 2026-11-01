/**
 * [INPUT]: Explicit semantic SVG mapping, native scaled icon metrics and accessible control attributes.
 * [OUTPUT]: NativeSvgIcon renders currentColor vectors without icon fonts or private-use text glyphs.
 * [POS]: Maintained editor icon adapter; authored artwork and the original control hierarchy are independent.
 */
import { nativeIcons } from "./native-icons";
import { CircleHelp } from "lucide-react";
import type { CSSProperties, SVGProps } from "react";
type NativeIconProps = Omit<SVGProps<SVGSVGElement>, "name"> & {
  icons?: typeof nativeIcons; name?: string; icon?: { name: string }; pixelSize: number | string; bold?: boolean; alt?: string;
  animated?: boolean; customSize?: unknown; customIcon?: unknown; size?: unknown;
};
export function NativeSvgIcon(props: NativeIconProps) {
  const { icons = nativeIcons, name: explicitName, icon, pixelSize, bold, alt, animated, customSize: _customSize,
    customIcon: _customIcon, size: _size, style, className, ...attributes } = props;
  const name = explicitName ?? icon?.name;
  if (!name) return null;
  const Glyph = icons[name] ?? CircleHelp;
  const spin = name === "Spinner" && animated !== false;
  const styles: CSSProperties = { display: "inline-block", flexShrink: 0, verticalAlign: "-0.125em",
    width: "1em", height: "1em", fontSize: pixelSize, ...style };
  return <Glyph {...attributes} size="1em" data-cds="Icon" data-bottega-icon={name}
    data-bottega-icon-missing={icons[name] ? undefined : ""}
    data-bottega-icon-spin={spin ? "" : undefined} strokeWidth={bold ? 2.25 : 1.8}
    className={className} style={styles} focusable="false" role={attributes.role ?? (alt ? "img" : undefined)}
    aria-hidden={attributes["aria-hidden"] ?? (alt ? undefined : true)} aria-label={attributes["aria-label"] ?? alt} />;
}
