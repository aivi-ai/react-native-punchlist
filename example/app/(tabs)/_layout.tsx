import { Tabs } from 'expo-router';

/** Nested navigator: the punch list reports the focused leaf inside these tabs. */
export default function TabsLayout() {
  return (
    <Tabs>
      <Tabs.Screen name="index" options={{ title: 'Feed' }} />
      <Tabs.Screen name="orders" options={{ title: 'Orders' }} />
    </Tabs>
  );
}
