import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SoundCloud } from './SoundCloud';

const contentUrl = 'https://soundcloud.com/__nostter_test_user__/__nostter_test_track__';
const playerUrl = 'https://w.soundcloud.com/player/?url=nostter-test-fixture';

type StubElement = {
	tagName: string;
	getAttribute(name: string): string | null;
};

function element(tagName: string, src?: string): StubElement {
	return {
		tagName,
		getAttribute: (name) => (name === 'src' && src !== undefined ? src : null)
	};
}

function stubDocument(
	children: StubElement[] = [element('IFRAME', playerUrl)],
	executableOrEmbeddedElements: StubElement[] = children.filter((child) =>
		['IFRAME', 'SCRIPT', 'OBJECT', 'EMBED'].includes(child.tagName)
	)
): void {
	vi.stubGlobal(
		'DOMParser',
		class {
			parseFromString() {
				return {
					body: { children },
					querySelectorAll: () => executableOrEmbeddedElements
				};
			}
		}
	);
}

function response(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		type: 'rich',
		provider_name: 'SoundCloud',
		provider_url: 'https://soundcloud.com',
		html: '<iframe></iframe>',
		height: 166,
		title: ' Test title ',
		...overrides
	};
}

function jsonResponse(
	body: unknown,
	init: { ok?: boolean; contentType?: string; jsonError?: Error } = {}
): Response {
	return {
		ok: init.ok ?? true,
		headers: new Headers({
			'Content-Type': init.contentType ?? 'application/json; charset=utf-8'
		}),
		json: async () => {
			if (init.jsonError !== undefined) {
				throw init.jsonError;
			}
			return body;
		}
	} as unknown as Response;
}

beforeEach(() => {
	stubDocument();
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('SoundCloud URL', () => {
	it.each([
		contentUrl,
		'https://www.soundcloud.com/__nostter_test_user__',
		'https://soundcloud.com/__nostter_test_user__?key=value#fragment'
	])('accepts supported URL %s', (url) => {
		expect(SoundCloud.isSoundCloudUrl(url)).toBe(true);
	});

	it.each([
		'http://soundcloud.com/__nostter_test_user__',
		'https://soundcloud.com',
		'https://soundcloud.com/',
		'https://soundcloud.example/__nostter_test_user__',
		'https://soundcloud.com.example/__nostter_test_user__',
		'https://api.soundcloud.com/__nostter_test_user__',
		'https://on.soundcloud.com/__nostter_test__',
		'https://user@soundcloud.com/__nostter_test_user__',
		'https://soundcloud.com:8443/__nostter_test_user__'
	])('rejects unsupported URL %s', (url) => {
		expect(SoundCloud.isSoundCloudUrl(url)).toBe(false);
	});

	it('rejects malformed URL strings', () => {
		expect(SoundCloud.isSoundCloudUrl('not a URL')).toBe(false);
	});
});

describe('SoundCloud oEmbed request URL', () => {
	it('uses the fixed endpoint and required parameters', () => {
		const requestUrl = SoundCloud.getOEmbedUrl(`${contentUrl}?key=value#fragment`);
		expect(requestUrl?.origin).toBe('https://soundcloud.com');
		expect(requestUrl?.pathname).toBe('/oembed');
		expect([...requestUrl!.searchParams]).toStrictEqual([
			['format', 'json'],
			['auto_play', 'false'],
			['url', `${contentUrl}?key=value#fragment`]
		]);
	});

	it('does not generate a request for an invalid content URL', () => {
		expect(SoundCloud.getOEmbedUrl('https://example.com/test')).toBeUndefined();
	});
});

describe('SoundCloud player URL', () => {
	it.each([
		'https://w.soundcloud.com/player',
		playerUrl,
		'https://w.soundcloud.com/player/#fragment'
	])('accepts supported player URL %s', (url) => {
		expect(SoundCloud.isSoundCloudPlayerUrl(url)).toBe(true);
	});

	it.each([
		'http://w.soundcloud.com/player/',
		'https://soundcloud.com/player/',
		'https://w.soundcloud.com.example/player/',
		'https://user@w.soundcloud.com/player/',
		'https://w.soundcloud.com:8443/player/',
		'https://w.soundcloud.com/embed/',
		'https://w.soundcloud.com/player/extra'
	])('rejects unsupported player URL %s', (url) => {
		expect(SoundCloud.isSoundCloudPlayerUrl(url)).toBe(false);
	});
});

describe('SoundCloud oEmbed response', () => {
	it('returns only validated player data', () => {
		expect(SoundCloud.parseOEmbedResponse(response())).toStrictEqual({
			src: new URL(playerUrl),
			title: 'Test title',
			height: 166
		});
	});

	it.each([null, [], 'response', 1])('rejects a non-object response %#', (value) => {
		expect(SoundCloud.parseOEmbedResponse(value)).toBeUndefined();
	});

	it.each([
		{ type: 'video' },
		{ provider_name: 'Not SoundCloud' },
		{ provider_url: 'http://soundcloud.com' },
		{ provider_url: 'https://api.soundcloud.com' },
		{ provider_url: 'not a URL' },
		{ html: '' },
		{ html: '   ' }
	])('rejects malformed metadata %#', (override) => {
		expect(SoundCloud.parseOEmbedResponse(response(override))).toBeUndefined();
	});

	it('uses the fallback title and height', () => {
		expect(
			SoundCloud.parseOEmbedResponse(response({ title: '  ', height: undefined }))
		).toMatchObject({ title: 'SoundCloud player', height: 166 });
	});

	it.each([
		['81px', undefined],
		[Number.NaN, undefined],
		[Number.POSITIVE_INFINITY, undefined],
		[0, undefined],
		[-1, undefined],
		[1, 81],
		[166.6, 167],
		[1000, 450]
	])('validates or clamps height %#', (height, expected) => {
		const embed = SoundCloud.parseOEmbedResponse(response({ height }));
		expect(embed?.height).toBe(expected);
	});

	it('rejects no top-level element', () => {
		stubDocument([]);
		expect(SoundCloud.parseOEmbedResponse(response())).toBeUndefined();
	});

	it('rejects multiple top-level elements', () => {
		const iframe = element('IFRAME', playerUrl);
		stubDocument([iframe, element('DIV')], [iframe]);
		expect(SoundCloud.parseOEmbedResponse(response())).toBeUndefined();
	});

	it('rejects a top-level element other than iframe', () => {
		stubDocument([element('DIV')], []);
		expect(SoundCloud.parseOEmbedResponse(response())).toBeUndefined();
	});

	it('rejects an iframe without src', () => {
		stubDocument([element('IFRAME')]);
		expect(SoundCloud.parseOEmbedResponse(response())).toBeUndefined();
	});

	it.each(['SCRIPT', 'OBJECT', 'EMBED', 'IFRAME'])('rejects an additional %s element', (tag) => {
		const iframe = element('IFRAME', playerUrl);
		stubDocument([iframe], [iframe, element(tag)]);
		expect(SoundCloud.parseOEmbedResponse(response())).toBeUndefined();
	});

	it('rejects an invalid iframe URL', () => {
		stubDocument([element('IFRAME', 'https://example.com/player/')]);
		expect(SoundCloud.parseOEmbedResponse(response())).toBeUndefined();
	});
});

describe('fetch SoundCloud embed', () => {
	it('fetches JSON with the supplied abort signal', async () => {
		const fetchMock = vi.fn(async (url: URL, init?: RequestInit) => {
			void url;
			void init;
			return jsonResponse(response());
		});
		vi.stubGlobal('fetch', fetchMock);
		const controller = new AbortController();

		expect(await SoundCloud.fetchEmbed(contentUrl, controller.signal)).toMatchObject({
			title: 'Test title'
		});
		const [requestUrl, init] = fetchMock.mock.calls[0]!;
		expect(requestUrl).toBeInstanceOf(URL);
		expect(init).toMatchObject({ signal: controller.signal });
		expect(new Headers(init?.headers).get('Accept')).toBe('application/json');
	});

	it('does not fetch an invalid content URL', async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);
		expect(await SoundCloud.fetchEmbed('https://example.com/test')).toBeUndefined();
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it.each([
		jsonResponse(response(), { ok: false }),
		jsonResponse(response(), { contentType: 'text/html' }),
		jsonResponse(response(), { jsonError: new SyntaxError('invalid JSON') })
	])('returns undefined for an invalid fetch response %#', async (fetchResponse) => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => fetchResponse)
		);
		expect(await SoundCloud.fetchEmbed(contentUrl)).toBeUndefined();
	});

	it('returns undefined on network failure', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => {
				throw new TypeError('Failed to fetch');
			})
		);
		expect(await SoundCloud.fetchEmbed(contentUrl)).toBeUndefined();
	});

	it('returns undefined when aborted', async () => {
		const controller = new AbortController();
		controller.abort();
		vi.stubGlobal(
			'fetch',
			vi.fn(async (url: URL, init?: RequestInit) => {
				void url;
				if (init?.signal?.aborted) {
					throw new DOMException('Aborted', 'AbortError');
				}
				return jsonResponse(response());
			})
		);
		expect(await SoundCloud.fetchEmbed(contentUrl, controller.signal)).toBeUndefined();
	});
});
