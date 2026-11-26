'use strict'

// Cerebrum Ultimate integration helper.
// Canonical copy: node-red-contrib-cerebrum-ultimate/nodes/utils/cerebrumIntegration.js.
// Every Max Supervibe node package ships an identical copy: keep them in sync.
//
// Registers this package as a read-only provider in Cerebrum's in-process
// adapter registry. Cerebrum is optional: without it the registry is just an
// unused object. Cerebrum subscribes to the provider events (states, history,
// JavaScript routines) and publishes listEntities/getEntity to MCP clients.
//
// Event contract consumed by Cerebrum:
//   { entityId, eventType: 'state_changed', state, previousState,
//     resourceName, resourceType, area, kind, capability, unit, at, details }

const REGISTRY_KEY = Symbol.for('node-red.cerebrum-ultimate.adapters.v1')
const REGISTRY_VERSION = 1
const MAX_STATE_CHARS = 500

const isCompatibleRegistry = value => !!value &&
  value.version === REGISTRY_VERSION &&
  value.adapters instanceof Map &&
  value.providers instanceof Map &&
  value.listeners instanceof Set &&
  typeof value.registerAdapter === 'function' &&
  typeof value.registerProvider === 'function'

const notify = (listeners, event) => {
  listeners.forEach(listener => {
    try { listener(event) } catch { /* a consumer cannot break the registry */ }
  })
}

// Same shape as Cerebrum's own registry, so whichever package loads first
// creates an instance the other accepts.
const getCerebrumRegistry = () => {
  const existing = globalThis[REGISTRY_KEY]
  if (isCompatibleRegistry(existing)) return existing
  const registry = {
    version: REGISTRY_VERSION,
    adapters: new Map(),
    providers: new Map(),
    listeners: new Set(),
    registerAdapter (adapter) {
      if (!adapter || !adapter.id) throw new Error('Cerebrum adapter id is required')
      const frozen = Object.freeze({ ...adapter, id: String(adapter.id) })
      this.adapters.set(frozen.id, frozen)
      notify(this.listeners, { type: 'adapter_registered', adapter: frozen })
      return () => {
        if (this.adapters.get(frozen.id) !== frozen) return false
        this.adapters.delete(frozen.id)
        notify(this.listeners, { type: 'adapter_unregistered', adapter: frozen })
        return true
      }
    },
    registerProvider (provider) {
      if (!provider || !provider.id || !provider.adapterId) throw new Error('Cerebrum provider id and adapterId are required')
      this.providers.set(String(provider.id), provider)
      notify(this.listeners, { type: 'provider_registered', provider })
      return () => this.unregisterProvider(provider.id, provider)
    },
    unregisterProvider (providerId, expectedProvider) {
      const id = String(providerId || '')
      const provider = this.providers.get(id)
      if (!provider || (expectedProvider && provider !== expectedProvider)) return false
      this.providers.delete(id)
      notify(this.listeners, { type: 'provider_unregistered', provider })
      return true
    },
    subscribe (listener) {
      if (typeof listener !== 'function') return () => {}
      this.listeners.add(listener)
      return () => this.listeners.delete(listener)
    }
  }
  globalThis[REGISTRY_KEY] = registry
  return registry
}

const stateText = value => {
  if (value === undefined || value === null) return ''
  if (typeof value === 'object') {
    try { return JSON.stringify(value).slice(0, MAX_STATE_CHARS) } catch { return '' }
  }
  return String(value).slice(0, MAX_STATE_CHARS)
}

// adapter:  { id, title, packageName, kind, capabilities, operations }
// provider: { id, title, isReady(), listEntities(), getEntity(id), ... }
// options.minIntervalMs: per-entity minimum interval between two emitted
//   changes of a numeric value (telemetry); state changes of non-numeric
//   values are always emitted. Repeated identical values are never emitted.
const registerCerebrumIntegration = ({ adapter, provider, minIntervalMs = 0, now = () => Date.now() } = {}) => {
  const listeners = new Set()
  const lastByEntity = new Map()
  const pendingByEntity = new Map()
  let disposed = false
  let unregisterProvider = () => {}
  let unregisterAdapter = () => {}

  const deliver = event => {
    listeners.forEach(listener => {
      try { listener(event) } catch { /* Cerebrum must never break the node */ }
    })
  }

  const flushPending = entityId => {
    const pending = pendingByEntity.get(entityId)
    if (!pending) return
    clearTimeout(pending.timer)
    pendingByEntity.delete(entityId)
    if (disposed) return
    lastByEntity.set(entityId, { state: pending.event.state, at: now() })
    deliver(pending.event)
  }

  const emit = (event = {}) => {
    if (disposed || !listeners.size || !event.entityId) return false
    const entityId = String(event.entityId)
    const state = stateText(event.state)
    const previous = lastByEntity.get(entityId)
    if (previous && previous.state === state && (event.eventType || 'state_changed') === 'state_changed') return false
    const normalized = {
      ...event,
      entityId,
      eventType: event.eventType || 'state_changed',
      state,
      previousState: event.previousState !== undefined ? stateText(event.previousState) : (previous ? previous.state : ''),
      adapterId: adapter.id,
      providerId: provider.id,
      source: adapter.id,
      at: event.at || new Date(now()).toISOString()
    }
    const numeric = state !== '' && Number.isFinite(Number(state))
    const elapsed = previous ? now() - previous.at : Infinity
    if (minIntervalMs > 0 && numeric && normalized.eventType === 'state_changed' && elapsed < minIntervalMs) {
      // Keep only the latest value and deliver it when the interval ends.
      const pending = pendingByEntity.get(entityId)
      if (pending) pending.event = normalized
      else {
        const timer = setTimeout(() => flushPending(entityId), minIntervalMs - elapsed)
        if (timer && typeof timer.unref === 'function') timer.unref()
        pendingByEntity.set(entityId, { event: normalized, timer })
      }
      return false
    }
    if (pendingByEntity.has(entityId)) {
      clearTimeout(pendingByEntity.get(entityId).timer)
      pendingByEntity.delete(entityId)
    }
    if (normalized.eventType === 'state_changed') lastByEntity.set(entityId, { state, at: now() })
    deliver(normalized)
    return true
  }

  const publishedProvider = {
    ...provider,
    adapterId: adapter.id,
    subscribe (listener) {
      if (typeof listener !== 'function') return () => {}
      listeners.add(listener)
      return () => listeners.delete(listener)
    }
  }

  try {
    const registry = getCerebrumRegistry()
    unregisterAdapter = registry.registerAdapter(adapter) || (() => {})
    unregisterProvider = registry.registerProvider(publishedProvider) || (() => registry.unregisterProvider(publishedProvider.id, publishedProvider))
  } catch { /* Cerebrum integration is optional */ }

  return {
    provider: publishedProvider,
    emit,
    hasSubscribers: () => listeners.size > 0,
    dispose () {
      if (disposed) return
      disposed = true
      pendingByEntity.forEach(pending => clearTimeout(pending.timer))
      pendingByEntity.clear()
      listeners.clear()
      try { unregisterProvider() } catch { /* ignore */ }
      // The adapter manifest is shared by every config node of the package;
      // remove it only when no provider of this adapter remains.
      try {
        const registry = getCerebrumRegistry()
        const stillUsed = Array.from(registry.providers.values()).some(candidate => candidate && candidate.adapterId === adapter.id)
        if (!stillUsed) unregisterAdapter()
      } catch { /* ignore */ }
    }
  }
}

module.exports = {
  CEREBRUM_REGISTRY_KEY: REGISTRY_KEY,
  getCerebrumRegistry,
  registerCerebrumIntegration
}
