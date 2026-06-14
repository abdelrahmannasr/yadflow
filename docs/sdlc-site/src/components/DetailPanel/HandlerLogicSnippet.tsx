import type { FlowStep } from '../../data/types';
import { Icon } from '../shared/Icon';

interface HandlerLogicSnippetProps {
  step: FlowStep;
}

export function HandlerLogicSnippet({ step }: HandlerLogicSnippetProps) {
  const handlerParts = step.handler.split('.');
  const fileName = handlerParts.length > 1 ? handlerParts[0] + '.ts' : 'handler.ts';
  const functionName = handlerParts.length > 1 ? handlerParts[1] : step.handler;

  const code = `async ${functionName}(req) {
  // trigger: ${step.trigger}
  // status: ${step.status} → ${step.stepState}
  ${step.messages.map((m) => `await this.emit('${m.type}', '${m.label}');`).join('\n  ')}
}`;

  return (
    <div>
      <h4 className="text-xs font-bold text-slate-400 uppercase mb-2 flex items-center gap-2">
        <Icon name="code" size={16} /> Handler Logic
      </h4>
      <div className="rounded-lg p-3 border"
        style={{
          background: 'var(--color-surface-darker)',
          borderColor: 'var(--color-surface-highlight)',
        }}
      >
        <div className="mb-2 pb-2"
          style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}
        >
          <span className="text-[10px] text-slate-400">{functionName}() — {fileName}</span>
        </div>
        <pre className="text-[11px] text-blue-300 font-mono leading-relaxed overflow-x-auto">
          <code>{code}</code>
        </pre>
      </div>
    </div>
  );
}
