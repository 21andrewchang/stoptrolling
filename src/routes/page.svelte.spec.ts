import { page } from '@vitest/browser/context';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import Page from './+page.svelte';

describe('/+page.svelte', () => {
	it('renders the current hour input', async () => {
		render(Page);

		const input = page.getByLabelText('Current hour note');
		await expect.element(input).toBeInTheDocument();
	});
});
