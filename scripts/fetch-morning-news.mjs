/* Fetches one real English and one real Czech AI-news headline from Google News
   RSS (free, no API key) and writes them to public/data/morning.json for the
   Morning routine's pronunciation step. Runs from the daily GitHub Action.
   Real sources only, no generated text. */

import { mkdirSync, writeFileSync } from 'fs'

const FEEDS = {
  en: 'https://news.google.com/rss/search?q=artificial+intelligence&hl=en-US&gl=US&ceid=US:en',
  cs: 'https://news.google.com/rss/search?q=um%C4%9Bl%C3%A1%20inteligence&hl=cs&gl=CZ&ceid=CZ:cs',
}

function decodeEntities(s) {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&(?:apos|#39);/g, "'").replace(/&nbsp;/g, ' ')
}

function tagContent(xml, name) {
  const m = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i'))
  if (!m) return ''
  const cdata = m[1].match(/<!\[CDATA\[([\s\S]*?)\]\]>/)
  return (cdata ? cdata[1] : m[1]).trim()
}

function strip(s) {
  return decodeEntities(s.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()
}

async function pull(url) {
  const res = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 MissionControlMorning/1.0' } })
  if (!res.ok) throw new Error(`feed ${res.status}`)
  const xml = await res.text()
  const item = (xml.match(/<item>([\s\S]*?)<\/item>/i) || [])[1] || ''
  if (!item) throw new Error('no item in feed')
  const rawTitle = strip(tagContent(item, 'title'))
  const link = strip(tagContent(item, 'link'))
  let source = strip(tagContent(item, 'source'))
  let headline = rawTitle
  // Google News titles are "Headline - Publisher"; split the publisher off.
  if (!source && rawTitle.includes(' - ')) source = rawTitle.slice(rawTitle.lastIndexOf(' - ') + 3).trim()
  if (source && headline.endsWith(` - ${source}`)) headline = headline.slice(0, -(source.length + 3)).trim()
  return { text: headline, source: source || 'Google News', url: link }
}

async function main() {
  const [en, cs] = await Promise.all([pull(FEEDS.en), pull(FEEDS.cs)])
  const out = { date: new Date().toISOString().slice(0, 10), en, cs }
  mkdirSync('public/data', { recursive: true })
  writeFileSync('public/data/morning.json', JSON.stringify(out, null, 2))
  console.log('wrote public/data/morning.json\n' + JSON.stringify(out, null, 2))
}

main().catch((e) => { console.error('morning news failed:', e.message); process.exit(1) })
