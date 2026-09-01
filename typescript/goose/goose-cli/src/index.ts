/*
 * Copyright Daytona Platforms Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import { Daytona, Sandbox } from '@daytona/sdk'
import * as dotenv from 'dotenv'
import * as readline from 'readline'
import { GooseSession } from './session.js'

dotenv.config()

async function main() {
  const apiKey = process.env.DAYTONA_API_KEY
  if (!apiKey) {
    console.error('Error: DAYTONA_API_KEY environment variable is not set')
    console.error('Create a .env file with your Daytona API key (see .env.example)')
    process.exit(1)
  }

  if (!process.env.SANDBOX_OPENAI_API_KEY) {
    console.error('Error: SANDBOX_OPENAI_API_KEY environment variable is not set')
    console.error('Get an OpenAI API key from https://platform.openai.com/api-keys')
    process.exit(1)
  }

  const daytona = new Daytona({ apiKey })

  let sandbox: Sandbox | undefined
  let session: GooseSession | undefined

  const cleanup = async (exitCode = 0) => {
    try {
      console.log('\nCleaning up...')
      if (session) await session.cleanup()
      if (sandbox) await sandbox.delete()
    } catch (e) {
      console.error('Error during cleanup:', e)
    } finally {
      process.exit(exitCode)
    }
  }

  try {
    // Inject the OpenAI key and a fixed provider/model at create time, since a fresh
    // sandbox has no `goose configure` history - without these, `goose run` would
    // fall back to an interactive setup wizard, which can't be answered headlessly.
    // GOOSE_MODE=auto approves tool calls automatically (otherwise each one would
    // block waiting for a confirmation we have no way to answer). GOOSE_DISABLE_KEYRING
    // avoids Goose trying to reach a desktop keyring service that doesn't exist in the
    // sandbox, falling back to file-based secret storage instead.
    console.log('Creating sandbox...')
    sandbox = await daytona.create({
      envVars: {
        OPENAI_API_KEY: process.env.SANDBOX_OPENAI_API_KEY,
        GOOSE_PROVIDER: 'openai',
        GOOSE_MODEL: 'gpt-4o',
        GOOSE_MODE: 'auto',
        GOOSE_DISABLE_KEYRING: '1',
      },
    })

    process.once('SIGINT', () => cleanup())

    console.log('Installing Goose CLI...')
    const install = await sandbox.process.executeCommand(
      'curl -fsSL https://github.com/block/goose/releases/download/stable/download_cli.sh | bash',
    )
    if (install.exitCode !== 0) {
      throw new Error('Error installing Goose CLI: ' + install.result)
    }

    console.log('Starting Goose CLI...\n')
    session = new GooseSession(sandbox)
    await session.initialize()

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    rl.once('SIGINT', () => cleanup())

    console.log('Agent ready. Press Ctrl+C at any time to exit.\n')

    while (true) {
      const prompt = await new Promise<string>((resolve) => rl.question('User: ', resolve))
      if (prompt.trim()) {
        await session.processPrompt(prompt)
      }
    }
  } catch (error) {
    console.error(error)
    await cleanup(1)
  }
}

main().catch(console.error)
