// Only the slice of the optional peers that the adapter uses. The real packages
// provide their own (richer) types in the host app; these keep this repo free of
// installing them.
declare module 'expo-router' {
  export function useSegments(): string[];
  /** Present from the SDK that re-exports React Navigation's theming. */
  export const useTheme: undefined | (() => unknown);
}

declare module 'react-native-safe-area-context' {
  export function useSafeAreaInsets(): { top: number; right: number; bottom: number; left: number };
}
