import {
  AlertTriangle,
  Archive,
  CircleDashed,
  Clock,
  Inbox,
  List,
  Moon,
  Users,
} from "lucide-react";
import type { ReactNode } from "react";

import type { Filter } from "@/lib/filters";

/**
 * An icon per view, for the layouts where there is no room for the label.
 *
 * Kept beside the layouts rather than in lib/filters.ts, which is deliberately
 * free of React so it can be used by the pure helpers and their tests.
 */
export const VIEW_ICONS: Record<Filter, ReactNode> = {
  all: <List />,
  "due-soon": <Clock />,
  overdue: <AlertTriangle />,
  none: <CircleDashed />,
  snoozed: <Moon />,
  archived: <Archive />,
  shared: <Users />,
  requests: <Inbox />,
};
