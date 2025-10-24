import { json, error } from '@sveltejs/kit';
import OpenAI from 'openai';
import { env } from '$env/dynamic/private';
import type { RequestHandler } from './$types';

const apiKey = env.OPENAI_API_KEY;
const client = apiKey ? new OpenAI({ apiKey }) : null;

const response_format = {
    type: 'json_schema',
    name: 'log_rating',
    strict: true,
    schema: {
        type: 'object',
        additionalProperties: false,
        required: ['ok', 'reason'],
        properties: {
            ok: {
                type: 'boolean',
                description: 'True if the log reflects productive / non-troll behavior.' 
            },
            reason: {
                type: 'string',
                description: 'Brief rationale for the verdict.'
            }
        }
    }
} as const;

export const POST: RequestHandler = async ({ request }) => {
    try {
        if (!client) throw error(500, 'OPENAI_API_KEY is not set');

        const { log } = (await request.json()) as { log?: string };
        if (!log || typeof log !== 'string') throw error(400, 'Missing "log" string');

        const instructions = [
            "You rate a user's hourly log as PRODUCTIVE (ok=true) or NOT PRODUCTIVE (ok=false).",
            'Rules:',
            '- ok=true if the activity is work, study, chores, exercise, rest/recovery, social time with productive intent, or neutral life admin.',
            '- ok=false if the activity is procrastination, clearly trolling, spam, abusive, social media (unless related to work), watching unproductive videos, playing video games, etc.',
            '- If ambiguous, do your best to rate it based on the context given.',
            'For example, if given a short acronym with no other context, try to figure out what that acronym commonly refers to and rate using your best judgement.',
            'If given "idk" or "lol", these are typically trolling and should be rated as ok=false.',
            'Return ONLY the JSON specified by the provided schema.'
        ].join('\n');

        const response = await client.responses.create({
            model: 'gpt-5-nano-2025-08-07',
            input: [
                { role: 'system', content: instructions },
                { role: 'user', content: `Log: ${log}` }
            ],
            text: { format: response_format }
        });

        const out = response.output_text ? JSON.parse(response.output_text) as { ok: boolean, reason: string } : null;

        if (!out || typeof out.ok !== 'boolean' || typeof out.reason !== 'string') {
            return json({ ok: true, reason: 'Defaulted to ok=true because of invalid response.'}, { status: 200 });
        }

        return json(out, { status: 200 });
    } catch (err) {
        return json({ ok: true, reason: `Fallback (error: ${err})`}, { status: 200 });
    }
};
