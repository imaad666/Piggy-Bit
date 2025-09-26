import { useMemo } from 'react'
import { useAccount, useConnect, useDisconnect, useChainId, useSwitchChain } from 'wagmi'

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

export function Header() {
    const { connectors, connectAsync, status } = useConnect()
    const { isConnected, address } = useAccount()
    const { disconnect } = useDisconnect()
    const chainId = useChainId()
    const { switchChainAsync, isPending: isSwitching } = useSwitchChain()

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

    async function onSwitch() {
        try {
            await ensureRskTestnet()
            await switchChainAsync({ chainId: 31 })
        } catch { }
    }

    const needsSwitch = isConnected && chainId !== 31

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
                {needsSwitch && (
                    <button
                        onClick={onSwitch}
                        disabled={isSwitching}
                        style={{ padding: '8px 14px', border: '1px solid #000', background: '#fff', color: '#000', cursor: isSwitching ? 'not-allowed' : 'pointer' }}
                    >
                        {isSwitching ? 'Switching…' : 'Switch to Rootstock Testnet'}
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
