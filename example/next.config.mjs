import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const loader = path.resolve(here, '..', 'loader.cjs')

export default {
  webpack(config) {
    config.module.rules.push({ test: /\.crv$/, use: [{ loader }] })
    return config
  },
}
