import type { FunctionComponent, SVGProps } from 'react';
import Add from '@material-symbols/svg-300/outlined/add.svg?react';
import AccountTree from '@material-symbols/svg-300/outlined/account_tree.svg?react';
import ArrowForward from '@material-symbols/svg-300/outlined/arrow_forward.svg?react';
import AssignmentTurnedIn from '@material-symbols/svg-300/outlined/assignment_turned_in.svg?react';
import Cable from '@material-symbols/svg-300/outlined/cable.svg?react';
import Check from '@material-symbols/svg-300/outlined/check.svg?react';
import ChevronRight from '@material-symbols/svg-300/outlined/chevron_right.svg?react';
import Close from '@material-symbols/svg-300/outlined/close.svg?react';
import Delete from '@material-symbols/svg-300/outlined/delete.svg?react';
import Download from '@material-symbols/svg-300/outlined/download.svg?react';
import ErrorIcon from '@material-symbols/svg-300/outlined/error.svg?react';
import Inbox from '@material-symbols/svg-300/outlined/inbox.svg?react';
import Info from '@material-symbols/svg-300/outlined/info.svg?react';
import LeftPanelClose from '@material-symbols/svg-300/outlined/left_panel_close.svg?react';
import LeftPanelOpen from '@material-symbols/svg-300/outlined/left_panel_open.svg?react';
import Lock from '@material-symbols/svg-300/outlined/lock.svg?react';
import Logout from '@material-symbols/svg-300/outlined/logout.svg?react';
import PriorityHigh from '@material-symbols/svg-300/outlined/priority_high.svg?react';
import ProgressActivity from '@material-symbols/svg-300/outlined/progress_activity.svg?react';
import ReceiptLong from '@material-symbols/svg-300/outlined/receipt_long.svg?react';
import Redo from '@material-symbols/svg-300/outlined/redo.svg?react';
import Refresh from '@material-symbols/svg-300/outlined/refresh.svg?react';
import Search from '@material-symbols/svg-300/outlined/search.svg?react';
import SearchOff from '@material-symbols/svg-300/outlined/search_off.svg?react';
import Sync from '@material-symbols/svg-300/outlined/sync.svg?react';
import Undo from '@material-symbols/svg-300/outlined/undo.svg?react';
import UnknownDocument from '@material-symbols/svg-300/outlined/unknown_document.svg?react';
import Visibility from '@material-symbols/svg-300/outlined/visibility.svg?react';
import VisibilityOff from '@material-symbols/svg-300/outlined/visibility_off.svg?react';
import VpnKey from '@material-symbols/svg-300/outlined/vpn_key.svg?react';

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

export {
  Add,
  AccountTree,
  ArrowForward,
  AssignmentTurnedIn,
  Cable,
  Check,
  ChevronRight,
  Close,
  Delete,
  Download,
  ErrorIcon,
  Inbox,
  Info,
  LeftPanelClose,
  LeftPanelOpen,
  Lock,
  Logout,
  PriorityHigh,
  ProgressActivity,
  ReceiptLong,
  Redo,
  Refresh,
  Search,
  SearchOff,
  Sync,
  Undo,
  UnknownDocument,
  Visibility,
  VisibilityOff,
  VpnKey,
};
