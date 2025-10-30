import type { AiImageProvider } from './provider'

function blobToDataURL(blob: Blob): Promise<string> {
  return new Promise((res) => {
    const r = new FileReader()
    r.onload = () => res(String(r.result))
    r.readAsDataURL(blob)
  })
}

export class RemoteProvider implements AiImageProvider {
  name = 'remote'
  async generateBackground({ prompt, size, wallColor }: {
    prompt: string; size: { width: number; height: number }; wallColor?: string
  }): Promise<string> {
    const res = await fetch('/api/ai/generate-room', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, width: size.width, height: size.height, wallColor }),
    })
    if (!res.ok) throw new Error(`Remote provider failed: ${res.status}`)
    const blob = await res.blob()
    return await blobToDataURL(blob)
  }
}
