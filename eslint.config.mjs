/**
 * [INPUT]: Depends on ESLint JS/TypeScript/React Hooks Rules set and globals Environmental directory
 * [OUTPUT]: Provides the public desktop/UI monorepo flat config and unused-variable rules
 * [POS]: Root static-analysis configuration for the published Bottega source tree
 */

import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "apps/desktop/out/**",
      "apps/desktop/release/**",
      "**/node_modules/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  reactHooks.configs.flat.recommended,
  {
    files: [
      "apps/desktop/src/**/*.{ts,tsx}",
      "packages/ui/src/**/*.{ts,tsx}",
    ],
    languageOptions: {
      globals: globals.browser,
    },
  },
  {
    files: [
      "apps/desktop/electron/**/*.ts",
      "apps/desktop/shared/**/*.ts",
      "apps/desktop/electron.vite.config.ts",
    ],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { "argsIgnorePattern": "^_", "varsIgnorePattern": "^_" }
      ]
    }
  }
);
