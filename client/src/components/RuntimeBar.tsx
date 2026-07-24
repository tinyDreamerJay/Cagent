export interface RuntimeState {
  sessionId?: string;
  sessionName?: string;
  thinkingLevel?: string;
  autoCompactionEnabled?: boolean;
  autoRetryEnabled?: boolean;
  steeringMode?: "all" | "one-at-a-time";
  followUpMode?: "all" | "one-at-a-time";
  messageCount?: number;
  cwd?: string;
}

interface RuntimeBarProps {
  state: RuntimeState | null;
  thinkingLevels: string[];
  disabled: boolean;
  onThinkingChange: (level: string) => void;
  onAutoCompactionChange: (enabled: boolean) => void;
  onCompact: () => void;
}

function shortPath(value?: string) {
  if (!value) return "Project not selected";
  const normalized = value.replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  return parts.slice(-2).join("/") || normalized;
}

export function RuntimeBar({ state, thinkingLevels, disabled, onThinkingChange, onAutoCompactionChange, onCompact }: RuntimeBarProps) {
  const activeLevel = state?.thinkingLevel || "off";

  return (
    <div className="runtime-bar">
      <div className="runtime-project" title={state?.cwd || ""}>
        <span className="runtime-project-mark" aria-hidden="true" />
        <span>{shortPath(state?.cwd)}</span>
      </div>

      <div className="runtime-controls">
        <label className="runtime-select-label">
          <span>Thinking</span>
          <select
            value={activeLevel}
            onChange={(event) => onThinkingChange(event.target.value)}
            disabled={disabled || thinkingLevels.length === 0}
          >
            {(thinkingLevels.length ? thinkingLevels : [activeLevel]).map((level) => (
              <option key={level} value={level}>{level}</option>
            ))}
          </select>
        </label>
        <label className="runtime-toggle" title="Automatically compact the context when it grows large">
          <input
            type="checkbox"
            checked={Boolean(state?.autoCompactionEnabled)}
            onChange={(event) => onAutoCompactionChange(event.target.checked)}
            disabled={disabled}
          />
          <span>Auto compact</span>
        </label>
        <button className="runtime-compact" type="button" onClick={onCompact} disabled={disabled} title="Compact the current session context">
          Compact
        </button>
      </div>
    </div>
  );
}
