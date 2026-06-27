import { useState } from 'react';
import { Routes, Route, useLocation } from 'react-router-dom';
import { AnimatePresence } from 'framer-motion';
import { TopNav } from './components/TopNav';
import { Sidebar } from './components/Sidebar';
import { HomePage } from './pages/HomePage';
import { LessonPage } from './pages/LessonPage';

/** Root layout: top bar, the lesson-only sidebar (desktop + mobile drawer), and routes. */
export default function App() {
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const location = useLocation();
  const isLesson = location.pathname.startsWith('/lesson/');

  // Close the mobile drawer on every navigation so it never re-mounts open.
  // Adjusting state during render (React's documented pattern) instead of an
  // effect avoids an extra paint with the stale-open drawer.
  const [lastPath, setLastPath] = useState(location.pathname);
  if (location.pathname !== lastPath) {
    setLastPath(location.pathname);
    if (mobileSidebarOpen) setMobileSidebarOpen(false);
  }

  return (
    <div className="flex flex-col h-full" style={{ background: 'var(--color-bg-primary)' }}>
      <TopNav onToggleSidebar={isLesson ? () => setMobileSidebarOpen((v) => !v) : undefined} />
      <div className="flex flex-1 overflow-hidden">
        {isLesson && (
          <>
            {/* Desktop sidebar */}
            <aside
              className="hidden md:flex w-72 flex-none border-r"
              style={{ borderColor: 'var(--color-border-default)', background: 'var(--color-bg-primary)' }}
            >
              <Sidebar />
            </aside>
            {/* Mobile drawer */}
            {mobileSidebarOpen && (
              <div className="md:hidden fixed inset-0 z-30 flex">
                <div className="w-72 flex-none border-r" style={{ borderColor: 'var(--color-border-default)', background: 'var(--color-bg-secondary)' }}>
                  <Sidebar onNavigate={() => setMobileSidebarOpen(false)} />
                </div>
                <div className="flex-1 bg-black/50" onClick={() => setMobileSidebarOpen(false)} />
              </div>
            )}
          </>
        )}
        <main className="flex-1 overflow-hidden">
          <AnimatePresence mode="wait">
            <Routes location={location} key={location.pathname}>
              <Route path="/" element={<HomePage />} />
              <Route path="/lesson/:lessonId" element={<LessonPage />} />
              <Route path="*" element={<HomePage />} />
            </Routes>
          </AnimatePresence>
        </main>
      </div>
    </div>
  );
}
