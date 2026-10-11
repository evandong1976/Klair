import assert from 'node:assert/strict'
import { test } from 'node:test'
import { FLOWER_STYLES } from './flower'
import { guessType, MENUS, PROJECT_TYPES, topOptions, TYPE_META } from './options'
import { openTarget } from './open'

test('every type has a menu of 5 to 8 options, three of them standing and first', () => {
  for (const type of PROJECT_TYPES) {
    const menu = MENUS[type]
    assert.ok(menu.length >= 5 && menu.length <= 8, `${type}: ${menu.length} options`)
    assert.equal(new Set(menu.map((o) => o.id)).size, menu.length, `${type}: ids repeat`)
    assert.deepEqual(topOptions(type), menu.slice(0, 3), `${type}: standing options first`)
    for (const o of menu) {
      // Standing options must be runnable on any screen, and nothing may hold an em dash.
      if (o.top) assert.equal(o.needs, undefined, `${type}.${o.id}`)
      if (o.needs !== 'open' && o.needs !== 'explore') assert.ok(o.task, `${type}.${o.id}: task`)
      assert.ok(!/—/.test(`${o.title}${o.line}${o.when}${o.task}`), `${type}.${o.id}: em dash`)
    }
  }
})

test('each type has an 11 by 11 icon drawn in a flower palette', () => {
  for (const type of PROJECT_TYPES) {
    const { sprite, flower } = TYPE_META[type]
    assert.ok(FLOWER_STYLES[flower])
    assert.equal(sprite.length, 11)
    for (const row of sprite) assert.match(row, /^[.1-4]{11}$/, `${type}: "${row}"`)
  }
})

test('a project type is guessed from its name, then its brief, else work', () => {
  assert.equal(guessType('Klair development'), 'work')
  assert.equal(guessType('Machine Learning Study'), 'study')
  assert.equal(guessType('CS-UY 4563'), 'study')
  assert.equal(guessType('OS midterm'), 'study')
  assert.equal(guessType('Thesis research'), 'research')
  assert.equal(guessType('JEPA papers'), 'research')
  assert.equal(guessType('ML', 'The project is studying machine learning concepts.'), 'study')
  assert.equal(guessType('Reading', 'Surveying the literature on world models.'), 'research')
  assert.equal(guessType('SW', 'Building an Electron app in a code editor and terminal.'), 'work')
})

test('only a safe target the screen names can be opened', () => {
  const seen = 'Error: ANTHROPIC_API_KEY missing. Docker Desktop is not running.'
  assert.deepEqual(openTarget({ kind: 'url', target: 'https://console.anthropic.com/' }, seen), {
    kind: 'url',
    target: 'https://console.anthropic.com/',
    label: 'console.anthropic.com'
  })
  assert.equal(openTarget({ kind: 'app', target: 'Docker Desktop' }, seen)?.label, 'Docker Desktop')
  const refused = [
    { kind: 'url', target: 'http://console.anthropic.com/' }, // not https
    { kind: 'url', target: 'https://user:pw@console.anthropic.com/' }, // credentials
    { kind: 'url', target: 'file:///etc/passwd' },
    { kind: 'url', target: 'javascript:alert(1)' },
    { kind: 'url', target: 'https://example.org/anthropic' }, // a site the screen never names
    { kind: 'url', target: 'not a url' },
    { kind: 'app', target: '-a Terminal' }, // would read as a flag
    { kind: 'app', target: 'Docker; rm -rf ~' },
    { kind: 'app', target: 'Slack' }, // an app the screen never names
    { kind: 'none', target: '' },
    undefined
  ]
  for (const raw of refused) assert.equal(openTarget(raw, seen), null, JSON.stringify(raw))
})
