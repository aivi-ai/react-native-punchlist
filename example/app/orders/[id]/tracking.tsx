import { StyleSheet, Text, View } from 'react-native';

/** Second-level leaf: proves a nested focused route is what gets captured. */
export default function TrackingScreen() {
  return (
    <View style={styles.root}>
      <Text style={styles.h2}>Tracking</Text>
      <Text style={styles.p}>
        Open the punch list here and the prefix is <Text style={styles.code}>- [ ] OrderTrackingScreen: </Text>
        — clear evidence the resolver reports the focused leaf inside a nested navigator.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, padding: 16, gap: 12 },
  h2: { fontSize: 20, fontWeight: '700' },
  p: { fontSize: 14, opacity: 0.7, lineHeight: 20 },
  code: { fontFamily: 'monospace' },
});
