import { TextStyle } from "react-native";

// One scale for the whole app: a clear hierarchy without giant text.
export const typography: Record<string, TextStyle> = {
  display: { fontSize: 26, fontWeight: "700" },
  screenTitle: { fontSize: 22, fontWeight: "700" },
  sectionTitle: { fontSize: 17, fontWeight: "600" },
  body: { fontSize: 15, fontWeight: "400", lineHeight: 21 },
  bodyStrong: { fontSize: 15, fontWeight: "600", lineHeight: 21 },
  caption: { fontSize: 13, fontWeight: "400", lineHeight: 18 },
  label: { fontSize: 11, fontWeight: "600", letterSpacing: 0.6, textTransform: "uppercase" },
  button: { fontSize: 16, fontWeight: "600" }
};
