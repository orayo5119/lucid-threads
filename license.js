// license.js — Electron MAIN process. License-key edition (no Google auth).

const { app } = require('electron')
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const https = require('https')

// ---- Your deployed backend + Stripe payment link ----
const BACKEND_URL = 'https://ray-browser-license-973037453162.asia-east1.run.app'
const STRIPE_PAYMENT_LINK = 'https://buy.stripe.com/5kQ00k6WR76i1lA4FLabK00'
// ------------------------------------------------------

const OFFLINE_GRACE_DAYS = 3

function storePath() {
  return path.join(app.getPath('userData'), 'license.json')
}

function loadStore() {
  try {
    return JSON.parse(fs.readFileSync(storePath(), 'utf8'))
  } catch (e) {
    return {}
  }
}

function saveStore(data) {
  fs.writeFileSync(storePath(), JSON.stringify(data, null, 2))
}

function getOrCreateDeviceId() {
  const store = loadStore()
  if (!store.deviceId) {
    store.deviceId = crypto.randomUUID()
    saveStore(store)
  }
  return store.deviceId
}

function httpJson(method, url, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null
    const req = https.request(
      url,
      {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
        },
        timeout: 10000,
      },
      (res) => {
        let raw = ''
        res.on('data', (c) => (raw += c))
        res.on('end', () => {
          try {
            const parsed = JSON.parse(raw)
            if (res.statusCode >= 400) {
              return reject(new Error(parsed.error || `HTTP ${res.statusCode}`))
            }
            resolve(parsed)
          } catch (e) {
            reject(new Error('Bad JSON from backend'))
          }
        })
      }
    )
    req.on('error', reject)
    req.on('timeout', () => req.destroy(new Error('Request timed out')))
    if (payload) req.write(payload)
    req.end()
  })
}

/**
 * Returns the current licence state:
 *   { status, trialDaysRemaining?, licensed?, isDev?, email?, paymentUrl, offline? }
 */
async function checkLicense() {
  const deviceId = getOrCreateDeviceId()
  try {
    await httpJson('POST', `${BACKEND_URL}/trial/start`, { deviceId })
    const result = await httpJson('GET', `${BACKEND_URL}/license/status?deviceId=${deviceId}`)

    const store = loadStore()
    saveStore({
      ...store,
      deviceId,
      lastStatus: result.status,
      lastTrialDaysRemaining: result.trialDaysRemaining,
      lastLicensed: result.licensed,
      lastIsDev: result.isDev,
      lastCheckedAt: new Date().toISOString(),
    })

    return { ...result, paymentUrl: STRIPE_PAYMENT_LINK }
  } catch (err) {
    console.warn('License check failed, using cache:', err.message)
    const store = loadStore()
    if (store.lastCheckedAt) {
      const days = (Date.now() - new Date(store.lastCheckedAt).getTime()) / 86400000
      if (days <= OFFLINE_GRACE_DAYS) {
        return {
          status: store.lastStatus || 'trial',
          trialDaysRemaining: store.lastTrialDaysRemaining,
          licensed: store.lastLicensed,
          isDev: store.lastIsDev,
          paymentUrl: STRIPE_PAYMENT_LINK,
          offline: true,
        }
      }
    }
    return {
      status: 'trial',
      trialDaysRemaining: 1,
      paymentUrl: STRIPE_PAYMENT_LINK,
      offline: true,
    }
  }
}

/** Activates a pasted license key (or the dev key) for this device. */
async function activateKey(key) {
  const deviceId = getOrCreateDeviceId()
  const result = await httpJson('POST', `${BACKEND_URL}/license/activate`, {
    deviceId,
    key,
  })

  // If this was the dev key, remember it locally so the dev toggle can use it.
  if (result.isDev) {
    const store = loadStore()
    saveStore({ ...store, devKey: key.trim() })
  }

  return { ...result, paymentUrl: STRIPE_PAYMENT_LINK }
}

/** Dev-only: flip this device between active / trial / expired. */
async function devSetStatus(status) {
  const store = loadStore()
  if (!store.devKey) throw new Error('Dev mode not enabled on this device')
  const deviceId = getOrCreateDeviceId()
  const result = await httpJson('POST', `${BACKEND_URL}/dev/set-status`, {
    deviceId,
    devKey: store.devKey,
    status,
  })
  return { ...result, paymentUrl: STRIPE_PAYMENT_LINK }
}

/** Sends user feedback to the backend (stored in Firestore). */
async function sendFeedback(message) {
  const deviceId = getOrCreateDeviceId()
  const store = loadStore()
  const body = {
    message,
    deviceId,
    email: store.lastEmail || '',
    status: store.lastStatus || '',
  }
  return httpJson('POST', `${BACKEND_URL}/feedback`, body)
}

module.exports = { checkLicense, activateKey, devSetStatus, sendFeedback }
