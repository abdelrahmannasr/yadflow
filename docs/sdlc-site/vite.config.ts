import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// `base` is substituted by `yad docs` at generate time from .sdlc/docs.json `basePath`
// (GitHub project Pages serve at /<repo>/; user/org Pages and GitLab Pages use /).
export default defineConfig({
  base: '/yadflow/',
  plugins: [react(), tailwindcss()],
})
