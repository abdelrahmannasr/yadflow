import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import './index.css'
import App from './App'

// HashRouter (not BrowserRouter): the tutorial is published as static files on
// GitHub Pages alongside the report (/yadflow/) and the overview app
// (/yadflow/app/). Pages only honors a single root-level 404.html, so a
// path-based router would 404 on a refreshed or shared lesson URL. Hash routing
// keeps deep links working with no server rewrite and no per-site 404 fallback.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </StrictMode>,
)
