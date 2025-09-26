import { useEffect, useMemo, useState } from 'react'
import { useAccount, useConnect } from 'wagmi'
import './App.css'
import { Header } from './components/Header'
import { Jars } from './components/Jars'
import { AgentChat } from './components/AgentChat'
import { PythPriceFeeds } from './components/PythPriceFeeds'

function App() {
  const { status, error } = useConnect()
  const { isConnected } = useAccount()
  const [uiMessage, setUiMessage] = useState<string | null>(null)

  useEffect(() => {
    if (!isConnected && error) {
      const maybeCode = (error as any)?.code
      const isPendingError = maybeCode === -32002 || /already pending/i.test(error.message)
      if (isPendingError) {
        setUiMessage('Please open MetaMask and complete or cancel the pending request.')
      } else {
        setUiMessage(error.message)
      }
    } else if (isConnected) {
      setUiMessage(null)
    }
  }, [error, isConnected])

  return (
    <div style={{ background: '#fff', color: '#000', minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <Header />
      {uiMessage && !isConnected && (
        <div style={{ margin: '12px auto 0', color: '#cc0000', fontSize: 12, maxWidth: 900, width: '100%', padding: '0 24px' }}>
          {uiMessage}
        </div>
      )}
      <main style={{ flex: 1 }}>
        <Jars />
        <div style={{ maxWidth: 900, width: '100%', margin: '0 auto', padding: '0 24px' }}>
          <AgentChat />
        </div>
        <div style={{ maxWidth: 900, width: '100%', margin: '0 auto', padding: '0 24px' }}>
          <PythPriceFeeds />
        </div>
      </main>
      <footer style={{ borderTop: '1px solid #000', padding: '12px 24px', fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontWeight: 600 }}>Piggy Bit</div>
        <div style={{ opacity: 0.9 }}>Uses Rootstock • Pyth • Made for ETHGlobal Delhi</div>
      </footer>
    </div>
  )
}

export default App
