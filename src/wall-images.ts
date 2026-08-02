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
  "amg-gtr": {
    src: 'wall/amg-gtr-900.webp',
    srcset: "wall/amg-gtr-450.webp 450w, wall/amg-gtr-675.webp 675w, wall/amg-gtr-900.webp 900w",
    w: 900, h: 563,
    lqip: "data:image/webp;base64,UklGRpgAAABXRUJQVlA4IIwAAAAQBACdASoYAA4APu1iqU2ppaOiMAgBMB2JZwCo9dwA3FSmH3lO1tSFgAD9nW8/Ol0dKB2J0eWkDKqVN+yFpf6FrStNKxrvDlDuBkNBre4Ys24g/etZ/yUB/KtYlXHxAcMI9jg9crvmXW4XBWSneH7uIypN57mYrkivbgNH9tQZpES6NEN65dbG0T9UAA==",
    credit: "wallpapercave.com",
  },
  "aventador-sv": {
    src: 'wall/aventador-sv-900.webp',
    srcset: "wall/aventador-sv-450.webp 450w, wall/aventador-sv-675.webp 675w, wall/aventador-sv-900.webp 900w",
    w: 900, h: 600,
    lqip: "data:image/webp;base64,UklGRpQAAABXRUJQVlA4IIgAAAAQBACdASoYABAAPu1iqU2ppaOiMAgBMB2JYgDDNCLDCUjZ2yKnESXhwADN7XdjthDSRWjA7WeqVyhqqB4+CnN/daour2FlxA56OSTVgOjZjZxv+Z0dL+hiwBUuoYisegX4ESlhGCeesCBvszaIjemR/V8nq4+H9Y+TP/Edswds6C6McftiC1AA",
    credit: "s1.cdn.autoevolution.com",
  },
  "diamond-gym": {
    src: 'wall/diamond-gym-900.webp',
    srcset: "wall/diamond-gym-450.webp 450w, wall/diamond-gym-675.webp 675w, wall/diamond-gym-900.webp 900w",
    w: 900, h: 900,
    lqip: "data:image/webp;base64,UklGRuQAAABXRUJQVlA4INgAAACQBQCdASoYABgAPu1usFIppiSiqAgBMB2JZQDNxauWy9nUExeKFtRlEIz4AdeD5HSBQW2bhAD944As/8xWF2wN3MV7w2mRxg3cGhB7gCbtsN4CDB88crzg1tf2Zmit/5MADy/GC/TLlgMk6MedM0PL2ysTS3OMqVYyOQRBpfkd9OYCPOjX9PNuo/BRvtHGSXFIdle7kskeFM663P6KzTb6yCb9sCcWW4fsk/FaCufkJ6+UIPvlWa9hwoBjEN+uoiYn4m/FjWoiH2YvjxoIeWGQv3QnUBnmQAA=",
    credit: "gymcrasher.com",
  },
  "gle63s": {
    src: 'wall/gle63s-900.webp',
    srcset: "wall/gle63s-450.webp 450w, wall/gle63s-675.webp 675w, wall/gle63s-900.webp 900w",
    w: 900, h: 600,
    lqip: "data:image/webp;base64,UklGRqoAAABXRUJQVlA4IJ4AAAAQBACdASoYABAAPu1iqU2ppaOiMAgBMB2JZwDE2CICUWrqJ1RXqFEEqADypF+s2eknDQrQwjIgsqkzGxurlhZQXQph9FLv8qF0d6BCJARmYKwqVDBKc6cLI5T2XCbgOZAyq3wXk+wFcfGX8rv3+dvx67GPoMw/tew6fXMO35mTEIWJ4MOCkenakYrF5ILozUPMU16Eb/HpfS2T8AAAAA==",
    credit: "autodrift.ae",
  },
  "late-desk": {
    src: 'wall/late-desk-900.webp',
    srcset: "wall/late-desk-450.webp 450w, wall/late-desk-675.webp 675w, wall/late-desk-900.webp 900w",
    w: 900, h: 675,
    lqip: "data:image/webp;base64,UklGRowAAABXRUJQVlA4IIAAAAAwBACdASoYABIAPu1krE+ppSQiMBgIATAdiWMAVwsDVHzeCzkjuPMnlsAA/tzUpyDP03knbwl1v+/9x+WlxDBO7zLEL6xFJIYIN/fPfQ8b39jW7eLY2/Lg3p/Pl71vspM8LGUANSuwy0MTGDV/Y1HsKO5RKws9H2LLJeOdsygAAA==",
    credit: "i.pinimg.com",
  },
  "newborn": {
    src: 'wall/newborn-900.webp',
    srcset: "wall/newborn-450.webp 450w, wall/newborn-675.webp 675w, wall/newborn-900.webp 900w",
    w: 736, h: 877,
    lqip: "data:image/webp;base64,UklGRuwAAABXRUJQVlA4IOAAAACQBQCdASoYAB0APu1qrlCppaQiqAqpMB2JaQAIG26mjhnr3U/0mP8JXVWm1QJeI4pti1dXwAD+1N/8hR7GVmhXTMTNpb+ZnyPdBWR8fZwcXlKa0rX3OXFfui5Wg8Gh3zdSUdC5dkMc5n0b7fEWJB0NedGllFIf2TJZc+IWYX7UM3jjVWaLdkbzWWoPpdQsRekn1VrRBhrcuAb8I4gO1eUwxIAb4PrMO3QIWY1Rb5AxVx9ulCS6Z7HKWxGT9mwkLutMXt/JBZdLPBJmnwR3g3ZrgEgBx0gwS0KsJGDKoAAAAA==",
    credit: "i.pinimg.com",
  },
  "noel-deyzel": {
    src: 'wall/noel-deyzel-900.webp',
    srcset: "wall/noel-deyzel-450.webp 450w, wall/noel-deyzel-675.webp 675w, wall/noel-deyzel-900.webp 900w",
    w: 900, h: 1350,
    lqip: "data:image/webp;base64,UklGRvQAAABXRUJQVlA4IOgAAAAwBgCdASoYACQAPu1sr1GppaQipWsxMB2JYwDKAC6b+7QREUDA5A1FI1d/IFogag9z4GUUXp7u0ZLAAP73ef1qtT2o5Ddvy0fr+kVlgZB/98/RKJXyM6DiYCAkTTbR6/fHeJT+0xyRfBrsob+goC7KGVR5s5PTKws3+ZYc8X+PVfKzNExx28Uv3hsK5vd93U6U34lCZPMEgtlzIGb2z11yK/xfjhbO5Vm+45bBylcBvejUnVpB2cfrHnKX1dUGdnVo5Mgwj+fb6tdiIjAbroS/7dTQKsYAuc0C+RB+dh/XFd4ENRecaCAA",
    credit: "noeldeyzelshop.com",
  },
  "one-light": {
    src: 'wall/one-light-900.webp',
    srcset: "wall/one-light-450.webp 450w, wall/one-light-675.webp 675w, wall/one-light-900.webp 900w",
    w: 900, h: 600,
    lqip: "data:image/webp;base64,UklGRkQAAABXRUJQVlA4IDgAAAAwAwCdASoYABAAPu1orU6ppiSiMAgBMB2JZwABQ7NywaAAAP764bWqBkLHo6TXxPqIqLGWgIAAAA==",
    credit: "images.unsplash.com",
  },
  "villa": {
    src: 'wall/villa-900.webp',
    srcset: "wall/villa-450.webp 450w, wall/villa-675.webp 675w, wall/villa-900.webp 900w",
    w: 900, h: 563,
    lqip: "data:image/webp;base64,UklGRrYAAABXRUJQVlA4IKoAAACQBACdASoYAA4APu1iqU2ppaOiMAgBMB2JYgCdIExCucuKXT864sB/t3Uv5kAA4V0+vc3kx8KbanmEWf8pYC675ZWibPED9D/3C4M2KErgqI+h2Fhwp+5/WUhZPDTSd4fhgUceZ0pCngy+qFc6dG8n7919sAPUUpjfN+PjNQo8WF5zWNwP+jeXFZKjQPPb4l6LZMl5EAcXE1nQfbuET0CRnihWqJTR8h0AAA==",
    credit: "i.pinimg.com",
  },
  "workspace": {
    src: 'wall/workspace-900.webp',
    srcset: "wall/workspace-450.webp 450w, wall/workspace-675.webp 675w, wall/workspace-900.webp 900w",
    w: 900, h: 1416,
    lqip: "data:image/webp;base64,UklGRiYBAABXRUJQVlA4IBoBAACwBgCdASoYACYAPu1wrlMppiQipWmZMB2JZQDLLd6BhecVP11gTHyJO8wHI0OrzK/wb2Opyor5lZrsz/YigAD+X+cAwJvWJUZxd9FP7MpI8RAVEXBbXvNmZCUsnc4x2y0CV9PxZbuWs8Q2tZT8JaLb2fKovWad1syq9JQ+Gu2sAVCNBK0PL+Zr4C0F73jNg8Hs4GSZPs6S2I4y3GIl/TK08cj1wr8Pkc9xddH5ifHT6vXkk42OKuC7W085oosm0UUmtk7SemtFJnBwi8ptpMstiFGSwbf2GCDnhmR3/kUKPf3epAGV9rMwcga5GedYgr9o/TFMYhbrD4j1WJQbj9oc7mkvbMbwfvxkcw55KoNrMkqOWb8slcAAAAA=",
    credit: "i.pinimg.com",
  },
  "zyzz": {
    src: 'wall/zyzz-900.webp',
    srcset: "wall/zyzz-450.webp 450w, wall/zyzz-675.webp 675w, wall/zyzz-900.webp 900w",
    w: 900, h: 1575,
    lqip: "data:image/webp;base64,UklGRqwBAABXRUJQVlA4IKABAACQCACdASoYACsAPu1mrE+ppSQiKqoBMB2JaQASBh2mYB2bJgSp1t9e7hyPbQwWC5eYrblW+IqKCtjgq2lpX905R8w8e7yn9HH+y1lzgAD+70TPUztI8z1KUmi1Az3ZqmRgunZQeclHBfBbIkhQaI6bGeatF7UazTcUoqTy0+TVW5w7lAm8ieAp76cqnc94eiCwDX/X0/SCpkwg12pa6WjIgBQdsKN4FiQDgOVbnxcZXFt8BOnGIfY9ilj5369jZ00lQ30bYjgzA7ynAgEGCv7mBr3R3EGxKcEBJzrMa4aK8669N1nvLvVqGkqhPRT549vLo2XksXxlncnxARVWUGpn6GjS/pq3Q3r+s4yBATdN6BRAfzICdpWWUD4+mSd+8sLAx87kO73sGAz5mjOcwwYebCMZNciQ0wQpEZ6puxSe6aw8hUD9CPwtonL+fJNHejUECvKqLKGWLLmHE/CrGZd5C7Dn/WhammrQazXQlk4w2QObz2976wdnCTUZ7odjk1DWeWlhPefYatKTMJaE8RzqvB+4XogsZ0Mj5amaRgAAAA==",
    credit: "i.pinimg.com",
  },
}

export function wallImage(key: string): WallImage | undefined {
  return WALL_IMAGES[key]
}
