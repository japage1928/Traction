import { supabase } from './supabase';
import type { AdvisorEvent, Platform } from '@shared/types';

/**
 * Thin client for the Netlify Functions. Every call carries the caller's
 * Supabase access token so the function can establish who is asking.
 */

const BASE = '/.netlify/functions';

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('You are signed out. Sign in again to continue.');
  return { Authorization: `Bearer ${token}`, 'content-type': 'application/json' };
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}/${path}`, {
    method: 'POST',
    headers: await authHeaders(),
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(payload.error ?? `Request failed (${res.status})`);
  return payload as T;
}

// --- Provider / account management -----------------------------------------

export interface ProviderStatus {
  platform: Platform;
  label: string;
  configured: boolean;
  scopes: string[];
  missingEnv: string[];
}

export async function getProviderStatus(): Promise<{
  providers: ProviderStatus[];
  encryptionReady: boolean;
  aiReady: boolean;
}> {
  const res = await fetch(`${BASE}/providers-status`);
  if (!res.ok) throw new Error(`Could not load integration status (${res.status})`);
  return res.json();
}

/** Kicks off an OAuth connect by navigating to the provider. */
export async function connectAccount(platform: Platform, returnTo = '/accounts'): Promise<void> {
  const { url } = await post<{ url: string }>('oauth-start', { platform, returnTo });
  window.location.href = url;
}

export interface SyncResult {
  accountId: string;
  platform: Platform;
  handle: string;
  ok: boolean;
  message?: string;
}

export function syncAccounts(): Promise<{ results: SyncResult[]; synced: number; failed: number }> {
  return post('sync');
}

// --- AI ---------------------------------------------------------------------

export function refreshTrends(): Promise<{ inserted: number; capturedAt?: string }> {
  return post('trends');
}

export function generateBrief(): Promise<{ headline: string; summary: string; tasksCreated: number }> {
  return post('brief');
}

/**
 * Streams an advisor reply. `onEvent` fires for each server-sent frame; the
 * returned promise resolves when the stream closes.
 */
export async function streamAdvisor(
  message: string,
  threadId: string | null,
  onEvent: (event: AdvisorEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(`${BASE}/advisor`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({ message, threadId }),
    signal,
  });

  if (!res.ok || !res.body) {
    const payload = await res.json().catch(() => ({}));
    throw new Error(payload.error ?? `Advisor request failed (${res.status})`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    // SSE frames are separated by a blank line.
    const frames = buffer.split('\n\n');
    buffer = frames.pop() ?? '';

    for (const frame of frames) {
      const line = frame.split('\n').find((l) => l.startsWith('data: '));
      if (!line) continue;
      try {
        onEvent(JSON.parse(line.slice(6)) as AdvisorEvent);
      } catch {
        // A partial frame is not fatal — skip it and keep reading.
      }
    }
  }
}
