// Supabase Edge Function: send-push-notification
// Uses Firebase Cloud Messaging (FCM) HTTP v1 API with Web Crypto RS256 OAuth2 JWTs.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const FIREBASE_PROJECT_ID = "screensync-9fc1f";
const FCM_V1_ENDPOINT = `https://fcm.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/messages:send`;
const GOOGLE_OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
const FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, x-client-info, apikey, x-push-admin-secret",
  "Content-Type": "application/json"
};

function base64UrlEncode(input: Uint8Array | string): string {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function pemToPkcs8ArrayBuffer(pem: string): ArrayBuffer {
  const cleaned = pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s+/g, "");
  const binary = atob(cleaned);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

export async function createGoogleOAuthAccessToken(
  serviceAccount: { client_email: string; private_key: string; token_uri?: string },
  fetchFn: typeof fetch = fetch
): Promise<string> {
  if (!serviceAccount?.client_email || !serviceAccount?.private_key) {
    throw new Error("INVALID_FIREBASE_SERVICE_ACCOUNT");
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const header = base64UrlEncode(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64UrlEncode(JSON.stringify({
    iss: serviceAccount.client_email,
    scope: FCM_SCOPE,
    aud: serviceAccount.token_uri || GOOGLE_OAUTH_TOKEN_URL,
    iat: nowSec,
    exp: nowSec + 3600
  }));

  const signingInput = `${header}.${payload}`;
  const keyBuffer = pemToPkcs8ArrayBuffer(serviceAccount.private_key);
  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    keyBuffer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    new TextEncoder().encode(signingInput)
  );
  const jwt = `${signingInput}.${base64UrlEncode(new Uint8Array(signature))}`;

  const tokenResp = await fetchFn(serviceAccount.token_uri || GOOGLE_OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt
    }).toString()
  });

  if (!tokenResp.ok) {
    throw new Error(`GOOGLE_OAUTH_TOKEN_ERROR_${tokenResp.status}`);
  }
  const tokenJson = await tokenResp.json();
  if (!tokenJson?.access_token) {
    throw new Error("GOOGLE_OAUTH_ACCESS_TOKEN_MISSING");
  }
  return tokenJson.access_token;
}

export async function handleSendPushNotificationRequest(
  req: Request,
  envOverride?: Record<string, string>,
  deps?: { clientFactory?: any; fetchFn?: typeof fetch }
): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, error: "METHOD_NOT_ALLOWED" }), {
      status: 405,
      headers: CORS_HEADERS
    });
  }

  const getEnv = (k: string) =>
    envOverride && k in envOverride
      ? envOverride[k]
      : (typeof Deno !== "undefined" && Deno.env ? Deno.env.get(k) || "" : "");

  const rawServiceAccount = getEnv("FIREBASE_SERVICE_ACCOUNT_JSON");
  let serviceAccount: any = null;
  try {
    serviceAccount = rawServiceAccount ? JSON.parse(rawServiceAccount) : null;
  } catch (_e) {
    serviceAccount = null;
  }
  if (!serviceAccount || !serviceAccount.client_email || !serviceAccount.private_key) {
    return new Response(JSON.stringify({ ok: false, error: "FIREBASE_SERVICE_ACCOUNT_MISSING" }), {
      status: 500,
      headers: CORS_HEADERS
    });
  }

  const supabaseUrl = getEnv("SUPABASE_URL");
  const anonKey = getEnv("SUPABASE_ANON_KEY") || getEnv("SUPABASE_PUBLISHABLE_KEY");
  const serviceRoleKey = getEnv("SUPABASE_SERVICE_ROLE_KEY");
  const pushAdminSecret = getEnv("PUSH_ADMIN_SECRET");

  if (!supabaseUrl || !serviceRoleKey) {
    return new Response(JSON.stringify({ ok: false, error: "SUPABASE_SERVER_CONFIG_MISSING" }), {
      status: 500,
      headers: CORS_HEADERS
    });
  }

  const authHeader = req.headers.get("Authorization") || "";
  const adminSecretHeader = req.headers.get("x-push-admin-secret") || "";
  const isAdminSecretAuth = Boolean(pushAdminSecret && adminSecretHeader && adminSecretHeader === pushAdminSecret);
  const isServiceRoleAuth = Boolean(serviceRoleKey && authHeader === `Bearer ${serviceRoleKey}`);
  const isAdminMode = isAdminSecretAuth || isServiceRoleAuth;

  const factory = deps?.clientFactory || createClient;
  const fetchFn = deps?.fetchFn || fetch;

  let callerUserId: string | null = null;
  if (!isAdminMode) {
    if (!authHeader.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ ok: false, error: "MISSING_BEARER_TOKEN" }), {
        status: 401,
        headers: CORS_HEADERS
      });
    }
    const userClient = factory(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } }
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user?.id) {
      return new Response(JSON.stringify({ ok: false, error: "INVALID_AUTH_SESSION" }), {
        status: 401,
        headers: CORS_HEADERS
      });
    }
    callerUserId = userData.user.id;
  }

  let body: Record<string, any> = {};
  try {
    body = await req.json();
  } catch (_e) {
    return new Response(JSON.stringify({ ok: false, error: "INVALID_JSON_BODY" }), {
      status: 400,
      headers: CORS_HEADERS
    });
  }

  const title = typeof body.title === "string" && body.title.trim() ? body.title.trim() : "ScreenSync";
  const messageBody = typeof body.body === "string" ? body.body.trim() : "";
  if (!messageBody) {
    return new Response(JSON.stringify({ ok: false, error: "NOTIFICATION_BODY_REQUIRED" }), {
      status: 400,
      headers: CORS_HEADERS
    });
  }

  const adminClient = factory(supabaseUrl, serviceRoleKey);

  const surveyId = typeof body.surveyId === "string" ? body.surveyId.trim() : "";
  const surveyUrl = typeof body.surveyUrl === "string" ? body.surveyUrl.trim() : "";
  const ctaLabel = typeof body.ctaLabel === "string" && body.ctaLabel.trim() ? body.ctaLabel.trim() : "Open Google Form";
  const dismissLabel = typeof body.dismissLabel === "string" && body.dismissLabel.trim() ? body.dismissLabel.trim() : "Maybe Later";
  let surveyUpserted = false;

  if (isAdminMode && body.upsertActiveSurvey === true && surveyId && /^https:\/\//i.test(surveyUrl)) {
    const { error: surveyErr } = await adminClient
      .from("research_surveys")
      .upsert(
        {
          survey_id: surveyId,
          title,
          body: messageBody,
          survey_url: surveyUrl,
          cta_label: ctaLabel,
          dismiss_label: dismissLabel,
          is_active: true
        },
        { onConflict: "survey_id" }
      );
    if (!surveyErr) {
      surveyUpserted = true;
    }
  }

  let query = adminClient
    .from("device_push_tokens")
    .select("id, user_id, installation_id, platform, fcm_token")
    .eq("is_active", true);

  if (isAdminMode) {
    if (!body.broadcastAll) {
      if (typeof body.targetUserId === "string" && body.targetUserId.trim()) {
        query = query.eq("user_id", body.targetUserId.trim());
      } else {
        return new Response(JSON.stringify({ ok: false, error: "TARGET_USER_OR_BROADCAST_REQUIRED" }), {
          status: 400,
          headers: CORS_HEADERS
        });
      }
    }
  } else {
    query = query.eq("user_id", callerUserId);
  }

  if (Array.isArray(body.platforms) && body.platforms.length > 0) {
    query = query.in("platform", body.platforms);
  }

  const { data: tokens, error: queryErr } = await query;
  if (queryErr) {
    return new Response(JSON.stringify({ ok: false, error: "TOKEN_QUERY_FAILED", detail: queryErr.message }), {
      status: 500,
      headers: CORS_HEADERS
    });
  }

  const tokenRows = Array.isArray(tokens) ? tokens : [];
  if (tokenRows.length === 0) {
    return new Response(JSON.stringify({ ok: true, sent: 0, deactivated: 0, failed: 0, surveyUpserted }), {
      status: 200,
      headers: CORS_HEADERS
    });
  }

  const accessToken = await createGoogleOAuthAccessToken(serviceAccount, fetchFn);
  const customData: Record<string, string> = {};
  if (body.data && typeof body.data === "object") {
    for (const [k, v] of Object.entries(body.data)) {
      if (v !== undefined && v !== null) {
        customData[String(k)] = String(v);
      }
    }
  }
  if (surveyUrl || surveyId) {
    customData.type = "research_survey";
    if (surveyId) customData.survey_id = String(surveyId);
    if (surveyUrl) {
      customData.survey_url = String(surveyUrl);
      customData.url = String(surveyUrl);
    }
    customData.title = String(title);
    customData.body = String(messageBody);
  }

  let sent = 0;
  let deactivated = 0;
  let failed = 0;
  const staleIds: string[] = [];

  for (const row of tokenRows) {
    const fcmResp = await fetchFn(FCM_V1_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        message: {
          token: row.fcm_token,
          notification: { title, body: messageBody },
          data: customData,
          ...(surveyUrl ? { webpush: { fcm_options: { link: String(surveyUrl) } } } : {})
        }
      })
    });

    if (fcmResp.ok) {
      sent++;
    } else {
      let errText = "";
      try {
        errText = await fcmResp.text();
      } catch (_e) {}
      if (errText.includes("UNREGISTERED") || errText.includes("NOT_FOUND")) {
        staleIds.push(row.id);
        deactivated++;
      } else {
        failed++;
      }
    }
  }

  if (staleIds.length > 0) {
    await adminClient
      .from("device_push_tokens")
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .in("id", staleIds);
  }

  return new Response(JSON.stringify({ ok: true, sent, deactivated, failed, total: tokenRows.length, surveyUpserted }), {
    status: 200,
    headers: CORS_HEADERS
  });
}

if (typeof Deno !== "undefined" && typeof Deno.serve === "function") {
  Deno.serve((req: Request) => handleSendPushNotificationRequest(req));
}
