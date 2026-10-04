import type { SVGProps } from "react";

/**
 * X's own mark, drawn in currentColor so it takes the ink of the link it sits
 * in, in either theme. Decorative: the label beside it names the link.
 *
 * Source (24x24 viewBox, path unmodified): Simple Icons, icons/x.svg
 * (CC0-1.0). The mark is a trademark of X Corp.; the licence covers the path
 * data only. Used here only to point at Berth's own account on X.
 */
const PATH =
  "M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z";

export function XMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden focusable="false" {...props}>
      <path d={PATH} />
    </svg>
  );
}
