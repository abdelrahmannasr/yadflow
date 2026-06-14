import { DocPageShell } from '../components/DocLayout/DocPageShell';
import { RoleCard } from '../components/DocLayout/RoleCard';
import { ROLES } from '../data/roles';

export function RoleSelectPage() {
  return (
    <DocPageShell
      title="Documentation Hub"
      subtitle="Select your lens to see tailored documentation for the yadflow SDLC pipeline"
      icon="menu_book"
      backTo="/"
      backLabel="Dashboard"
    >
      <div className="p-8 max-w-5xl mx-auto">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {ROLES.map((role) => (
            <RoleCard key={role.slug} role={role} />
          ))}
        </div>

        <div
          className="mt-8 rounded-xl border p-5 text-center"
          style={{ background: 'rgba(20,17,24,0.3)', borderColor: 'var(--color-border-default)' }}
        >
          <p className="text-sm text-slate-400">
            Each role page includes tailored documentation sections and relevant flow paths.
            <br />
            <span className="text-slate-500">Use the Reference panel (top nav) for quick-access to the legend and rules.</span>
          </p>
        </div>
      </div>
    </DocPageShell>
  );
}
