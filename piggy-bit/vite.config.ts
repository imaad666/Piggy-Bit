import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default ({ mode }: { mode: string }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const endpoint = env.VITE_AGENT_ENDPOINT

  const proxy: Record<string, any> = {}
  if (endpoint) {
    try {
      const u = new globalThis.URL(endpoint)
      proxy['/agent/submit'] = {
        target: `${u.protocol}//${u.host}`,
        changeOrigin: true,
        secure: true,
        rewrite: () => u.pathname, // forward exactly to the agent's submit path
      }
    } catch {
      // ignore invalid URL
    }
  }

  return defineConfig({
    plugins: [react()],
    server: { proxy },
    optimizeDeps: {
      exclude: ['axios']
    },
    build: {
      rollupOptions: {
        external: (id) => {
          // Externalize axios to prevent bundling conflicts
          if (id === 'axios') return true
          return false
        }
      }
    }
  })
}
