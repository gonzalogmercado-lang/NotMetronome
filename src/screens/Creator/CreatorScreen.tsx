import { StyleSheet, Text, View } from "react-native";

function CreatorScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Creator</Text>
      <Text>Track and pattern tools coming soon.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    gap: 8,
  },
  title: {
    fontSize: 24,
    fontWeight: "600",
  },
});

export default CreatorScreen;
