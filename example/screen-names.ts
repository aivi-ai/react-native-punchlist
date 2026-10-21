/**
 * Route template → friendly screen name.
 *
 * Kept as one explicit map so the label the punch list inserts is deterministic
 * and reviewable, instead of being derived from whatever the URL happens to be.
 */
export const SCREENS: Record<string, string> = {
  index: 'HomeFeedScreen',
  '(tabs)/index': 'HomeFeedScreen',
  '(tabs)/orders': 'OrdersListScreen',
  form: 'CheckoutFormScreen',
  'orders/[id]': 'OrderDetailScreen',
  'orders/[id]/tracking': 'OrderTrackingScreen',
  modal: 'FilterModalScreen',
};
