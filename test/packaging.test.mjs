import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs'
import assert from 'node:assert/strict'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

/**
 * Reading this repository's own `package.json` off disk would answer "what does
 * the file say", which is NOT the question an `exports` map decides. The map is
 * enforced by the resolver, against an INSTALLED package, and a `readFileSync`
 * assertion on it passes just as happily with the entry deleted.
 *
 * So these cases take a consumer's position: a scratch directory gets the
 * `node_modules` layout an install produces, this package is linked into it,
 * and a real `node` reads the specifier back the way a version-pinning CI step
 * would. What is under test is Node's resolution, not this file's opinion of it.
 */

const root = fileURLToPath(new URL('..', import.meta.url))
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

const consumer = mkdtempSync(path.join(tmpdir(), 'webpack-loader-consumer-'))
mkdirSync(path.join(consumer, 'node_modules', '@markup-carve'), { recursive: true })
symlinkSync(root, path.join(consumer, 'node_modules', '@markup-carve', 'webpack-loader'), 'dir')
process.on('exit', () => rmSync(consumer, { recursive: true, force: true }))

const run = (script) =>
  execFileSync('node', ['-e', script], {
    cwd: consumer,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()

const codeOf = (specifier) =>
  run(
    `import(${JSON.stringify(specifier)}).then(() => console.log('RESOLVED'),` +
      ` (e) => console.log(e.code ?? String(e)))`,
  )

test('reads the installed version back through the package specifier', () => {
  // The question a version-pinning CI step asks. Closed, it throws
  // ERR_PACKAGE_PATH_NOT_EXPORTED, which reads as "this package is not
  // installed" rather than "this subpath is closed" - so whoever hits it goes
  // and audits their install before they suspect a manifest.
  assert.equal(
    run(`console.log(require('@markup-carve/webpack-loader/package.json').version)`),
    pkg.version,
  )
})

test('reads it back under import as well as require', () => {
  // Both resolvers consult the same map, but only one of them is what a given
  // CI one-liner happens to use.
  assert.equal(
    run(
      `import('@markup-carve/webpack-loader/package.json', { with: { type: 'json' } })` +
        `.then((m) => console.log(m.default.version))`,
    ),
    pkg.version,
  )
})

test('opens that one file and not the directory holding it', () => {
  // This package declared `exports` as a bare string, which names the entry
  // point and closes every other subpath. Expanding it to a map to let the
  // version through must not go one step further and open the checkout: a
  // `./*` wildcard would publish the whole checkout as importable API, and
  // nothing else here would notice.
  for (const subpath of ['loader.cjs', 'package-lock.json', 'test/loader.test.mjs']) {
    assert.equal(
      codeOf(`@markup-carve/webpack-loader/${subpath}`),
      'ERR_PACKAGE_PATH_NOT_EXPORTED',
      subpath,
    )
  }
})

test('still resolves the entry point the map already named', () => {
  assert.equal(codeOf('@markup-carve/webpack-loader'), 'RESOLVED')
})
