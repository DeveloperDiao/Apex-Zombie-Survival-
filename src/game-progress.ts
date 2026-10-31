
import { supabase } from "./supabase";

export type ServerGameProgress = {
  player: {
    id: string;
    username: string;
    coins: number;
    campaign_level: number;
    best_endless: number;
  };
  upgrades: {
    health: number;
    armor: number;
    stamina: number;
    damage: number;
    fire_rate: number;
  } | null;
};

export async function getServerGameProgress():
  Promise<ServerGameProgress> {

  const { data: userData, error: userError } =
    await supabase.auth.getUser();

  if (userError || !userData.user) {
    throw new Error("Authentication required");
  }

  const { data, error } =
    await supabase.functions.invoke(
      "apex-game",
      {
        body: {
          action: "get_progress"
        }
      }
    );

  if (error) {
    throw new Error(
      `Progress request failed: ${error.message}`
    );
  }

  if (
    !data ||
    data.success !== true ||
    !data.player ||
    data.player.id !== userData.user.id
  ) {
    throw new Error(
      String(data?.error ?? "Invalid progress response")
    );
  }

  const player = data.player;

  for (const field of [
    "coins",
    "best_endless"
  ]) {
    if (
      !Number.isSafeInteger(player[field]) ||
      player[field] < 0
    ) {
      throw new Error("Invalid server progress values");
    }
  }

  if (
    !Number.isSafeInteger(player.campaign_level) ||
    player.campaign_level < 1
  ) {
    throw new Error("Invalid campaign level");
  }

  const upgrades = data.upgrades;

  if (upgrades !== null && upgrades !== undefined) {
    for (const field of [
      "health",
      "armor",
      "stamina",
      "damage",
      "fire_rate"
    ]) {
      if (
        !Number.isSafeInteger(upgrades[field]) ||
        upgrades[field] < 0
      ) {
        throw new Error("Invalid upgrade data");
      }
    }
  }

  return {
    player: {
      id: player.id,
      username: player.username,
      coins: player.coins,
      campaign_level: player.campaign_level,
      best_endless: player.best_endless
    },
    upgrades: upgrades ?? null
  };
}
