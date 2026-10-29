
import { supabase } from "./supabase";

export type PlayerProfile = {
  id: string;
  username: string;
  is_admin: boolean;
  is_disabled: boolean;
  coins: number;
};

export async function login(
  email: string,
  password: string
): Promise<PlayerProfile> {
  const { data, error } =
    await supabase.auth.signInWithPassword({
      email,
      password
    });

  if (error) {
    throw new Error(error.message);
  }

  if (!data.user) {
    throw new Error("Login failed");
  }

  const { data: profile, error: profileError } =
    await supabase
      .from("player_profiles")
      .select(
        "id, username, is_admin, is_disabled, coins"
      )
      .eq("id", data.user.id)
      .single();

  if (profileError || !profile) {
    await supabase.auth.signOut();
    throw new Error("Player profile not found");
  }

  if (profile.is_disabled) {
    await supabase.auth.signOut();
    throw new Error("LOG-in-ERROR:1149");
  }

  return profile as PlayerProfile;
}

export async function logout() {
  const { error } = await supabase.auth.signOut();

  if (error) {
    throw new Error(error.message);
  }
}

export async function getCurrentProfile():
  Promise<PlayerProfile | null> {
  const { data, error } =
    await supabase.auth.getUser();

  if (error || !data.user) {
    return null;
  }

  const { data: profile, error: profileError } =
    await supabase
      .from("player_profiles")
      .select(
        "id, username, is_admin, is_disabled, coins"
      )
      .eq("id", data.user.id)
      .single();

  if (profileError || !profile) {
    return null;
  }

  if (profile.is_disabled) {
    await supabase.auth.signOut();
    return null;
  }

  return profile as PlayerProfile;
}
