import { useEffect, useMemo, useState } from 'react'
import { HermesClient } from '@pythnetwork/hermes-client'
import { useAccount, usePublicClient, useChainId } from 'wagmi'
import { getWalletClient } from 'wagmi/actions'
import { config as wagmiConfig } from '../wagmi'
import { formatEther, createPublicClient, http } from 'viem'

type FeedRow = {
  id: string
  price?: number
  conf?: number
  expo?: number
  publishTime?: number
}

function toDecimal(price?: number, expo?: number): number | undefined {
  if (price === undefined || expo === undefined) return undefined
  if (expo === 0) return price
  return price * Math.pow(10, expo)
}

function normId(id?: string): string {
  return (id || '').toLowerCase().replace(/^0x/, '')
}

const DEFAULT_FEEDS: { id: string; label: string; symbol: string }[] = [
  { symbol: 'BTC/USD', label: 'BTC/USD', id: '0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43' },
  { symbol: 'BNB/USD', label: 'BNB/USD', id: '0x2f95862b045670cd22bee3114c39763a4a08beeb663b145d283c31d7d1101c4f' },
  { symbol: 'DOGE/USD', label: 'DOGE/USD', id: '0xdcef50dd0a4cd2dcc17e45df1676dcb336a11a61c69df7a0299b0150c672d25c' },
  { symbol: 'ETH/USD', label: 'ETH/USD', id: '0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace' },
  { symbol: 'FIL/USD', label: 'FIL/USD', id: '0x150ac9b959aee0051e4091f0ef5216d941f590e1c5e7f91cf7635b5c11628c0e' },
  { symbol: 'SHIB/USD', label: 'SHIB/USD', id: '0xf0d57deca57b3da2fe63a493f4c25925fdfd8edf834b20f93e1f84dbd1504d4a' },
]

export function PythPriceFeeds() {
  // const defaultIds = useMemo(() => DEFAULT_FEEDS.map(f => f.id).join(','), [])
  const [idsInput, setIdsInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [rows, setRows] = useState<FeedRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const publicClient = usePublicClient()
  const { isConnected } = useAccount()
  const chainId = useChainId()
  const [pythAddress, setPythAddress] = useState<string>(() => localStorage.getItem('pyth:contract') || '')
  const [ipythInfo, setIPythInfo] = useState<string>('')
  const [ipythOpen, setIPythOpen] = useState(false)
  const [selectedIds, setSelectedIds] = useState<string[]>(() => DEFAULT_FEEDS.map(f => f.id))
  const [lastFee, setLastFee] = useState<bigint | null>(null)
  const [lastUpdateData, setLastUpdateData] = useState<`0x${string}`[] | null>(null)
  const [copiedNote, setCopiedNote] = useState<string>('')
  const [targetChainId, setTargetChainId] = useState<number | null>(null)

  const ids = useMemo(() => idsInput.split(',').map(s => s.trim()).filter(Boolean), [idsInput])

  async function fetchPrices(overrideIds?: string[]) {
    const useIds = overrideIds && overrideIds.length > 0 ? overrideIds : ids
    if (useIds.length === 0) { setRows([]); return }
    setLoading(true)
    setError(null)
    try {
      const client = new HermesClient('https://hermes.pyth.network', {})
      const update = await client.getLatestPriceUpdates(useIds, { parsed: true }) as any
      const parsed = Array.isArray(update.parsed) ? update.parsed : []
      const next: FeedRow[] = parsed.map((p: any) => ({
        id: p?.price_feed?.id || p?.id || '',
        price: typeof p?.price?.price === 'number' ? p.price.price : Number(p?.price?.price),
        conf: typeof p?.price?.conf === 'number' ? p.price.conf : Number(p?.price?.conf),
        expo: typeof p?.price?.expo === 'number' ? p.price.expo : Number(p?.price?.expo),
        publishTime: typeof p?.price?.publish_time === 'number' ? p.price.publish_time : Number(p?.price?.publish_time),
      }))
      // sort to DEFAULT_FEEDS order first, then any remaining
      const order = new Map(DEFAULT_FEEDS.map((f, i) => [f.id.toLowerCase(), i]))
      next.sort((a, b) => (order.get((a.id || '').toLowerCase()) ?? 999) - (order.get((b.id || '').toLowerCase()) ?? 999))
      setRows(next)
    } catch (e: any) {
      setError(e?.message || 'Failed to fetch prices')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    // Show default feeds on load, even if the input is empty
    fetchPrices(DEFAULT_FEEDS.map(f => f.id))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    try { localStorage.setItem('pyth:contract', pythAddress || '') } catch { }
    ; (window as any).__PYTH_CONTRACT__ = pythAddress || undefined
  }, [pythAddress])

  // Auto-fill Pyth contract by chain when possible
  useEffect(() => {
    const CHAIN_IPYTH: Record<number, string> = {
      1: '0x4305FB66699C3B2702D4d05CF36551390A4c69C6', // Ethereum
      56: '0x4D7E825f80bDf85e913E0DD2A2D54927e9dE1594', // BNB
      314: '0xA2aa501b19aff244D90cc15a4Cf739D2725B5729', // Filecoin
    }
    if (!pythAddress && CHAIN_IPYTH[chainId]) {
      setPythAddress(CHAIN_IPYTH[chainId])
      setTargetChainId(chainId)
    }
  }, [chainId])

  // Infer target chain from the pasted IPyth address
  useEffect(() => {
    const ADDRESS_TO_CHAIN: Record<string, number> = {
      '0x4305fb66699c3b2702d4d05cf36551390a4c69c6': 1,
      '0x4d7e825f80bdf85e913e0dd2a2d54927e9de1594': 56,
      '0xa2aa501b19aff244d90cc15a4cf739d2725b5729': 314,
    }
    const key = (pythAddress || '').toLowerCase()
    if (ADDRESS_TO_CHAIN[key] && targetChainId !== ADDRESS_TO_CHAIN[key]) {
      setTargetChainId(ADDRESS_TO_CHAIN[key])
    }
  }, [pythAddress])

  // Minimal IPyth ABI for quick checks
  const IPythAbi = [
    { inputs: [], name: 'getValidTimePeriod', outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }], stateMutability: 'view', type: 'function' },
    { inputs: [{ internalType: 'bytes[]', name: 'updateData', type: 'bytes[]' }], name: 'getUpdateFee', outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }], stateMutability: 'view', type: 'function' },
    { inputs: [{ internalType: 'bytes[]', name: 'updateData', type: 'bytes[]' }], name: 'updatePriceFeeds', outputs: [], stateMutability: 'payable', type: 'function' },
  ] as const

  async function launchIPyth() {
    try {
      setError(null)
      setIPythInfo('')
      if (!pythAddress) throw new Error('Enter Pyth contract address')
      // Use read-only client for target chain to avoid switching wallet network
      const CHAIN_TO_RPC: Record<number, string> = {
        1: 'https://ethereum.publicnode.com',
        56: 'https://bsc-dataseed.binance.org',
        314: 'https://api.node.glif.io/rpc/v1',
      }
      const rpc = targetChainId ? CHAIN_TO_RPC[targetChainId] : undefined
      if (!rpc) throw new Error('Select a chain tile above to set IPyth network')
      const readClient = createPublicClient({ transport: http(rpc) })
      const valid = await readClient.readContract({ abi: IPythAbi as any, address: pythAddress as `0x${string}`, functionName: 'getValidTimePeriod', args: [] }) as bigint
      setIPythInfo(`IPyth live. ValidTimePeriod = ${valid.toString()} seconds`)
      setIPythOpen(true)
    } catch (e: any) {
      setError(e?.message || 'Failed to launch IPyth')
    }
  }

  async function getUpdateFeeForSelected() {
    try {
      setError(null)
      if (!pythAddress) throw new Error('Enter Pyth contract address')
      if (selectedIds.length === 0) throw new Error('Select at least one feed')
      const client = new HermesClient('https://hermes.pyth.network', {})
      const update = await client.getLatestPriceUpdates(selectedIds, { encoding: 'hex', parsed: false }) as any
      const data = (update.binary?.data || update.data || []) as string[]
      const updateData: `0x${string}`[] = data.map((hex: string) => (hex.startsWith('0x') ? hex as `0x${string}` : (`0x${hex}` as `0x${string}`)))
      const CHAIN_TO_RPC: Record<number, string> = {
        1: 'https://ethereum.publicnode.com',
        56: 'https://bsc-dataseed.binance.org',
        314: 'https://api.node.glif.io/rpc/v1',
      }
      const rpc = targetChainId ? CHAIN_TO_RPC[targetChainId] : undefined
      if (!rpc) throw new Error('Select a chain tile above to set IPyth network')
      const readClient = createPublicClient({ transport: http(rpc) })
      const fee = (await readClient.readContract({ abi: IPythAbi as any, address: pythAddress as `0x${string}`, functionName: 'getUpdateFee', args: [updateData] })) as bigint
      setLastUpdateData(updateData)
      setLastFee(fee)
      setIPythInfo(`Fee: ${fee.toString()} wei (${formatEther(fee)} ETH)`)
    } catch (e: any) {
      setError(e?.message || 'Failed to get fee')
    }
  }

  async function updatePriceFeedsOnChain() {
    try {
      setError(null)
      if (!isConnected) throw new Error('Connect wallet')
      if (!pythAddress) throw new Error('Enter Pyth contract address')
      if (!lastUpdateData) throw new Error('Get fee first')
      const wc = await getWalletClient(wagmiConfig)
      if (!wc) throw new Error('Wallet not ready')
      const value = lastFee ?? 0n
      const hash = await wc.writeContract({ abi: IPythAbi as any, address: pythAddress as `0x${string}`, functionName: 'updatePriceFeeds', args: [lastUpdateData], value })
      await publicClient!.waitForTransactionReceipt({ hash })
      setIPythInfo(`Updated on-chain. Tx: ${hash}`)
    } catch (e: any) {
      setError(e?.message || 'Failed to update')
    }
  }

  return (
    <section style={{ marginTop: 32, marginBottom: 48 }}>
      <h3 style={{ margin: 0, marginBottom: 8 }}>Pyth Price Feeds</h3>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: 8, margin: '6px 0 8px 0' }}>
        <input value={pythAddress} onChange={e => setPythAddress(e.target.value)} placeholder="Pyth contract address (0x...)" style={{ padding: '8px 10px', border: '1px solid #000', background: '#fff', color: '#000' }} />
        <button onClick={launchIPyth} style={{ padding: '8px 12px', border: '1px solid #000', background: '#000', color: '#fff', cursor: 'pointer' }}>Launch IPyth</button>
        <div style={{ alignSelf: 'center', fontSize: 12, color: '#555' }}>{ipythInfo || 'On-chain pull via IPyth.'}</div>
      </div>
      {copiedNote && (<div style={{ fontSize: 12, color: '#0a0', marginBottom: 6 }}>{copiedNote}</div>)}
      <div style={{ display: 'grid', gap: 6, marginBottom: 8 }}>
        <div style={{ fontSize: 12, color: '#555' }}>Pyth contracts (tap to copy & fill):</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 8 }}>
          {[
            { label: 'Ethereum (IPyth)', address: '0x4305FB66699C3B2702D4d05CF36551390A4c69C6', chain: 1 },
            { label: 'BNB (IPyth)', address: '0x4D7E825f80bDf85e913E0DD2A2D54927e9dE1594', chain: 56 },
            { label: 'Filecoin (IPyth)', address: '0xA2aa501b19aff244D90cc15a4Cf739D2725B5729', chain: 314 },
          ].map((c) => (
            <button key={c.address} onClick={async () => { try { await navigator.clipboard.writeText(c.address) } catch { }; setPythAddress(c.address); setTargetChainId(c.chain); setCopiedNote(`${c.label} copied`); setTimeout(() => setCopiedNote(''), 1200) }}
              title={c.address}
              style={{ textAlign: 'left', padding: 10, border: '1px solid #000', background: '#fff', color: '#000', cursor: 'pointer' }}>
              <div style={{ fontWeight: 600 }}>{c.label}</div>
              <div style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.address}</div>
            </button>
          ))}
        </div>
      </div>
      <div style={{ display: 'grid', gap: 6, marginBottom: 8 }}>
        <div style={{ fontSize: 12, color: '#555' }}>Stable feed IDs (tap to copy):</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 8 }}>
          {DEFAULT_FEEDS.map(f => {
            const idNo0x = f.id.replace(/^0x/, '')
            return (
              <button key={f.id} onClick={async () => { try { await navigator.clipboard.writeText(f.id) } catch { }; setCopiedNote(`${f.symbol} feed ID copied`); setTimeout(() => setCopiedNote(''), 1200) }}
                title={f.id}
                style={{ textAlign: 'left', padding: 10, border: '1px solid #000', background: '#fff', color: '#000', cursor: 'pointer' }}>
                <div style={{ fontWeight: 600 }}>{f.symbol} • {f.label}</div>
                <div style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{idNo0x}</div>
              </button>
            )
          })}
        </div>
      </div>
      <div style={{ marginBottom: 5, fontSize: 14, color: '#555', fontWeight: 600 }}>Search Prices on Hermes by Pyth</div>
      <div style={{ marginBottom: 8, fontSize: 12, color: '#555' }}>Popular: {DEFAULT_FEEDS.map(f => f.label).join(', ')}</div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
        <input value={idsInput} onChange={e => setIdsInput(e.target.value)} placeholder="Comma-separated Pyth price IDs (0x...)" style={{ flex: 1, padding: '8px 10px', border: '1px solid #000', background: '#fff', color: '#000' }} />
        <button onClick={() => fetchPrices()} disabled={loading || ids.length === 0} style={{ padding: '8px 14px', border: '1px solid #000', background: '#000', color: '#fff', cursor: loading || ids.length === 0 ? 'not-allowed' : 'pointer' }}>{loading ? 'loading' : 'Fetch'}</button>
      </div>
      {error && <div style={{ color: '#cc0000', fontSize: 12, marginBottom: 8 }}>{error}</div>}
      {rows.length > 0 && (
        <div style={{ border: '1px solid #000' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 2fr 1fr 1fr 1fr', padding: '8px 12px', background: '#000', color: '#fff' }}>
            <div>Symbol</div>
            <div>ID</div>
            <div>Expo</div>
            <div>Price</div>
            <div>Publish Time</div>
          </div>
          {rows.map(r => {
            const dec = toDecimal(r.price, r.expo)
            const feed = DEFAULT_FEEDS.find(f => normId(f.id) === normId(r.id))
            const sym = feed?.symbol || '-'
            return (
              <div key={r.id} style={{ display: 'grid', gridTemplateColumns: '1.2fr 2fr 1fr 1fr 1fr', padding: '8px 12px', background: '#fff', color: '#000', borderTop: '1px solid #000' }}>
                <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={sym}>{sym}</div>
                <div style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.id}>{r.id}</div>
                <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={String(r.expo ?? '-')}>
                  {r.expo ?? '-'}
                </div>
                <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={dec !== undefined && isFinite(dec) ? dec.toString() : '-'}>
                  {dec !== undefined && isFinite(dec) ? dec.toFixed(6) : '-'}
                </div>
                <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.publishTime ? new Date(r.publishTime * 1000).toISOString() : '-'}>
                  {r.publishTime ? new Date(r.publishTime * 1000).toLocaleTimeString() : '-'}
                </div>
                {/* per-row sync removed */}
              </div>
            )
          })}
        </div>
      )}

      {ipythOpen && (
        <div onClick={() => setIPythOpen(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div onClick={e => e.stopPropagation()} style={{ width: 720, background: '#fff', color: '#000', border: '1px solid #000', padding: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <h3 style={{ margin: 0 }}>IPyth Pull</h3>
              <button onClick={() => setIPythOpen(false)} style={{ padding: '4px 8px', border: '1px solid #000', background: '#fff', color: '#000', cursor: 'pointer' }}>Close</button>
            </div>
            <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: '1fr', gap: 8 }}>
              <div style={{ fontSize: 12, color: '#555' }}>Stable feeds to update:</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: 8 }}>
                {DEFAULT_FEEDS.map(f => (
                  <label key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 8, border: '1px solid #000', padding: 8 }}>
                    <input type="checkbox" checked={selectedIds.includes(f.id)} onChange={(e) => {
                      setSelectedIds(prev => e.target.checked ? Array.from(new Set([...prev, f.id])) : prev.filter(x => x !== f.id))
                    }} />
                    <span>{f.symbol} • {f.label}</span>
                  </label>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
                <button onClick={getUpdateFeeForSelected} style={{ padding: '8px 12px', border: '1px solid #000', background: '#000', color: '#fff', cursor: 'pointer' }}>Get Update Fee</button>
                <button onClick={updatePriceFeedsOnChain} disabled={!isConnected || !lastUpdateData} style={{ padding: '8px 12px', border: '1px solid #000', background: '#fff', color: '#000', cursor: (!isConnected || !lastUpdateData) ? 'not-allowed' : 'pointer' }}>Update Price Feeds</button>
                {lastFee !== null && <div style={{ fontSize: 12 }}>Fee: {formatEther(lastFee)} ETH</div>}
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}


