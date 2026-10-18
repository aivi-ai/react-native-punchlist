import { useState } from 'react';
import { ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';

/** Many-input form: the keyboard must not hide the sheet or the caret. */
export default function CheckoutFormScreen() {
  const [values, setValues] = useState<Record<string, string>>({});
  const [subscribe, setSubscribe] = useState(false);

  const field = (name: string, label: string) => (
    <View style={styles.field} key={name}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        value={values[name] ?? ''}
        onChangeText={(text) => setValues((current) => ({ ...current, [name]: text }))}
        placeholder={label}
        style={styles.input}
        autoCapitalize="none"
      />
    </View>
  );

  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={styles.h2}>Checkout form</Text>
      {field('email', 'Email')}
      {field('name', 'Full name')}
      {field('address', 'Address')}
      {field('city', 'City')}
      {field('postcode', 'Postcode')}
      {field('phone', 'Phone')}
      {field('note', 'Delivery note')}
      <View style={styles.switchRow}>
        <Text style={styles.label}>Subscribe</Text>
        <Switch value={subscribe} onValueChange={setSubscribe} />
      </View>
      {field('card', 'Card (never a real one)')}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 14, paddingBottom: 120 },
  h2: { fontSize: 20, fontWeight: '700' },
  field: { gap: 6 },
  label: { fontSize: 13, fontWeight: '600', opacity: 0.8 },
  input: { borderWidth: 1, borderColor: '#bbb', borderRadius: 8, paddingHorizontal: 12, minHeight: 44 },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
});
