import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

// A `github:` or `git+` specifier installs fine here and breaks a consumer:
// npm hands them a spec that needs git and a build step, and nothing else in
// the suite reads the declared form. It was reintroduced by #8.
const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

test('the declared engine is a registry version, not a git specifier', () => {
  const spec =
    manifest.dependencies?.['@markup-carve/carve'] ??
    manifest.devDependencies?.['@markup-carve/carve']

  assert.ok(spec, '@markup-carve/carve is not declared')
  assert.match(spec, /^[\^~]?\d+\.\d+\.\d+/)
})
