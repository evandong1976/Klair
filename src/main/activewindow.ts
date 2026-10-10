import { execFile } from 'child_process'
import { promisify } from 'util'
import { config } from './config'

const run = promisify(execFile)

export interface ActiveWindow {
  appName: string | null
  windowTitle: string | null
  url: string | null
}

// Front app, window title and browser URL via AppleScript. Off unless
// KLAIR_ACTIVE_WINDOW=applescript (it needs Automation/Accessibility permission).
// Screenshots alone don't give reliable tab metadata, per the brief.
const SCRIPT = `
set frontApp to ""
set winTitle to ""
set u to ""
tell application "System Events"
  set frontApp to name of first application process whose frontmost is true
  try
    tell process frontApp to set winTitle to name of front window
  end try
end tell
try
  if frontApp is "Google Chrome" then tell application "Google Chrome" to set u to URL of active tab of front window
  if frontApp is "Safari" then tell application "Safari" to set u to URL of front document
  if frontApp is "Arc" then tell application "Arc" to set u to URL of active tab of front window
end try
return frontApp & linefeed & winTitle & linefeed & u
`

const EMPTY: ActiveWindow = { appName: null, windowTitle: null, url: null }

export async function activeWindow(): Promise<ActiveWindow> {
  if (!config.activeWindow || process.platform !== 'darwin') return EMPTY
  try {
    const { stdout } = await run('osascript', ['-e', SCRIPT], { timeout: 1500 })
    const [appName, windowTitle, url] = stdout.replace(/\n$/, '').split('\n')
    return { appName: appName || null, windowTitle: windowTitle || null, url: url || null }
  } catch {
    return EMPTY
  }
}
