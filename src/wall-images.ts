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
  "diamond-gym": {
    src: 'wall/diamond-gym-900.webp',
    srcset: "wall/diamond-gym-450.webp 450w, wall/diamond-gym-675.webp 675w, wall/diamond-gym-900.webp 900w",
    w: 900, h: 900,
    lqip: "data:image/webp;base64,UklGRuQAAABXRUJQVlA4INgAAACQBQCdASoYABgAPu1usFIppiSiqAgBMB2JZQDNxauWy9nUExeKFtRlEIz4AdeD5HSBQW2bhAD944As/8xWF2wN3MV7w2mRxg3cGhB7gCbtsN4CDB88crzg1tf2Zmit/5MADy/GC/TLlgMk6MedM0PL2ysTS3OMqVYyOQRBpfkd9OYCPOjX9PNuo/BRvtHGSXFIdle7kskeFM663P6KzTb6yCb9sCcWW4fsk/FaCufkJ6+UIPvlWa9hwoBjEN+uoiYn4m/FjWoiH2YvjxoIeWGQv3QnUBnmQAA=",
    credit: "gymcrasher.com",
  },
  "family-field": {
    src: 'wall/family-field-900.webp',
    srcset: "wall/family-field-450.webp 450w, wall/family-field-675.webp 675w, wall/family-field-900.webp 900w",
    w: 900, h: 1350,
    lqip: "data:image/webp;base64,UklGRsgAAABXRUJQVlA4ILwAAAAwBQCdASoYACQAPu1uqlAppqOiqrgMATAdiWkA0qwFWV9zmFE6Adfd5BmmJ5iZPdlwAAD9+iGqKj8MkFxmooUOC72CsT0f/6zxQT9jcemeM1cZxdRTSCjwJ5Qnm1oxawoRhA9ZB9XDCU7dHm5rk6oJaDE9ozSoO4K0ojZ6mOB2By+7X+ryZYj86HGd15fTM2DWCFRsrlfgldt0isHv2kQKPZAQjg4jsmoqPpS6t7rx+KckCfAqxQUBxgAAAA==",
    credit: "i.pinimg.com",
  },
  "gle63s": {
    src: 'wall/gle63s-900.webp',
    srcset: "wall/gle63s-450.webp 450w, wall/gle63s-675.webp 675w, wall/gle63s-900.webp 900w",
    w: 900, h: 600,
    lqip: "data:image/webp;base64,UklGRqoAAABXRUJQVlA4IJ4AAAAQBACdASoYABAAPu1iqU2ppaOiMAgBMB2JZwDE2CICUWrqJ1RXqFEEqADypF+s2eknDQrQwjIgsqkzGxurlhZQXQph9FLv8qF0d6BCJARmYKwqVDBKc6cLI5T2XCbgOZAyq3wXk+wFcfGX8rv3+dvx67GPoMw/tew6fXMO35mTEIWJ4MOCkenakYrF5ILozUPMU16Eb/HpfS2T8AAAAA==",
    credit: "autodrift.ae",
  },
  "golden-field": {
    src: 'wall/golden-field-900.webp',
    srcset: "wall/golden-field-450.webp 450w, wall/golden-field-675.webp 675w, wall/golden-field-900.webp 900w",
    w: 900, h: 600,
    lqip: "data:image/webp;base64,UklGRn4AAABXRUJQVlA4IHIAAAAQBACdASoYABAAPu1iqU2ppaOiMAgBMB2JZACdACHogp6M2FR255YUUgD+l5vFY4M3edyroHkKJRpsiFupUWTkufGl+JkfbGtIylQ5E2BGWoRYQA7oAidDg82msfHXWISOBcwmKGpUf9VkH4gBCSC9gAA=",
    credit: "i.pinimg.com",
  },
  "gym-six": {
    src: 'wall/gym-six-900.webp',
    srcset: "wall/gym-six-450.webp 450w, wall/gym-six-675.webp 675w, wall/gym-six-900.webp 900w",
    w: 900, h: 1200,
    lqip: "data:image/webp;base64,UklGRgABAABXRUJQVlA4IPQAAADQBQCdASoYACAAPu1grFAppSQisBgIATAdiWkACBpYm7Bsdn+T8uPXEr7gTrToYD8rEQ2fI44AAP7Zna0MXrQ7vkJYu7LwgjbjAjlriFR2CC+pI0t/+wWbbM5yGgneHh4QsCPJFyxHsU5hkliIiVlkVLtnUCu4C9t+Pc605dgVd5CRuOQdhG1XX+yWussCHnC0/AP8D+03dwl6GmNJZS9qvf9h/gJB+CWphdnlm+E4Kv02xUWsfFTYD6kKx/DlRpLPKKoOTbWDfar+WvIQFB3sp0KUq8L+w9iVj4LlsLDoHjHW+NzLGtZ8qSNWwpmYleEV8AAA",
    credit: "i.pinimg.com",
  },
  "her": {
    src: 'wall/her-900.webp',
    srcset: "wall/her-450.webp 450w, wall/her-675.webp 675w, wall/her-900.webp 900w",
    w: 900, h: 1344,
    lqip: "data:image/webp;base64,UklGRuoAAABXRUJQVlA4IN4AAACQBgCdASoYACQAPu1uq1GppiOipWzJMB2JYgCpJ5OFrqpf8kxKSoxrBJ8Z5oZBrSJ5lUUdywPEHZ1+YHQAAP73BOro7lb6v3itvn0195b1vZ1aYZieNgfwU/0BTAvIEnukiAOVswCuHAGbWNtXEkn2OMNyexlTAoXl7PIDEmylPw3Q6ivT5+wzgMkttqAU09kadyIFTVpvcKs+CK+zzkdP66JMsEa/hM8nZeY9aklOAN70fEvJiSQ5vkWYCXbhFDEfZbhUzW4qJHUXmuRkAuI0swCXGsOGYRJ2SWMoAAA=",
    credit: "i.pinimg.com",
  },
  "late-desk": {
    src: 'wall/late-desk-900.webp',
    srcset: "wall/late-desk-450.webp 450w, wall/late-desk-675.webp 675w, wall/late-desk-900.webp 900w",
    w: 900, h: 675,
    lqip: "data:image/webp;base64,UklGRowAAABXRUJQVlA4IIAAAAAwBACdASoYABIAPu1krE+ppSQiMBgIATAdiWMAVwsDVHzeCzkjuPMnlsAA/tzUpyDP03knbwl1v+/9x+WlxDBO7zLEL6xFJIYIN/fPfQ8b39jW7eLY2/Lg3p/Pl71vspM8LGUANSuwy0MTGDV/Y1HsKO5RKws9H2LLJeOdsygAAA==",
    credit: "i.pinimg.com",
  },
  "liguria": {
    src: 'wall/liguria-900.webp',
    srcset: "wall/liguria-450.webp 450w, wall/liguria-675.webp 675w, wall/liguria-900.webp 900w",
    w: 900, h: 600,
    lqip: "data:image/webp;base64,UklGRqgAAABXRUJQVlA4IJwAAACwBACdASoYABAAPu1iqU2ppaOiMAgBMB2JbACdHYCNq2/+A8ctRHQWIb57AouwAPpZRMQ4TZnyObC88REYNVLaEfJEHuot4+xTpxjiZ9HxWFpd6800NSVPs7xHG6653s3xzjL36bx0vvcGvDcUuU4yiRSqzs4hNe8D12+9/nzuk5zjS0HyNcdfsMYG+zPXJwOm+J4QTtv1LNbqAAA=",
    credit: "get.pxhere.com",
  },
  "newborn": {
    src: 'wall/newborn-900.webp',
    srcset: "wall/newborn-450.webp 450w, wall/newborn-675.webp 675w, wall/newborn-900.webp 900w",
    w: 900, h: 1200,
    lqip: "data:image/webp;base64,UklGRgABAABXRUJQVlA4IPQAAACwBgCdASoYACAAPu1grFAppSQisBgIATAdiUATpnHk5Sa97umKQ64qbyUeVl2QWrLm6b8z5bxm4wfPHipOwAD1WRzs4NBOPgGY2QVAgU1v4tGO4GOCyy2lYnHZDc4dpXtDINvKSWZX2TPjPCmmd+M609Cnmw01Vpwk+RAZjWqR5AW0EiltorULZCYCwVJ220D7TXnOS7FAiRVxRPuM5yoXWCFunzKulJ8Hp+HgZ5uiNnowT6vZkJtlBlxLFwVkW3qFJWqXmvNT06CeBlBQdOmFrNr6FopySXBxnvj8toY2ab29jIykkE/r2VjFs/VC5o/AAAAA",
    credit: "i.pinimg.com",
  },
  "noel-deyzel": {
    src: 'wall/noel-deyzel-900.webp',
    srcset: "wall/noel-deyzel-450.webp 450w, wall/noel-deyzel-675.webp 675w, wall/noel-deyzel-900.webp 900w",
    w: 900, h: 1350,
    lqip: "data:image/webp;base64,UklGRvQAAABXRUJQVlA4IOgAAAAwBgCdASoYACQAPu1sr1GppaQipWsxMB2JYwDKAC6b+7QREUDA5A1FI1d/IFogag9z4GUUXp7u0ZLAAP73ef1qtT2o5Ddvy0fr+kVlgZB/98/RKJXyM6DiYCAkTTbR6/fHeJT+0xyRfBrsob+goC7KGVR5s5PTKws3+ZYc8X+PVfKzNExx28Uv3hsK5vd93U6U34lCZPMEgtlzIGb2z11yK/xfjhbO5Vm+45bBylcBvejUnVpB2cfrHnKX1dUGdnVo5Mgwj+fb6tdiIjAbroS/7dTQKsYAuc0C+RB+dh/XFd4ENRecaCAA",
    credit: "noeldeyzelshop.com",
  },
  "old-photo": {
    src: 'wall/old-photo-900.webp',
    srcset: "wall/old-photo-450.webp 450w, wall/old-photo-675.webp 675w, wall/old-photo-900.webp 900w",
    w: 900, h: 1284,
    lqip: "data:image/webp;base64,UklGRvoAAABXRUJQVlA4IO4AAABwBwCdASoYACIAPu1opk+ppiMiKqwBMB2JZwDDsa4xpFrKD435k3LkDUcIlnE8T2M/LwjD0Dwrg0lbtRavtX2pHbxLAAD5I483TgtHxIWy+JmBVsbU7g6gUL5apVBMuGaRbfMdl97k6zxcCl0QbAgc2OgIMr4rPJR21wISJurTpPsxnVqDVneGp1qOhOXF4RK2TYq7c7ljraT1tYYDIapZuFsccIg4jxZ/pMnEbdKDGiItZcIWkaEstKUHi20vjjiNX4I9c/IhBpSiIaOu6RPhTrNlw5WRfZu8/iahB2vOvAcSLS6Tl0A79arwAAAA",
    credit: "memoreel.family",
  },
  "one-light": {
    src: 'wall/one-light-900.webp',
    srcset: "wall/one-light-450.webp 450w, wall/one-light-675.webp 675w, wall/one-light-900.webp 900w",
    w: 900, h: 600,
    lqip: "data:image/webp;base64,UklGRkQAAABXRUJQVlA4IDgAAAAwAwCdASoYABAAPu1orU6ppiSiMAgBMB2JZwABQ7NywaAAAP764bWqBkLHo6TXxPqIqLGWgIAAAA==",
    credit: "images.unsplash.com",
  },
  "prague-dawn": {
    src: 'wall/prague-dawn-900.webp',
    srcset: "wall/prague-dawn-450.webp 450w, wall/prague-dawn-675.webp 675w, wall/prague-dawn-900.webp 900w",
    w: 900, h: 1200,
    lqip: "data:image/webp;base64,UklGRuAAAABXRUJQVlA4INQAAADQBQCdASoYACAAPu1cqE2ppKQiN/VYATAdiUAZQAHonDpPfwlyHThsaHXK9gQHCI+TjlhQ6E5gAP4E7kcaHfqkV+QnBUA2MgDh3LdXCgL1f3D49fE7EAx5S7Nk6SsI28XdBg+lwL+yEV+0QDIKpo5E6gbE9R0RtfpgC1oTVbSzFMd+z+R21Og6375HOimOclRQ8YFR69yH66FP1pG0n0Do6hDOlFERKFhlaU5vvjdhnPGfsubNMIMLnsNNg553Dt2XuN3sebctRmKsbP4FO8OKxGKAAA==",
    credit: "images.pexels.com",
  },
  "prague-night": {
    src: 'wall/prague-night-900.webp',
    srcset: "wall/prague-night-450.webp 450w, wall/prague-night-675.webp 675w, wall/prague-night-900.webp 900w",
    w: 900, h: 663,
    lqip: "data:image/webp;base64,UklGRqAAAABXRUJQVlA4IJQAAAAQBQCdASoYABIAPu1mqk8ppaOiKA1RMB2JYwCdM1j73Cam/gTVmNSBoATcmlUOktYAAP7jHqSKTKGwR//HhkrKDowEmaxMsR1eVyu3JUpXndrBmwEgGqlSN/YAF9NqwALtsopVKAkepdHnk/EAcvDPuYocoLCb0Fap4ib7Mcw/5g6QklKq6og6qiLMXkeZjdDUe4AA",
    credit: "libreshot.com",
  },
  "red-car": {
    src: 'wall/red-car-900.webp',
    srcset: "wall/red-car-450.webp 450w, wall/red-car-675.webp 675w, wall/red-car-900.webp 900w",
    w: 900, h: 598,
    lqip: "data:image/webp;base64,UklGRtgAAABXRUJQVlA4IMwAAABQBACdASoYABAAPu1iqU2ppaOiMAgBMB2JagCdAYtymhGqbj3qD6vuB0WoAP7A/sX86oL8+rqwHtdf4WoBgAY8pcVkf4DImldJ/WcwniKxXZr5spDbaP/jb/iNWzt4l2Y78Oa/Mecr9pp9Lzl8yfgchNKBluGaXr77YwJq6wtMrOYdsWwndXn4uS++9MXMb3MmtkNdO0WwYEJB+Bbc6tozMzVXxMIwcEkp/ZEr9nWvH7qGqP/viuGar3+6AVfZ8SG6UNyL5QIfgaoVAAA=",
    credit: "i.redd.it",
  },
  "the-bar": {
    src: 'wall/the-bar-900.webp',
    srcset: "wall/the-bar-450.webp 450w, wall/the-bar-675.webp 675w, wall/the-bar-900.webp 900w",
    w: 900, h: 563,
    lqip: "data:image/webp;base64,UklGRsAAAABXRUJQVlA4ILQAAAAwBACdASoYAA4APu1iqU2ppaOiMAgBMB2JYwBTAJcAxwAhkpI1LDJDZQAA+yEF/9LXpaJFbzzf9pzUYTSOUhoE1bMJVyrRy/XEIdmEy9hm5WPbGP+HuzZmPMjHHsPrYpLcFfQPW/nzuKzifaecAU551R3LZ5l9JstNNqjoe/QsExFyvldn9HSby+N+V7IbnOv5pqtx+EIDu2HHw5yDZfM8zIzXTeqkOk2vp0yD6i/yec3AAAA=",
    credit: "cdnimg.co",
  },
  "villa": {
    src: 'wall/villa-900.webp',
    srcset: "wall/villa-450.webp 450w, wall/villa-675.webp 675w, wall/villa-900.webp 900w",
    w: 900, h: 563,
    lqip: "data:image/webp;base64,UklGRrYAAABXRUJQVlA4IKoAAACQBACdASoYAA4APu1iqU2ppaOiMAgBMB2JYgCdIExCucuKXT864sB/t3Uv5kAA4V0+vc3kx8KbanmEWf8pYC675ZWibPED9D/3C4M2KErgqI+h2Fhwp+5/WUhZPDTSd4fhgUceZ0pCngy+qFc6dG8n7919sAPUUpjfN+PjNQo8WF5zWNwP+jeXFZKjQPPb4l6LZMl5EAcXE1nQfbuET0CRnihWqJTR8h0AAA==",
    credit: "i.pinimg.com",
  },
  "windows-lit": {
    src: 'wall/windows-lit-900.webp',
    srcset: "wall/windows-lit-450.webp 450w, wall/windows-lit-675.webp 675w, wall/windows-lit-900.webp 900w",
    w: 900, h: 563,
    lqip: "data:image/webp;base64,UklGRr4AAABXRUJQVlA4ILIAAADwBACdASoYAA0APu1iqU2ppaOiMAgBMB2JZACdMoR3H1/E2B72EFyfbXq9wgFSaCQA/uzY5o1on4cGE6Rk+lSyM55PZ/zPi7/+GXY1sDM2wnX1usRnV+RJdPzodPCY+zoR3QgYdpMlHb7VuBADSBvnFJMlcon8NiVSanWAfGFEjR8mvX6iCscFNJpOZtrovWTWP1w94eqfNhy5uO7gm54v2gIRS5AQ85Oc+oVnmXICgAAA",
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
    w: 900, h: 563,
    lqip: "data:image/webp;base64,UklGRmYAAABXRUJQVlA4IFoAAADQAwCdASoYAA4APu1iqU2ppaOiMAgBMB2JZwAAWk8O/Kn3GTxPSKAA/ujb35tXPpnXkcRo7tmBCP31ymyRNSdfLX4jSYnKb2TZdKf11f0e+BdcCe7CN8KAAAA=",
    credit: "wallpaperaccess.com",
  },
}

export function wallImage(key: string): WallImage | undefined {
  return WALL_IMAGES[key]
}
