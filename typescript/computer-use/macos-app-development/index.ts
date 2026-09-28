/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import { Computer, MacOSSandbox } from 'use-computer-sdk'
import type { ExecResult } from 'use-computer-sdk'
import * as dotenv from 'dotenv'
import * as fs from 'fs'

dotenv.config()

const APP_NAME = 'CounterApp'
const BUNDLE_ID = 'com.example.counterapp'
const REMOTE_ROOT = `~/${APP_NAME}`

// Static XcodeGen spec. It wires up an app target and a hosted unit-test target
// (dependencies: [{ target: APP_NAME }] gives the test target TEST_HOST/bundle-loader
// settings automatically, so `@testable import CounterApp` resolves). Unlike the iOS
// version of this example, there's no simulator involved -- the app target builds a
// real macOS .app that runs directly on the sandbox's own desktop.
const PROJECT_YML = `name: ${APP_NAME}
options:
  bundleIdPrefix: com.example
  deploymentTarget:
    macOS: "13.0"
targets:
  ${APP_NAME}:
    type: application
    platform: macOS
    sources:
      - path: Sources
    settings:
      base:
        PRODUCT_BUNDLE_IDENTIFIER: ${BUNDLE_ID}
        CODE_SIGNING_ALLOWED: NO
        GENERATE_INFOPLIST_FILE: YES
        MARKETING_VERSION: "1.0"
        CURRENT_PROJECT_VERSION: "1"
        SWIFT_VERSION: "5.0"
        ENABLE_HARDENED_RUNTIME: NO
        COMBINE_HIDPI_IMAGES: YES
  ${APP_NAME}Tests:
    type: bundle.unit-test
    platform: macOS
    sources:
      - path: Tests
    dependencies:
      - target: ${APP_NAME}
    settings:
      base:
        CODE_SIGNING_ALLOWED: NO
        GENERATE_INFOPLIST_FILE: YES
        SWIFT_VERSION: "5.0"
schemes:
  ${APP_NAME}:
    build:
      targets:
        ${APP_NAME}: all
        ${APP_NAME}Tests: [test]
    test:
      targets:
        - ${APP_NAME}Tests
`

// Static app entry point. A plain WindowGroup scene is all a macOS app needs to get a
// normal, resizable window -- no AppKit boilerplate required.
const APP_ENTRY_SWIFT = `import SwiftUI

@main
struct ${APP_NAME}App: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}
`

// Static app source: a counter view whose count never goes below zero. The counting logic
// lives in a plain `Counter` struct (rather than only inside @State) so it can be exercised
// directly by the XCTest case below via @testable import, without any UI testing. This is the
// same SwiftUI view as the iOS example -- it renders identically on macOS with no changes.
const CONTENT_VIEW_SWIFT = `import SwiftUI

struct Counter {
    private(set) var value = 0

    mutating func increment() {
        value += 1
    }

    mutating func decrement() {
        if value > 0 {
            value -= 1
        }
    }
}

struct ContentView: View {
    @State private var counter = Counter()

    var body: some View {
        VStack(spacing: 24) {
            Text("\\(counter.value)")
                .font(.system(size: 64, weight: .bold))

            HStack(spacing: 40) {
                Button(action: { counter.decrement() }) {
                    Image(systemName: "minus.circle.fill")
                        .font(.system(size: 44))
                }
                .buttonStyle(.plain)

                Button(action: { counter.increment() }) {
                    Image(systemName: "plus.circle.fill")
                        .font(.system(size: 44))
                }
                .buttonStyle(.plain)
            }
        }
        .padding(60)
        .frame(minWidth: 360, minHeight: 240)
    }
}
`

// Static test source: exercises the Counter logic above.
const COUNTER_APP_TESTS_SWIFT = `import XCTest
@testable import ${APP_NAME}

final class ${APP_NAME}Tests: XCTestCase {
    func testIncrement() {
        var counter = Counter()
        counter.increment()
        XCTAssertEqual(counter.value, 1)
    }

    func testDecrementStopsAtZero() {
        var counter = Counter()
        counter.decrement()
        XCTAssertEqual(counter.value, 0)
    }

    func testIncrementThenDecrement() {
        var counter = Counter()
        counter.increment()
        counter.increment()
        counter.decrement()
        XCTAssertEqual(counter.value, 1)
    }
}
`

interface TestCaseResult {
  className: string
  method: string
  status: 'passed' | 'failed'
  seconds: number
}
interface TestSummary {
  succeeded: boolean
  executed: number
  failures: number
  unexpected: number
  seconds: number
  cases: TestCaseResult[]
}

// Parses raw `xcodebuild test` stdout into a pass/fail summary. Deliberately not using
// `xcresulttool`'s JSON output here -- its schema changed significantly between Xcode 15
// and 16, and the sandbox's exact Xcode version isn't pinned.
function parseTestOutput(output: string): TestSummary {
  const caseRegex = /Test Case '-\[(\S+)\.(\S+) (\S+)\]' (passed|failed) \(([\d.]+) seconds\)\./g
  // Keyed by class+method+status+seconds: if execSsh output repeats a command's tail (observed in
  // practice), this collapses exact duplicate lines without dropping a genuinely re-run test case.
  const caseMap = new Map<string, TestCaseResult>()
  let m: RegExpExecArray | null
  while ((m = caseRegex.exec(output)) !== null) {
    const [, , className, method, status, seconds] = m
    const testCase: TestCaseResult = { className, method, status: status as 'passed' | 'failed', seconds: Number(seconds) }
    caseMap.set(`${className}|${method}|${status}|${seconds}`, testCase)
  }
  const cases = [...caseMap.values()]

  // Use the *last* match for both: xcodebuild prints one "Executed ..." line per suite (per test
  // class, per bundle, then a final "All tests" aggregate) so the last one is the real total, and
  // execSsh output has been observed to occasionally repeat the whole tail of a command's output,
  // in which case the last copy is what actually matters. The summary format also varies across
  // Xcode versions -- some print "in 0.003 seconds", others "in 0.003 (0.005) seconds".
  const summaryMatches = [
    ...output.matchAll(/Executed (\d+) tests?, with (\d+) failures? \((\d+) unexpected\) in ([\d.]+)(?: \([\d.]+\))? seconds/g),
  ]
  const overallMatches = [...output.matchAll(/\*\* TEST (SUCCEEDED|FAILED) \*\*/g)]
  const summaryMatch = summaryMatches.at(-1)
  const overallMatch = overallMatches.at(-1)

  if (!summaryMatch || !overallMatch) {
    throw new Error(`Could not parse xcodebuild test output:\n${output.slice(-4000)}`)
  }

  const [, executed, failures, unexpected, seconds] = summaryMatch
  return {
    succeeded: overallMatch[1] === 'SUCCEEDED',
    executed: Number(executed),
    failures: Number(failures),
    unexpected: Number(unexpected),
    seconds: Number(seconds),
    cases,
  }
}

function printSummary(summary: TestSummary) {
  console.log('\nTest Results')
  console.log('============')
  for (const c of summary.cases) {
    console.log(`[${c.status === 'passed' ? 'PASS' : 'FAIL'}] ${c.className}.${c.method} (${c.seconds}s)`)
  }
  console.log('------------')
  console.log(
    `${summary.succeeded ? 'SUCCEEDED' : 'FAILED'}: executed ${summary.executed}, ${summary.failures} failures (${summary.unexpected} unexpected), ${summary.seconds}s`,
  )
}

// execSsh runs a non-login shell, so Homebrew's own PATH setup (normally sourced from
// /etc/zprofile on login) never runs -- put it on PATH ourselves so `brew` and anything
// it installs (like xcodegen) are found.
const REMOTE_PATH_PREFIX = 'export PATH="/opt/homebrew/bin:/opt/homebrew/sbin:$PATH"; '

// Runs a command over SSH, logging its output, and throws on failure unless `tolerate` says to
// ignore it. If `retryIf` matches the result, the command is re-run (up to `retries` times total)
// after a short delay before `tolerate`/failure are considered.
async function runRemote(
  mac: MacOSSandbox,
  command: string,
  opts: {
    tolerate?: (result: ExecResult) => boolean
    retryIf?: (result: ExecResult) => boolean
    retries?: number
    retryDelayMs?: number
  } = {},
): Promise<ExecResult> {
  const retries = opts.retries ?? 1
  const retryDelayMs = opts.retryDelayMs ?? 5000
  let result: ExecResult
  for (let attempt = 1; attempt <= retries; attempt++) {
    result = await mac.execSsh(REMOTE_PATH_PREFIX + command)
    if (result.stdout) console.log(result.stdout)
    if (result.stderr) console.error(result.stderr)
    if (attempt < retries && opts.retryIf?.(result)) {
      console.log(`Retrying (attempt ${attempt + 1}/${retries})...`)
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs))
      continue
    }
    break
  }
  if (result!.exitCode !== 0 && !opts.tolerate?.(result!)) {
    throw new Error(`Command failed (exit ${result!.exitCode}): ${command}`)
  }
  return result!
}

// Make sure you have the USE_COMPUTER_API_KEY and USE_COMPUTER_RESERVATION_ID environment variables set
const computer = new Computer()

// Set RECORD_SESSION=true to record the whole sandbox session and save it to recording.mp4
const RECORD_SESSION = /^(1|true|yes)$/i.test(process.env.RECORD_SESSION ?? '')

async function run() {
  // A reservation is billed for its full duration, so this script expects one to already exist
  // rather than creating (and re-billing) a new one on every run. See the README for how to reserve one.
  const reservationId = process.env.USE_COMPUTER_RESERVATION_ID
  if (!reservationId) {
    console.error('Error: USE_COMPUTER_RESERVATION_ID environment variable is not set')
    console.error('Reserve a Mac Mini (see README) and put its id in your .env file')
    process.exit(1)
  }

  console.log('Creating a macOS sandbox...')
  const mac = await computer.create({ type: 'macos', reservationId })
  console.log('Sandbox ready. Watch it live at:', mac.vncUrl)

  let recordingId: string | null = null
  if (RECORD_SESSION) {
    recordingId = await mac.recording.start()
    console.log('Recording started:', recordingId)
  }

  try {
    // Fail loudly and early if Xcode isn't on this image, rather than failing confusingly later
    await runRemote(mac, 'xcodebuild -version')

    // Upload the project scaffolding and app/test source into the sandbox
    console.log('Uploading project files...')
    await runRemote(mac, `mkdir -p ${REMOTE_ROOT}/Sources ${REMOTE_ROOT}/Tests`)
    await mac.upload(Buffer.from(PROJECT_YML), `${REMOTE_ROOT}/project.yml`)
    await mac.upload(Buffer.from(APP_ENTRY_SWIFT), `${REMOTE_ROOT}/Sources/${APP_NAME}App.swift`)
    await mac.upload(Buffer.from(CONTENT_VIEW_SWIFT), `${REMOTE_ROOT}/Sources/ContentView.swift`)
    await mac.upload(Buffer.from(COUNTER_APP_TESTS_SWIFT), `${REMOTE_ROOT}/Tests/${APP_NAME}Tests.swift`)

    // Generate the actual Xcode project from the spec
    console.log('Ensuring xcodegen is installed...')
    await runRemote(mac, 'command -v xcodegen >/dev/null 2>&1 || brew install xcodegen')
    console.log('Generating Xcode project...')
    await runRemote(mac, `cd ${REMOTE_ROOT} && xcodegen generate`)

    // Unlike the iOS version of this example, there's no simulator to pick or boot -- macOS apps
    // build straight to a native binary that runs directly on the sandbox's own desktop.
    const destination = 'platform=macOS'
    const appPath = `${REMOTE_ROOT}/build/Build/Products/Debug/${APP_NAME}.app`
    const buildOrTest = (action: 'build' | 'test', opts: { extraArgs?: string; tolerate?: (r: ExecResult) => boolean } = {}) =>
      runRemote(
        mac,
        `cd ${REMOTE_ROOT} && rm -rf TestResults.xcresult && xcodebuild -project ${APP_NAME}.xcodeproj -scheme ${APP_NAME} ` +
          `-configuration Debug -derivedDataPath build -destination '${destination}' ${opts.extraArgs ?? ''} ${action}`,
        { tolerate: opts.tolerate },
      )

    console.log('Building app...')
    await buildOrTest('build')

    // Launch it directly with `open` -- a macOS .app just runs, no install/simctl step needed.
    console.log('Launching app...')
    await runRemote(mac, `open ${appPath}`)

    // Give the UI a moment to settle, then capture a screenshot. xcodebuild test (below) proves
    // the app's *logic* is correct; this screenshot is what actually confirms the SwiftUI view
    // rendered as intended, for manual review.
    await new Promise((resolve) => setTimeout(resolve, 2000))

    console.log('Capturing screenshot...')
    const screenshot = await mac.screenshot.takeFullScreen()
    fs.writeFileSync('screenshot.png', screenshot)
    console.log('✓ Screenshot saved to screenshot.png')

    // Quit the app before testing: xcodebuild test does its own launch of the app as the test
    // host, and leaving the manually-launched copy above running conflicts with that.
    await runRemote(mac, `pkill -f "${appPath}"`, { tolerate: () => true })

    // Run the XCTest suite. No simulator boot is involved, so there's no destination-not-ready
    // flakiness to retry here the way the iOS version needs to.
    console.log('Running tests...')
    const testResult = await buildOrTest('test', {
      extraArgs: '-resultBundlePath TestResults.xcresult',
      tolerate: () => true, // xcodebuild exits non-zero when tests fail; we parse pass/fail ourselves below
    })

    // Archive and download the .xcresult bundle as a structured artifact alongside the printed summary
    console.log('Archiving test results...')
    await runRemote(mac, `cd ${REMOTE_ROOT} && zip -r TestResults.xcresult.zip TestResults.xcresult`)
    const xcresultZip = await mac.download(`${REMOTE_ROOT}/TestResults.xcresult.zip`)
    fs.writeFileSync('TestResults.xcresult.zip', xcresultZip)
    console.log('✓ Test results saved to TestResults.xcresult.zip')

    // Parse and print a clean pass/fail summary
    const summary = parseTestOutput(testResult.stdout)
    printSummary(summary)
    if (!summary.succeeded) process.exitCode = 1
  } catch (error) {
    console.error('Error executing example:', error)
    process.exitCode = 1
  } finally {
    // Stop the recording and download it, even if something above failed
    if (recordingId) {
      console.log('Stopping recording...')
      const recording = await mac.recording.stop(recordingId)
      const bytes = await mac.recording.download(recording.recordingId)
      fs.writeFileSync('recording.mp4', bytes)
      console.log('✓ Recording saved to recording.mp4')
    }

    // Always tear down the sandbox
    console.log('Closing sandbox...')
    await mac.close()
  }
}

run()
