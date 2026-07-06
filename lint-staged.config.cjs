module.exports = {
  '*.{js,cjs,mjs,ts,tsx}': ['pnpm exec eslint --max-warnings=0'],
  '*.{js,cjs,mjs,ts,tsx,json,md,yml,yaml}': ['pnpm exec prettier --check'],
};
