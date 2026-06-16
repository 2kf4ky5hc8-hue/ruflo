import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Simple SPA build. Supabase is the backend — there is no server here.
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
  },
});
