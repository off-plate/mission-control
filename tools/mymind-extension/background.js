importScripts('lib.js')

const flash = (tabId, text, color) => {
  chrome.action.setBadgeBackgroundColor({ color, tabId })
  chrome.action.setBadgeText({ text, tabId })
  setTimeout(() => chrome.action.setBadgeText({ text: '', tabId }), 2500)
}
const done = (tab, r) => {
  if (r.needsKey) chrome.runtime.openOptionsPage()
  flash(tab.id, r.ok ? 'OK' : 'X', r.ok ? '#2D7D52' : '#C8402F')
}

chrome.runtime.onInstalled.addListener(() => {
  const m = (id, title, contexts) => chrome.contextMenus.create({ id, title, contexts })
  m('page', 'Save page to MyMind', ['page'])
  m('link', 'Save link to MyMind', ['link'])
  m('image', 'Save image to MyMind', ['image'])
  m('selection', 'Save quote to MyMind', ['selection'])
})

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab) return
  let r
  if (info.menuItemId === 'image') {
    try { r = await mmSend({ image_b64: await mmImageToB64(info.srcUrl) }) }
    catch { r = await mmSend({ url: info.srcUrl }) }      // a picture the extension may not read: save its address
  } else if (info.menuItemId === 'link') r = await mmSend({ url: info.linkUrl })
  else if (info.menuItemId === 'selection') r = await mmSend({ text: info.selectionText, url: info.pageUrl })
  else {
    const p = await mmPageInfo(tab.id)
    r = await mmSend({ url: tab.url, title: p?.title, description: p?.description, ...(await mmPreview(p)) })
  }
  done(tab, r)
})

chrome.commands.onCommand.addListener(async (cmd) => {
  if (cmd !== 'quick-save') return
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!tab || !/^https?:/.test(tab.url || '')) return
  const p = await mmPageInfo(tab.id)
  /* A selection, if there is one, is saved as a quote with its source; otherwise the page. */
  const r = p?.selection
    ? await mmSend({ text: p.selection, url: tab.url })
    : await mmSend({ url: tab.url, title: p?.title, description: p?.description, ...(await mmPreview(p)) })
  done(tab, r)
})
