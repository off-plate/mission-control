/* The launch screen (index.html) takes the app's real steps: how far along it is, and when it is ready. A no-op on a
   desktop, where there is no launch screen. */
type Splash = { set(p: number): void; done(): void }
const s = () => (window as unknown as { mcSplash?: Splash }).mcSplash

export const splash = {
  /** Reached this far (0 to 100). Only ever moves forward. */
  set: (p: number) => s()?.set(p),
  /** The first real screen has drawn: the dots collapse and the launch screen goes. */
  done: () => s()?.done(),
}
