import { GoogleAuth } from "google-auth-library";

/**
 * Direct Google API client using Application Default Credentials (ADC),
 * replacing Replit's managed connectors proxy so this server can run
 * anywhere, and replacing the earlier OAuth-refresh-token approach now that
 * this app deploys to Google Cloud Run.
 *
 * On Cloud Run, ADC is provided automatically by the service account
 * attached to the running service — no key file, no refresh token, nothing
 * to download or rotate. This sidesteps the org policy that blocks service
 * account *key creation* entirely, since Cloud Run never needs to export a
 * key: it uses the service account's identity directly via the metadata
 * server.
 *
 * Setup required (see README/deployment notes):
 * 1. Create a Service Account in Google Cloud Console (creating the
 *    account itself is NOT blocked by the org policy — only downloading a
 *    JSON key for it is).
 * 2. Enable the Google Drive API and Google Sheets API for the project.
 * 3. Share the target Google Drive folder AND the target Google Sheet with
 *    the service account's email address, granting Editor access.
 * 4. When deploying to Cloud Run, attach this service account to the
 *    service (--service-account flag, or set it in the Cloud Run console).
 *
 * For local development without Cloud Run, run:
 *   gcloud auth application-default login
 * This creates local user ADC credentials (not a service account key, so
 * it isn't affected by the org policy either) that GoogleAuth below will
 * automatically pick up.
 */

const DRIVE_BASE_URL = "https://www.googleapis.com";
const SHEETS_BASE_URL = "https://sheets.googleapis.com";

const SCOPES = [
  "https://www.googleapis.com/auth/drive",
  "https://www.googleapis.com/auth/spreadsheets",
];

type GoogleService = "google-drive" | "google-sheet";

let cachedAuth: GoogleAuth | null = null;

function getAuth(): GoogleAuth {
  if (!cachedAuth) {
    cachedAuth = new GoogleAuth({ scopes: SCOPES });
  }
  return cachedAuth;
}

async function getAccessToken(): Promise<string> {
  const auth = getAuth();
  const client = await auth.getClient();
  const tokenResponse = await client.getAccessToken();
  const token = typeof tokenResponse === "string" ? tokenResponse : tokenResponse?.token;
  if (!token) {
    throw new Error(
      "Failed to obtain a Google access token from Application Default Credentials. " +
        "On Cloud Run, make sure a service account is attached to the service. " +
        "For local development, run `gcloud auth application-default login`.",
    );
  }
  return token;
}

/**
 * Mimics the shape of Replit's ReplitConnectors#proxy so the rest of the
 * Google Drive/Sheets integration code did not need to change: same
 * (service, path, init) signature, same Response return type.
 *
 * Exposed on a plain object (rather than a standalone function) so tests
 * can substitute `googleClient.proxy` the same way the old code substituted
 * `ReplitConnectors.prototype.proxy`.
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
