/**
 * Plain React Navigation integration (snippet, not installed in the example).
 *
 * The host owns the navigation ref and reads it inside the resolver — the punch
 * list never wraps or replaces the navigator.
 *
 *   npm install @react-navigation/native @react-navigation/native-stack \
 *     react-native-screens react-native-safe-area-context
 */
import { createNavigationContainerRef, NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Punchlist } from 'react-native-punchlist';
import { Text, View } from 'react-native';

export type RootStackParamList = {
  Home: undefined;
  Orders: undefined;
  OrderDetail: { id: string };
};

export const navigationRef = createNavigationContainerRef<RootStackParamList>();

const Stack = createNativeStackNavigator<RootStackParamList>();

/**
 * Returns `undefined` until the container is ready. The punch list treats a
 * missing label as plain capture, so a cold start is never a prefix like
 * "undefined" or a raw route path.
 */
function currentScreenName(): string | undefined {
  if (!navigationRef.isReady()) return undefined;
  return navigationRef.getCurrentRoute()?.name;
}

export function App() {
  return (
    <NavigationContainer ref={navigationRef}>
      <Stack.Navigator>
        <Stack.Screen name="Home">
          {() => (
            <View>
              <Text>Home</Text>
            </View>
          )}
        </Stack.Screen>
        <Stack.Screen name="Orders">
          {() => (
            <View>
              <Text>Orders</Text>
            </View>
          )}
        </Stack.Screen>
        {/* Nested navigator: the focused leaf route is what `getCurrentRoute()`
            reports, so a nested screen captures as OrderDetail, not "Orders". */}
        <Stack.Screen name="OrderDetail">
          {() => (
            <View>
              <Text>Order detail</Text>
            </View>
          )}
        </Stack.Screen>
      </Stack.Navigator>
      <Punchlist
        enabled
        appId="react-navigation-host"
        getContext={() => ({ screen: currentScreenName() })}
        onOpen={() => {
          /* host-side hook, e.g. logging */
        }}
      />
    </NavigationContainer>
  );
}
