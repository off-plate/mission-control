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

}

export function wallImage(key: string): WallImage | undefined {
  return WALL_IMAGES[key]
}
