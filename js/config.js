// Addresses and the version. tools/build_mobile.py writes the version; the tests serve their own copy of this file
// (pointing at stand-ins for OpenRouter and Google Drive), so the app itself never has test switches.
export const CONFIG = {
  VERSION: '0.7.5',
  OPENROUTER: 'https://openrouter.ai/api/v1',
  OPENROUTER_AUTH: 'https://openrouter.ai/auth',
  DRIVE: 'https://www.googleapis.com/drive/v3',
  DRIVE_UPLOAD: 'https://www.googleapis.com/upload/drive/v3',
  GIS_SCRIPT: 'https://accounts.google.com/gsi/client',
  // The Google Cloud "OAuth client ID" (Web application) for app.kalamobhala.com and localhost:8766 (17 Nov 2026).
  // Not a secret: it is in every page that signs in with Google. A different one pasted in Settings wins.
  GOOGLE_CLIENT_ID: '436017564829-ah2ulf574l1bpo0ntc95ca3b64v2reou.apps.googleusercontent.com',
  // Where the app lives (OpenRouter's sign-in sends the browser back here; also sent as HTTP-Referer).
  APP_URL: location.origin + location.pathname.replace(/[^/]*$/, ''),
};
