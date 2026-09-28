import { GoogleAuth, OAuth2Client } from "google-auth-library";

/**
 * Direct Google API client, replacing Replit's managed connectors proxy so
 * this server can run outside Replit (e.g. Google Cloud Run).
 *
 * Two authentication modes, chosen automatically:
 *
 * 1. OAuth refresh token (preferred for a personal Gmail account).
 *    Set GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET and
 *    GOOGLE_OAUTH_REFRESH_TOKEN. The server acts as the account owner, so
 *    uploaded scans land in the owner's own Drive and use the owner's
 *    storage. (Service accounts have no Drive storage quota, so uploads to
 *    a personal Drive folder can fail with them.)
 *    Scopes needed when generating the token:
 *      https://www.googleapis.com/auth/drive
 *      https://www.googleapis.com/auth/spreadsheets
 *
 * 2. Application Default Credentials (fallback). Used when the OAuth
 *    variables are not set: the service account attached to Cloud Run, or
 *    `gcloud auth application-default login` for local development.
 */

const DRIVE_BASE_URL = "https://www.googleapis.com";
const SHEETS_BASE_URL = "https://sheets.googleapis.com";

const SCOPES = [
  "https://www.googleapis.com/auth/drive",
  "https://www.googleapis.com/auth/spreadsheets",
];

type GoogleService = "google-drive" | "google-sheet";

let cachedOAuthClient: OAuth2Client | null = null;
let cachedAdcAuth: GoogleAuth | null = null;

function getOAuthClient(): OAuth2Client | null {
  const clientId = process.env["GOOGLE_OAUTH_CLIENT_ID"];
  const clientSecret = process.env["GOOGLE_OAUTH_CLIENT_SECRET"];
  const refreshToken = process.env["GOOGLE_OAUTH_REFRESH_TOKEN"];

  const provided = [clientId, clientSecret, refreshToken].filter(Boolean).length;
  if (provided === 0) return null;
  if (provided < 3) {
    throw new Error(
      "Incomplete Google OAuth configuration. Set all of GOOGLE_OAUTH_CLIENT_ID, " +
        "GOOGLE_OAUTH_CLIENT_SECRET and GOOGLE_OAUTH_REFRESH_TOKEN, or none of them.",
    );
  }

  if (!cachedOAuthClient) {
    const client = new OAuth2Client({ clientId, clientSecret });
    client.setCredentials({ refresh_token: refreshToken });
    cachedOAuthClient = client;
  }
  return cachedOAuthClient;
}

async function getAccessToken(): Promise<string> {
  const oauthClient = getOAuthClient();
  if (oauthClient) {
    const { token } = await oauthClient.getAccessToken();
    if (!token) {
      throw new Error(
        "Failed to obtain a Google access token from the OAuth refresh token. " +
          "The token may have been revoked, or the OAuth client credentials may be wrong.",
      );
    }
    return token;
  }

  if (!cachedAdcAuth) {
    cachedAdcAuth = new GoogleAuth({ scopes: SCOPES });
  }
  const client = await cachedAdcAuth.getClient();
  const tokenResponse = await client.getAccessToken();
  const token = typeof tokenResponse === "string" ? tokenResponse : tokenResponse?.token;
  if (!token) {
    throw new Error(
      "Failed to obtain a Google access token. Set the GOOGLE_OAUTH_* environment " +
        "variables, or attach a service account to the service.",
    );
  }
  return token;
}

/**
 * Mimics the shape of Replit's ReplitConnectors#proxy so the rest of the
 * Google Drive/Sheets integration code did not need to change: same
 * (service, path, init) signature, same Response return type.
 *
 * Exposed on a plain object so tests can substitute `googleClient.proxy`
 * the same way the old code substituted `ReplitConnectors.prototype.proxy`.
 */
export const googleClient = {
  async proxy(service: GoogleService, path: string, init?: RequestInit): Promise<Response> {
    const baseUrl = service === "google-drive" ? DRIVE_BASE_URL : SHEETS_BASE_URL;
    const token = await getAccessToken();
    const headers = new Headers(init?.headers);
    headers.set("Authorization", `Bearer ${token}`);
    return fetch(`${baseUrl}${path}`, { ...init, headers });
  },
};
