/** @type {import("prettier").Config} */
export default {
  semi: true,
  singleQuote: true,
  trailingComma: 'all',
  printWidth: 100,
  tabWidth: 2,
  arrowParens: 'always',
  // A few files are committed with CRLF (the mobile app's app.json, metro config, two screens);
  // 'auto' keeps each file's own endings instead of failing them, and rewriting them all.
  endOfLine: 'auto',
};
