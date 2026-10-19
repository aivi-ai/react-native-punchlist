import { Link } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';

export default function OrdersScreen() {
  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={styles.h2}>Orders</Text>
      {['A-1001', 'A-1002', 'A-1003'].map((id) => (
        <Link key={id} href={`/orders/${id}`} asChild>
          <Pressable style={styles.row}>
            <Text style={styles.rowTitle}>Order {id}</Text>
          </Pressable>
        </Link>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 12 },
  h2: { fontSize: 20, fontWeight: '700' },
  row: { paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#ccc' },
  rowTitle: { fontSize: 16 },
});
