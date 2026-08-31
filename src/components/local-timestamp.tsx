"use client";

import { useSyncExternalStore } from "react";
import { formatTimestamp } from "@/lib/utils";

function subscribe() {
  return () => {};
}

/**
 * A moment on the reader's own clock rather than the server's.
 *
 * An admin reading an access record, or an advisor reading when a follow-up
 * comes due, is comparing it against the clock on the wall, and a server render
 * has no idea what that clock says - a deployed Node process defaults to UTC.
 * So the value is formatted in the browser, and the server pass renders a
 * placeholder rather than a time that would visibly change once the page
 * hydrates. The exact instant is in the markup either way.
 */
export function LocalTimestamp({ value }: { value: Date }) {
  const formatted = useSyncExternalStore<string | null>(
    subscribe,
    () => formatTimestamp(value),
    () => null,
  );

  return <time dateTime={value.toISOString()}>{formatted ?? "…"}</time>;
}
