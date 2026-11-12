import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { runInNewContext } from 'node:vm'

test('the production worker precaches the shell, serves offline navigation and bypasses RPC', async () => {
  const origin = 'https://stellar-relief.test'
  const scope = `${origin}/demo/`
  const html = readFileSync(new URL('../dist/index.html', import.meta.url), 'utf8')
  const assets = [...html.matchAll(/(?:src|href)="\/?(assets\/[^"]+)"/g)].map((match) => match[1])
  assert.ok(assets.length > 0)
  const worker = readFileSync(new URL('../dist/sw.js', import.meta.url), 'utf8')
  const handlers = new Map()
  const old = `stellar-relief:${scope}:old`
  const unrelated = `stellar-relief:${origin}/other/:other`
  const stores = new Map([[old, new Map()], [unrelated, new Map()]])
  let connected = true
  let claimed = false
  const fetch = async (url) => {
    if (!connected) throw new Error('network offline')
    const path = new URL(url).pathname.slice('/demo/'.length)
    return readFileSync(new URL(`../dist/${path}`, import.meta.url), 'utf8')
  }
  runInNewContext(worker, {
    URL, Request,
    self: {
      registration: { scope }, location: { origin },
      addEventListener: (name, handler) => handlers.set(name, handler),
      clients: { claim: async () => { claimed = true } },
    },
    caches: {
      async open(name) {
        if (!stores.has(name)) stores.set(name, new Map())
        const entries = stores.get(name)
        return {
          async addAll(requests) {
            for (const request of requests) {
              assert.equal(request.cache, 'reload')
              entries.set(request.url, await fetch(request.url))
            }
          },
          async match(url) { return entries.get(url) },
        }
      },
      keys: async () => [...stores.keys()],
      delete: async (name) => stores.delete(name),
    },
    fetch,
  })
  const event = (name, request) => {
    let result
    const capture = (promise) => { result = promise }
    handlers.get(name)({ request, waitUntil: capture, respondWith: capture })
    return result
  }
  await event('install')
  await event('activate')
  assert.equal(claimed, true)
  assert.equal(stores.has(old), false)
  assert.equal(stores.has(unrelated), true)
  connected = false
  assert.equal(await event('fetch', { method: 'GET', mode: 'navigate', url: scope + '#shop' }), html)
  for (const asset of assets) {
    assert.ok(await event('fetch', { method: 'GET', url: scope + asset }))
  }
  assert.equal(event('fetch', { method: 'POST', url: scope }), undefined)
  assert.equal(event('fetch', { method: 'GET', url: 'https://soroban-testnet.stellar.org' }), undefined)
})
