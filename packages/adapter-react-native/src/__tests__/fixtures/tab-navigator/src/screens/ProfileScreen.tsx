import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

export default function ProfileScreen(): React.JSX.Element {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Profile</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 24, fontWeight: '700', color: '#333' },
});
