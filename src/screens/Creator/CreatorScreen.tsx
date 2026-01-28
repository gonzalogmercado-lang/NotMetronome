import { ScrollView, StyleSheet, Text, View } from "react-native";

function CreatorScreen() {
  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Creator</Text>

      <View style={styles.card}>
        <Text style={styles.label}>Proyectos</Text>
        <Text style={styles.text}>
          (Placeholder) Acá va la lista de proyectos. Al tocar uno: detalle + entrar a Sequence.
        </Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.label}>Sequence</Text>
        <Text style={styles.text}>
          (Placeholder) Dentro del proyecto vive el secuenciador: bar index tipo 1.1.1, var1/var2/var3 y el botón + para sumar bars.
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

export default CreatorScreen;
