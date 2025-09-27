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
      include: ['axios']
    },
    build: {
      rollupOptions: {
        external: (id) => {
          // Don't externalize axios - bundle it
          if (id === 'axios') return false
          return false
        }
      }
    }
  })
}
