import { cloudflare } from '@cloudflare/vite-plugin'
import tailwindcss from '@tailwindcss/vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Plugin order follows the TanStack Start hosting guide (Cloudflare Workers):
// cloudflare first, then tanstackStart, then React.
export default defineConfig({
  server: {
    port: 3000,
    // BETTER_AUTH_URL must match the origin the browser uses, so never fall
    // back to another port: fail instead ("Port 3000 is already in use").
    strictPort: true,
  },
  resolve: {
    tsconfigPaths: true,
  },
  plugins: [
    cloudflare({ viteEnvironment: { name: 'ssr' } }),
    tanstackStart(),
    viteReact(),
    tailwindcss(),
  ],
})
