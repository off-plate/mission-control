const $ = (id) => document.getElementById(id)
let tab = null, info = null
;(async () => {
  ;[tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  info = tab ? await mmPageInfo(tab.id) : null
  $('site').textContent = tab?.url || ''
  $('t').value = info?.title || tab?.title || ''
  if (!/^https?:/.test(tab?.url || '')) { $('go').disabled = true; $('msg').textContent = 'This page cannot be saved.' }
  $('n').focus()
})()
async function save() {
  $('go').disabled = true; $('msg').className = ''; $('msg').textContent = 'Saving...'
  const body = info?.selection && !$('t').dataset.edited
    ? { text: info.selection, url: tab.url, note: $('n').value }
    : { url: tab.url, title: $('t').value, description: info?.description, ...(await mmPreview(info)), note: $('n').value }
  const r = await mmSend(body)
  $('msg').className = r.ok ? 'ok' : 'err'
  $('msg').textContent = r.ok ? (r.duplicate ? 'Already saved, moved to the top' : 'Saved') : r.error
  if (r.needsKey) chrome.runtime.openOptionsPage()
  if (r.ok) setTimeout(() => window.close(), 900); else $('go').disabled = false
}
$('go').addEventListener('click', save)
$('t').addEventListener('input', () => { $('t').dataset.edited = '1' })
document.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey || e.target.id === 't')) save() })
