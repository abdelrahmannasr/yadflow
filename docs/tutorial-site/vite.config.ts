import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Deployed as a peer of the overview site on the same GitHub Pages domain.
// The terminology report serves at /yadflow/, the overview SPA at /yadflow/app/,
// and this guided tutorial at /yadflow/tutorial/.
export default defineConfig({
  base: '/yadflow/tutorial/',
  plugins: [react(), tailwindcss()],
})
