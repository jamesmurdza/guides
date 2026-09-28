/*
 * Copyright Daytona Platforms Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

const ESC = ''
const BOLD = ESC + '[1m'
const ITALIC = ESC + '[3m'
const DIM = ESC + '[2m'
const UNDERLINE = ESC + '[4m'
const CYAN = ESC + '[36m'
const RESET = ESC + '[0m'

/** Basic markdown to ANSI: **bold**, *italic*, `code`, [text](url) links */
export function renderMarkdown(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_match, label: string, url: string) =>
      // Goose often emits bare links as [url](url) - printing the URL twice reads oddly.
      label === url ? `${UNDERLINE}${CYAN}${url}${RESET}` : `${UNDERLINE}${CYAN}${label}${RESET} ${DIM}(${url})${RESET}`,
    )
    .replace(/\*\*(.+?)\*\*/g, `${BOLD}$1${RESET}`)
    .replace(/(?<!\*)\*([^*\n]+?)\*(?!\*)/g, `${ITALIC}$1${RESET}`)
    .replace(/`([^`]+?)`/g, `${DIM}$1${RESET}`)
}
