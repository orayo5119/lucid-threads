const { app, BrowserWindow, nativeTheme, screen, ipcMain, shell } = require('electron')
const { checkLicense, activateKey, devSetStatus, sendFeedback } = require('./license')
const { autoUpdater } = require('electron-updater')

nativeTheme.themeSource = 'dark'

let mainWindow
const SNAP_THRESHOLD = 28 // px from left edge to trigger snap

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

  mainWindow.on('move', () => {
    const [x, y] = mainWindow.getPosition()
    const display = screen.getDisplayNearestPoint({ x, y })
    const { workArea } = display
    const nearLeft = x <= workArea.x + SNAP_THRESHOLD
    if (nearLeft !== snapCandidate) {
      snapCandidate = nearLeft
      send('snap-hint', snapCandidate ? 'left' : null)
    }
  })

  mainWindow.on('moved', () => {
    if (!snapCandidate) return
    const [, y] = mainWindow.getPosition()
    const display = screen.getDisplayNearestPoint({ x: 0, y })
    const { workArea } = display
    const b = mainWindow.getBounds()
    mainWindow.setBounds({ x: workArea.x, y: b.y, width: b.width, height: b.height }, true)
    snapCandidate = false
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

ipcMain.on('update:install', () => autoUpdater.quitAndInstall())

ipcMain.on('open-payment-link', (event, paymentUrl) => {
  shell.openExternal(paymentUrl)
})

app.whenReady().then(() => {
  createWindow()
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
