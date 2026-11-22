/**
 * The API a build talks to: `API_URL` from its EAS build profile (eas.json), else app.json's own
 * `extra.apiUrl` — so a test build can point at a tunnel without the address living in app.json.
 */
module.exports = ({ config }) => ({
  ...config,
  extra: { ...config.extra, ...(process.env.API_URL ? { apiUrl: process.env.API_URL } : {}) },
});
