import type { FunctionComponent, SVGProps } from 'react';
import AssignmentTurnedIn from '@material-symbols/svg-300/outlined/assignment_turned_in.svg?react';
import Cable from '@material-symbols/svg-300/outlined/cable.svg?react';
import Logout from '@material-symbols/svg-300/outlined/logout.svg?react';
import ReceiptLong from '@material-symbols/svg-300/outlined/receipt_long.svg?react';

/**
 * The Material Symbols the design draws with, kept under their own names so a component asking for
 * an icon does not import an asset path.
 *
 * Outlined at weight 300, which is the axis the design's icon font is pinned to. They arrive as one
 * SVG per icon rather than through the icon font, whose 4 MB variable woff2 would be a heavy price
 * for a handful of glyphs — and, being self-hosted, they hold to the same no-CDN rule as
 * `src/app/fonts.css`. Vite turns each into a component; see `svgr` in `vite.config.ts`.
 */
export type IconComponent = FunctionComponent<SVGProps<SVGSVGElement>>;

export { AssignmentTurnedIn, Cable, Logout, ReceiptLong };
