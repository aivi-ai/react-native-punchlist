const { getDefaultConfig } = require('expo/metro-config');
const { withPunchlist } = require('react-native-punchlist/metro');

// One-time setup, not app code. Dev builds always get the punch list; production
// builds get an inert stub unless this is a preview build (EXPO_PUBLIC_PUNCHLIST=1).
module.exports = withPunchlist(getDefaultConfig(__dirname), {
  includeInProduction: process.env.EXPO_PUBLIC_PUNCHLIST === '1',
});
