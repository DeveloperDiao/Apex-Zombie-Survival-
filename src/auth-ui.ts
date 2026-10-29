
import {
  getCurrentProfile,
  login,
  logout,
  type PlayerProfile
} from "./auth";

let activeProfile: PlayerProfile | null = null;

let changeListener:
  ((profile: PlayerProfile | null) => void) | null = null;

let accountCheckRunning = false;
let accountMonitorStarted = false;
let sessionVersion = 0;

export function onProfileChange(
  listener: (profile: PlayerProfile | null) => void
): void {
  changeListener = listener;
  listener(activeProfile);
}

export function currentPlayer(): PlayerProfile | null {
  return activeProfile;
}

function setActiveProfile(
  profile: PlayerProfile | null
): void {
  activeProfile = profile;
  changeListener?.(profile);
}

export async function signOutPlayer(): Promise<void> {
  sessionVersion++;

  await logout();

  setActiveProfile(null);
  showLogin();
}

function showLogin(
  initialMessage = ""
): void {
  if (document.getElementById("apex-login")) {
    const existingMessage =
      document.getElementById("apex-login-message");

    if (existingMessage && initialMessage) {
      existingMessage.textContent = initialMessage;
    }

    return;
  }

  const overlay = document.createElement("div");

  overlay.id = "apex-login";

  overlay.style.cssText =
    "position:fixed;" +
    "inset:0;" +
    "z-index:100;" +
    "background:#080b09;" +
    "color:#f2d17c;" +
    "display:flex;" +
    "align-items:center;" +
    "justify-content:center;" +
    "font-family:Arial,sans-serif;" +
    "padding:20px;" +
    "box-sizing:border-box";

  const form = document.createElement("form");

  form.style.cssText =
    "width:min(100%,380px);" +
    "padding:28px 22px;" +
    "border:1px solid #a78439;" +
    "border-radius:16px;" +
    "background:#101510;" +
    "box-sizing:border-box;" +
    "text-align:center";

  const heading = document.createElement("h1");

  heading.textContent = "APEX ZOMBIE SURVIVAL";

  heading.style.cssText =
    "font-size:23px;" +
    "margin:0 0 8px";

  const subtitle = document.createElement("p");

  subtitle.textContent = "ACCOUNT LOGIN";

  subtitle.style.cssText =
    "font-size:12px;" +
    "letter-spacing:3px;" +
    "color:#b5a27a;" +
    "margin:0 0 25px";

  const email = document.createElement("input");

  email.type = "email";
  email.placeholder = "Account email";
  email.autocomplete = "username";
  email.required = true;

  const password = document.createElement("input");

  password.type = "password";
  password.placeholder = "Password";
  password.autocomplete = "current-password";
  password.required = true;

  const submit = document.createElement("button");

  submit.type = "submit";
  submit.textContent = "SIGN IN";

  const message = document.createElement("p");

  message.id = "apex-login-message";
  message.setAttribute("role", "status");
  message.textContent = initialMessage;

  message.style.cssText =
    "font-size:13px;" +
    "min-height:20px;" +
    "color:#ff9999";

  for (const input of [email, password]) {
    input.style.cssText =
      "display:block;" +
      "width:100%;" +
      "padding:14px;" +
      "margin:0 0 14px;" +
      "box-sizing:border-box;" +
      "border:1px solid #65542e;" +
      "border-radius:8px;" +
      "background:#1d251f;" +
      "color:white;" +
      "font-size:16px";
  }

  submit.style.cssText =
    "width:100%;" +
    "padding:14px;" +
    "background:#c5a052;" +
    "color:#101510;" +
    "border:0;" +
    "border-radius:8px;" +
    "font-weight:bold;" +
    "font-size:16px";

  form.append(
    heading,
    subtitle,
    email,
    password,
    submit,
    message
  );

  overlay.append(form);
  document.body.append(overlay);

  form.addEventListener("submit", async event => {
    event.preventDefault();

    submit.disabled = true;
    message.textContent = "Signing in...";

    const attemptVersion = ++sessionVersion;

    try {
      const profile = await login(
        email.value.trim(),
        password.value
      );

      if (attemptVersion !== sessionVersion) {
        return;
      }

      if (profile.is_disabled) {
        await logout();
        throw new Error("LOG-in-ERROR:1149");
      }

      setActiveProfile(profile);
      overlay.remove();

    } catch (error) {
      if (attemptVersion === sessionVersion) {
        message.textContent =
          error instanceof Error
            ? error.message
            : "Unable to sign in";
      }

    } finally {
      submit.disabled = false;
    }
  });
}

export async function initializeAuth(): Promise<void> {
  showLogin();

  const checkVersion = sessionVersion;

  try {
    const profile = await getCurrentProfile();

    if (checkVersion !== sessionVersion) {
      return;
    }

    if (profile && !profile.is_disabled) {
      setActiveProfile(profile);

      document
        .getElementById("apex-login")
        ?.remove();
    }

  } catch (error) {
    console.warn(
      "Session restoration failed",
      error
    );
  }
}

export function startAccountLockMonitor(): void {
  if (accountMonitorStarted) {
    return;
  }

  accountMonitorStarted = true;

  window.setInterval(async () => {
    if (!activeProfile || accountCheckRunning) {
      return;
    }

    accountCheckRunning = true;

    const checkVersion = sessionVersion;
    const checkedPlayerId = activeProfile.id;

    try {
      const profile = await getCurrentProfile();

      if (
        checkVersion !== sessionVersion ||
        activeProfile?.id !== checkedPlayerId
      ) {
        return;
      }

      if (!profile || profile.is_disabled) {
        sessionVersion++;

        setActiveProfile(null);

        showLogin(
          "LOG-in-ERROR:1149"
        );

        return;
      }

      setActiveProfile(profile);

    } catch (error) {
      console.warn(
        "Account status check failed:",
        error
      );
    } finally {
      accountCheckRunning = false;
    }
  }, 10000);
}
