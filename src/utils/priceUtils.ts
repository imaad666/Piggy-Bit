import { HermesClient } from '@pythnetwork/hermes-client'

// BTC/USD price feed ID from Pyth
const BTC_USD_FEED_ID = '0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43'

// Manual USD to INR conversion rate (you can update this or fetch from an API)
const USD_TO_INR_RATE = 83.5

export interface PriceData {
  btcUsd: number | null
  usdInr: number
  btcInr: number | null
  lastUpdated: Date | null
}

export async function fetchBtcPrice(): Promise<PriceData> {
  try {
    const client = new HermesClient('https://hermes.pyth.network', {})
    const update = await client.getLatestPriceUpdates([BTC_USD_FEED_ID], { parsed: true }) as any
    
    const parsed = Array.isArray(update.parsed) ? update.parsed : []
    const btcPrice = parsed[0]
    
    let btcUsd: number | null = null
    
    if (btcPrice?.price?.price && btcPrice?.price?.expo !== undefined) {
      const expo = Number(btcPrice.price.expo)
      const price = Number(btcPrice.price.price)
      btcUsd = expo === 0 ? price : price * Math.pow(10, expo)
    }
    
    const btcInr = btcUsd ? btcUsd * USD_TO_INR_RATE : null
    
    return {
      btcUsd,
      usdInr: USD_TO_INR_RATE,
      btcInr,
      lastUpdated: new Date()
    }
  } catch (error) {
    console.error('Failed to fetch BTC price:', error)
    return {
      btcUsd: null,
      usdInr: USD_TO_INR_RATE,
      btcInr: null,
      lastUpdated: null
    }
  }
}

// Calculate days to fill jar based on real-time BTC price
export function calculateDaysToFill(
  targetRbtc: number,
  autoTopupInr: number,
  cadence: 'daily' | 'weekly' | 'monthly',
  btcInrPrice: number
): { days: number; periods: number; inrAmount: number } {
  const targetInr = targetRbtc * btcInrPrice
  const periodsToFill = Math.ceil(targetInr / autoTopupInr)
  
  // Convert periods to days
  let days = periodsToFill
  if (cadence === 'weekly') {
    days = periodsToFill * 7
  } else if (cadence === 'monthly') {
    days = periodsToFill * 30
  }
  
  return {
    days,
    periods: periodsToFill,
    inrAmount: autoTopupInr
  }
}
