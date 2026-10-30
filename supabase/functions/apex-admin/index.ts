
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
    return respond(
      { error: "Method not allowed" },
      405
    );
  }

  try {
    const authorization =
      request.headers.get("Authorization") ?? "";

    if (!authorization.startsWith("Bearer ")) {
      return respond(
        { error: "Login required" },
        401
      );
    }

    const token = authorization.slice(7).trim();

    if (!token) {
      return respond(
        { error: "Invalid session" },
        401
      );
    }

    const { data: authData, error: authError } =
      await authClient.auth.getUser(token);

    if (authError || !authData.user) {
      return respond(
        { error: "Invalid session" },
        401
      );
    }

    const adminId = authData.user.id;

    const { data: admin, error: adminError } =
      await adminDb
        .from("player_profiles")
        .select("id, is_admin, is_disabled")
        .eq("id", adminId)
        .single();

    if (
      adminError ||
      !admin ||
      admin.is_admin !== true ||
      admin.is_disabled !== false
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
          { error: "Invalid request" },
          400
        );
      }

      body = parsed as Record<string, unknown>;
    } catch {
      return respond(
        { error: "Invalid JSON" },
        400
      );
    }

    const action = body.action;

    // LIST PLAYER ACCOUNTS

    if (action === "list_players") {
      const { data, error } = await adminDb
        .from("player_profiles")
        .select(
          "id, username, is_admin, is_disabled, coins, campaign_level, best_endless, created_at"
        )
        .order("created_at", {
          ascending: false
        })
        .limit(200);

      if (error) {
        throw error;
      }

      return respond({
        players: data ?? []
      });
    }

    // CREATE PLAYER ACCOUNT

    if (action === "create_player") {
      const username = body.username;
      const password = body.password;

      if (!validUsername(username)) {
        return respond(
          {
            error:
              "Username must be 3-24 characters: letters, numbers or underscores"
          },
          400
        );
      }

      if (!validPassword(password)) {
        return respond(
          {
            error:
              "Password must contain 12-128 characters"
          },
          400
        );
      }

      const { data: existing, error: lookupError } =
        await adminDb
          .from("player_profiles")
          .select("id")
          .ilike("username", username)
          .limit(1);

      if (lookupError) {
        throw lookupError;
      }

      if (existing && existing.length > 0) {
        return respond(
          { error: "Username already exists" },
          409
        );
      }

      // Generate an internal authentication identity.

      const internalEmail =
        `player-${crypto.randomUUID()}@accounts.invalid`;

      const { data: created, error: createError } =
        await adminDb.auth.admin.createUser({
          email: internalEmail,
          password,
          email_confirm: true
        });

      if (createError || !created.user) {
        throw createError ??
          new Error("User creation failed");
      }

      const playerId = created.user.id;

      // Create the player's profile.

      const { error: profileError } =
        await adminDb
          .from("player_profiles")
          .insert({
            id: playerId,
            username,
            is_admin: false,
            is_disabled: false,
            coins: 0,
            campaign_level: 1,
            best_endless: 0
          });

      if (profileError) {
        await adminDb.auth.admin.deleteUser(playerId);

        if (profileError.code === "23505") {
          return respond(
            { error: "Username already exists" },
            409
          );
        }

        throw profileError;
      }

      // Initialize the player's upgrades.

      const { error: upgradesError } =
        await adminDb
          .from("player_upgrades")
          .insert({
            player_id: playerId
          });

      if (upgradesError) {
        await adminDb.auth.admin.deleteUser(playerId);
        throw upgradesError;
      }

      // Record the administrator action.

      await audit(
        adminId,
        playerId,
        "create_player",
        { username }
      );

      return respond(
        {
          success: true,
          player: {
            id: playerId,
            username,
            coins: 0,
            campaign_level: 1
          }
        },
        201
      );
    }

    // ADD COINS TO PLAYER

    if (action === "add_coins") {
      const playerId = body.player_id;
      const amount = body.amount;

      if (!validUuid(playerId)) {
        return respond({
          error: "Invalid player ID"
        }, 400);
      }

      if (
        typeof amount !== "number" ||
        !Number.isSafeInteger(amount) ||
        amount < 1 ||
        amount > 1000000
      ) {
        return respond({
          error: "Amount must be 1 to 1,000,000 coins"
        }, 400);
      }

      const { data, error } = await adminDb.rpc(
        "apex_admin_add_coins",
        {
          p_admin_id: adminId,
          p_player_id: playerId,
          p_amount: amount
        }
      );

      if (error) throw error;

      if (!data) {
        return respond({
          error: "Player not found or not eligible"
        }, 404);
      }

      return respond({
        success: true,
        new_balance: data
      });
    }

    // DISABLE OR ENABLE PLAYER ACCOUNT

    if (action === "set_disabled") {
      const playerId = body.player_id;
      const disabled = body.disabled;

      if (
        !validUuid(playerId) ||
        typeof disabled !== "boolean"
      ) {
        return respond({
          error: "Invalid account update"
        }, 400);
      }

      if (playerId === adminId) {
        return respond({
          error: "Cannot disable your own admin account"
        }, 400);
      }

      const { data: target, error: targetError } =
        await adminDb
          .from("player_profiles")
          .select("id, username, is_admin")
          .eq("id", playerId)
          .single();

      if (targetError || !target) {
        return respond({
          error: "Player not found"
        }, 404);
      }

      if (target.is_admin) {
        return respond({
          error: "Cannot change another administrator"
        }, 403);
      }

      const { error: updateError } =
        await adminDb
          .from("player_profiles")
          .update({ is_disabled: disabled })
          .eq("id", playerId);

      if (updateError) throw updateError;

      if (disabled) {
        const { error: signOutError } =
          await adminDb.auth.admin.signOut(
            playerId,
            "global"
          );

        if (signOutError) throw signOutError;
      }

      await audit(
        adminId,
        playerId,
        disabled ? "disable_player" : "enable_player",
        { username: target.username }
      );

      return respond({
        success: true,
        disabled
      });
    }

    // RESET PLAYER PASSWORD

    if (action === "reset_password") {
      const playerId = body.player_id;
      const password = body.password;

      if (
        !validUuid(playerId) ||
        !validPassword(password)
      ) {
        return respond({
          error: "Invalid player ID or password"
        }, 400);
      }

      const { data: target, error: targetError } =
        await adminDb
          .from("player_profiles")
          .select("id, is_admin")
          .eq("id", playerId)
          .single();

      if (targetError || !target) {
        return respond({
          error: "Player not found"
        }, 404);
      }

      if (target.is_admin) {
        return respond({
          error: "Cannot reset an administrator password"
        }, 403);
      }

      const { error: passwordError } =
        await adminDb.auth.admin.updateUserById(
          playerId,
          { password }
        );

      if (passwordError) throw passwordError;

      const { error: signOutError } =
        await adminDb.auth.admin.signOut(
          playerId,
          "global"
        );

      if (signOutError) throw signOutError;

      await audit(
        adminId,
        playerId,
        "reset_password"
      );

      return respond({
        success: true
      });
    }

    // CHANGE PLAYER USERNAME

    if (action === "change_username") {
      const playerId = body.player_id;
      const newUsername = body.username;

      if (!validUuid(playerId)) {
        return respond({
          error: "Invalid player ID"
        }, 400);
      }

      if (!validUsername(newUsername)) {
        return respond({
          error:
            "Username must be 3-24 characters using letters, numbers, or underscores"
        }, 400);
      }

      const { data: target, error: targetError } =
        await adminDb
          .from("player_profiles")
          .select("id, username, is_admin")
          .eq("id", playerId)
          .single();

      if (targetError || !target) {
        return respond({
          error: "Player not found"
        }, 404);
      }

      if (target.is_admin) {
        return respond({
          error:
            "Administrator usernames cannot be changed here"
        }, 403);
      }

      if (target.username === newUsername) {
        return respond({
          success: true,
          username: newUsername,
          unchanged: true
        });
      }

      // Prevent duplicate usernames regardless of case.

      const { data: existing, error: lookupError } =
        await adminDb
          .from("player_profiles")
          .select("id")
          .ilike("username", newUsername)
          .neq("id", playerId)
          .limit(1);

      if (lookupError) {
        throw lookupError;
      }

      if (existing && existing.length > 0) {
        return respond({
          error: "Username already exists"
        }, 409);
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
          return respond({
            error: "Username already exists"
          }, 409);
        }

        throw updateError;
      }

      await audit(
        adminId,
        playerId,
        "change_username",
        {
          previous_username: target.username,
          new_username: updated.username
        }
      );

      return respond({
        success: true,
        username: updated.username
      });
    }

    // VIEW ADMINISTRATOR ACTION HISTORY

    if (action === "admin_history") {
      const playerId = body.player_id;
      const requestedLimit = body.limit ?? 100;

      if (
        playerId !== undefined &&
        playerId !== null &&
        !validUuid(playerId)
      ) {
        return respond({
          error: "Invalid player ID"
        }, 400);
      }

      if (
        typeof requestedLimit !== "number" ||
        !Number.isSafeInteger(requestedLimit) ||
        requestedLimit < 1 ||
        requestedLimit > 500
      ) {
        return respond({
          error: "History limit must be between 1 and 500"
        }, 400);
      }

      let query = adminDb
        .from("admin_audit_logs")
        .select(
          "id, admin_id, target_player_id, action, details, created_at"
        )
        .order("created_at", {
          ascending: false
        })
        .limit(requestedLimit);

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

    // UNKNOWN ADMINISTRATOR ACTION

    return respond({
      error: "Unknown administrator action"
    }, 400);

  } catch (error) {
    return errorResponse(error);
  }
});
