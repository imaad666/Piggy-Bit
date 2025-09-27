import { createContext, useContext, useState, ReactNode } from 'react'

export type NetworkType = 'rootstock' | 'sepolia'

interface NetworkContextType {
    selectedNetwork: NetworkType
    setSelectedNetwork: (network: NetworkType) => void
}

const NetworkContext = createContext<NetworkContextType | undefined>(undefined)

export function NetworkProvider({ children }: { children: ReactNode }) {
    const [selectedNetwork, setSelectedNetwork] = useState<NetworkType>('rootstock')

    return (
        <NetworkContext.Provider value={{ selectedNetwork, setSelectedNetwork }}>
            {children}
        </NetworkContext.Provider>
    )
}

export function useNetwork() {
    const context = useContext(NetworkContext)
    if (context === undefined) {
        throw new Error('useNetwork must be used within a NetworkProvider')
    }
    return context
}
