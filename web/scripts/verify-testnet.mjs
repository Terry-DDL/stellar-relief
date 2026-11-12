import { readFileSync } from 'node:fs'
import { verifyTestnet } from '../src/testnet.ts'

const evidence = JSON.parse(readFileSync(new URL('../src/evidence.json', import.meta.url)))
try {
  const result = await verifyTestnet(evidence)
  console.log(JSON.stringify(result, null, 2))
  if (result.mismatches.length > 0) process.exitCode = 1
} catch (error) {
  console.error(`Verification unavailable. ${error.message}`)
  process.exitCode = 1
}
