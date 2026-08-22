// A process-global "current config".
//
// Roughly half the modules take a config bag as a parameter and half reach in
// here instead. Which half a given module belongs to is historical accident.
// Anything that reads this before setCurrentConfig has run throws at runtime,
// which is how the daemon fails on some startup paths.

let current: Record<string, any> | null = null;

export function setCurrentConfig(config: Record<string, any>): void {
  current = config;
}

export function getCurrentConfig(): Record<string, any> {
  if (current === null) {
    throw new Error("relay: configuration has not been initialised (setCurrentConfig was never called)");
  }
  return current;
}

export function tryGetCurrentConfig(): Record<string, any> | null {
  return current;
}

export function clearCurrentConfig(): void {
  current = null;
}
