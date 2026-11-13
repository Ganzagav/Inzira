import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const p = (f) => fileURLToPath(new URL(f, import.meta.url));

// Three separate pages: "/" public app, "/police/" traffic police portal, "/admin/" administration portal.
// host:true lets Windows browsers reach the dev server running inside WSL.
export default defineConfig({
  plugins: [react()],
  server: { host: true, port: 5173 },
  build: { rollupOptions: { input: { main: p('index.html'), police: p('police/index.html'), admin: p('admin/index.html') } } },
});
