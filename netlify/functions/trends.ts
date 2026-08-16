import Anthropic from '@anthropic-ai/sdk';
import { authenticate, serviceClient } from './_shared/supabase.js';
import { error, json, withErrorHandling } from './_shared/http.js';
import type { Platform } from '../../shared/types.js';

/**
 * POST /.netlify/functions/trends
 *
 * Refreshes the trending-topics table. Rather than scraping each platform —
 * which needs per-platform elevated API access most accounts do not have — we
 * let Claude search the live web and report what is actually moving, scoped to
 * the operator's niche so the results are usable rather than generic.
 *
 * Results are shared across users (the table is platform-wide), but the search
 * is biased by the requesting user's niche.
 */

const MODEL = process.env.ANTHROPIC_MODEL ?? 'claude-opus-5';
const PLATFORMS_TO_SCAN: Platform[] = ['x', 'linkedin', 'reddit', 'youtube'];

interface TrendPayload {
  topics: Array<{
    platform: Platform;
    topic: string;
    score: number;
    momentum?: number;
    why_it_matters?: string;
    url?: string;
  }>;
}

const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    topics: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          platform: { type: 'string', enum: PLATFORMS_TO_SCAN },
          topic: { type: 'string' },
          score: { type: 'number', description: 'Relative heat, 0-100.' },
          momentum: { type: 'number', description: 'Percent change vs last week, positive or negative.' },
          why_it_matters: { type: 'string' },
          url: { type: 'string' },
        },
        required: ['platform', 'topic', 'score'],
        additionalProperties: false,
      },
    },
  },
  required: ['topics'],
  additionalProperties: false,
} as const;

export default withErrorHandling(async (req: Request) => {
  if (req.method !== 'POST') return error('Method not allowed', 405);

  if (!process.env.ANTHROPIC_API_KEY) {
    return error('ANTHROPIC_API_KEY is not configured on this deployment.', 503);
  }

  const auth = await authenticate(req);
  if (!auth) return error('Not signed in', 401);

  const db = serviceClient();

  const { data: profile } = await db
    .from('profiles')
    .select('niche, audience')
    .eq('id', auth.userId)
    .maybeSingle();

  const niche = profile?.niche?.trim();
  const audience = profile?.audience?.trim();

  const scope = niche
    ? `The operator works in: ${niche}.${audience ? ` Their audience is: ${audience}.` : ''} Prioritise topics that this operator could credibly post about.`
    : 'The operator has not specified a niche yet, so report broadly relevant topics for people building an audience online.';

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 4000,
    thinking: { type: 'adaptive' },
    output_config: {
      effort: 'medium',
      format: { type: 'json_schema', schema: OUTPUT_SCHEMA },
    },
    tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 6 }],
    messages: [
      {
        role: 'user',
        content:
          `Search the web for what is genuinely trending right now on these platforms: ${PLATFORMS_TO_SCAN.join(', ')}.\n\n` +
          `${scope}\n\n` +
          'Return 12-20 topics total, spread across the platforms. Score each 0-100 by how much attention it is currently getting. ' +
          'Only report things you actually found evidence for in search results — do not pad the list with plausible-sounding guesses. ' +
          "Today's date is " +
          new Date().toISOString().slice(0, 10) +
          '.',
      },
    ],
  });

  if (response.stop_reason === 'refusal') {
    return error('The trend search was declined by safety filters. Try narrowing your niche description.', 422);
  }

  const textBlock = response.content.find((b) => b.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    return error('The model returned no usable trend data.', 502);
  }

  let payload: TrendPayload;
  try {
    payload = JSON.parse(textBlock.text) as TrendPayload;
  } catch {
    return error('Could not parse trend data from the model response.', 502);
  }

  const capturedAt = new Date().toISOString();
  const rows = (payload.topics ?? [])
    .filter((t) => t.topic && PLATFORMS_TO_SCAN.includes(t.platform))
    .slice(0, 30)
    .map((t) => ({
      platform: t.platform,
      topic: t.topic.slice(0, 200),
      score: Math.max(0, Math.min(100, Number(t.score) || 0)),
      momentum: t.momentum == null ? null : Number(t.momentum),
      region: 'global',
      url: t.url ?? null,
      captured_at: capturedAt,
    }));

  if (!rows.length) {
    return json({ inserted: 0, message: 'No trends found this run.' });
  }

  const { error: insertError } = await db
    .from('trending_topics')
    .upsert(rows, { onConflict: 'platform,topic,region,captured_at' });

  if (insertError) throw new Error(insertError.message);

  return json({ inserted: rows.length, capturedAt });
});
