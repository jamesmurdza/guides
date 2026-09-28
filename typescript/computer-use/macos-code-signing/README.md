# macOS Code Signing (use.computer)

## Overview

This example demonstrates how to generate a real Xcode project on a macOS sandbox, sign it with your own Apple Developer Program credentials, and export a signed `.app` you can download to your machine. It uses [use.computer](https://use.computer) to provision a macOS sandbox.

In this example, the script uploads the hardcoded Swift source for a small counter app, turns it into a real Xcode project with [XcodeGen](https://github.com/yonaskolb/XcodeGen), archives and signs it for macOS using an **App Store Connect API key**, exports a signed `.app`, and downloads it to your machine as a zip.

This is the macOS counterpart to the [iOS code signing example](../ios-code-signing) — same pipeline, but targeting the Mac itself instead of a device/simulator, so there's no provisioned-device requirement anywhere in the flow.

## Features

- **Real macOS sandbox:** Created on your use.computer reservation, torn down when the script finishes
- **Real Xcode project:** [XcodeGen](https://github.com/yonaskolb/XcodeGen) turns hardcoded Swift source into an actual `.xcodeproj`
- **Non-interactive code signing:** Signs with an App Store Connect API key — no Apple ID login, no 2FA, fully scriptable
- **Signed artifact:** The exported, signed `.app` is zipped and downloaded to your machine, and its signature is verified in the sandbox before download
- **No LLM, no agent loop:** Every file uploaded to the sandbox is a hardcoded string in `index.ts` — one script, one signing pipeline, nothing more

## Prerequisites

- **Node.js:** Version 18 or higher is required
- **npm:** Included with Node.js installation
- **Apple Developer Program membership:** App Store Connect API keys require a paid membership — a free Apple ID account cannot generate one
- **Passwordless `sudo` on the sandbox:** The archive/export steps run via `launchctl asuser` (see [How It Works](#how-it-works)), which needs `sudo`. This is already the case on the standard use.computer Mac Mini image

## Environment Variables

To run this example, you need to set the following environment variables:

- `USE_COMPUTER_API_KEY`: Required to control macOS sandboxes. Get it from [use.computer](https://use.computer)
- `USE_COMPUTER_RESERVATION_ID`: Required. The id of an active Mac Mini reservation to create the sandbox on — reserve one from the [use.computer dashboard](https://use.computer) (see [Reserving a Mac Mini](#reserving-a-mac-mini) below)
- `APPLE_TEAM_ID`: Required. Your Apple Developer Program Team ID (see [Getting your Apple credentials](#getting-your-apple-credentials) below)
- `APPLE_BUNDLE_ID`: Required. The bundle identifier to sign the app as, e.g. `com.yourteam.SignDemoMac`
- `APPLE_API_KEY_ID`: Required. The Key ID of your App Store Connect API key
- `APPLE_API_ISSUER_ID`: Required. The Issuer ID shown on the App Store Connect API Keys page
- `APPLE_API_KEY_PATH`: Required. Local path to the downloaded `AuthKey_<APPLE_API_KEY_ID>.p8` file. **Never commit this file** — it's already excluded via `.gitignore`
- `APPLE_EXPORT_METHOD`: Optional. `development` (default) or `developer-id` — see [Export method](#export-method) below

Create a `.env` file in the project directory with these variables (see `.env.example`).

## Getting Started

### Reserving a Mac Mini

macOS sandboxes run on dedicated Mac Minis reserved through use.computer — reservations run 24 hours or more, billed for the full duration regardless of how many sandboxes you create with it, and each Mac can host up to 2 macOS sandboxes at once. This script expects a reservation to already exist rather than creating (and re-billing) a new one on every run.

1. Sign up at [use.computer](https://use.computer) and grab your API key from **Settings**.
2. From the [use.computer dashboard](https://use.computer), reserve a Mac Mini and copy its reservation id.
3. Put both values in your `.env` file as `USE_COMPUTER_API_KEY` and `USE_COMPUTER_RESERVATION_ID`.

Reserving is also possible directly from code instead of the dashboard — see the [use.computer Quick Start](https://docs.use.computer/docs/quickstart) for the SDK call and reservation options.

### Getting your Apple credentials

1. **Team ID:** Sign in to the [Apple Developer portal](https://developer.apple.com/account) → **Membership** → copy your **Team ID** (a 10-character alphanumeric string).
2. **App Store Connect API key:** Sign in to [App Store Connect](https://appstoreconnect.apple.com/) → **Users and Access** → **Integrations** → **App Store Connect API** → generate a new key with **Developer** (or higher) access.
   - Apple lets you download the `.p8` private key file **exactly once** — save it somewhere safe outside the repo.
   - Note the **Key ID** and **Issuer ID** shown on that page.
3. Put the Team ID, Key ID, Issuer ID, and the local path to the `.p8` file into your `.env` file as `APPLE_TEAM_ID`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER_ID`, and `APPLE_API_KEY_PATH`.
4. Pick a bundle identifier you're free to use under your team (e.g. `com.yourteam.SignDemoMac`) and set it as `APPLE_BUNDLE_ID`. With automatic signing and `-allowProvisioningUpdates`, Xcode will register it for you if it doesn't already exist.

### Setup and Run

1. Install dependencies:

   ```bash
   npm install
   ```

2. Run the example:

   ```bash
   npm run start
   ```

## How It Works

1. A macOS sandbox is created on your existing reservation via `use-computer-sdk`
2. The hardcoded project files — an XcodeGen `project.yml` spec, the `@main` app entry file, and `ContentView.swift` — are uploaded to the sandbox
3. A prebuilt [XcodeGen](https://github.com/yonaskolb/XcodeGen) release binary is downloaded directly from GitHub — the sandbox image has Xcode but not Homebrew, so this avoids a `brew install` dependency
4. `xcodegen generate` turns the uploaded files into a real `.xcodeproj`, with the target's `platform` set to `macOS` (the iOS example uses `iOS`)
5. The App Store Connect API key (`.p8`) is uploaded to the sandbox — this is what lets `xcodebuild` sign non-interactively
6. `xcodebuild archive` builds the app for the Mac itself (`-destination 'generic/platform=macOS'` — the macOS equivalent of the iOS example's `-sdk iphoneos`) with automatic signing, using `-allowProvisioningUpdates` plus the API key so Xcode fetches or creates the needed certificate (and, for a `development` export, provisioning profile) from Apple on the fly. The command runs via `launchctl asuser` rather than directly over SSH — SSH sessions live in a separate macOS security session from the sandbox's console/GUI login, so a plain SSH command can't reach the unlocked login keychain and fails with "User interaction is not allowed"; `launchctl asuser` re-binds the command into that GUI session
7. `xcodebuild -exportArchive` exports a signed `.app` from the archive, using the same API key and the same `launchctl asuser` wrapping. Unlike an iOS export (which produces a zipped `.ipa`), a macOS export produces the `.app` bundle directly
8. The signature is verified in the sandbox with `codesign --display --verbose=4` and printed, so you can see the signing identity and team before downloading anything
9. The `.app` is zipped with `ditto` (Apple's recommended way to archive a bundle, since it preserves resource forks and extended attributes that a plain `zip` can drop) and downloaded to your machine as `SignDemoMac.app.zip`
10. The sandbox is closed

## Configuration

### App Customization

The app's source is hardcoded in `index.ts` as the `CONTENT_VIEW_SWIFT` constant:

```typescript
const CONTENT_VIEW_SWIFT = `import SwiftUI

struct ContentView: View {
    @State private var count = 0
    ...
}
`
```

Edit this string directly to change the app — it's uploaded to the sandbox verbatim as `ContentView.swift`. The same applies to `PROJECT_YML` (the XcodeGen spec) and `APP_ENTRY_SWIFT` (the `@main` entry point) if you need more targets, sources, or capabilities.

### Export method

Set via `APPLE_EXPORT_METHOD` in `.env`:

- `development` (default): signs with a development certificate/profile, the same style the iOS example uses. Works with any Apple Developer Program team and produces a signed `.app` with no further setup.
- `developer-id`: signs with a Developer ID Application certificate — the identity macOS apps distributed outside the Mac App Store normally use. `ENABLE_HARDENED_RUNTIME` is already turned on in `PROJECT_YML` for this reason. Xcode's automatic signing will fetch or create this certificate the same way it does for `development`, no registered devices required.

### Notarization is not included

Neither export method notarizes the app. A `developer-id`-signed `.app` downloaded from this script will still be quarantined and blocked by Gatekeeper on a fresh Mac until it's notarized (`xcrun notarytool submit` + `xcrun stapler staple`) — that's a separate, longer-running step this example intentionally leaves out to keep the script focused on the signing pipeline. See [Apple's notarization guide](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution) if you want to add it.

For local testing without notarizing, you can clear the quarantine flag after unzipping:

```bash
ditto -xk SignDemoMac.app.zip .
xattr -cr SignDemoMac.app
open SignDemoMac.app
```

## Example Output

When the script completes, you'll see output similar to:

```
Creating a macOS sandbox...
Sandbox ready. Watch it live at: https://api.use.computer/vnc?sandbox=sb-59278e445d893dcb2a4510e62b3b0e6b&token=***
Uploading project files...
Installing xcodegen...
Generating Xcode project with xcodegen...
Created project at /tmp/SignDemoMac/SignDemoMac.xcodeproj
Uploading App Store Connect API key...
Archiving and signing (this can take a minute)...
** ARCHIVE SUCCEEDED **
Exporting signed .app...
** EXPORT SUCCEEDED **
Verifying code signature...
Executable=/private/tmp/SignDemoMac/build/export/SignDemoMac.app/Contents/MacOS/SignDemoMac
Identifier=com.yourteam.SignDemoMac
Authority=Apple Development: Created via API (ABCDE12345)
Authority=Apple Worldwide Developer Relations Certification Authority
Authority=Apple Root CA
TeamIdentifier=ABCDE12345
Compressing signed .app for download...
Downloading signed .app...
✓ Signed app saved to SignDemoMac.app.zip
```

`SignDemoMac.app.zip` contains a real, signed build — inspect it with `codesign --display --verbose=4 SignDemoMac.app` locally after unzipping, or run it directly on a Mac (see [Notarization](#notarization-is-not-included) above for the quarantine caveat).

## License

See the main project LICENSE file for details.

## References

- [use.computer Documentation](https://docs.use.computer)
- [use.computer Quick Start](https://docs.use.computer/docs/quickstart)
- [XcodeGen](https://github.com/yonaskolb/XcodeGen)
- [Apple: Distributing your app using the App Store Connect API](https://developer.apple.com/documentation/appstoreconnectapi)
- [Apple: Notarizing macOS software before distribution](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution)
