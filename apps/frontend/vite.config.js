import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const srcAlias = new URL('./src', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      { find: '@', replacement: srcAlias },
    ],
  },
});
