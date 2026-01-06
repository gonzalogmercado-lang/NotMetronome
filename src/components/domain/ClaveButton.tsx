import { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

type ClaveButtonProps = {
  onPress: () => void;
  meterLabel: string;
  accentPreview?: string;
  footer?: ReactNode;
};

function ClaveButton({ onPress, meterLabel, accentPreview, footer }: ClaveButtonProps) {
  return (
    <Pressable onPress={onPress} style={styles.button}>
      <View style={styles.header}>
        <Text style={styles.title}>Clave</Text>
        <Text style={styles.meter}>{meterLabel}</Text>
      </View>
      {accentPreview ? <Text style={styles.preview}>{accentPreview}</Text> : null}
      {footer ? <View style={styles.footer}>{footer}</View> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#aaa",
    padding: 12,
    borderRadius: 10,
    backgroundColor: "#f5f5f5",
    gap: 6,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  title: {
    fontWeight: "700",
    fontSize: 16,
  },
  meter: {
    fontVariant: ["tabular-nums"],
    color: "#555",
  },
  preview: {
    fontFamily: "monospace",
    color: "#222",
  },
  footer: {
    marginTop: 4,
  },
});

export default ClaveButton;
