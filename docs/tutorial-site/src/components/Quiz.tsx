import { useState } from 'react';
import { Icon } from './Icon';
import { InlineText } from './InlineText';
import type { QuizQuestion } from '../data/types';

function Question({ question, onResolved }: { question: QuizQuestion; onResolved: (correct: boolean) => void }) {
  const [picked, setPicked] = useState<number | null>(null);
  const answered = picked !== null;

  return (
    <div>
      <p className="font-medium mb-3" style={{ color: 'var(--color-text-primary)' }}>
        <InlineText text={question.q} />
      </p>
      <div className="space-y-2">
        {question.options.map((opt, i) => {
          const isPicked = picked === i;
          const isCorrect = i === question.answer;
          let border = 'var(--color-border-default)';
          let bg = 'transparent';
          let icon: string | null = null;
          let iconColor = '';
          if (answered) {
            if (isCorrect) { border = '#3fae6b'; bg = 'rgba(63,174,107,0.10)'; icon = 'check_circle'; iconColor = '#3fae6b'; }
            else if (isPicked) { border = 'var(--color-accent-hover)'; bg = 'rgba(251,37,118,0.08)'; icon = 'cancel'; iconColor = 'var(--color-accent-hover)'; }
          }
          return (
            <button
              key={i}
              disabled={answered}
              onClick={() => { setPicked(i); onResolved(isCorrect); }}
              className="w-full text-left rounded-lg px-3.5 py-2.5 text-sm flex items-center justify-between gap-2 transition-colors"
              style={{ border: `1px solid ${border}`, background: bg, cursor: answered ? 'default' : 'pointer', color: 'var(--color-text-secondary)' }}
            >
              <span><InlineText text={opt} /></span>
              {icon && <Icon name={icon} size={18} style={{ color: iconColor, flex: 'none' }} />}
            </button>
          );
        })}
      </div>
      {answered && (
        <div className="mt-3 rounded-lg p-3 text-sm flex gap-2" style={{ background: 'rgba(90,169,230,0.08)', borderLeft: '3px solid var(--color-earns)', color: 'var(--color-text-secondary)' }}>
          <Icon name="lightbulb" size={17} style={{ color: 'var(--color-earns)', flex: 'none', marginTop: 1 }} />
          <span><InlineText text={question.explain} /></span>
        </div>
      )}
    </div>
  );
}

export function Quiz({ questions }: { questions: QuizQuestion[] }) {
  return (
    <div className="rounded-xl p-5" style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border-default)' }}>
      <div className="flex items-center gap-2 mb-4">
        <Icon name="quiz" size={18} style={{ color: 'var(--color-primary-hover)' }} />
        <h3 className="font-display font-semibold" style={{ color: 'var(--color-text-primary)' }}>Check yourself</h3>
      </div>
      <div className="space-y-6">
        {questions.map((q, i) => (
          <Question key={i} question={q} onResolved={() => {}} />
        ))}
      </div>
    </div>
  );
}
