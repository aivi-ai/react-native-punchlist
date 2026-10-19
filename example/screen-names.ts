/**
 * Route template → friendly screen name.
 *
 * Kept as one explicit map so the label the punch list inserts is deterministic
 * and reviewable, instead of being derived from whatever the URL happens to be.
 */
const SCREEN_NAMES: Record<string, string> = {
  index: 'HomeFeedScreen',
  '(tabs)/index': 'HomeFeedScreen',
  '(tabs)/orders': 'OrdersListScreen',
  form: 'CheckoutFormScreen',
  'orders/[id]': 'OrderDetailScreen',
  'orders/[id]/tracking': 'OrderTrackingScreen',
  modal: 'FilterModalScreen',
};

/** Resolve a label from committed `useSegments()` output. */
export function screenNameForSegments(segments: readonly string[]): string {
  const key = segments.join('/');
  if (SCREEN_NAMES[key]) return SCREEN_NAMES[key];
  for (let length = segments.length; length > 0; length--) {
    const candidate = segments.slice(0, length).join('/');
    if (SCREEN_NAMES[candidate]) return SCREEN_NAMES[candidate];
  }
  if (segments.length > 0) {
    const leaf = segments[segments.length - 1];
    return leaf === '' ? 'Unknown' : leaf.charAt(0).toUpperCase() + leaf.slice(1);
  }
  return 'UnknownScreen';
}
