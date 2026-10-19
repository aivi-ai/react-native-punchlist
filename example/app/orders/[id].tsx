import { Link, useLocalSearchParams } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

/** Nested dynamic route: the label comes from the route template, not the id. */
export default function OrderDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <View style={styles.root}>
      <Text style={styles.h2}>Order {id}</Text>
      <Text style={styles.p}>
        The captured label for this route is <Text style={styles.code}>OrderDetailScreen</Text> —
        the dynamic id is deliberately not collected.
      </Text>
      <Link href={`/orders/${id}/tracking`} style={styles.link}>
        Tracking →
      </Link>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, padding: 16, gap: 12 },
  h2: { fontSize: 20, fontWeight: '700' },
  p: { fontSize: 14, opacity: 0.7, lineHeight: 20 },
  code: { fontFamily: 'monospace' },
  link: { fontSize: 15, fontWeight: '600' },
});
