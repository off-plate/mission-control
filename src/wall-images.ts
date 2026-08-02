/* GENERATED FILE. Written by the Jarvis wall-image skill
 * (.claude/skills/wall-image/scripts/place.py). Do not hand edit:
 * add or remove wall photographs through the skill and this is
 * rewritten from wall-manifest.json.
 *
 * w and h are the real pixel dimensions of the served file. They
 * are set as attributes on the img so the browser reserves the
 * card's height before the photo lands and the masonry column
 * does not reflow under the cursor.
 */

export interface WallImage {
  /** Path under the site base, joined with BASE_URL at render. */
  src: string
  srcset: string
  w: number
  h: number
  /** 24px WebP as a data URI: the card's colour before the load. */
  lqip: string
  credit: string
}

export const WALL_IMAGES: Record<string, WallImage> = {
  "calm-desk": {
    src: 'wall/calm-desk-900.webp',
    srcset: "wall/calm-desk-450.webp 450w, wall/calm-desk-675.webp 675w, wall/calm-desk-900.webp 900w",
    w: 900, h: 1200,
    lqip: "data:image/webp;base64,UklGRtQAAABXRUJQVlA4IMgAAABQBQCdASoYACAAPu1qqU8ppiOiMBgIATAdiUAVhmHQn1Xc8D6Nl3GCuGBM8y/RtfeRJ8gA/sBrFHcWWzqXhUFq494qRGdPTwtitrb1z/w4Xy1lfJ9tyzu6m2rzJe39cmTKgEnuhrD1bo88ACMMMAEmxgOfZqqDhv0kORGq0IWnruPclbJ/GokGK3oB/IW715dlD/jLQtoKOPoh8FgW+kfvaF+Evcup8galGqenIxtYU3KVg49bHKj7SS/OmK0GGjVwKdhfxlCAAA==",
    credit: "i.pinimg.com",
  },
  "challenger": {
    src: 'wall/challenger-900.webp',
    srcset: "wall/challenger-450.webp 450w, wall/challenger-675.webp 675w, wall/challenger-900.webp 900w",
    w: 900, h: 600,
    lqip: "data:image/webp;base64,UklGRloAAABXRUJQVlA4IE4AAACwAwCdASoYABAAPu1iqU2ppaQiMAgBMB2JaQDKACHP08RMLj784AD+2sLHyXfi2mlXILmX8ICK47ot6nTERK7/EhDb6at7KjTzxJaAAAA=",
    credit: "i.pinimg.com",
  },
  "corner-night": {
    src: 'wall/corner-night-900.webp',
    srcset: "wall/corner-night-450.webp 450w, wall/corner-night-675.webp 675w, wall/corner-night-900.webp 900w",
    w: 900, h: 1350,
    lqip: "data:image/webp;base64,UklGRsIAAABXRUJQVlA4ILYAAACQBgCdASoYACQAPu1mq02ppaQiMBqqqTAdiWMAwGQWeN3U/rUU3OdnNahHe79gX+kLk+eMeSqUDVT4YjgAAP7Zw3hvl0Y2RL7DV0N1KRo3XUnSFlx/1jFa4DRSTpM+nXAsO7I53FZcQYErFcvTv2Ta2U+dlSL/tCtALluuUuEZukuzbXgQjfze98pvFw58e9EQWZGuWdZElJf6D9i3wvyis44Ssf0I7qQAqtuai8IXJpGV1KAAAA==",
    credit: "i.pinimg.com",
  },
  "gym-six": {
    src: 'wall/gym-six-900.webp',
    srcset: "wall/gym-six-450.webp 450w, wall/gym-six-675.webp 675w, wall/gym-six-900.webp 900w",
    w: 900, h: 1200,
    lqip: "data:image/webp;base64,UklGRgABAABXRUJQVlA4IPQAAADQBQCdASoYACAAPu1grFAppSQisBgIATAdiWkACBpYm7Bsdn+T8uPXEr7gTrToYD8rEQ2fI44AAP7Zna0MXrQ7vkJYu7LwgjbjAjlriFR2CC+pI0t/+wWbbM5yGgneHh4QsCPJFyxHsU5hkliIiVlkVLtnUCu4C9t+Pc605dgVd5CRuOQdhG1XX+yWussCHnC0/AP8D+03dwl6GmNJZS9qvf9h/gJB+CWphdnlm+E4Kv02xUWsfFTYD6kKx/DlRpLPKKoOTbWDfar+WvIQFB3sp0KUq8L+w9iVj4LlsLDoHjHW+NzLGtZ8qSNWwpmYleEV8AAA",
    credit: "i.pinimg.com",
  },
  "liguria": {
    src: 'wall/liguria-900.webp',
    srcset: "wall/liguria-450.webp 450w, wall/liguria-675.webp 675w, wall/liguria-900.webp 900w",
    w: 900, h: 600,
    lqip: "data:image/webp;base64,UklGRqgAAABXRUJQVlA4IJwAAACwBACdASoYABAAPu1iqU2ppaOiMAgBMB2JbACdHYCNq2/+A8ctRHQWIb57AouwAPpZRMQ4TZnyObC88REYNVLaEfJEHuot4+xTpxjiZ9HxWFpd6800NSVPs7xHG6653s3xzjL36bx0vvcGvDcUuU4yiRSqzs4hNe8D12+9/nzuk5zjS0HyNcdfsMYG+zPXJwOm+J4QTtv1LNbqAAA=",
    credit: "get.pxhere.com",
  },
}

export function wallImage(key: string): WallImage | undefined {
  return WALL_IMAGES[key]
}
