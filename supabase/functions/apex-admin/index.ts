
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;

const ANON_KEY =
  Deno.env.get("SUPABASE_ANON_KEY") ??
  Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!;

const SERVICE_KEY =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const adminDb = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

const authClient = createClient(SUPABASE_URL, ANON_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json"
};

function respond(
  data: unknown,
  status = 200
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: corsHeaders
  });
}

function validUsername(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[a-zA-Z0-9_]{3,24}$/.test(value)
  );
}

function validPassword(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 12 &&
    value.length <= 128
  );
}

function validUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  );
}

function errorResponse(error: unknown): Response {
  console.error("Admin operation failed:", error);

  return respond(
    { error: "Unable to complete administrator action" },
    500
  );
}

async function audit(
  adminId: string,
  targetId: string | null,
  action: string,
  details: Record<string, unknown> = {}
): Promise<void> {
  const { error } = await adminDb
    .from("admin_audit_logs")
    .insert({
      admin_id: adminId,
      target_player_id: targetId,
      action,
      details
    });

  if (error) {
    console.error("Audit log failed:", error);
    throw new Error("Audit logging failed");
  }
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: corsHeaders
    });
  }

  if (request.method !== "POST") {
    return respond({ error: "Method not allowed" }, 405);
  }

  try {
    const authorization =
      request.headers.get("Authorization") ?? "";

    if (!authorization.startsWith("Bearer ")) {
      return respond({ error: "Login required" }, 401);
    }

    const token = authorization.slice(7).trim();

    if (!token) {
      return respond(
        { error: "Administrator session required" },
        401
      );
    }

    const {
      data: userData,
      error: userError
    } = await authClient.auth.getUser(token);

    if (userError || !userData.user) {
      return respond(
        { error: "Invalid or expired session" },
        401
      );
    }

    const adminId = userData.user.id;

    const {
      data: adminProfile,
      error: adminError
    } = await adminDb
      .from("player_profiles")
      .select("id, is_admin, is_disabled")
      .eq("id", adminId)
      .single();

    if (
      adminError ||
      !adminProfile ||
      adminProfile.is_admin !== true ||
      adminProfile.is_disabled !== false
    ) {
      return respond(
        { error: "Administrator access denied" },
        403
      );
    }

    let body: Record<string, unknown>;

    try {
      const parsed: unknown = await request.json();

      if (
        !parsed ||
        typeof parsed !== "object" ||
        Array.isArray(parsed)
      ) {
        return respond(
          { error: "Invalid request body" },
          400
        );
      }

      body = parsed as Record<string, unknown>;
    } catch {
      return respond(
        { error: "Invalid JSON request" },
        400
      );
    }

    const action = body.action;

    if (action === "list_players") {
      const { data, error } = await adminDb
        .from("player_profiles")
        .select(
          "id, username, coins, campaign_level, best_endless, is_admin, is_disabled, created_at"
        )
        .order("created_at", {
          ascending: false
        })
        .limit(500);

      if (error) {
        throw error;
      }

      return respond({
        success: true,
        players: data ?? []
      });
    }

    if (action === "add_coins") {
      const playerId = body.player_id;
      const amount = body.amount;

      if (!validUuid(playerId)) {
        return respond(
          { error: "Invalid player ID" },
          400
        );
      }

      if (
        typeof amount !== "number" ||
        !Number.isSafeInteger(amount) ||
        amount < 1 ||
        amount > 1000000
      ) {
        return respond(
          {
            error:
              "Coin amount must be between 1 and 1,000,000"
          },
          400
        );
      }

      const { data, error } = await adminDb.rpc(
        "apex_admin_add_coins",
        {
          p_admin_id: adminId,
          p_player_id: playerId,
          p_amount: amount
        }
      );

      if (error) {
        throw error;
      }

      const balance =
        typeof data === "number"
          ? data
          : typeof data === "object" &&
              data !== null &&
              "new_balance" in data
            ? Number(data.new_balance)
            : Number(data);

      if (
        !Number.isSafeInteger(balance) ||
        balance < 0
      ) {
        return respond(
          {
            error:
              "Coin grant result requires verification"
          },
          500
        );
      }

      return respond({
        success: true,
        new_balance: balance
      });
    }

    if (action === "change_username") {
      const playerId = body.player_id;
      const newUsername = body.username;

      if (!validUuid(playerId)) {
        return respond(
          { error: "Invalid player ID" },
          400
        );
      }

      if (!validUsername(newUsername)) {
        return respond(
          {
            error:
              "Username must contain 3–24 letters, numbers, or underscores"
          },
          400
        );
      }

      const { data: target, error: targetError } =
        await adminDb
          .from("player_profiles")
          .select("id, username, is_admin")
          .eq("id", playerId)
          .single();

      if (targetError || !target) {
        return respond(
          { error: "Player not found" },
          404
        );
      }

      if (target.is_admin) {
        return respond(
          {
            error:
              "Administrator accounts cannot be renamed"
          },
          403
        );
      }

      if (target.username === newUsername) {
        return respond({
          success: true,
          username: newUsername,
          unchanged: true
        });
      }

      const { data: duplicate, error: duplicateError } =
        await adminDb
          .from("player_profiles")
          .select("id")
          .eq("username", newUsername)
          .neq("id", playerId)
          .maybeSingle();

      if (duplicateError) {
        throw duplicateError;
      }

      if (duplicate) {
        return respond(
          { error: "Username already exists" },
          409
        );
      }

      const { data: updated, error: updateError } =
        await adminDb
          .from("player_profiles")
          .update({ username: newUsername })
          .eq("id", playerId)
          .eq("is_admin", false)
          .select("id, username")
          .single();

      if (updateError) {
        if (updateError.code === "23505") {
          return respond(
            { error: "Username already exists" },
            409
          );
        }

        throw updateError;
      }

      await audit(adminId, playerId, "change_username", {
        previous_username: target.username,
        new_username: updated.username
      });

      return respond({
        success: true,
        username: updated.username
      });
    }

    if (action === "set_account_lock") {
      const playerId = body.player_id;
      const locked = body.locked;

      if (!validUuid(playerId)) {
        return respond(
          { error: "Invalid player ID" },
          400
        );
      }

      if (typeof locked !== "boolean") {
        return respond(
          { error: "Invalid lock setting" },
          400
        );
      }

      const { data: target, error: targetError } =
        await adminDb
          .from("player_profiles")
          .select("id, username, is_admin, is_disabled")
          .eq("id", playerId)
          .single();

      if (targetError || !target) {
        return respond(
          { error: "Player not found" },
          404
        );
      }

      if (target.is_admin) {
        return respond(
          {
            error:
              "Administrator accounts cannot be locked"
          },
          403
        );
      }

      if (target.is_disabled === locked) {
        return respond({
          success: true,
          is_disabled: locked,
          unchanged: true
        });
      }

      const { data: updated, error: updateError } =
        await adminDb
          .from("player_profiles")
          .update({ is_disabled: locked })
          .eq("id", playerId)
          .eq("is_admin", false)
          .select("id, username, is_disabled")
          .single();

      if (updateError) {
        throw updateError;
      }

      await audit(
        adminId,
        playerId,
        locked ? "lock_account" : "unlock_account",
        {
          username: updated.username,
          previous_locked: target.is_disabled,
          new_locked: updated.is_disabled
        }
      );

      return respond({
        success: true,
        is_disabled: updated.is_disabled
      });
    }

    if (action === "change_password") {
      const playerId = body.player_id;
      const newPassword = body.password;

      if (!validUuid(playerId)) {
        return respond(
          { error: "Invalid player ID" },
          400
        );
      }

      if (!validPassword(newPassword)) {
        return respond(
          {
            error:
              "Password must contain 12–128 characters"
          },
          400
        );
      }

      const { data: target, error: targetError } =
        await adminDb
          .from("player_profiles")
          .select("id, username, is_admin")
          .eq("id", playerId)
          .single();

      if (targetError || !target) {
        return respond(
          { error: "Player not found" },
          404
        );
      }

      if (target.is_admin) {
        return respond(
          {
            error:
              "Administrator passwords cannot be changed here"
          },
          403
        );
      }

      const { error: passwordError } =
        await adminDb.auth.admin.updateUserById(
          playerId,
          { password: newPassword }
        );

      if (passwordError) {
        throw passwordError;
      }

      await audit(
        adminId,
        playerId,
        "change_password",
        {
          username: target.username,
          password_changed: true
        }
      );

      return respond({
        success: true,
        message: "Player password updated"
      });
    }

    if (action === "admin_history") {
      const playerId = body.player_id;
      const limit = body.limit ?? 100;

      if (
        playerId !== undefined &&
        playerId !== null &&
        !validUuid(playerId)
      ) {
        return respond(
          { error: "Invalid player ID" },
          400
        );
      }

      if (
        typeof limit !== "number" ||
        !Number.isSafeInteger(limit) ||
        limit < 1 ||
        limit > 500
      ) {
        return respond(
          {
            error:
              "History limit must be between 1 and 500"
          },
          400
        );
      }

      let query = adminDb
        .from("admin_audit_logs")
        .select(
          "id, admin_id, target_player_id, action, details, created_at"
        )
        .order("created_at", {
          ascending: false
        })
        .limit(limit);

      if (typeof playerId === "string") {
        query = query.eq(
          "target_player_id",
          playerId
        );
      }

      const { data, error } = await query;

      if (error) {
        throw error;
      }

      return respond({
        success: true,
        history: data ?? []
      });
    }

    return respond(
      {
        error: "Unknown administrator action"
      },
      400
    );
  } catch (error) {
    return errorResponse(error);
  }
});
