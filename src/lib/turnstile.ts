const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export async function verifyTurnstileToken(token: string | undefined, remoteIp?: string) {
  const secret = process.env.TURNSTILE_SECRET_KEY;

  if (!secret) {
    console.warn("TURNSTILE_SECRET_KEY is not set; skipping Turnstile verification.");
    return true;
  }

  if (!token) {
    return false;
  }

  const body = new URLSearchParams({ secret, response: token });

  if (remoteIp) {
    body.set("remoteip", remoteIp);
  }

  try {
    const response = await fetch(TURNSTILE_VERIFY_URL, { method: "POST", body });

    if (!response.ok) {
      return false;
    }

    const result = (await response.json()) as { success?: boolean };
    return result.success === true;
  } catch (error) {
    console.error("Turnstile verification request failed.", error);
    return false;
  }
}
