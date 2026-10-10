import assert from 'node:assert/strict'
import { test } from 'node:test'
import { accelFromEvent, isBindable, prettyAccel } from './keys'

const press = (code: string, mods: string[] = []): Parameters<typeof accelFromEvent>[0] => ({
  code,
  ctrlKey: mods.includes('ctrl'),
  altKey: mods.includes('alt'),
  shiftKey: mods.includes('shift'),
  metaKey: mods.includes('meta')
})

test('key presses become accelerators', () => {
  assert.equal(accelFromEvent(press('KeyK', ['ctrl', 'alt'])), 'Control+Alt+K')
  assert.equal(accelFromEvent(press('Space', ['meta', 'shift'])), 'Shift+Command+Space')
  assert.equal(accelFromEvent(press('F5')), 'F5')
  assert.equal(accelFromEvent(press('KeyK')), null) // bare letter
  assert.equal(accelFromEvent(press('KeyK', ['shift'])), null) // shift alone still types
  assert.equal(accelFromEvent(press('AltLeft', ['alt'])), null) // modifier on its own
})

test('accelerators are validated and displayed', () => {
  assert.equal(isBindable('Control+Alt+K'), true)
  assert.equal(isBindable('K'), false)
  assert.equal(isBindable('Bogus+K'), false)
  assert.equal(prettyAccel('Control+Alt+K'), '⌃⌥K')
  assert.equal(prettyAccel('Shift+Command+Return'), '⇧⌘↵')
})
