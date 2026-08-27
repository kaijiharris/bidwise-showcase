import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

// ESLint 9 flat config for the Next.js app. We bridge the (still eslintrc-style)
// `eslint-config-next` shareable configs through FlatCompat -- this is the same
// shape `create-next-app` generates for Next 15. `eslint .` (see package.json)
// runs this non-interactively in CI and locally.
const eslintConfig = [
  {
    // Build output, generated types, coverage, and tooling artifacts: never linted.
    ignores: [
      ".next/**",
      "out/**",
      "build/**",
      "coverage/**",
      "next-env.d.ts",
    ],
  },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
];

export default eslintConfig;
