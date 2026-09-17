import http from 'node:http'
import handler from '../api/admin/users.ts'

const port = Number(process.env.LOCAL_ADMIN_PORT || 55401)
const server = http.createServer(async (request, response) => {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(Buffer.from(chunk))
  let body: unknown
  try { body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : undefined } catch { body = undefined }
  const end = response.end.bind(response)
  const res: any = response
  res.status = (code: number) => { response.statusCode = code; return res }
  res.json = (value: unknown) => { response.setHeader('content-type', 'application/json'); end(JSON.stringify(value)); return res }
  res.end = (value?: unknown) => { end(value as any); return res }
  await handler({ method: request.method, headers: { ...request.headers, host: request.headers['x-forwarded-host'] || request.headers.host, 'x-forwarded-proto': request.headers['x-forwarded-proto'] || 'http' }, body } as any, res)
})
server.listen(port, '127.0.0.1', () => console.log(`LOCAL_ADMIN_HTTP=http://127.0.0.1:${port}`))
