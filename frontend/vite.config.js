import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // O backend so aceita pedidos (CORS) de http://localhost:5173 por omissao (CORS_ORIGEM).
    // strictPort evita que o Vite mude de porta em silencio e os pedidos falhem por CORS.
    port: 5173,
    strictPort: true,
  },
  build: {
    target: 'es2022',
    // O SDK do Web3Auth e grande; fica num chunk separado (import dinamico).
    chunkSizeWarningLimit: 4000,
  },
});
