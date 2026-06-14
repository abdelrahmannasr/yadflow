import { Icon } from '../shared/Icon';
import { STATUS_MAPPINGS } from '../../data/referenceData';

const CATEGORY_COLORS: Record<string, string> = {
  Front: '#2471a3',
  'Front (parallel)': '#1e8449',
  Build: '#1e8449',
  Automation: '#ca6f1e',
};

const LOCK_FACTS = [
  'The architect authors contract.md with a delimited CONTRACT-SURFACE:BEGIN … END block — the shared cross-repo surface.',
  'yad-architecture writes the SHA-256 of that block into .sdlc/contract-lock.json — the surface is now hash-locked.',
  'Each per-repo spec quotes the locked contract and never widens it; the contract stays singular in the product hub.',
  'In CI, contract-check FAILS a diff that changes the surface without a Contract-Change trailer + a re-locked contract — and routes it back to the architecture gate.',
];

export function ContractLockSection() {
  return (
    <div className="space-y-5">
      <div
        className="rounded-xl border p-4"
        style={{ background: 'rgba(20,17,24,0.5)', borderColor: 'var(--color-border-default)' }}
      >
        <h4 className="text-sm font-bold text-slate-200 mb-3 flex items-center gap-2">
          <Icon name="lock" size={16} className="text-slate-400" /> How the contract surface is hash-locked
        </h4>
        <ul className="space-y-2">
          {LOCK_FACTS.map((f, i) => (
            <li key={i} className="flex items-start gap-2">
              <Icon name="check_circle" size={15} className="text-emerald-400 mt-0.5 shrink-0" />
              <span className="text-xs text-slate-400 leading-relaxed">{f}</span>
            </li>
          ))}
        </ul>
        <div className="mt-3">
          <code className="block text-[11px] text-slate-300 code-block">
            {"awk '/CONTRACT-SURFACE:BEGIN/{f=1;next} /CONTRACT-SURFACE:END/{f=0} f' contract.md | shasum -a 256"}
          </code>
        </div>
      </div>

      <div
        className="rounded-xl border overflow-hidden"
        style={{ borderColor: 'var(--color-border-default)', background: 'rgba(20,17,24,0.5)' }}
      >
        <div className="px-4 py-3 border-b flex items-center justify-between" style={{ borderColor: 'var(--color-border-default)', background: 'rgba(255,255,255,0.03)' }}>
          <span className="text-sm font-bold text-slate-200">Step → artifact ledger</span>
          <span className="text-[10px] font-bold text-slate-400">{STATUS_MAPPINGS.length} entries</span>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr style={{ background: 'rgba(255,255,255,0.05)' }}>
              <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-400">Step</th>
              <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-400">Writes</th>
              <th className="px-4 py-2.5 text-right text-xs font-semibold text-slate-400">Phase</th>
            </tr>
          </thead>
          <tbody>
            {STATUS_MAPPINGS.map((m) => {
              const color = CATEGORY_COLORS[m.category] || '#64748b';
              return (
                <tr
                  key={m.step}
                  className="border-t hover:bg-white/5 transition-colors"
                  style={{ borderColor: 'var(--color-border-default)' }}
                >
                  <td className="px-4 py-2.5 font-mono text-xs text-slate-300">{m.step}</td>
                  <td className="px-4 py-2.5 font-mono text-xs text-slate-300">{m.writes}</td>
                  <td className="px-4 py-2.5 text-right">
                    <span
                      className="text-[10px] font-medium px-2 py-0.5 rounded border"
                      style={{ color, background: `${color}15`, borderColor: `${color}25` }}
                    >
                      {m.category}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
