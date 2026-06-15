import { Routes, Route } from 'react-router-dom';
import { FlowCanvas } from './components/Canvas/FlowCanvas';
import { PathSelector } from './components/Sidebar/PathSelector';
import { StepList } from './components/Sidebar/StepList';
import { SidebarFooter } from './components/Sidebar/SidebarFooter';
import { PlaybackBar } from './components/Controls/PlaybackBar';
import { TopNavBar } from './components/Navigation/TopNavBar';
import { RightPanel } from './components/DetailPanel/RightPanel';
import { RulesLegendPanel } from './components/Reference/RulesLegendPanel';
import { CommandPalette } from './components/shared/CommandPalette';
import { SystemLogsTerminal } from './components/Logs/SystemLogsTerminal';
import { SubPathDetailPage } from './pages/SubPathDetailPage';
import { RoleSelectPage } from './pages/RoleSelectPage';
import { StakeholderDocPage } from './pages/StakeholderDocPage';
import { usePlayback } from './hooks/usePlayback';
import { useFlowStore } from './store/useFlowStore';

function Dashboard() {
  usePlayback();
  const isLogsPanelOpen = useFlowStore((s) => s.isLogsPanelOpen);

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Left Sidebar */}
      <aside
        className="w-80 flex-none flex flex-col border-r z-10"
        style={{
          borderColor: 'var(--color-border-default)',
          background: 'var(--color-bg-primary)',
        }}
      >
        {/* Path Selection */}
        <div className="p-4 border-b overflow-y-auto" style={{ borderColor: 'var(--color-border-default)' }}>
          <PathSelector />
        </div>

        {/* Step Timeline */}
        <div className="flex-1 overflow-y-auto p-4">
          <StepList />
        </div>

        {/* Footer */}
        <SidebarFooter />
      </aside>

      {/* Main Canvas Area */}
      <main className="flex-1 flex flex-col overflow-hidden relative flow-grid"
        style={{ background: '#1b172d' }}
      >
        {/* Canvas */}
        <div className="flex-1 overflow-hidden">
          <FlowCanvas />
        </div>

        {/* System Logs (collapsible) */}
        {isLogsPanelOpen && (
          <div className="h-48 flex-shrink-0 border-t"
            style={{ borderColor: 'var(--color-border-default)' }}
          >
            <SystemLogsTerminal />
          </div>
        )}

        {/* Playback Controls */}
        <PlaybackBar />
      </main>

      {/* Right Detail Panel */}
      <RightPanel />
    </div>
  );
}

function App() {
  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden" style={{ background: 'var(--color-bg-primary)' }}>
      <TopNavBar />
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/path/:pathId" element={<SubPathDetailPage />} />
        <Route path="/docs" element={<RoleSelectPage />} />
        <Route path="/docs/:roleSlug" element={<StakeholderDocPage />} />
      </Routes>
      <RulesLegendPanel />
      <CommandPalette />
    </div>
  );
}

export default App;
