import { useEffect, useRef, useState } from 'react'

type ChatMsg = { role: 'user' | 'agent'; text: string }

export function AgentChat() {
    const [messages, setMessages] = useState<ChatMsg[]>([])
    const [input, setInput] = useState('')
    const [sending, setSending] = useState(false)
    const listRef = useRef<HTMLDivElement | null>(null)

    // Configure your hosted Agent endpoint here (Agentverse-hosted proxy or mailbox submit URL)
    const AGENT_ENDPOINT = (import.meta as any).env?.VITE_AGENT_ENDPOINT || '/agent/submit'

    useEffect(() => {
        if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight
    }, [messages])

    async function send() {
        const text = input.trim()
        if (!text || sending) return
        setSending(true)
        setMessages(prev => [...prev, { role: 'user', text }])
        setInput('')
        try {
            // Basic message envelope
            const payload = { text, wallet: (window as any)?.ethereum?.selectedAddress || null, chainId: (window as any)?.ethereum?.chainId || null }
            const res = await fetch(AGENT_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
            if (!res.ok) throw new Error(`Agent error ${res.status}`)
            const data = await res.json()

            // Display text reply if present
            if (typeof data?.text === 'string' && data.text.length > 0) {
                setMessages(prev => [...prev, { role: 'agent', text: data.text }])
            }

            // Handle action payloads
            if (data?.action?.type === 'CreateJarParams') {
                const p = data.action
                const open = (window as any)?.piggybit?.openCreateJarPrefill
                if (open) open({ name: p.name, targetUsd: Number(p.targetUsdc || p.target || 0), autoTopupInr: Number(p.autoTopupInr || 0), period: p.period || 'weekly' })
            } else if (data?.action?.type === 'CreateUsdcJarParams') {
                const p = data.action
                const open = (window as any)?.piggybit?.openCreateUsdcJarPrefill
                if (open) open({ name: p.name, targetUsdc: Number(p.targetUsdc || 0), autoTopupUsdc: Number(p.autoTopupUsdc || 0), period: p.period || 'weekly', token: p.token || undefined })
            }
        } catch (e: any) {
            setMessages(prev => [...prev, { role: 'agent', text: e?.message || 'Agent unreachable' }])
        } finally {
            setSending(false)
        }
    }

    return (
        <section style={{ marginTop: 32 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
                <img src="/asi-logo.png" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} alt="Artificial Superintelligence Alliance" style={{ width: 32, height: 32 }} />
                <h3 style={{ margin: 0 }}>Artificial Superintelligence Alliance</h3>
            </div>
            <div ref={listRef} style={{ border: '1px solid #000', background: '#fff', color: '#000', height: 220, padding: 12, overflowY: 'auto' }}>
                {messages.length === 0 ? (
                    <div style={{ color: '#666' }}>Ask me to plan a savings jar. Example: “Create a USDC jar for iPhone 17 Pro.”</div>
                ) : messages.map((m, i) => (
                    <div key={i} style={{ marginBottom: 8 }}>
                        <strong>{m.role === 'user' ? 'You' : 'Agent'}:</strong> {m.text}
                    </div>
                ))}
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <input value={input} onChange={e => setInput(e.target.value)} placeholder="Type your message" style={{ flex: 1, padding: '8px 10px', border: '1px solid #000', background: '#fff', color: '#000' }} />
                <button onClick={send} disabled={sending} style={{ padding: '8px 14px', border: '1px solid #000', background: '#000', color: '#fff', cursor: sending ? 'not-allowed' : 'pointer' }}>{sending ? 'sending' : 'Send'}</button>
            </div>
        </section>
    )
}


