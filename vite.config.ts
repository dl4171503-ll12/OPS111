import { schoolAssessmentPlugin } from './vite-plugins/school-assessment';
import { schoolOpsArchivePlugin } from './vite-plugins/school-ops-archive';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { schoolLlmPlugin } from './vite-plugins/school-llm';
import { schoolTtsPlugin } from './vite-plugins/school-tts';
import { schoolWebSearchPlugin } from './vite-plugins/school-web-search';
import { schoolEyeCarePlugin } from './vite-plugins/school-eye-care';

export default defineConfig({
  cacheDir: 'node_modules/.vite-school',
  plugins: [schoolAssessmentPlugin(), schoolOpsArchivePlugin(), schoolLlmPlugin(), schoolTtsPlugin(), schoolWebSearchPlugin(), schoolEyeCarePlugin(), react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  server: {
    proxy: { '/api/student-link': { target: 'http://127.0.0.1:919', changeOrigin: false } },
    watch: { ignored: ['**/.ops-browser/**', '**/.ops-data/**'] },
    fs: { deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/.ops-data/**', '**/.ops-browser/**'] },
    host: '127.0.0.1',
    port: 918,
    strictPort: true,
  },
  preview: {
    host: '127.0.0.1',
    port: 920,
    strictPort: true,
  },
});
