/**
 * Raw TLS + HTTP/2 connection test — bypasses wechaty-puppet-service entirely.
 * Tests if HTTP/2 over TLS to Caddy actually works.
 */
import { readFileSync } from 'fs'
import { connect } from 'http2'

const endpoint = process.argv[2] || 'nick-wechaty.agent-wx.app:443'
const host = endpoint.split(':')[0]!
const port = endpoint.split(':')[1] || '443'

console.log(`Connecting to ${endpoint} with TLS + HTTP/2...`)

const client = connect(`https://${host}:${port}`, {
  // Use system CA store (Node's default)
  rejectUnauthorized: true,
})

client.on('connect', () => {
  console.log('HTTP/2 connection established!')

  // Send a POST to the gRPC path (wechaty.Puppet/Ding)
  const req = client.request({
    ':method': 'POST',
    ':path': '/wechaty.Puppet/Start',
    'content-type': 'application/grpc',
    'te': 'trailers',
    'authorization': `Wechaty test_token`,
  })

  req.on('response', (headers) => {
    console.log('Response headers:', headers)
  })

  let data = Buffer.alloc(0)
  req.on('data', (chunk: Buffer) => {
    data = Buffer.concat([data, chunk])
  })

  req.on('end', () => {
    console.log('Response body length:', data.length)
    client.close()
  })

  req.on('error', (err) => {
    console.error('Request error:', err.message)
    client.close()
  })

  req.end()
})

client.on('error', (err) => {
  console.error('Connection error:', err.message)
})

setTimeout(() => {
  console.log('Timeout — closing')
  client.close()
  process.exit(1)
}, 10000)
