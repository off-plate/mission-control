const k = document.getElementById('k'), m = document.getElementById('m')
chrome.storage.local.get('key').then((v) => { if (v.key) { k.placeholder = 'A key is saved. Paste a new one to replace it.' } })
document.getElementById('s').addEventListener('click', async () => {
  const v = k.value.trim(); if (!v) { m.textContent = 'Paste the key first.'; return }
  await chrome.storage.local.set({ key: v }); k.value = ''; m.textContent = 'Saved.'
})
