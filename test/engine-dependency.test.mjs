import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

// The guard runs at publish time only (release.yml). This file runs the real
// script on every PR so a broken guard is not first found during a release.
const guard = fileURLToPath(new URL('../scripts/no-git-dependencies.mjs', import.meta.url))
const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const release = readFileSync(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8')
const scratch = mkdtempSync(join(tmpdir(), 'webpack-loader-carve-guard-'))

let runs = 0
function runGuard(candidate, lock) {
  const dir = join(scratch, String(runs++))
  mkdirSync(dir)
  const path = join(dir, 'package.json')
  writeFileSync(path, JSON.stringify(candidate), 'utf8')
  if (lock) writeFileSync(join(dir, 'package-lock.json'), JSON.stringify(lock), 'utf8')
  const run = spawnSync(process.execPath, [guard, path], { encoding: 'utf8' })
  assert.equal(run.error, undefined)
  return run.status
}

const withEngine = (spec) => ({ ...manifest, dependencies: { ...manifest.dependencies, '@markup-carve/carve': spec } })

test('the guard refuses a git specifier for the engine', () => {
  assert.equal(runGuard(withEngine('github:markup-carve/carve-js#99ad0d2a4e5ec192440c3e5a1b4b95f50ed3cfcf')), 1)
  assert.equal(runGuard(withEngine('git+https://github.com/markup-carve/carve-js.git#99ad0d2')), 1)
  assert.equal(runGuard(withEngine('markup-carve/carve-js#99ad0d2')), 1)
})

test('the guard refuses a manifest without the engine', () => {
  const { '@markup-carve/carve': _, ...rest } = manifest.dependencies
  assert.equal(runGuard({ ...manifest, dependencies: rest }), 1)
})

test('the guard accepts a registry version for the engine', () => {
  assert.equal(runGuard(withEngine('^0.1.15')), 0)
  assert.equal(runGuard(withEngine('0.1.15')), 0)
})

const lockResolving = (resolved) => ({ packages: { 'node_modules/@markup-carve/carve': { resolved } } })

test('the guard refuses a lockfile that still resolves the engine over git', () => {
  const git = 'git+ssh://git@github.com/markup-carve/carve-js.git#99ad0d2a4e5ec192440c3e5a1b4b95f50ed3cfcf'
  assert.equal(runGuard(withEngine('^0.1.15'), lockResolving(git)), 1)
  assert.equal(runGuard(withEngine('^0.1.15'), lockResolving(undefined)), 1)
  const registry = 'https://registry.npmjs.org/@markup-carve/carve/-/carve-0.1.15.tgz'
  assert.equal(runGuard(withEngine('^0.1.15'), lockResolving(registry)), 0)
})

test('the committed manifest and lockfile get the verdict publish would give them', () => {
  const lock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'))
  const spec = manifest.dependencies?.['@markup-carve/carve'] ?? manifest.devDependencies?.['@markup-carve/carve']
  const resolved = lock.packages['node_modules/@markup-carve/carve']?.resolved ?? ''
  const registry = /^[\^~]?\d+\.\d+\.\d+/.test(spec ?? '') && resolved.startsWith('https://registry.npmjs.org/')
  assert.equal(runGuard(manifest, lock), registry ? 0 : 1)
})

test('release.yml runs the guard', () => {
  assert.match(release, /run: node scripts\/no-git-dependencies\.mjs/)
})
