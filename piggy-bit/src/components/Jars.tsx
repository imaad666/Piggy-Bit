import { useEffect, useMemo, useState } from 'react'
import { useAccount, useChainId, useSwitchChain, usePublicClient } from 'wagmi'
import type { Hex } from 'viem'
import { PiggyJarAbi, PiggyJarBytecode } from '../contracts/PiggyJar'
import { PiggyJarUSDCAbi, PiggyJarUSDCBytecode } from '../contracts/PiggyJarUSDC'
import { ERC20Abi } from '../contracts/erc20'
import { getWalletClient } from 'wagmi/actions'
import { config as wagmiConfig } from '../wagmi'

const INR_PER_USDC = 85

export type Jar = {
    id: string
    name: string
    targetUsd: number
    thresholdUsd: number
    recurringUsd: number
    targetAsset: 'RBTC' | 'ETH'
    cadence: 'daily' | 'weekly' | 'monthly'
    autoSwap: boolean
    depositedUsd: number
    status: 'filling' | 'filled' | 'broken'
    isDeployed: boolean
    contractAddress?: `0x${string}`
    isUsdcJar?: boolean
    usdcToken?: `0x${string}`
    // simulation bookkeeping: last simulated day when a period was paid
    lastSimDayPaid?: number
}

function readJarsFor(address?: string | null): Jar[] {
    try {
        const key = address ? `piggybit:jars:${address.toLowerCase()}` : 'piggybit:jars'
        const raw = localStorage.getItem(key)
        if (!raw) return []
        const arr = JSON.parse(raw)
        return Array.isArray(arr) ? arr : []
    } catch { return [] }
}
function writeJarsFor(address: string, jars: Jar[]) {
    try {
        // Only write if we have a valid address and jars array
        if (address && address.length === 42 && jars.length >= 0) {
            localStorage.setItem(`piggybit:jars:${address.toLowerCase()}`, JSON.stringify(jars))
        }
    } catch { }
}

export function Jars() {
    const { isConnected, address } = useAccount()
    const chainId = useChainId()
    const { switchChainAsync } = useSwitchChain()
    const publicClient = usePublicClient()

    const [jars, setJars] = useState<Jar[]>([])
    const [createOpen, setCreateOpen] = useState(false)
    const [usdcOpen, setUsdcOpen] = useState(false)
    const [name, setName] = useState('My Jar')
    const [target, setTarget] = useState('10')
    const [recurring, setRecurring] = useState('100')
    const [asset, setAsset] = useState<'RBTC' | 'ETH'>('RBTC')
    const [cadence, setCadence] = useState<'daily' | 'weekly' | 'monthly'>('daily')
    const [autoSwap, setAutoSwap] = useState(true)
    const [creating, setCreating] = useState(false)
    const [formError, setFormError] = useState<string | null>(null)
    const [txStatus, setTxStatus] = useState<string | null>(null)

    // Simulation time and notifications
    const [simDay, setSimDay] = useState<number>(() => {
        try { const r = localStorage.getItem('piggybit:simDay'); return r ? Number(r) || 0 : 0 } catch { return 0 }
    })
    type Notification = { id: string; jarId: string; text: string; periods?: number }
    const [notifications, setNotifications] = useState<Notification[]>(() => {
        try { const r = localStorage.getItem('piggybit:notifications'); return r ? JSON.parse(r) : [] } catch { return [] }
    })

    // USDC modal fields
    const [usdcName, setUsdcName] = useState('USDC Jar')
    const [usdcTarget, setUsdcTarget] = useState('10')
    const [usdcTopup, setUsdcTopup] = useState('5')
    const [usdcTokenAddr, setUsdcTokenAddr] = useState('')

    const [upiJarId, setUpiJarId] = useState<string | null>(null)

    // Load jars when wallet connects, clear when disconnects
    useEffect(() => {
        if (isConnected && address) {
            const savedJars = readJarsFor(address)
            setJars(savedJars)
        } else {
            // Clear jars when wallet disconnects
            setJars([])
        }
    }, [isConnected, address])

    // Save jars only when they actually change (not on initial load)
    const [hasLoaded, setHasLoaded] = useState(false)
    useEffect(() => {
        if (address && hasLoaded) {
            writeJarsFor(address, jars)
        }
    }, [jars, address, hasLoaded])

    useEffect(() => {
        if (isConnected && address) {
            setHasLoaded(true)
        }
    }, [isConnected, address])
    useEffect(() => { try { localStorage.setItem('piggybit:simDay', String(simDay)) } catch { } }, [simDay])
    useEffect(() => { try { localStorage.setItem('piggybit:notifications', JSON.stringify(notifications)) } catch { } }, [notifications])

    // expose prefill helpers for AgentChat
    useEffect(() => {
        (window as any).piggybit = {
            openCreateJarPrefill: (params: { name: string; targetUsd: number; autoTopupInr: number; period: 'daily' | 'weekly' | 'monthly' }) => {
                setName(params.name || 'Jar')
                setTarget(String(Math.max(1, Math.floor(params.targetUsd))))
                setRecurring(String(Math.max(1, Math.floor(params.autoTopupInr))))
                setCadence(params.period)
                setCreateOpen(true)
            },
            openCreateUsdcJarPrefill: (params: { name: string; targetUsdc: number; autoTopupUsdc: number; period: 'daily' | 'weekly' | 'monthly'; token?: `0x${string}` }) => {
                setUsdcName(params.name || 'USDC Jar')
                setUsdcTarget(String(Math.max(1, Math.floor(params.targetUsdc))))
                setUsdcTopup(String(Math.max(1, Math.floor(params.autoTopupUsdc))))
                setCadence(params.period)
                if (params.token) setUsdcTokenAddr(params.token)
                setUsdcOpen(true)
            },
        }
    }, [])

    const etaText = useMemo(() => {
        const targetUsdNum = Number(target)
        const topupInr = Number(recurring)
        if (!Number.isFinite(targetUsdNum) || !Number.isFinite(topupInr) || targetUsdNum <= 0 || topupInr <= 0) return ''
        const depositUsdc = topupInr / INR_PER_USDC
        const periodsNeeded = Math.ceil(targetUsdNum / depositUsdc)
        const periodDays = cadence === 'daily' ? 1 : cadence === 'weekly' ? 7 : 30
        const days = periodsNeeded * periodDays
        return `Est. to fill: ~${days} days`
    }, [target, recurring, cadence])

    async function ensureRskTestnet() {
        const eth = (window as any)?.ethereum
        if (!eth?.request) return
        try { await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x1f' }] }) } catch (e: any) {
            const needsAdd = e?.code === 4902 || /Unrecognized chain/i.test(e?.message || '')
            if (needsAdd) {
                await eth.request({ method: 'wallet_addEthereumChain', params: [{ chainId: '0x1f', chainName: 'Rootstock Testnet', nativeCurrency: { name: 'tRBTC', symbol: 'tRBTC', decimals: 18 }, rpcUrls: ['https://public-node.testnet.rsk.co'], blockExplorerUrls: ['https://explorer.testnet.rsk.co'] }] })
                await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x1f' }] })
            }
        }
    }

    async function onCreateUsdcJar() {
        setFormError(null)
        const nameVal = usdcName.trim() || 'USDC Jar'
        const targetVal = Number(usdcTarget)
        const topupVal = Number(usdcTopup)
        const token = usdcTokenAddr.trim() as `0x${string}`
        if (!/^0x[0-9a-fA-F]{40}$/.test(token)) { setFormError('Enter a valid token address'); return }
        if (!Number.isFinite(targetVal) || targetVal <= 0) { setFormError('Enter a valid target (USDC).'); return }
        if (!Number.isFinite(topupVal) || topupVal <= 0) { setFormError('Enter a valid auto top-up (USDC).'); return }
        try {
            setCreating(true)
            if (chainId !== 31) { await ensureRskTestnet(); try { await switchChainAsync({ chainId: 31 }) } catch { } }
            const wc = await getWalletClient(wagmiConfig, { chainId: 31 })
            if (!wc) { setFormError('Wallet not ready.'); setCreating(false); return }
            const owner = (await wc.getAddresses())[0]
            // scale UI amounts to token units
            const decimals = await publicClient!.readContract({ abi: ERC20Abi as any, address: token, functionName: 'decimals', args: [] }) as number
            const mul = 10 ** decimals
            const targetUnits = BigInt(Math.round(targetVal * mul))
            const recurringUnits = BigInt(Math.round(topupVal * mul))
            const periodIndex = cadence === 'daily' ? 0 : (cadence === 'weekly' ? 1 : 2)
            const hash = await wc.deployContract({ abi: PiggyJarUSDCAbi as any, bytecode: PiggyJarUSDCBytecode as Hex, args: [owner, token, nameVal, periodIndex, recurringUnits, targetUnits], account: owner })
            const receipt = await publicClient!.waitForTransactionReceipt({ hash })
            const addr = receipt.contractAddress as `0x${string}` | undefined
            if (!addr) throw new Error('No address')
            const newJar: Jar = { id: Math.random().toString(36).slice(2), name: nameVal, targetUsd: targetVal, thresholdUsd: targetVal, recurringUsd: topupVal, targetAsset: 'RBTC', cadence, autoSwap, depositedUsd: 0, status: 'filling', isDeployed: true, contractAddress: addr, isUsdcJar: true, usdcToken: token }
            const updatedJars = [newJar, ...jars]
            setJars(updatedJars)
            // IMMEDIATELY save to localStorage
            if (address) {
                console.log('IMMEDIATE SAVE: Saving new jar for address:', address)
                writeJarsFor(address, updatedJars)
            }
            setUsdcOpen(false)
        } catch (e: any) { setFormError(e?.message || String(e)) } finally { setCreating(false) }
    }

    async function approveUsdc(token: `0x${string}`, spender: `0x${string}`, amount: bigint) {
        const wc = await getWalletClient(wagmiConfig, { chainId: 31 })
        if (!wc) throw new Error('Wallet not ready')
        const owner = (await wc.getAddresses())[0]
        const hash = await wc.writeContract({ abi: ERC20Abi as any, address: token, functionName: 'approve', args: [spender, amount], account: owner })
        await publicClient!.waitForTransactionReceipt({ hash })
    }

    async function depositUsdc(jar: Jar, token: `0x${string}`, amountInUsdc: number) {
        const wc = await getWalletClient(wagmiConfig, { chainId: 31 })
        if (!wc) throw new Error('Wallet not ready')
        const owner = (await wc.getAddresses())[0]
        const decimals = await publicClient!.readContract({ abi: ERC20Abi as any, address: token, functionName: 'decimals', args: [] }) as number
        const amt = BigInt(Math.floor(amountInUsdc * 10 ** decimals))
        await approveUsdc(token, jar.contractAddress as `0x${string}`, amt)
        const hash = await wc.writeContract({ abi: PiggyJarUSDCAbi as any, address: jar.contractAddress as `0x${string}`, functionName: 'deposit', args: [amt], account: owner })
        await publicClient!.waitForTransactionReceipt({ hash })
        setJars(prev => prev.map(j => { if (j.id !== jar.id) return j; const newDeposited = (j.depositedUsd || 0) + amountInUsdc; const filled = newDeposited >= j.targetUsd; return { ...j, depositedUsd: newDeposited, status: filled ? 'filled' : 'filling' } }))
        const updated = jars.find(j => j.id === jar.id)
        if (updated && (updated.depositedUsd + amountInUsdc) >= updated.targetUsd) { await breakUsdcJar({ ...updated, depositedUsd: updated.depositedUsd + amountInUsdc }); alert('Jar filled. Funds returned to your wallet.') }
    }

    async function breakUsdcJar(jar: Jar) {
        const wc = await getWalletClient(wagmiConfig, { chainId: 31 })
        if (!wc) throw new Error('Wallet not ready')
        const owner = (await wc.getAddresses())[0]
        const hash = await wc.writeContract({ abi: PiggyJarUSDCAbi as any, address: jar.contractAddress as `0x${string}`, functionName: 'breakJar', args: [], account: owner })
        await publicClient!.waitForTransactionReceipt({ hash })
        onBreakJar(jar.id)
    }

    async function onCreate(e: React.FormEvent) {
        e.preventDefault()
        if (creating) return
        setFormError(null)
        const targetUsd = Number(target)
        const topupInr = Number(recurring)
        if (!Number.isFinite(targetUsd) || targetUsd <= 0) { setFormError('Enter a valid target (USDC).'); return }
        if (!Number.isFinite(topupInr) || topupInr <= 0) { setFormError('Enter a valid auto top-up (INR).'); return }
        try {
            setCreating(true)
            if (chainId !== 31) { await ensureRskTestnet(); try { await switchChainAsync({ chainId: 31 }) } catch { } }
            const wc = await getWalletClient(wagmiConfig, { chainId: 31 })
            if (!wc) { setFormError('Wallet not ready.'); setCreating(false); return }
            const owner = (await wc.getAddresses())[0]
            const hash = await wc.deployContract({ abi: PiggyJarAbi as any, bytecode: PiggyJarBytecode as Hex, args: [owner, BigInt(targetUsd), BigInt(targetUsd), name.trim() || 'Jar'], account: owner })
            const receipt = await publicClient!.waitForTransactionReceipt({ hash })
            const deployedAddress = receipt.contractAddress as `0x${string}` | undefined
            if (!deployedAddress) throw new Error('No contract address in receipt')
            const newJar: Jar = { id: Math.random().toString(36).slice(2), name: name.trim() || 'Jar', targetUsd, thresholdUsd: targetUsd, recurringUsd: topupInr, targetAsset: asset, cadence, autoSwap, depositedUsd: 0, status: 'filling', isDeployed: true, contractAddress: deployedAddress, isUsdcJar: false }
            const updatedJars = [newJar, ...jars]
            setJars(updatedJars)
            // IMMEDIATELY save to localStorage
            if (address) {
                console.log('IMMEDIATE SAVE: Saving new jar for address:', address)
                writeJarsFor(address, updatedJars)
            }
            setCreateOpen(false)
        } catch (err: any) { setFormError(err?.message || String(err)) } finally { setCreating(false) }
    }

    function onSimulateDeposit(jarId: string, amountInInr: number) {
        const amountUsdc = amountInInr / INR_PER_USDC
        setJars(prev => prev.map(j => { if (j.id !== jarId) return j; if (j.isUsdcJar) return j; const depositedUsd = (Number(j.depositedUsd) || 0) + amountUsdc; const filled = depositedUsd >= j.targetUsd; return { ...j, depositedUsd, status: filled ? 'filled' : 'filling' } }))
    }

    function onBreakJar(jarId: string) { setJars(prev => prev.map(j => j.id === jarId ? { ...j, status: 'broken', depositedUsd: 0 } : j)) }
    function openUpi(jarId: string) { setUpiJarId(jarId) }
    function closeUpi() { setUpiJarId(null) }
    function payUpi(jarId: string) { const jar = jars.find(j => j.id === jarId); if (!jar) return; onSimulateDeposit(jarId, Number(jar.recurringUsd) || 0); closeUpi() }

    // Simulation helpers
    function periodDaysFor(c: 'daily' | 'weekly' | 'monthly') { return c === 'daily' ? 1 : c === 'weekly' ? 7 : 30 }
    function advanceSim(days: number) {
        if (days <= 0) return
        const prevDay = simDay
        const nextDay = prevDay + days
        setSimDay(nextDay)
        setJars(prev => prev.map(j => {
            if (j.status !== 'filling') return j
            const pd = periodDaysFor(j.cadence)
            const lastPaid = j.lastSimDayPaid ?? prevDay
            const totalPeriodsDue = Math.floor((nextDay - lastPaid) / pd)
            if (totalPeriodsDue <= 0) return j
            // create a notification to settle due periods (USDC or mock UPI)
            setNotifications(curr => {
                // remove any existing notification for this jar to avoid duplicates
                const filtered = curr.filter(n => n.jarId !== j.id)
                return [{ id: Math.random().toString(36).slice(2), jarId: j.id, text: `${totalPeriodsDue} ${j.cadence} payment(s) due for ${j.name}`, periods: totalPeriodsDue }, ...filtered]
            })
            return { ...j, lastSimDayPaid: lastPaid + totalPeriodsDue * pd }
        }))
    }

    async function settleNotification(n: Notification) {
        const jar = jars.find(j => j.id === n.jarId)
        if (!jar) { setNotifications(prev => prev.filter(x => x.id !== n.id)); return }
        if (jar.isUsdcJar) {
            if (!jar.usdcToken || !jar.contractAddress) { setNotifications(prev => prev.filter(x => x.id !== n.id)); return }
            const periods = n.periods || 1
            const amount = (Number(jar.recurringUsd) || 0) * periods
            try {
                await depositUsdc(jar, jar.usdcToken as `0x${string}`, amount)
            } catch (e) {
                // keep the notification if failed
                return
            }
            setNotifications(prev => prev.filter(x => x.id !== n.id))
        } else {
            // Mock jar: open UPI popup for one payment; user can repeat if multiple
            openUpi(jar.id)
            setNotifications(prev => prev.filter(x => x.id !== n.id))
        }
    }

    const activeJars = jars.filter(j => j.status !== 'broken')
    const brokenJars = jars.filter(j => j.status === 'broken')

    function clearCurrentJars() {
        if (address) {
            try { localStorage.removeItem(`piggybit:jars:${address.toLowerCase()}`) } catch { }
        }
        try { localStorage.removeItem('piggybit:jars') } catch { }
        setJars([])
    }

    return (
        <div style={{ padding: '24px', maxWidth: 900, width: '100%', margin: '0 auto' }}>
            {/* Simulation time controls */}
            <section style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between' }}>
                <div style={{ fontSize: 13 }}>Simulated time: <strong>{simDay} day(s)</strong></div>
                <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={() => advanceSim(1)} style={{ padding: '6px 10px', border: '1px solid #000', background: '#fff', cursor: 'pointer' }}>+1 day</button>
                    <button onClick={() => advanceSim(7)} style={{ padding: '6px 10px', border: '1px solid #000', background: '#fff', cursor: 'pointer' }}>+1 week</button>
                    <button onClick={() => advanceSim(30)} style={{ padding: '6px 10px', border: '1px solid #000', background: '#fff', cursor: 'pointer' }}>+1 month</button>
                    <button onClick={() => setSimDay(0)} style={{ padding: '6px 10px', border: '1px solid #000', background: '#ffeb3b', cursor: 'pointer' }}>Reset</button>
                </div>
            </section>
            {notifications.length > 0 && (
                <section style={{ marginBottom: 16, border: '1px dashed #000', padding: 12, background: '#fafafa' }}>
                    <div style={{ fontSize: 14, marginBottom: 8 }}><strong>Notifications</strong></div>
                    <div style={{ display: 'grid', gap: 8 }}>
                        {notifications.map(n => {
                            const jar = jars.find(j => j.id === n.jarId)
                            const canSettle = !!jar
                            return (
                                <div key={n.id} style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between' }}>
                                    <div style={{ fontSize: 13 }}>{n.text}</div>
                                    <div style={{ display: 'flex', gap: 8 }}>
                                        {canSettle && <button onClick={() => settleNotification(n)} style={{ padding: '6px 10px', border: '1px solid #000', background: '#000', color: '#fff', cursor: 'pointer' }}>Pay now</button>}
                                        <button onClick={() => setNotifications(prev => prev.filter(x => x.id !== n.id))} style={{ padding: '6px 10px', border: '1px solid #000', background: '#fff', cursor: 'pointer' }}>Dismiss</button>
                                    </div>
                                </div>
                            )
                        })}
                    </div>
                </section>
            )}
            <section style={{ marginBottom: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <h2 style={{ fontSize: 20, margin: 0 }}>My Jars</h2>
                <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={() => setCreateOpen(true)} disabled={!isConnected} style={{ padding: '8px 14px', border: '1px solid #000', background: isConnected ? '#fff' : '#f0f0f0', color: isConnected ? '#000' : '#666', cursor: isConnected ? 'pointer' : 'not-allowed' }}>Create Jar</button>
                    <button onClick={() => setUsdcOpen(true)} disabled={!isConnected} style={{ padding: '8px 14px', border: '1px solid #000', background: isConnected ? '#e5e5e5' : '#f0f0f0', color: isConnected ? '#000' : '#666', cursor: isConnected ? 'pointer' : 'not-allowed' }}>Create USDC Jar</button>
                    <button onClick={clearCurrentJars} disabled={!isConnected} style={{ padding: '8px 14px', border: '1px solid #000', background: isConnected ? '#fff' : '#f0f0f0', color: isConnected ? '#000' : '#666', cursor: isConnected ? 'pointer' : 'not-allowed' }}>Clear Jars</button>
                </div>
            </section>

            {activeJars.length === 0 ? (
                <div style={{ color: '#444' }}>Connect wallet to create / view jars</div>
            ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
                    {activeJars.map(jar => {
                        const deposited = Number(jar.depositedUsd) || 0
                        const targetVal = Number(jar.targetUsd) || 0
                        const pct = targetVal > 0 ? Math.min(100, Math.round((deposited / targetVal) * 100)) : 0
                        const filled = jar.status === 'filled'
                        const cardStyle: React.CSSProperties = filled ? { border: '1px solid #000', padding: 16, background: '#000', color: '#fff' } : { border: '1px solid #000', padding: 16, background: '#fff', color: '#000' }
                        const barBg = filled ? '#fff' : '#000'
                        const barTrack = filled ? '#000' : '#fff'
                        const canTopUp = jar.status !== 'filled'
                        return (
                            <div key={jar.id} style={cardStyle}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                                    <strong>{jar.name}</strong>
                                    <span style={{ fontSize: 12 }}>{jar.status.toUpperCase()}</span>
                                </div>
                                <div style={{ fontSize: 13, marginBottom: 8 }}>
                                    {`Target: $${targetVal.toFixed(2)} • ${jar.isUsdcJar ? 'Auto top-up: $' + (Number(jar.recurringUsd) || 0).toFixed(2) + ' USDC' : 'Auto top-up: ₹' + (Number(jar.recurringUsd) || 0).toFixed(0)} • Asset: ${jar.targetAsset}`}
                                </div>
                                <div style={{ fontSize: 12, marginBottom: 8 }}>Cadence: {jar.cadence} • Auto-swap: {jar.autoSwap ? 'On' : 'Off'}</div>
                                <div style={{ fontSize: 13, marginBottom: 8 }}>
                                    {`$${deposited.toFixed(2)} / $${targetVal.toFixed(2)} (${pct}%)`}
                                </div>
                                <div style={{ height: 8, border: '1px solid #000', background: barTrack, marginBottom: 12 }}>
                                    <div style={{ height: '100%', width: `${pct}%`, background: barBg }} />
                                </div>
                                {jar.contractAddress && (
                                    <div style={{ fontSize: 12, marginBottom: 12 }}>
                                        Contract: <span style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace' }}>{jar.contractAddress}</span>
                                    </div>
                                )}
                                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                                    {jar.isUsdcJar ? (
                                        <>
                                            {canTopUp && (
                                                <button onClick={() => depositUsdc(jar, jar.usdcToken as `0x${string}`, Number(jar.recurringUsd) || 0)} style={{ padding: '6px 12px', border: '1px solid #000', background: filled ? '#fff' : '#000', color: filled ? '#000' : '#fff', cursor: 'pointer' }}>Pay</button>
                                            )}
                                            <button onClick={() => breakUsdcJar(jar)} style={{ padding: '6px 12px', border: '1px solid #000', background: '#fff', color: '#000', cursor: 'pointer' }}>Break Jar</button>
                                        </>
                                    ) : (
                                        <>
                                            <button onClick={() => onBreakJar(jar.id)} style={{ padding: '6px 12px', border: '1px solid #000', background: filled ? '#fff' : '#000', color: filled ? '#000' : '#fff', cursor: 'pointer' }}>Break Jar</button>
                                            {canTopUp && (
                                                <button onClick={() => openUpi(jar.id)} aria-label="UPI" title="UPI" style={{ padding: 0, border: '1px solid #000', background: filled ? '#fff' : '#000', color: filled ? '#000' : '#fff', cursor: 'pointer', marginLeft: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 0, width: 64, height: 32 }}>
                                                    <img src="/upi_logo_icon.png" alt="UPI" style={{ width: '90%', height: '90%', objectFit: 'contain', display: 'block' }} onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
                                                </button>
                                            )}
                                        </>
                                    )}
                                </div>
                            </div>
                        )
                    })}
                </div>
            )}

            {brokenJars.length > 0 && (
                <section style={{ marginTop: 24 }}>
                    <h3 style={{ fontSize: 16, margin: '0 0 12px 0' }}>Broken Jars</h3>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
                        {brokenJars.map(jar => (
                            <div key={jar.id} style={{ border: '1px dashed #000', padding: 16, background: '#f5f5f5', color: '#000' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                                    <strong>{jar.name}</strong>
                                    <span style={{ fontSize: 12 }}>BROKEN</span>
                                </div>
                                <div style={{ fontSize: 13, marginBottom: 8 }}>Target: ${jar.targetUsd.toFixed(2)}</div>
                                {jar.contractAddress && (
                                    <div style={{ fontSize: 12, marginBottom: 8 }}>Contract: <span style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace' }}>{jar.contractAddress}</span></div>
                                )}
                                <div style={{ fontSize: 12, color: '#555' }}>Funds were returned to your wallet on break.</div>
                            </div>
                        ))}
                    </div>
                </section>
            )}

            {usdcOpen && (
                <div onClick={() => setUsdcOpen(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <div onClick={e => e.stopPropagation()} style={{ width: 900, background: '#fff', color: '#000', border: '1px solid #000', padding: 16 }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <h3 style={{ margin: 0 }}>Create USDC Jar</h3>
                            <button onClick={() => setUsdcOpen(false)} style={{ border: '1px solid #000', background: '#fff', color: '#000', padding: '4px 8px', cursor: 'pointer' }}>Close</button>
                        </div>
                        <form onSubmit={(e) => { e.preventDefault(); onCreateUsdcJar() }} style={{ marginTop: 12 }}>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr 1fr', gap: 12 }}>
                                <label style={{ display: 'grid', gap: 6 }}>
                                    <span>Jar name</span>
                                    <input value={usdcName} onChange={e => setUsdcName(e.target.value)} style={{ padding: '8px 10px', border: '1px solid #000', background: '#fff', color: '#000' }} />
                                </label>
                                <label style={{ display: 'grid', gap: 6 }}>
                                    <span>Target (USDC)</span>
                                    <input value={usdcTarget} onChange={e => setUsdcTarget(e.target.value)} type="number" min="1" step="1" style={{ padding: '8px 10px', border: '1px solid #000', background: '#fff', color: '#000' }} />
                                </label>
                                <label style={{ display: 'grid', gap: 6 }}>
                                    <span>Auto top-up (USDC)</span>
                                    <input value={usdcTopup} onChange={e => setUsdcTopup(e.target.value)} type="number" min="1" step="1" style={{ padding: '8px 10px', border: '1px solid #000', background: '#fff', color: '#000' }} />
                                </label>
                                <label style={{ display: 'grid', gap: 6 }}>
                                    <span>USDC token address</span>
                                    <input value={usdcTokenAddr} onChange={e => setUsdcTokenAddr(e.target.value)} placeholder="0x..." style={{ padding: '8px 10px', border: '1px solid #000', background: '#fff', color: '#000' }} />
                                </label>
                                <label style={{ display: 'grid', gap: 6 }}>
                                    <span>Recurring period</span>
                                    <select value={cadence} onChange={e => setCadence(e.target.value as 'daily' | 'weekly' | 'monthly')} style={{ padding: '8px 10px', border: '1px solid #000', background: '#fff', color: '#000' }}>
                                        <option value="daily">Daily</option>
                                        <option value="weekly">Weekly</option>
                                        <option value="monthly">Monthly</option>
                                    </select>
                                </label>
                            </div>
                            {formError && (<div style={{ marginTop: 8, color: '#cc0000', fontSize: 12 }}>{formError}</div>)}
                            <div style={{ marginTop: 12, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                                <button type="button" onClick={() => setUsdcOpen(false)} style={{ padding: '8px 14px', border: '1px solid #000', background: '#fff', color: '#000', cursor: 'pointer' }}>Cancel</button>
                                <button type="submit" disabled={creating} style={{ padding: '8px 14px', border: '1px solid #000', background: '#000', color: '#fff', cursor: creating ? 'not-allowed' : 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                                    {creating ? 'minting' : 'Mint Jar'}
                                    <img src="/rootstock_logo.png" alt="Rootstock" style={{ width: 18, height: 18, objectFit: 'contain' }} />
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {createOpen && (
                <div onClick={() => setCreateOpen(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <div onClick={e => e.stopPropagation()} style={{ width: 760, background: '#fff', color: '#000', border: '1px solid #000', padding: 16 }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <h3 style={{ margin: 0 }}>Create Jar</h3>
                            <button onClick={() => setCreateOpen(false)} style={{ border: '1px solid #000', background: '#fff', color: '#000', padding: '4px 8px', cursor: 'pointer' }}>Close</button>
                        </div>
                        <form onSubmit={onCreate} style={{ marginTop: 12 }}>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 12 }}>
                                <label style={{ display: 'grid', gap: 6 }}>
                                    <span>Jar name</span>
                                    <input value={name} onChange={e => setName(e.target.value)} style={{ padding: '8px 10px', border: '1px solid #000', background: '#fff', color: '#000' }} />
                                </label>
                                <label style={{ display: 'grid', gap: 6 }}>
                                    <span>Target (USDC)</span>
                                    <input value={target} onChange={e => setTarget(e.target.value)} type="number" min="1" step="1" style={{ padding: '8px 10px', border: '1px solid #000', background: '#fff', color: '#000' }} />
                                </label>
                                <label style={{ display: 'grid', gap: 6 }}>
                                    <span>Auto top-up (₹ INR)</span>
                                    <input value={recurring} onChange={e => setRecurring(e.target.value)} type="number" min="1" step="1" style={{ padding: '8px 10px', border: '1px solid #000', background: '#fff', color: '#000' }} />
                                </label>
                                <label style={{ display: 'grid', gap: 6 }}>
                                    <span>Recurring period</span>
                                    <select value={cadence} onChange={e => setCadence(e.target.value as 'daily' | 'weekly' | 'monthly')} style={{ padding: '8px 10px', border: '1px solid #000', background: '#fff', color: '#000' }}>
                                        <option value="daily">Daily</option>
                                        <option value="weekly">Weekly</option>
                                        <option value="monthly">Monthly</option>
                                    </select>
                                </label>
                            </div>
                            {etaText && (<div style={{ marginTop: 8, fontSize: 12 }}>{etaText}</div>)}
                            {formError && (<div style={{ marginTop: 8, color: '#cc0000', fontSize: 12 }}>{formError}</div>)}
                            <div style={{ marginTop: 8, fontSize: 11, opacity: 0.8 }}>Assuming 1 USDC ≈ ₹{INR_PER_USDC}</div>
                            <div style={{ marginTop: 12, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                                <button type="button" onClick={() => setCreateOpen(false)} style={{ padding: '8px 14px', border: '1px solid #000', background: '#fff', color: '#000', cursor: 'pointer' }}>Cancel</button>
                                <button type="submit" disabled={creating} style={{ padding: '8px 14px', border: '1px solid #000', background: '#000', color: '#fff', cursor: creating ? 'not-allowed' : 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                                    {creating ? 'minting' : 'Mint Jar'}
                                    <img src="/rootstock_logo.png" alt="Rootstock" style={{ width: 18, height: 18, objectFit: 'contain' }} />
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {upiJarId && (() => {
                const jar = jars.find(j => j.id === upiJarId)
                const amtInr = jar ? Number(jar.recurringUsd) || 0 : 0
                const amtUsdc = amtInr / INR_PER_USDC
                const filled = jar?.status === 'filled'
                return (
                    <div onClick={closeUpi} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <div onClick={e => e.stopPropagation()} style={{ width: 360, background: filled ? '#000' : '#fff', color: filled ? '#fff' : '#000', border: '1px solid #000', padding: 16 }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                <h3 style={{ margin: 0 }}>Mock UPI Payment</h3>
                                <button onClick={closeUpi} style={{ border: '1px solid #000', background: filled ? '#000' : '#fff', color: filled ? '#fff' : '#000', padding: '4px 8px', cursor: 'pointer' }}>Close</button>
                            </div>
                            <div style={{ marginTop: 12 }}>Jar: <strong>{jar?.name}</strong></div>
                            <div style={{ marginTop: 8 }}>Amount: <strong>₹{amtInr.toFixed(0)} (~${amtUsdc.toFixed(2)} USDC)</strong></div>
                            <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end' }}>
                                <button onClick={() => payUpi(upiJarId)} style={{ padding: '8px 14px', border: '1px solid #000', background: filled ? '#fff' : '#000', color: filled ? '#000' : '#fff', cursor: 'pointer' }}>Pay</button>
                            </div>
                        </div>
                    </div>
                )
            })()}
        </div>
    )
}
