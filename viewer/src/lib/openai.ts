export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

const API_URL = 'https://api.openai.com/v1/chat/completions'
const MODELS_URL = 'https://api.openai.com/v1/models'

/** Test that the API key is valid by making a lightweight request. */
export async function testConnection(apiKey: string): Promise<void> {
  const trimmed = apiKey?.trim()
  if (!trimmed) {
    throw new Error('Please enter your API key first.')
  }

  const res = await fetch(`${MODELS_URL}?limit=1`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${trimmed}`,
    },
  })

  if (!res.ok) {
    if (res.status === 401) {
      throw new Error('Invalid API key. Please check your key and try again.')
    }
    const errBody = await res.text()
    let errMsg: string
    try {
      const parsed = JSON.parse(errBody)
      errMsg = parsed.error?.message ?? errBody
    } catch {
      errMsg = errBody || res.statusText
    }
    throw new Error(errMsg || `Connection failed: ${res.status}`)
  }
}
const MODEL = 'gpt-4o-mini'

export async function chat(messages: ChatMessage[], apiKey: string): Promise<string> {
  if (!apiKey?.trim()) {
    throw new Error('API key is required. Please add your OpenAI API key in Settings.')
  }

  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey.trim()}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages,
      temperature: 0.7,
    }),
  })

  if (!res.ok) {
    const errBody = await res.text()
    let errMsg: string
    try {
      const parsed = JSON.parse(errBody)
      errMsg = parsed.error?.message ?? errBody
    } catch {
      errMsg = errBody || res.statusText
    }
    if (res.status === 401) {
      throw new Error('Invalid API key. Please check your OpenAI API key in Settings.')
    }
    if (res.status === 429) {
      throw new Error('Rate limit exceeded. Please try again later.')
    }
    throw new Error(errMsg || `OpenAI API error: ${res.status}`)
  }

  const data = await res.json()
  const content = data.choices?.[0]?.message?.content
  if (content == null) {
    throw new Error('No response from OpenAI.')
  }
  return content
}
