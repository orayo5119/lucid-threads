const { app, BrowserWindow, nativeTheme, screen, ipcMain, shell, webContents, session } = require('electron')
const { checkLicense, activateKey, devSetStatus, sendFeedback } = require('./license')
const { autoUpdater } = require('electron-updater')

nativeTheme.themeSource = 'dark'

let mainWindow
const SNAP_THRESHOLD = 70 // px from either screen edge to trigger snap

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 380,
    height: 900,
    minWidth: 380,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 14 },
    transparent: true,
    backgroundColor: '#00000000',
    roundedCorners: true,
    title: 'Lucid Browser',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webviewTag: true,
    },
  })

  mainWindow.loadFile('renderer.html')

  let snapCandidate = false

  // Snap to whichever screen edge the window is near: left or right.
  let snapSide = null

  mainWindow.on('move', () => {
    const b = mainWindow.getBounds()
    const { workArea } = screen.getDisplayMatching(b)
    let side = null
    if (b.x <= workArea.x + SNAP_THRESHOLD) side = 'left'
    else if (b.x + b.width >= workArea.x + workArea.width - SNAP_THRESHOLD) side = 'right'
    if (side !== snapSide) {
      snapSide = side
      send('snap-hint', side)
    }
  })

  mainWindow.on('moved', () => {
    if (!snapSide) return
    const b = mainWindow.getBounds()
    const { workArea } = screen.getDisplayMatching(b)
    const x = snapSide === 'left' ? workArea.x : workArea.x + workArea.width - b.width
    mainWindow.setBounds({ x, y: b.y, width: b.width, height: b.height }, true)
    snapSide = null
    send('snap-hint', null)
  })

  mainWindow.webContents.once('did-finish-load', refreshLicense)
  setInterval(refreshLicense, 24 * 60 * 60 * 1000)
}

function send(channel, payload) {
  if (mainWindow && mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
    mainWindow.webContents.send(channel, payload)
  }
}

async function refreshLicense() {
  try {
    send('license-status', await checkLicense())
  } catch (err) {
    console.error('License refresh failed:', err)
  }
}

// --- IPC ---

ipcMain.handle('license:activate', async (event, key) => {
  try {
    const result = await activateKey(key)
    send('license-status', result)
    return { ok: true }
  } catch (err) {
    console.error('Activation failed:', err.message)
    return { ok: false, error: err.message }
  }
})

ipcMain.handle('dev:set-status', async (event, status) => {
  try {
    const result = await devSetStatus(status)
    send('license-status', result)
    return { ok: true }
  } catch (err) {
    console.error('Dev set-status failed:', err.message)
    return { ok: false, error: err.message }
  }
})

ipcMain.handle('feedback:send', async (event, message) => {
  try {
    await sendFeedback(message)
    return { ok: true }
  } catch (err) {
    console.error('Feedback send failed:', err.message)
    return { ok: false, error: err.message }
  }
})

// --- Auto-update ---
// Checks on launch and every 4 hours. Downloads in the background, then the
// renderer shows a banner. The app restarts only when the user clicks Restart,
// or installs silently when they quit normally.
function setupAutoUpdater() {
  if (!app.isPackaged) return
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.on('update-downloaded', (info) => send('update-ready', info.version))
  autoUpdater.on('error', (err) => console.error('Update error:', err.message))
  const check = () => autoUpdater.checkForUpdates().catch(() => {})
  check()
  setInterval(check, 4 * 60 * 60 * 1000)
}

// --- TikTok: real touch swipe for each wheel gesture ---
// TikTok's mobile feed only responds to touch, so the page reports wheel gestures and
// we send a synthetic touch scroll through Chrome's input protocol.
ipcMain.on('tiktok-swipe', async (event, { id, dir, w, h }) => {
  const wc = webContents.fromId(id)
  if (!wc || wc.isDestroyed()) return
  try {
    if (!wc.debugger.isAttached()) {
      wc.debugger.attach('1.3')
      await wc.debugger.sendCommand('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 })
    }
    const width = w || 380, height = h || 800
    await wc.debugger.sendCommand('Input.synthesizeScrollGesture', {
      x: Math.round(width / 2),
      y: Math.round(height / 2),
      yDistance: dir > 0 ? -Math.round(height * 0.6) : Math.round(height * 0.6),
      gestureSourceType: 'touch',
      speed: 2500,
    })
  } catch (err) {
    console.error('TikTok swipe failed:', err.message)
  }
})

ipcMain.on('update:install', () => autoUpdater.quitAndInstall())

ipcMain.on('open-payment-link', (event, paymentUrl) => {
  shell.openExternal(paymentUrl)
})

// --- Keep sites from opening the App Store or their phone apps ---
// TikTok's mobile site links to the App Store and to the TikTok app; macOS would open those.
function isAppLink(url) {
  return /^(itms-apps?s?|itms|market|intent|snssdk\d*|tiktok|musically):/i.test(url) ||
    /^https?:\/\/(apps|itunes)\.apple\.com\//i.test(url)
}

app.on('web-contents-created', (event, wc) => {
  const block = (e, url) => { if (isAppLink(url)) e.preventDefault() }
  wc.on('will-navigate', block)
  wc.on('will-redirect', block)
  wc.setWindowOpenHandler(({ url }) => isAppLink(url) ? { action: 'deny' } : { action: 'allow' })
})

app.whenReady().then(() => {
  createWindow()
  // External app links (itms-apps:, tiktok:, ...) ask for "openExternal" permission: refuse it.
  session.fromPartition('persist:threads').setPermissionRequestHandler((wc, permission, callback) => {
    callback(permission !== 'openExternal')
  })
  setupAutoUpdater()

  // Poll cursor every 80ms — the webview swallows pointer events, so
  // renderer-side mousemove is unreliable over it.
  setInterval(() => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    const c = screen.getCursorScreenPoint()
    const b = mainWindow.getBounds()
    const inside =
      c.x >= b.x && c.x <= b.x + b.width && c.y >= b.y && c.y <= b.y + b.height
    send('cursor-in-window', inside)
  }, 80)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
