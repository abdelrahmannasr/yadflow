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
import { Icon } from './components/shared/Icon';

const railStyle = {
  borderColor: 'var(--color-border-default)',
  background: 'var(--color-bg-primary)',
};

function Dashboard() {
  usePlayback();
  const isLogsPanelOpen = useFlowStore((s) => s.isLogsPanelOpen);
  const isLeftPanelOpen = useFlowStore((s) => s.isLeftPanelOpen);
  const isRightPanelOpen = useFlowStore((s) => s.isRightPanelOpen);
  const toggleLeftPanel = useFlowStore((s) => s.toggleLeftPanel);
  const toggleRightPanel = useFlowStore((s) => s.toggleRightPanel);

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Left Sidebar (collapsible — collapse to widen the canvas) */}
      {isLeftPanelOpen ? (
        <aside
          className="w-80 flex-none flex flex-col border-r z-10"
          style={railStyle}
        >
          {/* Collapse header */}
          <div className="flex items-center justify-between px-4 pt-3 pb-1">
            <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>
              Navigator
            </span>
            <button
              onClick={toggleLeftPanel}
              title="Collapse panel"
              aria-label="Collapse navigator panel"
              className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-white/5 hover:text-white"
            >
              <Icon name="left_panel_close" size={18} />
            </button>
          </div>

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
      ) : (
        <div className="w-10 flex-none flex flex-col items-center border-r z-10 pt-3" style={railStyle}>
          <button
            onClick={toggleLeftPanel}
            title="Expand navigator"
            aria-label="Expand navigator panel"
            className="flex h-8 w-8 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-white/5 hover:text-white"
          >
            <Icon name="left_panel_open" size={18} />
          </button>
        </div>
      )}

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

      {/* Right Detail Panel (collapsible — collapse to widen the canvas) */}
      {isRightPanelOpen ? (
        <RightPanel />
      ) : (
        <div className="w-10 flex-none flex flex-col items-center border-l z-10 pt-3" style={railStyle}>
          <button
            onClick={toggleRightPanel}
            title="Expand details"
            aria-label="Expand step-details panel"
            className="flex h-8 w-8 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-white/5 hover:text-white"
          >
            <Icon name="right_panel_open" size={18} />
          </button>
        </div>
      )}
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
