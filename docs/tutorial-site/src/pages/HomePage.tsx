import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Icon } from '../components/Icon';
import { MODULES, ALL_LESSONS, TOTAL_LESSONS } from '../data/lessons';
import { useProgress } from '../store/useProgress';
import { REFERENCE_URL } from '../links';

const levelMeta: Record<string, { color: string; label: string }> = {
  beginner: { color: 'var(--color-earns)', label: 'Beginner' },
  intermediate: { color: 'var(--color-artifact)', label: 'Intermediate' },
  advanced: { color: 'var(--color-accent)', label: 'Advanced' },
};

/** Landing page: hero with start/resume CTA and the grid of curriculum modules. */
export function HomePage() {
  const completed = useProgress((s) => s.completed);
  const navigate = useNavigate();
  // Count only lessons that still exist — stale localStorage IDs must not inflate progress.
  const doneCount = ALL_LESSONS.filter((l) => completed[l.id]).length;
  const firstUndone = ALL_LESSONS.find((l) => !completed[l.id]) ?? ALL_LESSONS[0];
  const resuming = doneCount > 0 && doneCount < TOTAL_LESSONS;

  return (
    <div className="h-full overflow-y-auto">
      {/* Hero */}
      <section className="hero-glow flow-grid">
        <div className="max-w-5xl mx-auto px-6 pt-16 pb-12">
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full mb-5 text-xs font-medium" style={{ background: 'var(--color-primary-soft)', color: '#e9d5ff' }}>
              <Icon name="school" size={15} /> Learn by doing
            </div>
            <h1 className="font-display font-bold text-4xl sm:text-5xl leading-tight mb-4" style={{ color: 'var(--color-text-primary)' }}>
              Learn Yadflow,<br />one gated step at a time.
            </h1>
            <p className="text-lg max-w-2xl mb-8 leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
              A hands-on walk from an empty repo to your first shipped feature — the gated SDLC where
              AI builds and a human approves every step. {TOTAL_LESSONS} short lessons, nine modules.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={() => navigate(`/lesson/${firstUndone.id}`)}
                className="inline-flex items-center gap-2 px-5 py-3 rounded-lg font-semibold transition-transform hover:scale-[1.02]"
                style={{ background: 'linear-gradient(135deg, var(--color-primary), var(--color-accent))', color: '#fff' }}
              >
                <Icon name={resuming ? 'play_arrow' : 'rocket_launch'} size={20} />
                {resuming ? `Resume — ${firstUndone.title}` : 'Start the tutorial'}
              </button>
              <a
                href={REFERENCE_URL}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 px-5 py-3 rounded-lg font-medium transition-colors hover:bg-white/5"
                style={{ color: 'var(--color-text-secondary)', border: '1px solid var(--color-border-light)' }}
              >
                <Icon name="article" size={18} /> Terminology reference
              </a>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Modules */}
      <section className="max-w-5xl mx-auto px-6 py-12">
        <h2 className="font-display font-bold text-2xl mb-6" style={{ color: 'var(--color-text-primary)' }}>The curriculum</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {MODULES.map((m, i) => {
            const done = m.lessons.filter((l) => completed[l.id]).length;
            const allDone = done === m.lessons.length;
            const lm = levelMeta[m.level];
            return (
              <motion.div
                key={m.id}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.35, delay: Math.min(i * 0.04, 0.3) }}
              >
                <Link
                  to={`/lesson/${m.lessons[0].id}`}
                  className="block h-full rounded-xl p-5 transition-colors hover:border-[var(--color-border-light)]"
                  style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border-default)' }}
                >
                  <div className="flex items-start gap-3">
                    <div className="flex h-10 w-10 flex-none items-center justify-center rounded-lg" style={{ background: 'var(--color-bg-tertiary)' }}>
                      <Icon name={allDone ? 'check_circle' : m.icon} size={22} fill={allDone} style={{ color: allDone ? '#3fae6b' : lm.color }} />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-[11px] font-bold" style={{ color: 'var(--color-text-muted)' }}>MODULE {m.number}</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded font-semibold uppercase tracking-wide" style={{ color: lm.color, background: 'rgba(255,255,255,0.04)' }}>{lm.label}</span>
                      </div>
                      <h3 className="font-display font-semibold text-base mb-1" style={{ color: 'var(--color-text-primary)' }}>{m.title}</h3>
                      <p className="text-sm leading-snug mb-3" style={{ color: 'var(--color-text-secondary)' }}>{m.blurb}</p>
                      <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--color-text-muted)' }}>
                        <Icon name="menu_book" size={14} />
                        {m.lessons.length} lessons
                        <span>·</span>
                        <span style={{ color: done > 0 ? '#3fae6b' : 'var(--color-text-muted)' }}>{done}/{m.lessons.length} done</span>
                      </div>
                    </div>
                  </div>
                </Link>
              </motion.div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
