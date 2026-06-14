import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useFlowStore } from "../../store/useFlowStore";
import { Badge } from "../shared/Badge";

export const StepDetail: React.FC = () => {
  const getCurrentStep = useFlowStore((s) => s.getCurrentStep);
  const step = getCurrentStep();

  if (!step) {
    return (
      <div
        className="flex h-full items-center justify-center text-sm"
        style={{ color: "var(--color-text-muted)" }}
      >
        Select a path to view step details
      </div>
    );
  }

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={step.id}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        transition={{ duration: 0.2 }}
        className="flex h-full flex-col gap-2 overflow-auto px-4 py-2"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-2">
          <div>
            <div
              className="text-xs font-bold"
              style={{ color: "var(--color-text-primary)" }}
            >
              {step.title}
            </div>
            <div
              className="mt-0.5 text-[11px] leading-relaxed"
              style={{ color: "var(--color-text-secondary)" }}
            >
              {step.description}
            </div>
          </div>
        </div>

        {/* Grid of details */}
        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
          <DetailItem label="Trigger" value={step.trigger} />
          <DetailItem label="Handler" value={step.handler} mono />
          <DetailItem label="Status" value={step.status} highlight />
          <DetailItem
            label="Artifact"
            value={step.stepState}
            highlight
          />
        </div>

        {/* Side Effects */}
        {Object.keys(step.sideEffects).length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {step.sideEffects.jobs && (
              <SideEffectPill icon="⏱️" label="Jobs" value={step.sideEffects.jobs} />
            )}
            {step.sideEffects.notifications && (
              <SideEffectPill
                icon="🔔"
                label="Notifications"
                value={step.sideEffects.notifications}
              />
            )}
            {step.sideEffects.dac && (
              <SideEffectPill icon="📋" label="DAC" value={step.sideEffects.dac} />
            )}
            {step.sideEffects.pubsub && (
              <SideEffectPill icon="📡" label="Pub/Sub" value={step.sideEffects.pubsub} />
            )}
          </div>
        )}

        {/* Message types in this step */}
        {step.messages.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {Array.from(new Set(step.messages.map((m) => m.type))).map(
              (type) => (
                <Badge key={type} type={type} />
              )
            )}
          </div>
        )}
      </motion.div>
    </AnimatePresence>
  );
};

function DetailItem({
  label,
  value,
  mono,
  highlight,
}: {
  label: string;
  value: string;
  mono?: boolean;
  highlight?: boolean;
}) {
  return (
    <div className="min-w-0">
      <div
        className="text-[9px] uppercase tracking-wider"
        style={{ color: "var(--color-text-muted)" }}
      >
        {label}
      </div>
      <div
        className={`truncate text-[11px] ${mono ? "font-mono" : "font-medium"}`}
        style={{
          color: highlight
            ? "var(--color-accent)"
            : "var(--color-text-secondary)",
        }}
        title={value}
      >
        {value}
      </div>
    </div>
  );
}

function SideEffectPill({
  icon,
  label,
  value,
}: {
  icon: string;
  label: string;
  value: string;
}) {
  return (
    <div
      className="flex items-start gap-1 rounded-md border px-2 py-1"
      style={{
        borderColor: "var(--color-border-default)",
        background: "var(--color-bg-secondary)",
      }}
    >
      <span className="text-[10px]">{icon}</span>
      <div className="min-w-0">
        <div
          className="text-[9px] font-bold uppercase"
          style={{ color: "var(--color-text-muted)" }}
        >
          {label}
        </div>
        <div
          className="text-[10px] leading-snug"
          style={{ color: "var(--color-text-secondary)" }}
          title={value}
        >
          {value}
        </div>
      </div>
    </div>
  );
}
