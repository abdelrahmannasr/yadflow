import { useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Icon } from '../components/Icon';
import { LessonBody, CommandList, ProducesList } from '../components/LessonBody';
import { Quiz } from '../components/Quiz';
import { findLesson } from '../data/lessons';
import { useProgress } from '../store/useProgress';

const levelColor: Record<string, string> = {
  beginner: 'var(--color-earns)',
  intermediate: 'var(--color-artifact)',
  advanced: 'var(--color-accent)',
};

export function LessonPage() {
  const { lessonId } = useParams();
  const navigate = useNavigate();
  const result = lessonId ? findLesson(lessonId) : null;
  const isComplete = useProgress((s) => (lessonId ? Boolean(s.completed[lessonId]) : false));
  const markComplete = useProgress((s) => s.markComplete);
  const toggle = useProgress((s) => s.toggle);

  // Scroll to top whenever the lesson changes.
  useEffect(() => {
    document.getElementById('lesson-scroll')?.scrollTo({ top: 0 });
  }, [lessonId]);

  if (!result) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3">
        <Icon name="error" size={40} style={{ color: 'var(--color-text-muted)' }} />
        <p style={{ color: 'var(--color-text-secondary)' }}>Lesson not found.</p>
        <Link to="/" className="text-sm font-medium" style={{ color: 'var(--color-primary-hover)' }}>← Back to start</Link>
      </div>
    );
  }

  const { lesson, prev, next } = result;

  const completeAndAdvance = () => {
    markComplete(lesson.id);
    if (next) navigate(`/lesson/${next.id}`);
    else navigate('/');
  };

  return (
    <div id="lesson-scroll" className="h-full overflow-y-auto">
      <article className="max-w-3xl mx-auto px-6 py-10">
        {/* Header */}
        <motion.div key={lesson.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
          <div className="flex items-center gap-2.5 mb-3 text-xs" style={{ color: 'var(--color-text-muted)' }}>
            <span className="px-2 py-0.5 rounded font-semibold uppercase tracking-wide" style={{ color: levelColor[lesson.level], background: 'rgba(255,255,255,0.04)' }}>
              {lesson.level}
            </span>
            <span className="flex items-center gap-1"><Icon name="schedule" size={14} /> {lesson.duration}</span>
          </div>
          <h1 className="font-display font-bold text-3xl mb-3 leading-tight" style={{ color: 'var(--color-text-primary)' }}>
            {lesson.title}
          </h1>
          <p className="text-lg mb-8 leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>{lesson.summary}</p>

          {/* Body */}
          <LessonBody body={lesson.body} />
          {lesson.commands && <CommandList commands={lesson.commands} />}
          {lesson.produces && <ProducesList produces={lesson.produces} />}
          {lesson.quiz && (
            <div className="mt-8">
              <Quiz questions={lesson.quiz} />
            </div>
          )}

          {/* Complete toggle */}
          <div className="mt-8 flex items-center gap-3">
            <button
              onClick={() => toggle(lesson.id)}
              className="inline-flex items-center gap-2 text-sm font-medium px-4 py-2 rounded-lg transition-colors"
              style={{
                border: `1px solid ${isComplete ? '#3fae6b' : 'var(--color-border-light)'}`,
                color: isComplete ? '#3fae6b' : 'var(--color-text-secondary)',
                background: isComplete ? 'rgba(63,174,107,0.08)' : 'transparent',
              }}
            >
              <Icon name={isComplete ? 'task_alt' : 'radio_button_unchecked'} size={18} />
              {isComplete ? 'Completed' : 'Mark complete'}
            </button>
          </div>
        </motion.div>

        {/* Footer nav */}
        <div className="mt-10 pt-6 border-t flex items-center justify-between gap-4" style={{ borderColor: 'var(--color-border-default)' }}>
          {prev ? (
            <Link to={`/lesson/${prev.id}`} className="group flex items-center gap-2 text-sm min-w-0" style={{ color: 'var(--color-text-secondary)' }}>
              <Icon name="arrow_back" size={18} />
              <span className="truncate">{prev.title}</span>
            </Link>
          ) : <span />}
          <button
            onClick={completeAndAdvance}
            className="inline-flex items-center gap-2 flex-none px-4 py-2 rounded-lg text-sm font-semibold transition-transform hover:scale-[1.02]"
            style={{ background: 'linear-gradient(135deg, var(--color-primary), var(--color-accent))', color: '#fff' }}
          >
            {next ? 'Complete & next' : 'Complete & finish'}
            <Icon name={next ? 'arrow_forward' : 'flag'} size={18} />
          </button>
        </div>
      </article>
    </div>
  );
}
