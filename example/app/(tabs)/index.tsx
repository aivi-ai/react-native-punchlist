import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { Link } from 'expo-router';

const ROWS = Array.from({ length: 200 }, (_, index) => ({
  id: `row-${index}`,
  title: `Feed row ${index + 1}`,
  detail: `Long scrolling list — row ${index + 1} of 200`,
}));

/** Long scrolling list: the FAB must stay reachable while the list scrolls. */
export default function HomeScreen() {
  return (
    <FlatList
      data={ROWS}
      keyExtractor={(item) => item.id}
      contentContainerStyle={styles.content}
      ListHeaderComponent={
        <View style={styles.header}>
          <Text style={styles.h1}>Home feed</Text>
          <Text style={styles.p}>
            Tap the punch-list FAB, type a note, close it, reopen it — the draft survives because
            AsyncStorage is wired as the adapter.
          </Text>
          <View style={styles.links}>
            <Link href="/form" style={styles.link}>
              Checkout form →
            </Link>
            <Link href="/modal" style={styles.link}>
              Filter modal →
            </Link>
          </View>
        </View>
      }
      renderItem={({ item }) => (
        <Pressable style={styles.row}>
          <Text style={styles.rowTitle}>{item.title}</Text>
          <Text style={styles.rowDetail}>{item.detail}</Text>
        </Pressable>
      )}
    />
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 8 },
  header: { gap: 8, paddingBottom: 12 },
  h1: { fontSize: 24, fontWeight: '700' },
  p: { fontSize: 14, opacity: 0.7, lineHeight: 20 },
  links: { flexDirection: 'row', gap: 16, paddingTop: 4 },
  link: { fontSize: 15, fontWeight: '600' },
  row: { paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#ccc' },
  rowTitle: { fontSize: 16, fontWeight: '600' },
  rowDetail: { fontSize: 13, opacity: 0.6 },
});
