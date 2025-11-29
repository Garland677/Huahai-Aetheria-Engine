import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  base: './', // 关键修改：使用相对路径，确保 Electron 打包后能找到资源
  server: {
    port: 3000,
    open: true, // Auto-open browser
    host: true  // Listen on all addresses (0.0.0.0), essential for Termux/Network access
  }
});