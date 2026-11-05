import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Em desenvolvimento, /api vai para o servidor local (npm run dev:api).
  server: { proxy: { '/api': 'http://localhost:3001' } },
})
