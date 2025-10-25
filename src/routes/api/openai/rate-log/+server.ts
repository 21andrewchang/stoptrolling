import { json, error } from '@sveltejs/kit';
import OpenAI from 'openai';
import { env } from '$env/dynamic/private';
import type { RequestHandler } from './$types';
import { performance } from 'node:perf_hooks';

const apiKey = env.OPENAI_API_KEY;
const client = apiKey ? new OpenAI({ apiKey }) : null;

export const POST: RequestHandler = async ({ request }) => {
    const t0 = performance.now();
    try {
        if (!client) throw error(500, 'OPENAI_API_KEY is not set');

        // Measure JSON parse
        const bodyStart = performance.now();
        const { log, goal } = (await request.json()) as { log?: string; goal?: string };
        const bodyEnd = performance.now();

        if (!log || typeof log !== 'string') throw error(400, 'Missing "log" string');

        // Prepare prompt…
        const system = `Return ONLY JSON: {"ok":<bool>,"reason":<string>}.` +
            `Be extremely strict about goal alignment.` +
            `Reasoning should be extremely consise.` +
            `Do not suggest what to do next.`;
        const user = goal?.trim() ? `Log: ${log}\nGoal: ${goal}` : `Log: ${log}`;

        // Measure OpenAI call
        const llmStart = performance.now();
        const resp = await client.responses.create({
            model: 'gpt-5-nano-2025-08-07',
            input: [
                { role: 'system', content: system },
                { role: 'user', content: user }
            ],
            text: {
                format: {
                    type: 'json_schema',
                    name: 'log_rating',
                    strict: true,
                    schema: {
                        type: 'object',
                        additionalProperties: false,
                        required: ['ok', 'reason'],
                        properties: {
                            ok: { type: 'boolean' },
                            reason: {
                                type: 'string',
                                minLength: 1,
                                maxLength: 30
                            }
                        }
                    }
                }
            }
        });
        const llmEnd = performance.now();

        const out = resp.output_text ? JSON.parse(resp.output_text) as { ok: boolean; reason: string } : null;

        const tEnd = performance.now();
        return json(
            {
                ok: out?.ok ?? true,
                reason: out?.reason ?? 'Defaulted due to invalid response.',
                timings: {
                    parse_ms: Math.round(bodyEnd - bodyStart),
                    openai_ms: Math.round(llmEnd - llmStart),
                    total_ms: Math.round(tEnd - t0)
                }
            },
            { status: 200 }
        );
    } catch (e: any) {
        const tEnd = performance.now();
        return json(
            {
                ok: true,
                reason: `Fallback (error: ${e?.message ?? e})`,
                timings: { total_ms: Math.round(tEnd - t0) }
            },
            { status: 200 }
        );
    }
};
