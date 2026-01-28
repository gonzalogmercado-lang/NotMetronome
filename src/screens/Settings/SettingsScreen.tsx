import { ScrollView, StyleSheet, Text, View } from "react-native";

function SettingsScreen() {
  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Settings</Text>

      <View style={styles.card}>
        <Text style={styles.label}>Audio</Text>
        <Text style={styles.text}>
          (Placeholder) Sacamos el panel viejo de debug de audio porque estaba desalineado con la API actual.
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 12 },
  title: { fontSize: 22, fontWeight: "700" },
  card: { padding: 14, borderRadius: 12, borderWidth: 1, borderColor: "#ddd" },
  label: { fontSize: 14, fontWeight: "700", marginBottom: 6 },
  text: { fontSize: 14, lineHeight: 20 },
});

export default SettingsScreen;
