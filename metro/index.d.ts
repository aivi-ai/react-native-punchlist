export interface WithPunchlistOptions {
  /**
   * Keep the real implementation in production bundles (internal/preview
   * builds). Default `false`: production bundles contain an inert stub.
   */
  includeInProduction?: boolean;
}

/** Wrap a Metro config. Returns the config unchanged unless `includeInProduction` is true. */
export function withPunchlist<T extends object>(config: T, options?: WithPunchlistOptions): T;
