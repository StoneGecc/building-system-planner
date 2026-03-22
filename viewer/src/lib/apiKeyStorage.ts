/**
 * Encrypt and store API key in localStorage using Web Crypto API.
 * Uses AES-GCM with a key derived from an app-specific salt.
 * Note: This protects against casual inspection of localStorage but is not
 * secure against someone with access to the source code.
 */

const STORAGE_KEY = 'building-system-openai-api-key'
const DERIVATION_PASSWORD = 'building-system-viewer-master-key-v1'
const PBKDF2_SALT = 'building-system-api-key-salt'
const PBKDF2_ITERATIONS = 100000

async function getEncryptionKey(): Promise<CryptoKey> {
  const encoder = new TextEncoder()
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(DERIVATION_PASSWORD),
    'PBKDF2',
    false,
    ['deriveBits', 'deriveKey']
  )
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: encoder.encode(PBKDF2_SALT),
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )
}

function generateIv(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(12))
}

export async function saveApiKey(plainKey: string): Promise<void> {
  const trimmed = plainKey.trim()
  if (!trimmed) {
    localStorage.removeItem(STORAGE_KEY)
    return
  }
  const key = await getEncryptionKey()
  const iv = generateIv()
  const plaintext = new TextEncoder().encode(trimmed)
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as unknown as BufferSource, tagLength: 128 },
    key,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    plaintext as unknown as BufferSource
  )
  const combined = new Uint8Array(iv.length + ciphertext.byteLength)
  combined.set(iv, 0)
  combined.set(new Uint8Array(ciphertext), iv.length)
  const base64 = btoa(String.fromCharCode(...combined))
  localStorage.setItem(STORAGE_KEY, base64)
}

export async function loadApiKey(): Promise<string> {
  const stored = localStorage.getItem(STORAGE_KEY)
  if (!stored) return ''
  try {
    // Migrate: if it looks like plain sk- key, encrypt and re-save
    if (stored.startsWith('sk-')) {
      await saveApiKey(stored)
      return stored
    }
    const binary = atob(stored)
    const combined = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) combined[i] = binary.charCodeAt(i)
    const key = await getEncryptionKey()
    const iv = combined.subarray(0, 12)
    const ciphertext = combined.subarray(12)
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv as unknown as BufferSource, tagLength: 128 },
      key,
      ciphertext as unknown as BufferSource
    )
    return new TextDecoder().decode(decrypted)
  } catch {
    return ''
  }
}

export { STORAGE_KEY }
