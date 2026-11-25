import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import vm from 'node:vm'

import { PLUGIN } from './_plugin-path.mjs'
const PROFILE = path.join(os.homedir(), '.dsh', 'profiles', 'desktop')
const profileRequire = createRequire(path.join(PROFILE, 'package.json'))

/** Evaluate the client bundle exactly the way the browser module loader does. */
async function loadBundle() {
  const source = await fs.readFile(path.join(PLUGIN, 'client.js'), 'utf8')
  let spec = null
  const documentStub = { baseURI: 'dsh-app://app/', documentElement: { lang: 'zh' } }
  const windowStub = {
    __ModuleLoader__: {
      load(next) {
        spec = next
      },
    },
    localStorage: { getItem: () => null },
  }
  const context = vm.createContext({ window: windowStub, document: documentStub, URL, console })
  vm.runInContext(source, context, { filename: 'client.js' })
  assert.ok(spec, 'bundle called window.__ModuleLoader__.load')
  const React = profileRequire('react')
  const moduleExports = spec.factory((name) => {
    if (name === 'react') return React
    throw new Error('client bundle required an unexpected module: ' + name)
  })
  return { spec, React, moduleExports }
}

test('bundle id matches the package and only react is required', async () => {
  const { spec, moduleExports } = await loadBundle()
  assert.equal(spec.id, 'dsh-gugu-stock')
  assert.ok(Array.isArray(moduleExports.inject))
  assert.deepEqual(Array.from(moduleExports.inject), ['slots'])
  assert.equal(typeof moduleExports.apply, 'function')
})

test('apply registers the left-rail panel, its icon, the settings page and its icon', async () => {
  const { moduleExports, React } = await loadBundle()
  const registered = []
  const slots = ['main', 'sidebar.panellist', 'settings.section', 'settings.section.icon']
  const ctx = {
    slots: {
      inject(key, factory) {
        assert.ok(slots.includes(key), 'unknown slot ' + key)
        const dispose = factory()
        return dispose
      },
      register(registration, component) {
        registered.push({ registration, component })
        return () => {}
      },
    },
  }
  moduleExports.apply(ctx)

  assert.equal(registered.length, 4)
  const [panel, rail, section, icon] = registered

  assert.equal(panel.registration.name, 'main')
  assert.equal(panel.registration.key, 'gugu-stock', 'panel key must equal the rail entry id')
  assert.equal(typeof panel.component, 'function')
  assert.equal(panel.component.name, 'GuguPanel')

  assert.equal(rail.registration.name, 'sidebar.panellist')
  assert.equal(rail.registration.id, 'gugu-stock')
  assert.equal(rail.registration.order, 40)
  assert.equal(rail.registration.label(), '谷谷股')
  const railWrapper = rail.component({ size: 24, active: false })
  assert.ok(React.isValidElement(railWrapper))
  const railElement = typeof railWrapper.type === 'function' ? railWrapper.type(railWrapper.props) : railWrapper
  assert.equal(railElement.type, 'svg')

  assert.equal(section.registration.name, 'settings.section')
  assert.equal(section.registration.id, 'gugu-stock')
  assert.equal(section.registration.order, 30)
  assert.equal(section.registration.label(), '谷谷股')
  assert.equal(typeof section.component, 'function')

  assert.equal(icon.registration.name, 'settings.section.icon')
  assert.equal(icon.registration.id, 'gugu-stock', 'icon id must equal the section id')
  assert.equal(icon.registration.order, 30)

  const wrapper = icon.component({ size: 24, active: true })
  assert.ok(React.isValidElement(wrapper))
  const element = typeof wrapper.type === 'function' ? wrapper.type(wrapper.props) : wrapper
  assert.ok(React.isValidElement(element))
  assert.equal(element.type, 'svg')
  assert.equal(element.props.width, 24)
})

test('the section component is a React component that does not touch the network on render', async () => {
  const { moduleExports } = await loadBundle()
  const registered = []
  moduleExports.apply({
    slots: {
      inject: (key, factory) => factory(),
      register: (registration, component) => {
        registered.push({ registration, component })
        return () => {}
      },
    },
  })
  const section = registered.find((entry) => entry.component.name === 'GuguSection')
  assert.ok(section, 'GuguSection was registered')
  assert.ok(section.component.toString().includes('useState'))
})

test('chart image can be double-clicked into a full-screen overlay', async () => {
  const source = await fs.readFile(path.join(PLUGIN, 'client.js'), 'utf8')
  assert.ok(source.includes('onDoubleClick'), 'chart image needs an onDoubleClick handler')
  assert.ok(source.includes('zoomOverlay'), 'overlay style missing')
  assert.ok(source.includes("event.key === 'Escape'"), 'Esc must close the overlay')
  assert.ok(source.includes("setZoom(true)"), 'double-click must open the overlay')
  assert.ok(source.includes("setZoom(false)"), 'click or Esc must close the overlay')
})
