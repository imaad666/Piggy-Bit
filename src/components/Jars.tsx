import { useEffect, useState, useMemo } from 'react'
import { useAccount, useChainId, useSwitchChain, usePublicClient } from 'wagmi'
import type { Hex } from 'viem'
import { PiggyJarTRBTCAbi, PiggyJarTRBTCBytecode } from '../contracts/PiggyJarTRBTC'
import { PiggyJarPYUSDAbi, PiggyJarPYUSDBytecode } from '../contracts/PiggyJarPYUSD'
import { PiggyJarPYUSDUPIAbi, PiggyJarPYUSDUPIBytecode } from '../contracts/PiggyJarPYUSDUPI'
import { getWalletClient } from 'wagmi/actions'
import { config as wagmiConfig } from '../wagmi'
import { useNetwork } from '../NetworkContext'

// tRBTC jar functionality
const INR_PER_RBTC = 9720986 // Mock exchange rate: 1 RBTC = 1 BTC ≈ ₹9.7M INR (Dec 2024)
// PYUSD jar functionality
const INR_PER_PYUSD = 84 // Mock exchange rate: 1 PYUSD ≈ ₹84 INR (Dec 2024)
const PYUSD_CONTRACT_ADDRESS = '0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582' // PYUSD on Sepolia (mock address - replace with actual)

export type Jar = {
    id: string
    name: string
    targetTrbtc: number // For PYUSD jars, this is targetPyusd but using same field for simplicity
    thresholdTrbtc: number // For PYUSD jars, this is thresholdPyusd
    recurringTrbtc: number // For PYUSD jars, this is recurringPyusd
    cadence: 'daily' | 'weekly' | 'monthly'
    depositedTrbtc: number // For PYUSD jars, this is depositedPyusd
    status: 'filling' | 'filled' | 'broken'
    isDeployed: boolean
    contractAddress?: `0x${string}`
    isTrbtcJar?: boolean
    isPyusdJar?: boolean
    isPyusdUpiJar?: boolean
    network?: 'rootstock' | 'sepolia'
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
    const { selectedNetwork } = useNetwork()

    const [jars, setJars] = useState<Jar[]>([])
    const [createOpen, setCreateOpen] = useState(false)
    const [trbtcOpen, setTrbtcOpen] = useState(false)
    const [pyusdOpen, setPyusdOpen] = useState(false)
    const [pyusdUpiOpen, setPyusdUpiOpen] = useState(false)
    const [name, setName] = useState('My Jar')
    const [target, setTarget] = useState('0.01')
    const [recurring, setRecurring] = useState('0.001')
    const [cadence, setCadence] = useState<'daily' | 'weekly' | 'monthly'>('daily')
    const [creating, setCreating] = useState(false)
    const [formError, setFormError] = useState<string | null>(null)

    // Calculate estimated time to fill for UPI jars
    const etaText = useMemo(() => {
        const targetVal = Number(target) // RBTC
        const recurringVal = Number(recurring) // RBTC (converted from INR input)
        if (!Number.isFinite(targetVal) || targetVal <= 0 || !Number.isFinite(recurringVal) || recurringVal <= 0) return ''
        const periodsToFill = Math.ceil(targetVal / recurringVal)
        const unit = cadence === 'daily' ? 'day' : cadence === 'weekly' ? 'week' : 'month'
        const unitPlural = periodsToFill === 1 ? unit : unit + 's'
        const inrAmount = Math.round(recurringVal * INR_PER_RBTC)
        return `Est: ${periodsToFill} ${unitPlural} to fill (₹${inrAmount.toLocaleString()} per ${unit})`
    }, [target, recurring, cadence])

    // Simulation time and notifications
    const [simDay, setSimDay] = useState<number>(() => {
        try { const r = localStorage.getItem('piggybit:simDay'); return r ? Number(r) || 0 : 0 } catch { return 0 }
    })
    type Notification = { id: string; jarId: string; text: string; periods?: number }
    const [notifications, setNotifications] = useState<Notification[]>(() => {
        try { const r = localStorage.getItem('piggybit:notifications'); return r ? JSON.parse(r) : [] } catch { return [] }
    })

    // tRBTC modal fields
    const [trbtcName, setTrbtcName] = useState('tRBTC Jar')
    const [trbtcTarget, setTrbtcTarget] = useState('0.01')
    const [trbtcTopup, setTrbtcTopup] = useState('0.001')

    // PYUSD modal fields
    const [pyusdName, setPyusdName] = useState('PYUSD Jar')
    const [pyusdTarget, setPyusdTarget] = useState('100')
    const [pyusdTopup, setPyusdTopup] = useState('10')

    // PYUSD UPI modal fields
    const [pyusdUpiName, setPyusdUpiName] = useState('PYUSD UPI Jar')
    const [pyusdUpiTarget, setPyusdUpiTarget] = useState('100')
    const [pyusdUpiTopup, setPyusdUpiTopup] = useState('840') // ₹840 = 10 PYUSD

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
            openCreateJarPrefill: (params: { name: string; targetTrbtc: number; autoTopupTrbtc: number; period: 'daily' | 'weekly' | 'monthly' }) => {
                setName(params.name || 'Jar')
                setTarget(String(Math.max(0.001, params.targetTrbtc)))
                setRecurring(String(Math.max(0.001, params.autoTopupTrbtc)))
                setCadence(params.period)
                setCreateOpen(true)
            },
            openCreateTrbtcJarPrefill: (params: { name: string; targetTrbtc: number; autoTopupTrbtc: number; period: 'daily' | 'weekly' | 'monthly' }) => {
                setTrbtcName(params.name || 'tRBTC Jar')
                setTrbtcTarget(String(Math.max(0.001, params.targetTrbtc)))
                setTrbtcTopup(String(Math.max(0.001, params.autoTopupTrbtc)))
                setCadence(params.period)
                setTrbtcOpen(true)
            },
        }
    }, [])


    async function ensureRskTestnet() {
        const eth = (window as any)?.ethereum
        if (!eth?.request) return
        try {
            await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x1f' }] })
        } catch (e: any) {
            const needsAdd = e?.code === 4902 || /Unrecognized chain/i.test(e?.message || '')
            if (needsAdd) {
                await eth.request({
                    method: 'wallet_addEthereumChain',
                    params: [{
                        chainId: '0x1f',
                        chainName: 'Rootstock Testnet',
                        nativeCurrency: { name: 'tRBTC', symbol: 'tRBTC', decimals: 18 },
                        rpcUrls: ['https://public-node.testnet.rsk.co'],
                        blockExplorerUrls: ['https://explorer.testnet.rsk.co']
                    }]
                })
                await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x1f' }] })
            }
        }
    }

    async function ensureSepoliaTestnet() {
        const eth = (window as any)?.ethereum
        if (!eth?.request) return
        try {
            await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0xaa36a7' }] })
        } catch (e: any) {
            const needsAdd = e?.code === 4902 || /Unrecognized chain/i.test(e?.message || '')
            if (needsAdd) {
                await eth.request({
                    method: 'wallet_addEthereumChain',
                    params: [{
                        chainId: '0xaa36a7',
                        chainName: 'Sepolia',
                        nativeCurrency: { name: 'Sepolia Ether', symbol: 'ETH', decimals: 18 },
                        rpcUrls: ['https://rpc.sepolia.org'],
                        blockExplorerUrls: ['https://sepolia.etherscan.io']
                    }]
                })
                await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0xaa36a7' }] })
            }
        }
    }

    async function onCreateTrbtcJar() {
        setFormError(null)
        const nameVal = trbtcName.trim() || 'tRBTC Jar'
        const targetVal = Number(trbtcTarget)
        const topupVal = Number(trbtcTopup)
        if (!Number.isFinite(targetVal) || targetVal <= 0) { setFormError('Enter a valid target (tRBTC).'); return }
        if (!Number.isFinite(topupVal) || topupVal <= 0) { setFormError('Enter a valid auto top-up (tRBTC).'); return }
        try {
            setCreating(true)
            if (chainId !== 31) { await ensureRskTestnet(); try { await switchChainAsync({ chainId: 31 }) } catch { } }
            const wc = await getWalletClient(wagmiConfig, { chainId: 31 })
            if (!wc) { setFormError('Wallet not ready.'); setCreating(false); return }
            const owner = (await wc.getAddresses())[0]
            // Convert tRBTC to wei (18 decimals)
            const targetUnits = BigInt(Math.round(targetVal * 10 ** 18))
            const recurringUnits = BigInt(Math.round(topupVal * 10 ** 18))
            const periodIndex = cadence === 'daily' ? 0 : (cadence === 'weekly' ? 1 : 2)
            const hash = await wc.deployContract({ abi: PiggyJarTRBTCAbi as any, bytecode: PiggyJarTRBTCBytecode as Hex, args: [owner, nameVal, periodIndex, recurringUnits, targetUnits], account: owner })
            const receipt = await publicClient!.waitForTransactionReceipt({ hash })
            const addr = receipt.contractAddress as `0x${string}` | undefined
            if (!addr) throw new Error('No address')
            const newJar: Jar = { id: Math.random().toString(36).slice(2), name: nameVal, targetTrbtc: targetVal, thresholdTrbtc: targetVal, recurringTrbtc: topupVal, cadence, depositedTrbtc: 0, status: 'filling', isDeployed: true, contractAddress: addr, isTrbtcJar: true }
            const updatedJars = [newJar, ...jars]
            setJars(updatedJars)
            // IMMEDIATELY save to localStorage
            if (address) {
                console.log('IMMEDIATE SAVE: Saving new jar for address:', address)
                writeJarsFor(address, updatedJars)
            }
            setTrbtcOpen(false)
        } catch (e: any) { setFormError(e?.message || String(e)) } finally { setCreating(false) }
    }

    async function onCreatePyusdJar() {
        setFormError(null)
        const nameVal = pyusdName.trim() || 'PYUSD Jar'
        const targetVal = Number(pyusdTarget)
        const topupVal = Number(pyusdTopup)
        if (!Number.isFinite(targetVal) || targetVal <= 0) { setFormError('Enter a valid target (PYUSD).'); return }
        if (!Number.isFinite(topupVal) || topupVal <= 0) { setFormError('Enter a valid auto top-up (PYUSD).'); return }
        try {
            setCreating(true)
            if (chainId !== 11155111) { await ensureSepoliaTestnet(); try { await switchChainAsync({ chainId: 11155111 }) } catch { } }
            const wc = await getWalletClient(wagmiConfig, { chainId: 11155111 })
            if (!wc) { setFormError('Wallet not ready.'); setCreating(false); return }
            const owner = (await wc.getAddresses())[0]
            // Convert PYUSD to wei (6 decimals)
            const targetUnits = BigInt(Math.round(targetVal * 10 ** 6))
            const recurringUnits = BigInt(Math.round(topupVal * 10 ** 6))
            const periodIndex = cadence === 'daily' ? 0 : (cadence === 'weekly' ? 1 : 2)
            const hash = await wc.deployContract({
                abi: PiggyJarPYUSDAbi as any,
                bytecode: PiggyJarPYUSDBytecode as Hex,
                args: [owner, nameVal, periodIndex, recurringUnits, targetUnits, PYUSD_CONTRACT_ADDRESS],
                account: owner
            })
            const receipt = await publicClient!.waitForTransactionReceipt({ hash })
            const addr = receipt.contractAddress as `0x${string}` | undefined
            if (!addr) throw new Error('No address')
            const newJar: Jar = {
                id: Math.random().toString(36).slice(2),
                name: nameVal,
                targetTrbtc: targetVal,
                thresholdTrbtc: targetVal,
                recurringTrbtc: topupVal,
                cadence,
                depositedTrbtc: 0,
                status: 'filling',
                isDeployed: true,
                contractAddress: addr,
                isPyusdJar: true,
                network: 'sepolia'
            }
            const updatedJars = [newJar, ...jars]
            setJars(updatedJars)
            if (address) {
                console.log('IMMEDIATE SAVE: Saving new PYUSD jar for address:', address)
                writeJarsFor(address, updatedJars)
            }
            setPyusdOpen(false)
        } catch (e: any) { setFormError(e?.message || String(e)) } finally { setCreating(false) }
    }

    async function onCreatePyusdUpiJar() {
        setFormError(null)
        const nameVal = pyusdUpiName.trim() || 'PYUSD UPI Jar'
        const targetVal = Number(pyusdUpiTarget)
        const topupInrVal = Number(pyusdUpiTopup)
        const topupPyusdVal = topupInrVal / INR_PER_PYUSD
        if (!Number.isFinite(targetVal) || targetVal <= 0) { setFormError('Enter a valid target (PYUSD).'); return }
        if (!Number.isFinite(topupPyusdVal) || topupPyusdVal <= 0) { setFormError('Enter a valid auto top-up (INR).'); return }
        try {
            setCreating(true)
            if (chainId !== 11155111) { await ensureSepoliaTestnet(); try { await switchChainAsync({ chainId: 11155111 }) } catch { } }
            const wc = await getWalletClient(wagmiConfig, { chainId: 11155111 })
            if (!wc) { setFormError('Wallet not ready.'); setCreating(false); return }
            const owner = (await wc.getAddresses())[0]
            // Convert PYUSD to wei (6 decimals)
            const targetUnits = BigInt(Math.round(targetVal * 10 ** 6))
            const recurringUnits = BigInt(Math.round(topupPyusdVal * 10 ** 6))
            const periodIndex = cadence === 'daily' ? 0 : (cadence === 'weekly' ? 1 : 2)
            const hash = await wc.deployContract({
                abi: PiggyJarPYUSDUPIAbi as any,
                bytecode: PiggyJarPYUSDUPIBytecode as Hex,
                args: [owner, nameVal, periodIndex, recurringUnits, targetUnits, PYUSD_CONTRACT_ADDRESS],
                account: owner
            })
            const receipt = await publicClient!.waitForTransactionReceipt({ hash })
            const addr = receipt.contractAddress as `0x${string}` | undefined
            if (!addr) throw new Error('No address')
            const newJar: Jar = {
                id: Math.random().toString(36).slice(2),
                name: nameVal,
                targetTrbtc: targetVal,
                thresholdTrbtc: targetVal,
                recurringTrbtc: topupPyusdVal,
                cadence,
                depositedTrbtc: 0,
                status: 'filling',
                isDeployed: true,
                contractAddress: addr,
                isPyusdUpiJar: true,
                network: 'sepolia'
            }
            const updatedJars = [newJar, ...jars]
            setJars(updatedJars)
            if (address) {
                console.log('IMMEDIATE SAVE: Saving new PYUSD UPI jar for address:', address)
                writeJarsFor(address, updatedJars)
            }
            setPyusdUpiOpen(false)
        } catch (e: any) { setFormError(e?.message || String(e)) } finally { setCreating(false) }
    }

    async function depositTrbtc(jar: Jar, amountInTrbtc: number) {
        const wc = await getWalletClient(wagmiConfig, { chainId: 31 })
        if (!wc) throw new Error('Wallet not ready')
        const owner = (await wc.getAddresses())[0]
        // Convert tRBTC to wei (18 decimals)
        const amountInWei = BigInt(Math.round(amountInTrbtc * 10 ** 18))

        const hash = await wc.writeContract({
            abi: PiggyJarTRBTCAbi as any,
            address: jar.contractAddress as `0x${string}`,
            functionName: 'deposit',
            args: [],
            account: owner,
            value: amountInWei
        })
        await publicClient!.waitForTransactionReceipt({ hash })

        setJars(prev => prev.map(j => {
            if (j.id !== jar.id) return j
            const newDeposited = (j.depositedTrbtc || 0) + amountInTrbtc
            const filled = newDeposited >= j.targetTrbtc
            return { ...j, depositedTrbtc: newDeposited, status: filled ? 'filled' : 'filling' }
        }))

        const updated = jars.find(j => j.id === jar.id)
        if (updated && (updated.depositedTrbtc + amountInTrbtc) >= updated.targetTrbtc) {
            await breakTrbtcJar({ ...updated, depositedTrbtc: updated.depositedTrbtc + amountInTrbtc })
            alert('Jar filled. Funds returned to your wallet.')
        }
    }

    async function breakTrbtcJar(jar: Jar) {
        const wc = await getWalletClient(wagmiConfig, { chainId: 31 })
        if (!wc) throw new Error('Wallet not ready')
        const owner = (await wc.getAddresses())[0]

        const hash = await wc.writeContract({ abi: PiggyJarTRBTCAbi as any, address: jar.contractAddress as `0x${string}`, functionName: 'breakJar', args: [], account: owner })
        await publicClient!.waitForTransactionReceipt({ hash })

        onBreakJar(jar.id)
    }

    async function onCreate(e: React.FormEvent) {
        e.preventDefault()
        if (creating) return
        setFormError(null)
        const targetTrbtc = Number(target)
        const recurringTrbtc = Number(recurring)
        if (!Number.isFinite(targetTrbtc) || targetTrbtc <= 0) { setFormError('Enter a valid target (RBTC).'); return }
        if (!Number.isFinite(recurringTrbtc) || recurringTrbtc <= 0) { setFormError('Enter a valid recurring amount (INR).'); return }
        try {
            setCreating(true)
            if (chainId !== 31) { await ensureRskTestnet(); try { await switchChainAsync({ chainId: 31 }) } catch { } }
            const wc = await getWalletClient(wagmiConfig, { chainId: 31 })
            if (!wc) { setFormError('Wallet not ready.'); setCreating(false); return }
            const owner = (await wc.getAddresses())[0]
            // Convert tRBTC to wei (18 decimals)
            const targetUnits = BigInt(Math.round(targetTrbtc * 10 ** 18))
            const recurringUnits = BigInt(Math.round(recurringTrbtc * 10 ** 18))
            const periodIndex = cadence === 'daily' ? 0 : (cadence === 'weekly' ? 1 : 2)
            const hash = await wc.deployContract({ abi: PiggyJarTRBTCAbi as any, bytecode: PiggyJarTRBTCBytecode as Hex, args: [owner, name.trim() || 'tRBTC Jar', periodIndex, recurringUnits, targetUnits], account: owner })
            const receipt = await publicClient!.waitForTransactionReceipt({ hash })
            const deployedAddress = receipt.contractAddress as `0x${string}` | undefined
            if (!deployedAddress) throw new Error('No contract address in receipt')
            const newJar: Jar = { id: Math.random().toString(36).slice(2), name: name.trim() || 'tRBTC Jar', targetTrbtc, thresholdTrbtc: targetTrbtc, recurringTrbtc, cadence, depositedTrbtc: 0, status: 'filling', isDeployed: true, contractAddress: deployedAddress, isTrbtcJar: true }
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

    function onSimulateDeposit(jarId: string, amountInTrbtc: number) {
        setJars(prev => prev.map(j => {
            if (j.id !== jarId) return j;
            const depositedTrbtc = (Number(j.depositedTrbtc) || 0) + amountInTrbtc;
            const filled = depositedTrbtc >= j.targetTrbtc;
            return { ...j, depositedTrbtc, status: filled ? 'filled' : 'filling' }
        }))
    }

    function onBreakJar(jarId: string) { setJars(prev => prev.map(j => j.id === jarId ? { ...j, status: 'broken', depositedTrbtc: 0 } : j)) }
    function openUpi(jarId: string) { setUpiJarId(jarId) }
    function closeUpi() { setUpiJarId(null) }
    function payUpi(jarId: string) { const jar = jars.find(j => j.id === jarId); if (!jar) return; onSimulateDeposit(jarId, Number(jar.recurringTrbtc) || 0); closeUpi() }

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
            // create a notification to settle due periods (tRBTC or mock UPI)
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
        if (jar.contractAddress) {
            const periods = n.periods || 1
            const amount = (Number(jar.recurringTrbtc) || 0) * periods
            try {
                await depositTrbtc(jar, amount)
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

    // Filter jars by selected network
    const networkJars = jars.filter(j => {
        if (selectedNetwork === 'rootstock') {
            return j.network === 'rootstock' || j.isTrbtcJar || (!j.network && !j.isPyusdJar && !j.isPyusdUpiJar)
        } else {
            return j.network === 'sepolia' || j.isPyusdJar || j.isPyusdUpiJar
        }
    })

    const activeJars = networkJars.filter(j => j.status !== 'broken')
    const brokenJars = networkJars.filter(j => j.status === 'broken')

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
                <h2 style={{ fontSize: 20, margin: 0 }}>My Jars - {selectedNetwork === 'rootstock' ? '🟠 Rootstock' : '🔵 Sepolia ETH'}</h2>
                <div style={{ display: 'flex', gap: 8 }}>
                    {selectedNetwork === 'rootstock' ? (
                        <>
                            <button onClick={() => setCreateOpen(true)} disabled={!isConnected} style={{ padding: '8px 14px', border: '1px solid #000', background: isConnected ? '#fff' : '#f0f0f0', color: isConnected ? '#000' : '#666', cursor: isConnected ? 'pointer' : 'not-allowed', display: 'flex', alignItems: 'center', gap: 6 }}>
                                <img src="/upi_logo_icon.png" alt="UPI" style={{ width: 16, height: 16, objectFit: 'contain' }} onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
                                Create UPI Jar (tRBTC)
                            </button>
                            <button onClick={() => setTrbtcOpen(true)} disabled={!isConnected} style={{ padding: '8px 14px', border: '1px solid #000', background: isConnected ? '#e5e5e5' : '#f0f0f0', color: isConnected ? '#000' : '#666', cursor: isConnected ? 'pointer' : 'not-allowed' }}>Create tRBTC Jar</button>
                        </>
                    ) : (
                        <>
                            <button onClick={() => setPyusdUpiOpen(true)} disabled={!isConnected} style={{ padding: '8px 14px', border: '1px solid #000', background: isConnected ? '#fff' : '#f0f0f0', color: isConnected ? '#000' : '#666', cursor: isConnected ? 'pointer' : 'not-allowed', display: 'flex', alignItems: 'center', gap: 6 }}>
                                <img src="/upi_logo_icon.png" alt="UPI" style={{ width: 16, height: 16, objectFit: 'contain' }} onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
                                Create UPI Jar (PYUSD)
                            </button>
                            <button onClick={() => setPyusdOpen(true)} disabled={!isConnected} style={{ padding: '8px 14px', border: '1px solid #000', background: isConnected ? '#e5e5e5' : '#f0f0f0', color: isConnected ? '#000' : '#666', cursor: isConnected ? 'pointer' : 'not-allowed' }}>Create PYUSD Jar</button>
                        </>
                    )}
                    <button onClick={clearCurrentJars} disabled={!isConnected} style={{ padding: '8px 14px', border: '1px solid #000', background: isConnected ? '#fff' : '#f0f0f0', color: isConnected ? '#000' : '#666', cursor: isConnected ? 'pointer' : 'not-allowed' }}>Clear Jars</button>
                </div>
            </section>

            {activeJars.length === 0 ? (
                <div style={{ color: '#444', textAlign: 'center', padding: '40px 20px' }}>
                    <div style={{ marginBottom: 8 }}>Connect your wallet to create and view jars</div>
                    <div style={{ fontSize: 12, opacity: 0.7 }}>
                        📱 Connecting will add Rootstock Testnet & Sepolia networks to your wallet<br />
                        🟠 Use Rootstock for tRBTC jars • 🔵 Use Sepolia for PYUSD jars
                    </div>
                </div>
            ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
                    {activeJars.map(jar => {
                        const deposited = Number(jar.depositedTrbtc) || 0
                        const targetVal = Number(jar.targetTrbtc) || 0
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
                                    {jar.isPyusdJar
                                        ? `Target: ${targetVal.toFixed(2)} PYUSD • Auto top-up: ${(Number(jar.recurringTrbtc) || 0).toFixed(2)} PYUSD`
                                        : jar.isPyusdUpiJar
                                            ? `Target: ${targetVal.toFixed(2)} PYUSD • Auto top-up: ₹${Math.round((Number(jar.recurringTrbtc) || 0) * INR_PER_PYUSD).toLocaleString()}`
                                            : jar.contractAddress && jar.isTrbtcJar
                                                ? `Target: ${targetVal.toFixed(4)} tRBTC • Auto top-up: ${(Number(jar.recurringTrbtc) || 0).toFixed(4)} tRBTC`
                                                : `Target: ${targetVal.toFixed(4)} tRBTC • Auto top-up: ₹${Math.round((Number(jar.recurringTrbtc) || 0) * INR_PER_RBTC).toLocaleString()}`
                                    }
                                </div>
                                <div style={{ fontSize: 12, marginBottom: 8 }}>Cadence: {jar.cadence}</div>
                                <div style={{ fontSize: 13, marginBottom: 8 }}>
                                    {jar.isPyusdJar || jar.isPyusdUpiJar
                                        ? `${deposited.toFixed(2)} / ${targetVal.toFixed(2)} PYUSD (${pct}%)`
                                        : `${deposited.toFixed(4)} / ${targetVal.toFixed(4)} tRBTC (${pct}%)`
                                    }
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
                                    {jar.contractAddress ? (
                                        <>
                                            {canTopUp && (
                                                <button onClick={() => depositTrbtc(jar, Number(jar.recurringTrbtc) || 0)} style={{ padding: '6px 12px', border: '1px solid #000', background: filled ? '#fff' : '#000', color: filled ? '#000' : '#fff', cursor: 'pointer' }}>Pay tRBTC</button>
                                            )}
                                            <button onClick={() => breakTrbtcJar(jar)} style={{ padding: '6px 12px', border: '1px solid #000', background: '#fff', color: '#000', cursor: 'pointer' }}>Break Jar</button>
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
                                <div style={{ fontSize: 13, marginBottom: 8 }}>Target: {(Number(jar.targetTrbtc) || 0).toFixed(4)} tRBTC</div>
                                {jar.contractAddress && (
                                    <div style={{ fontSize: 12, marginBottom: 8 }}>Contract: <span style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace' }}>{jar.contractAddress}</span></div>
                                )}
                                <div style={{ fontSize: 12, color: '#555' }}>Funds were returned to your wallet on break.</div>
                            </div>
                        ))}
                    </div>
                </section>
            )}

            {trbtcOpen && (
                <div onClick={() => setTrbtcOpen(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <div onClick={e => e.stopPropagation()} style={{ width: 600, background: '#fff', color: '#000', border: '1px solid #000', padding: 16 }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <h3 style={{ margin: 0 }}>Create tRBTC Jar</h3>
                            <button onClick={() => setTrbtcOpen(false)} style={{ border: '1px solid #000', background: '#fff', color: '#000', padding: '4px 8px', cursor: 'pointer' }}>Close</button>
                        </div>
                        <form onSubmit={(e) => { e.preventDefault(); onCreateTrbtcJar() }} style={{ marginTop: 12 }}>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                                <label style={{ display: 'grid', gap: 6 }}>
                                    <span>Jar name</span>
                                    <input value={trbtcName} onChange={e => setTrbtcName(e.target.value)} style={{ padding: '8px 10px', border: '1px solid #000', background: '#fff', color: '#000' }} />
                                </label>
                                <label style={{ display: 'grid', gap: 6 }}>
                                    <span>Target (tRBTC)</span>
                                    <input value={trbtcTarget} onChange={e => setTrbtcTarget(e.target.value)} type="number" min="0.001" step="0.001" style={{ padding: '8px 10px', border: '1px solid #000', background: '#fff', color: '#000' }} />
                                </label>
                                <label style={{ display: 'grid', gap: 6 }}>
                                    <span>Auto top-up (tRBTC)</span>
                                    <input value={trbtcTopup} onChange={e => setTrbtcTopup(e.target.value)} type="number" min="0.001" step="0.001" style={{ padding: '8px 10px', border: '1px solid #000', background: '#fff', color: '#000' }} />
                                </label>
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 12, marginTop: 12 }}>
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
                                <button type="button" onClick={() => setTrbtcOpen(false)} style={{ padding: '8px 14px', border: '1px solid #000', background: '#fff', color: '#000', cursor: 'pointer' }}>Cancel</button>
                                <button type="submit" disabled={creating} style={{ padding: '8px 14px', border: '1px solid #000', background: '#000', color: '#fff', cursor: creating ? 'not-allowed' : 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                                    {creating ? 'Creating...' : 'Create tRBTC Jar'}
                                    <img src="/rootstock_logo.png" alt="Rootstock" style={{ width: 18, height: 18, objectFit: 'contain' }} />
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {createOpen && (
                <div onClick={() => setCreateOpen(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <div onClick={e => e.stopPropagation()} style={{ width: 600, background: '#fff', color: '#000', border: '1px solid #000', padding: 16 }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <h3 style={{ margin: 0 }}>Create UPI Jar</h3>
                            <button onClick={() => setCreateOpen(false)} style={{ border: '1px solid #000', background: '#fff', color: '#000', padding: '4px 8px', cursor: 'pointer' }}>Close</button>
                        </div>
                        <form onSubmit={(e) => { e.preventDefault(); onCreate(e) }} style={{ marginTop: 12 }}>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                                <label style={{ display: 'grid', gap: 6 }}>
                                    <span>Jar name</span>
                                    <input value={name} onChange={e => setName(e.target.value)} style={{ padding: '8px 10px', border: '1px solid #000', background: '#fff', color: '#000' }} />
                                </label>
                                <label style={{ display: 'grid', gap: 6 }}>
                                    <span>Target (RBTC)</span>
                                    <input value={target} onChange={e => setTarget(e.target.value)} type="number" min="0.001" step="0.001" style={{ padding: '8px 10px', border: '1px solid #000', background: '#fff', color: '#000' }} />
                                </label>
                                <label style={{ display: 'grid', gap: 6 }}>
                                    <span>Auto top-up (INR)</span>
                                    <input value={Math.round(Number(recurring) * INR_PER_RBTC)} onChange={e => setRecurring(String(Number(e.target.value) / INR_PER_RBTC))} type="number" min="1" step="1" style={{ padding: '8px 10px', border: '1px solid #000', background: '#fff', color: '#000' }} />
                                </label>
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 12, marginTop: 12 }}>
                                <label style={{ display: 'grid', gap: 6 }}>
                                    <span>Recurring period</span>
                                    <select value={cadence} onChange={e => setCadence(e.target.value as 'daily' | 'weekly' | 'monthly')} style={{ padding: '8px 10px', border: '1px solid #000', background: '#fff', color: '#000' }}>
                                        <option value="daily">Daily</option>
                                        <option value="weekly">Weekly</option>
                                        <option value="monthly">Monthly</option>
                                    </select>
                                </label>
                            </div>
                            {etaText && (<div style={{ marginTop: 8, fontSize: 12, color: '#666' }}>{etaText}</div>)}
                            {formError && (<div style={{ marginTop: 8, color: '#cc0000', fontSize: 12 }}>{formError}</div>)}
                            <div style={{ marginTop: 12, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                                <button type="button" onClick={() => setCreateOpen(false)} style={{ padding: '8px 14px', border: '1px solid #000', background: '#fff', color: '#000', cursor: 'pointer' }}>Cancel</button>
                                <button type="submit" disabled={creating} style={{ padding: '8px 14px', border: '1px solid #000', background: '#000', color: '#fff', cursor: creating ? 'not-allowed' : 'pointer' }}>{creating ? 'Creating...' : 'Create UPI Jar'}</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {pyusdOpen && (
                <div onClick={() => setPyusdOpen(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <div onClick={e => e.stopPropagation()} style={{ width: 600, background: '#fff', color: '#000', border: '1px solid #000', padding: 16 }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <h3 style={{ margin: 0 }}>Create PYUSD Jar</h3>
                            <button onClick={() => setPyusdOpen(false)} style={{ border: '1px solid #000', background: '#fff', color: '#000', padding: '4px 8px', cursor: 'pointer' }}>Close</button>
                        </div>
                        <form onSubmit={(e) => { e.preventDefault(); onCreatePyusdJar() }} style={{ marginTop: 12 }}>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                                <label style={{ display: 'grid', gap: 6 }}>
                                    <span>Jar name</span>
                                    <input value={pyusdName} onChange={e => setPyusdName(e.target.value)} style={{ padding: '8px 10px', border: '1px solid #000', background: '#fff', color: '#000' }} />
                                </label>
                                <label style={{ display: 'grid', gap: 6 }}>
                                    <span>Target (PYUSD)</span>
                                    <input value={pyusdTarget} onChange={e => setPyusdTarget(e.target.value)} type="number" min="1" step="1" style={{ padding: '8px 10px', border: '1px solid #000', background: '#fff', color: '#000' }} />
                                </label>
                                <label style={{ display: 'grid', gap: 6 }}>
                                    <span>Auto top-up (PYUSD)</span>
                                    <input value={pyusdTopup} onChange={e => setPyusdTopup(e.target.value)} type="number" min="0.01" step="0.01" style={{ padding: '8px 10px', border: '1px solid #000', background: '#fff', color: '#000' }} />
                                </label>
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 12, marginTop: 12 }}>
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
                                <button type="button" onClick={() => setPyusdOpen(false)} style={{ padding: '8px 14px', border: '1px solid #000', background: '#fff', color: '#000', cursor: 'pointer' }}>Cancel</button>
                                <button type="submit" disabled={creating} style={{ padding: '8px 14px', border: '1px solid #000', background: '#000', color: '#fff', cursor: creating ? 'not-allowed' : 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                                    {creating ? 'Creating...' : 'Create PYUSD Jar'}
                                    <span style={{ fontSize: 12 }}>🔵</span>
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {pyusdUpiOpen && (
                <div onClick={() => setPyusdUpiOpen(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <div onClick={e => e.stopPropagation()} style={{ width: 600, background: '#fff', color: '#000', border: '1px solid #000', padding: 16 }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <h3 style={{ margin: 0 }}>Create UPI Jar (PYUSD)</h3>
                            <button onClick={() => setPyusdUpiOpen(false)} style={{ border: '1px solid #000', background: '#fff', color: '#000', padding: '4px 8px', cursor: 'pointer' }}>Close</button>
                        </div>
                        <form onSubmit={(e) => { e.preventDefault(); onCreatePyusdUpiJar() }} style={{ marginTop: 12 }}>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                                <label style={{ display: 'grid', gap: 6 }}>
                                    <span>Jar name</span>
                                    <input value={pyusdUpiName} onChange={e => setPyusdUpiName(e.target.value)} style={{ padding: '8px 10px', border: '1px solid #000', background: '#fff', color: '#000' }} />
                                </label>
                                <label style={{ display: 'grid', gap: 6 }}>
                                    <span>Target (PYUSD)</span>
                                    <input value={pyusdUpiTarget} onChange={e => setPyusdUpiTarget(e.target.value)} type="number" min="1" step="1" style={{ padding: '8px 10px', border: '1px solid #000', background: '#fff', color: '#000' }} />
                                </label>
                                <label style={{ display: 'grid', gap: 6 }}>
                                    <span>Auto top-up (INR)</span>
                                    <input value={pyusdUpiTopup} onChange={e => setPyusdUpiTopup(e.target.value)} type="number" min="84" step="84" style={{ padding: '8px 10px', border: '1px solid #000', background: '#fff', color: '#000' }} />
                                </label>
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 12, marginTop: 12 }}>
                                <label style={{ display: 'grid', gap: 6 }}>
                                    <span>Recurring period</span>
                                    <select value={cadence} onChange={e => setCadence(e.target.value as 'daily' | 'weekly' | 'monthly')} style={{ padding: '8px 10px', border: '1px solid #000', background: '#fff', color: '#000' }}>
                                        <option value="daily">Daily</option>
                                        <option value="weekly">Weekly</option>
                                        <option value="monthly">Monthly</option>
                                    </select>
                                </label>
                            </div>
                            <div style={{ marginTop: 8, fontSize: 12, color: '#666' }}>
                                ≈ {Math.round(Number(pyusdUpiTopup) / INR_PER_PYUSD * 100) / 100} PYUSD per {cadence.slice(0, -2)} payment
                            </div>
                            {formError && (<div style={{ marginTop: 8, color: '#cc0000', fontSize: 12 }}>{formError}</div>)}
                            <div style={{ marginTop: 12, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                                <button type="button" onClick={() => setPyusdUpiOpen(false)} style={{ padding: '8px 14px', border: '1px solid #000', background: '#fff', color: '#000', cursor: 'pointer' }}>Cancel</button>
                                <button type="submit" disabled={creating} style={{ padding: '8px 14px', border: '1px solid #000', background: '#000', color: '#fff', cursor: creating ? 'not-allowed' : 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                                    {creating ? 'Creating...' : 'Create UPI Jar'}
                                    <img src="/upi_logo_icon.png" alt="UPI" style={{ width: 18, height: 18, objectFit: 'contain' }} />
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {upiJarId && (() => {
                const jar = jars.find(j => j.id === upiJarId)
                const amtTrbtc = jar ? Number(jar.recurringTrbtc) || 0 : 0
                const filled = jar?.status === 'filled'
                const inrAmount = jar?.isPyusdJar || jar?.isPyusdUpiJar
                    ? Math.round(amtTrbtc * INR_PER_PYUSD)
                    : Math.round(amtTrbtc * INR_PER_RBTC)
                return (
                    <div onClick={closeUpi} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <div onClick={e => e.stopPropagation()} style={{ width: 360, background: filled ? '#000' : '#fff', color: filled ? '#fff' : '#000', border: '1px solid #000', padding: 16 }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                <h3 style={{ margin: 0 }}>Mock UPI Payment</h3>
                                <button onClick={closeUpi} style={{ border: '1px solid #000', background: filled ? '#000' : '#fff', color: filled ? '#fff' : '#000', padding: '4px 8px', cursor: 'pointer' }}>Close</button>
                            </div>
                            <div style={{ marginTop: 12 }}>Jar: <strong>{jar?.name}</strong></div>
                            <div style={{ marginTop: 8 }}>Amount: <strong>₹{inrAmount.toLocaleString()}</strong></div>
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
