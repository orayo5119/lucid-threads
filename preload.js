// Runs in the webview context before any page script.
// Removes Electron/webdriver signatures that cause Google to block sign-in.
try {
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined })
} catch (e) {}
