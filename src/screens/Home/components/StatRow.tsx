import { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";

type StatRowProps = {
  label: string;
  value: ReactNode;
};

function StatRow({ label, value }: StatRowProps) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    width: "100%",
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#ccc",
  },
  label: {
    fontWeight: "600",
    color: "#333",
  },
  value: {
    fontVariant: ["tabular-nums"],
  },
});

export default StatRow;
