export const config = { runtime: 'edge' }

export default async function handler(req: Request) {
  return new Response(JSON.stringify({ error: 'AI room generation is not available yet' }), {
    status: 501,
    headers: { 'Content-Type': 'application/json' },
  })
}
