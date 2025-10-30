// Pluggable AI provider: local mock + selector
export type GenSize = { width: number; height: number }

export interface AiImageProvider {
  name: string
  generateBackground(opts: {
    prompt: string
    seed?: number
    size: GenSize
    wallColor?: string
  }): Promise<string>
}

// simple seeded rng + hash
function sfc32(a: number, b: number, c: number, d: number) {
  return function () {
    a |= 0; b |= 0; c |= 0; d |= 0
    let t = (a + b | 0) + d | 0
    d = d + 1 | 0
    a = b ^ b >>> 9
    b = c + (c << 3) | 0
    c = (c << 21 | c >>> 11)
    c = c + t | 0
    return (t >>> 0) / 4294967296
  }
}
function hashSeed(str: string) {
  let h1 = 0x9e3779b9, h2 = 0x85ebca6b, h3 = 0xc2b2ae35, h4 = 0x27d4eb2f
  for (let i = 0; i < str.length; i++) {
    const k = str.charCodeAt(i)
    h1 = (h2 ^ (h1 ^ k) * 2654435761) >>> 0
    h2 = (h3 ^ (h2 ^ k) * 2246822519) >>> 0
    h3 = (h4 ^ (h3 ^ k) * 3266489917) >>> 0
    h4 = (h1 ^ (h4 ^ k) * 668265263) >>> 0
  }
  return [h1, h2, h3, h4]
}

export class LocalMockProvider implements AiImageProvider {
  name = 'local-mock'
  async generateBackground({ prompt, seed, size, wallColor }: {
    prompt: string; seed?: number; size: GenSize; wallColor?: string
  }): Promise<string> {
    const canvas = document.createElement('canvas')
    canvas.width = size.width
    canvas.height = size.height
    const ctx = canvas.getContext('2d')!
    const [a,b,c,d] = hashSeed(String(seed ?? 0xA11CE) + ':' + prompt)
    const rnd = sfc32(a,b,c,d)

    const wall = wallColor || `hsl(${Math.floor(rnd()*360)}, 20%, ${60+Math.floor(rnd()*10)}%)`
    const floor = `hsl(${Math.floor(rnd()*360)}, 25%, 30%)`

    ctx.fillStyle = wall
    ctx.fillRect(0,0,canvas.width,canvas.height)
    const grad = ctx.createRadialGradient(canvas.width*0.6, canvas.height*0.35, 50, canvas.width*0.6, canvas.height*0.35, canvas.width)
    grad.addColorStop(0, 'rgba(255,255,255,0.15)')
    grad.addColorStop(1, 'rgba(0,0,0,0.25)')
    ctx.fillStyle = grad
    ctx.fillRect(0,0,canvas.width,canvas.height)

    const floorH = Math.floor(canvas.height*0.28)
    ctx.fillStyle = floor
    ctx.fillRect(0, canvas.height-floorH, canvas.width, floorH)

    ctx.strokeStyle = 'rgba(255,255,255,0.12)'
    ctx.lineWidth = 1
    for (let x = 0; x < canvas.width; x += 40 + Math.floor(rnd()*30)) {
      ctx.beginPath(); ctx.moveTo(x, canvas.height-floorH); ctx.lineTo(x, canvas.height); ctx.stroke()
    }

    return canvas.toDataURL('image/png')
  }
}

let provider: AiImageProvider = new LocalMockProvider()
export function setAiProvider(p: AiImageProvider) { provider = p }
export function getAiProvider() { return provider }
