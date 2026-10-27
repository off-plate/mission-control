import type { MC, ShellApi } from '../bridge'
export interface NothingHandle { update: (mc: MC) => void; unmount: () => void }
export function mountNothing(host: HTMLElement, api: ShellApi, init: MC): NothingHandle
