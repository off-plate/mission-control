/* One click saves: the popup opens, grabs the page, sends it, plays a short animation, says it was saved, closes. */
const $ = (id) => document.getElementById(id)
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const MIN_SHOW = 1200   // the saving animation always gets this long, so a fast save still reads as something happening

async function run() {
  document.body.className = ''
  $('head').textContent = 'Saving to MyMind'; $('sub').textContent = ''
  /* ?tab=<id> lets a test point the popup at a tab; Chrome itself opens it with the active tab. */
  const forced = new URLSearchParams(location.search).get('tab')
  const tab = forced ? await chrome.tabs.get(+forced) : (await chrome.tabs.query({ active: true, currentWindow: true }))[0]
  if (!tab || !/^https?:/.test(tab.url || '')) return fail('This page cannot be saved.')
  const info = await mmPageInfo(tab.id)
  $('sub').textContent = info?.title || tab.title || tab.url
  const body = info?.selection
    ? { text: info.selection, url: tab.url }
    : { url: tab.url, title: info?.title, description: info?.description, ...(await mmPreview(info)) }
  const [r] = await Promise.all([mmSend(body), wait(MIN_SHOW)])
  if (!r.ok) { if (r.needsKey) chrome.runtime.openOptionsPage(); return fail(r.error) }
  document.body.className = 'ok'
  $('head').textContent = info?.selection ? 'Saved the quote' : r.duplicate ? 'Already saved' : 'Saved to MyMind'
  $('sub').textContent = r.duplicate ? 'Moved to the top' : (r.title || info?.title || '')
  setTimeout(() => window.close(), 1700)
}
function fail(msg) {
  document.body.className = 'err'
  $('head').textContent = 'Not saved'; $('sub').textContent = msg
}
$('retry').addEventListener('click', run)
run()
