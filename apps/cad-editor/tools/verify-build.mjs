#!/usr/bin/env node
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { readFileSync, statSync } from 'node:fs'

const DEFAULT_MAX_MAIN_BYTES = 512 * 1024

const args = process.argv.slice(2)
const mainOnly = args.includes('--main-only')
const profileArg = args.find(arg => !arg.startsWith('--'))

if (!profileArg) {
  console.error(
    'usage: node tools/verify-build.mjs <verify-build.profile.json> [--main-only]'
  )
  process.exit(1)
}

const profilePath = isAbsolute(profileArg)
  ? profileArg
  : resolve(process.cwd(), profileArg)
const packageDir = dirname(profilePath)

let profile
try {
  profile = JSON.parse(readFileSync(profilePath, 'utf8'))
} catch {
  console.error(`verify-build: failed to read profile: ${profilePath}`)
  process.exit(1)
}

if (!profile.main || !profile.worker || !profile.forbiddenInMain?.length) {
  console.error(
    'verify-build: profile must define "main", "worker", and non-empty "forbiddenInMain"'
  )
  process.exit(1)
}

const profileName = basename(packageDir)
const mainBundle = join(packageDir, profile.main)
const workerBundle = join(packageDir, profile.worker)
const mainLabel = basename(profile.main)
const workerLabel = basename(profile.worker)
const maxMainBytes = profile.maxMainBytes ?? DEFAULT_MAX_MAIN_BYTES
const requiredInWorker = profile.requiredInWorker ?? profile.forbiddenInMain

function fail(message) {
  console.error(`verify-build (${profileName}): ${message}`)
  process.exit(1)
}

function readBundle(path) {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    fail(`missing build output: ${path}`)
  }
}

function assertMainBundle() {
  let size
  try {
    size = statSync(mainBundle).size
  } catch {
    fail(`missing main bundle: ${mainBundle}`)
  }

  if (size > maxMainBytes) {
    fail(
      `${mainLabel} is too large (${size} bytes > ${maxMainBytes} bytes); parser code may have been bundled into the main bundle`
    )
  }

  const content = readBundle(mainBundle)
  for (const marker of profile.forbiddenInMain) {
    if (content.includes(marker)) {
      fail(
        `${mainLabel} contains forbidden marker "${marker}"; parser code must stay in ${workerLabel}`
      )
    }
  }

  console.log(
    `verify-build (${profileName}): ${mainLabel} ok (${size} bytes, forbidden markers absent)`
  )
}

function assertWorkerBundle() {
  let size
  try {
    size = statSync(workerBundle).size
  } catch {
    fail(`missing worker bundle: ${workerBundle}`)
  }

  const content = readBundle(workerBundle)
  const hasRequiredMarker = requiredInWorker.some(marker =>
    content.includes(marker)
  )
  if (!hasRequiredMarker) {
    fail(
      `${workerLabel} is missing expected parser markers; the worker bundle may be broken`
    )
  }

  console.log(
    `verify-build (${profileName}): ${workerLabel} ok (${size} bytes, parser present)`
  )
}

assertMainBundle()
if (!mainOnly) {
  assertWorkerBundle()
}
