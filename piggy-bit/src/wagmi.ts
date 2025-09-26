import { createConfig, http } from 'wagmi'
import { createClient } from 'viem'
import { injected } from 'wagmi/connectors'

// Rootstock (RSK) testnet chain definition
export const rootstockTestnet = {
    id: 31,
    name: 'Rootstock Testnet',
    nativeCurrency: { name: 'tRBTC', symbol: 'tRBTC', decimals: 18 },
    rpcUrls: {
        default: { http: ['https://public-node.testnet.rsk.co'] },
        public: { http: ['https://public-node.testnet.rsk.co'] },
    },
    blockExplorers: {
        default: { name: 'RSK Testnet Explorer', url: 'https://explorer.testnet.rsk.co' },
    },
} as const

export const config = createConfig({
    chains: [rootstockTestnet],
    transports: {
        [rootstockTestnet.id]: http('https://public-node.testnet.rsk.co'),
    },
    connectors: [injected()],
})

export const client = createClient({
    chain: rootstockTestnet,
    transport: http('https://public-node.testnet.rsk.co'),
})
