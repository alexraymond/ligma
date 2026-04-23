// Structural CoreLogger — identical shape to `@ligma/core`'s
// `CoreLogger` so main-process callers can pass the same scoped logger they
// use everywhere else. Duplicated (not imported) because this package sits
// below core in the dep graph and we don't want to invert that.
export interface CoreLogger {
  info: (event: string, data?: Record<string, unknown>) => void;
  warn: (event: string, data?: Record<string, unknown>) => void;
  error: (event: string, data?: Record<string, unknown>) => void;
}

export const NOOP_LOGGER: CoreLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
};
