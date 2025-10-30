export const config = { runtime: 'edge' }

export default async function handler(req: Request) {
  const { prompt, width, height, wallColor } = await req.json()
  const w = Math.max(320, Math.min(Number(width)||900, 1600))
  const h = Math.max(240, Math.min(Number(height)||600, 1200))
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${wallColor || '#eaeaea'}" />
          <stop offset="100%" stop-color="#b3b3b3" />
        </linearGradient>
      </defs>
      <rect width="100%" height="100%" fill="url(#g)"/>
      <rect x="0" y="${Math.floor(h*0.72)}" width="100%" height="${Math.floor(h*0.28)}" fill="#5b4a3a"/>
      <text x="24" y="40" font-size="18" fill="#000" opacity="0.55">
        AI room (stub): ${(String(prompt||'')).slice(0,60)}
      </text>
    </svg>`
  return new Response(svg, { headers: { 'Content-Type': 'image/svg+xml' } })
}
