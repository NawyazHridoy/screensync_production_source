// Supabase Edge Function: delete-account
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, x-client-info, apikey",
  "Content-Type": "application/json"
};

export async function handleDeleteAccountRequest(req: Request, envOverride?: Record<string, string>, clientFactory?: any): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ ok: false, error: "MISSING_BEARER_TOKEN" }), {
      status: 401,
      headers: CORS_HEADERS
    });
  }

  const getEnv = (k: string) => (envOverride && k in envOverride) ? envOverride[k] : ((typeof Deno !== "undefined" && Deno.env) ? (Deno.env.get(k) || "") : "");
  const supabaseUrl = getEnv("SUPABASE_URL");
  const anonKey = getEnv("SUPABASE_ANON_KEY") || getEnv("SUPABASE_PUBLISHABLE_KEY");
  const serviceRoleKey = getEnv("SUPABASE_SERVICE_ROLE_KEY");

  if (!serviceRoleKey) {
    console.error("[delete-account] Configuration error: SUPABASE_SERVICE_ROLE_KEY is missing.");
    return new Response(JSON.stringify({ ok: false, error: "SERVICE_ROLE_KEY_MISSING" }), {
      status: 500,
      headers: CORS_HEADERS
    });
  }

  let bodyObj: Record<string, any> = {};
  try {
    bodyObj = await req.json();
  } catch (_e) {
    bodyObj = {};
  }
  const reason = typeof bodyObj.reason === "string" && bodyObj.reason.trim()
    ? bodyObj.reason.trim()
    : "USER_PASSWORD_VERIFIED_IN_APP";

  const factory = clientFactory || createClient;
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

  const uid = userData.user.id;
  let passwordVerified = Boolean(bodyObj.passwordVerified !== false);

  if (typeof bodyObj.password === "string" && bodyObj.password.length > 0 && userData.user.email && userClient.auth && typeof userClient.auth.signInWithPassword === "function") {
    const { error: pwdErr } = await userClient.auth.signInWithPassword({
      email: userData.user.email,
      password: bodyObj.password
    });
    if (pwdErr) {
      return new Response(JSON.stringify({ ok: false, error: "INVALID_PASSWORD" }), {
        status: 401,
        headers: CORS_HEADERS
      });
    }
    passwordVerified = true;
  } else if (typeof bodyObj.confirmPhrase === "string") {
    if (bodyObj.confirmPhrase.trim().toUpperCase() !== "DELETE") {
      return new Response(JSON.stringify({ ok: false, error: "CONFIRMATION_PHRASE_REQUIRED" }), {
        status: 401,
        headers: CORS_HEADERS
      });
    }
    passwordVerified = true;
  }

  const { data: rpcData, error: rpcErr } = await userClient.rpc("delete_user_account_and_all_data", {
    p_user_id: uid,
    target_user_id: uid,
    p_reason: reason,
    p_password_verified: passwordVerified
  });
  if (rpcErr) {
    return new Response(JSON.stringify({ ok: false, error: "DATABASE_PURGE_FAILED", detail: rpcErr.message || "RPC_DELETION_FAILED" }), {
      status: 500,
      headers: CORS_HEADERS
    });
  }

  const adminClient = factory(supabaseUrl, serviceRoleKey);
  const { error: deleteUserErr } = await adminClient.auth.admin.deleteUser(uid);
  if (deleteUserErr) {
    return new Response(JSON.stringify({ ok: false, error: "AUTH_USER_DELETE_FAILED", detail: deleteUserErr.message || "" }), {
      status: 500,
      headers: CORS_HEADERS
    });
  }

  return new Response(JSON.stringify({
    ok: true,
    deletedUserId: uid,
    reason,
    passwordVerified,
    counts: rpcData || {}
  }), {
    status: 200,
    headers: CORS_HEADERS
  });
}

if (typeof Deno !== "undefined" && typeof Deno.serve === "function") {
  Deno.serve((req: Request) => handleDeleteAccountRequest(req));
}
