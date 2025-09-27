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

// Ethereum Sepolia testnet chain definition
export const sepoliaTestnet = {
    id: 11155111,
    name: 'Sepolia Testnet',
    nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
    rpcUrls: {
        default: { http: ['https://rpc.sepolia.org'] },
        public: { http: ['https://rpc.sepolia.org'] },
    },
    blockExplorers: {
        default: { name: 'Sepolia Etherscan', url: 'https://sepolia.etherscan.io' },
    },
} as const

export const config = createConfig({
    chains: [rootstockTestnet, sepoliaTestnet],
    transports: {
        [rootstockTestnet.id]: http('https://public-node.testnet.rsk.co'),
        [sepoliaTestnet.id]: http('https://rpc.sepolia.org'),
    },
    connectors: [injected()],
})

export const client = createClient({
    chain: rootstockTestnet,
    transport: http('https://public-node.testnet.rsk.co'),
})

export const sepoliaClient = createClient({
    chain: sepoliaTestnet,
    transport: http('https://rpc.sepolia.org'),
})
