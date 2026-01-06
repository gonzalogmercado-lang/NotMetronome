import { Text } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";

export default function AppRoot() {
  return (
    <SafeAreaProvider>
      <SafeAreaView style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <Text>NotMetronome OK ✅</Text>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}
