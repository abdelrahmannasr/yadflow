import { Icon } from '../shared/Icon';
import { useStakeholderFilter } from '../../hooks/useStakeholderFilter';
import { BULLMQ_JOBS } from '../../data/referenceData';

export function BullMQJobsList() {
  const jobs = useStakeholderFilter(BULLMQ_JOBS);

  if (jobs.length === 0) return null;

  return (
    <section>
      <div className="flex items-center gap-2 mb-4">
        <Icon name="verified" size={20} className="text-purple-400" />
        <h3 className="text-slate-100 text-lg font-bold font-display">The Check Gates</h3>
      </div>
      <div className="space-y-2">
        {jobs.map((job) => (
          <div
            key={job.name}
            className="p-3 rounded-lg border hover:border-purple-500/30 transition-colors"
            style={{
              background: 'rgba(20,17,24,0.5)',
              borderColor: 'var(--color-border-default)',
            }}
          >
            <div className="flex items-start gap-3">
              <div
                className="flex items-center justify-center w-8 h-8 rounded-lg shrink-0 mt-0.5"
                style={{ background: 'rgba(168,85,247,0.15)', color: '#a855f7' }}
              >
                <Icon name="timer" size={18} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-sm font-semibold text-slate-200 font-mono">{job.name}</span>
                </div>
                <p className="text-xs text-slate-400 mb-1.5">{job.description}</p>
                <div className="flex flex-wrap gap-2">
                  <span
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium border"
                    style={{ color: '#a855f7', background: 'rgba(168,85,247,0.1)', borderColor: 'rgba(168,85,247,0.2)' }}
                  >
                    <Icon name="schedule" size={10} />
                    {job.timing}
                  </span>
                  <span
                    className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium text-slate-400 border"
                    style={{ background: 'rgba(255,255,255,0.03)', borderColor: 'var(--color-border-default)' }}
                  >
                    queue: {job.queue}
                  </span>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
