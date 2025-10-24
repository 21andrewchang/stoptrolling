import { json, error } from '@sveltejs/kit';
import OpenAI from 'openai';
import { env } from '$env/dynamic/private';
import type { RequestHandler } from './$types';

const apiKey = env.OPENAI_API_KEY;
const client = apiKey ? new OpenAI({ apiKey }) : null;

