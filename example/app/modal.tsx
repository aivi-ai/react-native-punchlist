import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useState } from 'react';

/**
 * A host-owned native modal. Known limitation: such a modal can cover the root
 * FAB — the sheet itself still works, and `show()`/the web hotkey restore the FAB
 * once the modal is dismissed.
 */
export default function FilterModalScreen() {
  const [open, setOpen] = useState(true);
  return (
    <View style={styles.root}>
      <Text style={styles.h2}>Filters</Text>
      <Pressable style={styles.button} onPress={() => setOpen(true)}>
        <Text style={styles.buttonLabel}>Show host modal</Text>
      </Pressable>
      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <View style={styles.backdrop}>
          <View style={styles.sheet}>
            <Text style={styles.h2}>Host native modal</Text>
            <Text style={styles.p}>
              While this is open the punch-list FAB may be covered. Dismiss it, then reopen the punch
              list — notes typed before are still there.
            </Text>
            <Pressable style={styles.button} onPress={() => setOpen(false)}>
              <Text style={styles.buttonLabel}>Close</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, padding: 16, gap: 12 },
  h2: { fontSize: 20, fontWeight: '700' },
  p: { fontSize: 14, opacity: 0.7, lineHeight: 20 },
  button: { backgroundColor: '#2563eb', borderRadius: 10, paddingVertical: 14, alignItems: 'center' },
  buttonLabel: { color: '#fff', fontWeight: '600' },
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.35)' },
  sheet: { backgroundColor: '#fff', borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 16, gap: 12 },
});
