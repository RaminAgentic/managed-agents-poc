import type { ChatResponse } from "../types";

export async function postChat(prompt: string): Promise<ChatResponse> {
  const controller = new AbortController();
  // Managed agent sessions can take longer (env spin-up + tool execution)
  const timeoutId = setTimeout(() => controller.abort(), 300_000);

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw new Error(
        body?.error ?? `Chat request failed with status ${res.status}`
      );
    }

    return res.json();
  } finally {
    clearTimeout(timeoutId);
  }
}
