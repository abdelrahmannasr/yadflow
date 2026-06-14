import React from "react";
import type { MessageType } from "../../data/types";
import { MESSAGE_COLORS } from "../../data/types";

interface BadgeProps {
  type: MessageType;
  label?: string;
}

export const Badge: React.FC<BadgeProps> = React.memo(({ type, label }) => {
  const color = MESSAGE_COLORS[type];
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
      style={{
        backgroundColor: `${color}20`,
        color: color,
        border: `1px solid ${color}40`,
      }}
    >
      <span
        className="h-1.5 w-1.5 rounded-full"
        style={{ backgroundColor: color }}
      />
      {label || type}
    </span>
  );
});
