import { useMemo, useState, useEffect, useRef } from 'react'
import { useAccount, useConnect, useDisconnect, useChainId, useSwitchChain } from 'wagmi'
import { useNetwork } from '../NetworkContext'

async function ensureRskTestnet() {
    const eth = (window as any)?.ethereum
    if (!eth?.request) return
    try {
        await eth.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: '0x1f' }],
        })
        return
    } catch (e: any) {
        const needsAdd = e?.code === 4902 || /Unrecognized chain/i.test(e?.message || '')
        if (!needsAdd) throw e
        await eth.request({
            method: 'wallet_addEthereumChain',
            params: [
                {
                    chainId: '0x1f',
                    chainName: 'Rootstock Testnet',
                    nativeCurrency: { name: 'tRBTC', symbol: 'tRBTC', decimals: 18 },
                    rpcUrls: ['https://public-node.testnet.rsk.co', 'https://rpc.testnet.rootstock.io'],
                    blockExplorerUrls: ['https://explorer.testnet.rsk.co'],
                },
            ],
        })
        await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x1f' }] })
    }
}

async function ensureSepoliaTestnet() {
    const eth = (window as any)?.ethereum
    if (!eth?.request) return
    try {
        await eth.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: '0xaa36a7' }], // 11155111 in hex
        })
        return
    } catch (e: any) {
        const needsAdd = e?.code === 4902 || /Unrecognized chain/i.test(e?.message || '')
        if (!needsAdd) throw e
        await eth.request({
            method: 'wallet_addEthereumChain',
            params: [
                {
                    chainId: '0xaa36a7',
                    chainName: 'Sepolia',
                    nativeCurrency: { name: 'Sepolia Ether', symbol: 'ETH', decimals: 18 },
                    rpcUrls: ['https://rpc.sepolia.org'],
                    blockExplorerUrls: ['https://sepolia.etherscan.io'],
                },
            ],
        })
        await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0xaa36a7' }] })
    }
}

export function Header() {
    const { connectors, connectAsync, status } = useConnect()
    const { isConnected, address } = useAccount()
    const { disconnect } = useDisconnect()
    const chainId = useChainId()
    const { switchChainAsync, isPending: isSwitching } = useSwitchChain()
    const { selectedNetwork, setSelectedNetwork } = useNetwork()
    const [networkMenuOpen, setNetworkMenuOpen] = useState(false)
    const menuRef = useRef<HTMLDivElement>(null)

    // Close menu when clicking outside
    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
                setNetworkMenuOpen(false)
            }
        }
        document.addEventListener('mousedown', handleClickOutside)
        return () => document.removeEventListener('mousedown', handleClickOutside)
    }, [])

    const injected = useMemo(() => connectors.find(c => c.type === 'injected'), [connectors])

    async function onConnect() {
        if (!injected || status === 'pending') return
        try {
            await connectAsync({ connector: injected })
            await ensureRskTestnet()
            if (chainId !== 31) {
                try { await switchChainAsync({ chainId: 31 }) } catch { }
            }
        } catch (e) {
            // handled by parent error UI if needed
        }
    }

    async function onNetworkSelect(network: 'rootstock' | 'sepolia') {
        setSelectedNetwork(network)
        setNetworkMenuOpen(false)
        if (isConnected) {
            if (network === 'rootstock') {
                await ensureRskTestnet()
                if (chainId !== 31) {
                    try { await switchChainAsync({ chainId: 31 }) } catch { }
                }
            } else {
                await ensureSepoliaTestnet()
                if (chainId !== 11155111) {
                    try { await switchChainAsync({ chainId: 11155111 }) } catch { }
                }
            }
        }
    }

    const needsSwitch = isConnected && (
        (selectedNetwork === 'rootstock' && chainId !== 31) ||
        (selectedNetwork === 'sepolia' && chainId !== 11155111)
    )

    return (
        <header style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '16px 24px',
            borderBottom: '1px solid #000',
            background: '#fff',
            color: '#000',
            position: 'sticky',
            top: 0,
            zIndex: 10,
        }}>
            <div style={{
                fontFamily: 'ui-serif, Georgia, Cambria, "Times New Roman", Times, serif',
                fontSize: 24,
                letterSpacing: -0.3,
            }}>
                Piggy Bit
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {/* Network Selector */}
                <div ref={menuRef} style={{ position: 'relative' }}>
                    <button
                        onClick={() => setNetworkMenuOpen(!networkMenuOpen)}
                        style={{
                            padding: '8px 14px',
                            border: '1px solid #000',
                            background: '#f5f5f5',
                            color: '#000',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 6,
                        }}
                    >
                        Network: {selectedNetwork === 'rootstock' ? 'Rootstock' : 'Sepolia ETH'}
                        <span style={{ fontSize: 10 }}>▼</span>
                    </button>
                    {networkMenuOpen && (
                        <div style={{
                            position: 'absolute',
                            top: '100%',
                            right: 0,
                            background: '#fff',
                            border: '1px solid #000',
                            zIndex: 20,
                            minWidth: 150,
                        }}>
                            <button
                                onClick={() => onNetworkSelect('rootstock')}
                                style={{
                                    display: 'block',
                                    width: '100%',
                                    padding: '8px 12px',
                                    border: 'none',
                                    background: selectedNetwork === 'rootstock' ? '#f0f0f0' : '#fff',
                                    color: '#000',
                                    cursor: 'pointer',
                                    textAlign: 'left',
                                }}
                            >
                                🟠 Rootstock
                            </button>
                            <button
                                onClick={() => onNetworkSelect('sepolia')}
                                style={{
                                    display: 'block',
                                    width: '100%',
                                    padding: '8px 12px',
                                    border: 'none',
                                    background: selectedNetwork === 'sepolia' ? '#f0f0f0' : '#fff',
                                    color: '#000',
                                    cursor: 'pointer',
                                    textAlign: 'left',
                                }}
                            >
                                🔵 Sepolia ETH
                            </button>
                        </div>
                    )}
                </div>

                {needsSwitch && (
                    <button
                        onClick={() => onNetworkSelect(selectedNetwork)}
                        disabled={isSwitching}
                        style={{ padding: '8px 14px', border: '1px solid #000', background: '#fff', color: '#000', cursor: isSwitching ? 'not-allowed' : 'pointer' }}
                    >
                        {isSwitching ? 'Switching…' : `Switch to ${selectedNetwork === 'rootstock' ? 'Rootstock' : 'Sepolia'}`}
                    </button>
                )}
                {!isConnected ? (
                    <button
                        onClick={onConnect}
                        disabled={!injected || status === 'pending'}
                        style={{
                            padding: '8px 14px',
                            border: '1px solid #000',
                            background: '#fff',
                            color: '#000',
                            cursor: !injected || status === 'pending' ? 'not-allowed' : 'pointer',
                            opacity: !injected || status === 'pending' ? 0.6 : 1,
                        }}
                    >
                        {status === 'pending' ? 'Connecting…' : 'Connect Wallet'}
                    </button>
                ) : (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 12 }}>{address}</span>
                        <button
                            onClick={() => disconnect()}
                            style={{
                                padding: '6px 10px',
                                border: '1px solid #000',
                                background: '#000',
                                color: '#fff',
                                cursor: 'pointer',
                            }}
                        >
                            Disconnect
                        </button>
                    </div>
                )}
            </div>
        </header>
    )
}
