/**
 * Compile-time proof that what the package root exposes (to bundlers and to
 * Node) and the inert `/noop` build have exactly the types of `/full`, so the
 * build-time swap can never break a host. Checked by `npm run typecheck`.
 */
import type * as Full from '../../src/full';
import type * as Root from '../../src/index';
import type * as Entry from '../../entry/index';
import type * as Node from '../../entry/node';
import type * as Noop from '../../entry/noop';
import type * as Adapter from '../../src/adapters/expo-router';
import type * as AdapterEntry from '../../entry/expo-router';
import type * as AdapterNode from '../../entry/expo-router.node';
import type * as AdapterNoop from '../../entry/expo-router.noop';

type Same<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
function assertSame<_T extends true>(): void {}

assertSame<Same<typeof Root, typeof Full>>();
assertSame<Same<typeof Entry, typeof Full>>();
assertSame<Same<typeof Node, typeof Full>>();
assertSame<Same<typeof Noop, typeof Full>>();
assertSame<Same<typeof AdapterEntry, typeof Adapter>>();
assertSame<Same<typeof AdapterNode, typeof Adapter>>();
assertSame<Same<typeof AdapterNoop, typeof Adapter>>();
