import { TextStyle } from "react-native";

export const typography: Record<string, TextStyle> = {
  screenTitle: { fontSize: 22, fontWeight: "700" },
  sectionTitle: { fontSize: 17, fontWeight: "700" },
  body: { fontSize: 15, fontWeight: "400" },
  bodyStrong: { fontSize: 15, fontWeight: "600" },
  caption: { fontSize: 13, fontWeight: "400" },
  label: { fontSize: 12, fontWeight: "600", letterSpacing: 0.4, textTransform: "uppercase" },
  button: { fontSize: 16, fontWeight: "700" }
};
