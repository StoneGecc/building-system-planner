import { useState, useRef, useEffect } from 'react'
import type { SystemData } from '../types/system'
import type { BuildingDimensions } from '../types/system'
import { chat, testConnection, type ChatMessage } from '../lib/openai'
import { buildSystemPrompt } from '../lib/chatPrompts'
import { saveApiKey as saveEncryptedKey, loadApiKey } from '../lib/apiKeyStorage'

function tryParseApplyJson(text: string): SystemData[] | null {
  let raw: string | null = null
  const codeBlock = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (codeBlock) raw = codeBlock[1].trim()
  else {
    const braceStart = text.indexOf('{"action"')
    if (braceStart >= 0) {
      let depth = 0
      let end = braceStart
      for (let i = braceStart; i < text.length; i++) {
        if (text[i] === '{') depth++
        else if (text[i] === '}') { depth--; if (depth === 0) { end = i + 1; break } }
      }
      raw = text.slice(braceStart, end)
    }
  }
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    if (parsed?.action === 'apply' && Array.isArray(parsed?.data?.systems)) {
      return parsed.data.systems
    }
  } catch {
    // ignore
  }
  return null
}

interface ChatPanelProps {
  systems: SystemData[]
  buildingDimensions: BuildingDimensions
  onClose: () => void
  onProposedChanges: (systems: SystemData[]) => void
}

export function ChatPanel({
  systems,
  buildingDimensions,
  onClose,
  onProposedChanges,
}: ChatPanelProps) {
  const [apiKey, setApiKey] = useState('')
  const [showSettings, setShowSettings] = useState(false)
  const [keyLoaded, setKeyLoaded] = useState(false)
  const [testingConnection, setTestingConnection] = useState(false)
  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'success' | 'error'>('idle')
  const [connectionMessage, setConnectionMessage] = useState<string | null>(null)

  useEffect(() => {
    loadApiKey().then(key => {
      setApiKey(key)
      setKeyLoaded(true)
    })
  }, [])
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleSaveKey = async () => {
    const trimmed = apiKey.trim()
    if (!trimmed) return
    setError(null)
    setConnectionStatus('idle')
    try {
      await saveEncryptedKey(trimmed)
      setShowSettings(false)
    } catch (err) {
      console.error('Failed to save API key:', err)
      setError('Failed to save API key. Please try again.')
    }
  }

  const handleTestConnection = async () => {
    const trimmed = apiKey.trim()
    if (!trimmed) {
      setConnectionMessage('Please enter your API key first.')
      setConnectionStatus('error')
      return
    }
    setConnectionMessage(null)
    setConnectionStatus('idle')
    setTestingConnection(true)
    try {
      await testConnection(trimmed)
      setConnectionStatus('success')
      setConnectionMessage('Connection successful.')
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setConnectionMessage(msg)
      setConnectionStatus('error')
    } finally {
      setTestingConnection(false)
    }
  }

  const handleSend = async () => {
    const text = input.trim()
    if (!text || loading) return

    setInput('')
    setError(null)
    const userMsg: ChatMessage = { role: 'user', content: text }
    setMessages(prev => [...prev, userMsg])
    setLoading(true)

    try {
      const systemPrompt = buildSystemPrompt(systems, buildingDimensions)
      const chatMessages: ChatMessage[] = [
        { role: 'system', content: systemPrompt },
        ...messages,
        userMsg,
      ]

      const response = await chat(chatMessages, apiKey)

      const proposed = tryParseApplyJson(response)
      if (proposed && proposed.length > 0) {
        onProposedChanges(proposed)
        setMessages(prev => [
          ...prev,
          { role: 'assistant', content: 'I\'ve prepared the changes. Please review and confirm in the dialog.' },
        ])
      } else {
        setMessages(prev => [...prev, { role: 'assistant', content: response }])
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg)
      setMessages(prev => [
        ...prev,
        { role: 'assistant', content: `Error: ${msg}` },
      ])
    } finally {
      setLoading(false)
      inputRef.current?.focus()
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex">
      <div className="flex-1 bg-black/30" onClick={onClose} aria-hidden />
      <div
        className="flex flex-col w-[min(95vw,420px)] h-full bg-white shadow-2xl border-l border-border shrink-0"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
          <h2 className="font-mono text-base font-bold tracking-wider">
            AI Assistant
          </h2>
          <div className="flex items-center gap-2">
            <button
              onClick={() => { setShowSettings(s => !s); if (!showSettings) setConnectionMessage(null) }}
              className="inline-flex items-center gap-1.5 px-2 py-1.5 border border-border text-foreground bg-white font-mono text-[10px] tracking-widest uppercase hover:bg-muted transition-colors"
              title="API key settings"
            >
              {apiKey ? 'Connected' : 'Settings'}
            </button>
            <button
              onClick={onClose}
              className="inline-flex items-center justify-center w-8 h-8 border border-foreground text-foreground hover:bg-foreground hover:text-white transition-colors"
            >
              ×
            </button>
          </div>
        </div>

        {/* API Key Settings */}
        {showSettings && (
          <div className="px-4 py-3 border-b border-border bg-muted/20">
            <label className="block font-mono text-xs font-bold mb-1.5">OpenAI API Key</label>
            <input
              type="password"
              value={apiKey}
              onChange={e => { setApiKey(e.target.value); setConnectionMessage(null); setConnectionStatus('idle') }}
              placeholder={keyLoaded ? 'sk-...' : 'Loading...'}
              disabled={!keyLoaded}
              className="w-full px-3 py-2 font-mono text-xs border border-border bg-white focus:outline-none focus:ring-1 focus:ring-foreground disabled:opacity-60"
            />
            <div className="flex gap-2 mt-2">
              <button
                onClick={handleTestConnection}
                disabled={!keyLoaded || !apiKey.trim() || testingConnection}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-foreground text-foreground bg-white font-mono text-[10px] tracking-widest uppercase hover:bg-foreground hover:text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {testingConnection ? 'Testing...' : 'Test Connection'}
              </button>
              <button
                onClick={handleSaveKey}
                disabled={!keyLoaded || !apiKey.trim()}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-foreground text-foreground bg-white font-mono text-[10px] tracking-widest uppercase hover:bg-foreground hover:text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Save Key
              </button>
            </div>
            {connectionMessage && (
              <p className={`font-mono text-[10px] mt-2 ${connectionStatus === 'success' ? 'text-green-600' : 'text-red-600'}`}>
                {connectionMessage}
              </p>
            )}
            <p className="font-mono text-[10px] text-muted-foreground mt-1.5">
              Key is encrypted and stored locally. Do not share your key. For production use, use a backend proxy.
            </p>
          </div>
        )}

        {/* Messages */}
        <div className="flex-1 overflow-auto p-4 space-y-3">
          {messages.length === 0 && (
            <p className="font-mono text-xs text-muted-foreground">
              Ask questions about your building systems or request to add new systems, layers, or data.
            </p>
          )}
          {messages.map((m, i) => (
            <div
              key={i}
              className={`font-mono text-xs ${
                m.role === 'user'
                  ? 'ml-8 bg-foreground text-white p-3 rounded-l rounded-tr'
                  : 'mr-8 bg-muted/50 p-3 rounded-r rounded-tl'
              }`}
            >
              <div className="whitespace-pre-wrap break-words">{m.content}</div>
            </div>
          ))}
          {loading && (
            <div className="mr-8 bg-muted/50 p-3 rounded-r rounded-tl font-mono text-xs text-muted-foreground">
              Thinking...
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className="p-4 border-t border-border shrink-0">
          {error && (
            <p className="font-mono text-[10px] text-red-600 mb-2">{error}</p>
          )}
          <div className="flex gap-2">
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  handleSend()
                }
              }}
              placeholder="Ask about your data or request changes..."
              rows={2}
              disabled={loading || !apiKey}
              className="flex-1 min-w-0 px-3 py-2 font-mono text-xs border border-border bg-white focus:outline-none focus:ring-1 focus:ring-foreground resize-none"
            />
            <button
              onClick={handleSend}
              disabled={loading || !input.trim() || !apiKey}
              className="self-end px-3 py-2 border border-foreground text-foreground bg-white font-mono text-[10px] tracking-widest uppercase hover:bg-foreground hover:text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Send
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
