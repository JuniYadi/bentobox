import { GitHubPanel } from "../../features/github/GitHubPanel";

/** @adr ADR-0016.D2 */
export interface RightPanelProps {
  collapsed?: boolean;
  onUseAsPrompt?: (prompt: string) => void;
}

/** @adr ADR-0016.D2 */
export function RightPanel({ collapsed = false, onUseAsPrompt }: RightPanelProps) {
  if (collapsed) return null;
  return <aside className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden border-l"><GitHubPanel onUseAsPrompt={onUseAsPrompt} /></aside>;
}
