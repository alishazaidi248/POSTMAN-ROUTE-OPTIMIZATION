import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

// The backend's own rules: the recommended TypeScript set, with errors for real mistakes. Nothing is switched off to make it pass.
export default tseslint.config(
  { ignores: ["dist/**", "node_modules/**", "coverage/**", "uploads/**", "backups/**", "data/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node } },
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", ignoreRestSiblings: true }],
      // A "as any" hides a type error; the few that remain say why in a comment.
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/ban-ts-comment": "error",
      "no-console": ["error", { allow: ["warn", "error"] }]
    }
  },
  {
    // Operational scripts and prisma seeds talk to a person through the console
    files: ["scripts/**/*.ts", "prisma/**/*.ts"],
    rules: { "no-console": "off" }
  },
  {
    files: ["tests/**/*.ts"],
    rules: { "@typescript-eslint/no-explicit-any": "off", "no-console": "off" }
  }
);
