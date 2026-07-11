"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import Script from "next/script";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/field";

type TurnstileRenderOptions = {
  sitekey: string;
  callback?: (token: string) => void;
  "expired-callback"?: () => void;
  "error-callback"?: () => void;
};

declare global {
  interface Window {
    turnstile?: {
      render: (element: HTMLElement, options: TurnstileRenderOptions) => string;
      reset: (widgetId?: string) => void;
    };
  }
}

type LoginFormProps = {
  demoEnabled: boolean;
  turnstileSiteKey: string | null;
};

export function LoginForm({ demoEnabled, turnstileSiteKey }: LoginFormProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [demoLoading, setDemoLoading] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const turnstileRef = useRef<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<string | null>(null);

  const callbackUrl = searchParams.get("callbackUrl") ?? "/inbox";
  const turnstileActive = demoEnabled && Boolean(turnstileSiteKey);
  const demoReady = !turnstileActive || Boolean(turnstileToken);

  const renderTurnstile = useCallback(() => {
    if (
      !turnstileActive ||
      !turnstileSiteKey ||
      !turnstileRef.current ||
      !window.turnstile ||
      widgetIdRef.current !== null
    ) {
      return;
    }

    widgetIdRef.current = window.turnstile.render(turnstileRef.current, {
      sitekey: turnstileSiteKey,
      callback: (token: string) => setTurnstileToken(token),
      "expired-callback": () => setTurnstileToken(null),
      "error-callback": () => setTurnstileToken(null),
    });
  }, [turnstileActive, turnstileSiteKey]);

  useEffect(() => {
    renderTurnstile();
  }, [renderTurnstile]);

  function resetTurnstile() {
    setTurnstileToken(null);

    if (turnstileActive && window.turnstile && widgetIdRef.current !== null) {
      window.turnstile.reset(widgetIdRef.current);
    }
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);

    setLoading(true);
    setError(null);

    const result = await signIn("credentials", {
      email: String(formData.get("email") ?? ""),
      password: String(formData.get("password") ?? ""),
      redirect: false,
      callbackUrl,
    });

    setLoading(false);

    if (result?.error) {
      setError("Invalid email or password.");
      return;
    }

    router.push(result?.url ?? "/inbox");
    router.refresh();
  }

  async function onDemoClick() {
    setDemoLoading(true);
    setError(null);

    try {
      const result = await signIn("demo", {
        turnstileToken: turnstileToken ?? "",
        redirect: false,
        callbackUrl,
      });

      if (result?.error) {
        setError("Demo sign-in failed. Please try again.");
        resetTurnstile();
        return;
      }

      router.push(result?.url ?? "/inbox");
      router.refresh();
    } catch {
      setError("Demo sign-in failed. Please try again.");
      resetTurnstile();
    } finally {
      setDemoLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" required />
      </div>
      <div className="space-y-2">
        <Label htmlFor="password">Password</Label>
        <Input id="password" name="password" type="password" required />
      </div>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      <Button type="submit" className="w-full" disabled={loading}>
        {loading ? "Signing in..." : "Sign in"}
      </Button>
      {demoEnabled ? (
        <>
          <div className="flex items-center gap-3 text-xs uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
            <span className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
            or
            <span className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
          </div>
          <Button
            type="button"
            variant="secondary"
            className="w-full"
            onClick={onDemoClick}
            disabled={demoLoading || !demoReady}
          >
            {demoLoading ? "Opening demo..." : "View demo"}
          </Button>
          <p className="text-xs leading-5 text-zinc-500 dark:text-zinc-400">
            Explore the workspace with seeded dealership data. No account needed.
          </p>
          {turnstileActive ? (
            <>
              <div ref={turnstileRef} className="flex justify-center" />
              <Script
                src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
                strategy="afterInteractive"
                onLoad={renderTurnstile}
              />
            </>
          ) : null}
        </>
      ) : null}
    </form>
  );
}
