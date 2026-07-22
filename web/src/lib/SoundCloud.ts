const contentHosts = new Set(['soundcloud.com', 'www.soundcloud.com']);
const oEmbedEndpoint = 'https://soundcloud.com/oembed';
const defaultHeight = 166;
const minimumHeight = 81;
const maximumHeight = 450;

export type SoundCloudEmbed = {
	src: URL;
	title: string;
	height: number;
};

function parseUrl(url: URL | string): URL | undefined {
	try {
		return new URL(typeof url === 'string' ? url : url.href);
	} catch {
		return undefined;
	}
}

function isSoundCloudOriginUrl(url: URL): boolean {
	return (
		url.protocol === 'https:' &&
		contentHosts.has(url.hostname) &&
		url.username === '' &&
		url.password === '' &&
		url.port === ''
	);
}

function normalizeHeight(height: unknown): number | undefined {
	if (height === undefined) {
		return defaultHeight;
	}
	if (typeof height !== 'number' || !Number.isFinite(height) || height <= 0) {
		return undefined;
	}
	return Math.min(maximumHeight, Math.max(minimumHeight, Math.round(height)));
}

export class SoundCloud {
	static isSoundCloudUrl(url: URL | string): boolean {
		const parsed = parseUrl(url);
		return (
			parsed !== undefined &&
			isSoundCloudOriginUrl(parsed) &&
			parsed.pathname.split('/').some(Boolean)
		);
	}

	static getOEmbedUrl(url: URL | string): URL | undefined {
		const parsed = parseUrl(url);
		if (parsed === undefined || !this.isSoundCloudUrl(parsed)) {
			return undefined;
		}

		const requestUrl = new URL(oEmbedEndpoint);
		requestUrl.search = new URLSearchParams([
			['format', 'json'],
			['auto_play', 'false'],
			['url', parsed.href]
		]).toString();
		return requestUrl;
	}

	static isSoundCloudPlayerUrl(url: URL | string): boolean {
		const parsed = parseUrl(url);
		return (
			parsed !== undefined &&
			parsed.protocol === 'https:' &&
			parsed.hostname === 'w.soundcloud.com' &&
			parsed.username === '' &&
			parsed.password === '' &&
			parsed.port === '' &&
			(parsed.pathname === '/player' || parsed.pathname === '/player/')
		);
	}

	static parseOEmbedResponse(value: unknown): SoundCloudEmbed | undefined {
		if (value === null || typeof value !== 'object' || Array.isArray(value)) {
			return undefined;
		}

		const response = value as Record<string, unknown>;
		if (
			response.type !== 'rich' ||
			response.provider_name !== 'SoundCloud' ||
			typeof response.provider_url !== 'string'
		) {
			return undefined;
		}

		const providerUrl = parseUrl(response.provider_url);
		if (providerUrl === undefined || !isSoundCloudOriginUrl(providerUrl)) {
			return undefined;
		}

		if (typeof response.html !== 'string' || response.html.trim() === '') {
			return undefined;
		}
		const height = normalizeHeight(response.height);
		if (height === undefined) {
			return undefined;
		}

		const document = new DOMParser().parseFromString(response.html, 'text/html');
		const topLevelElements = [...document.body.children];
		if (topLevelElements.length !== 1 || topLevelElements[0].tagName !== 'IFRAME') {
			return undefined;
		}

		const iframe = topLevelElements[0];
		const executableOrEmbeddedElements = document.querySelectorAll(
			'iframe, script, object, embed'
		);
		if (
			executableOrEmbeddedElements.length !== 1 ||
			executableOrEmbeddedElements[0] !== iframe
		) {
			return undefined;
		}

		const srcValue = iframe.getAttribute('src')?.trim();
		if (srcValue === undefined || srcValue === '' || !this.isSoundCloudPlayerUrl(srcValue)) {
			return undefined;
		}

		const title =
			typeof response.title === 'string' && response.title.trim() !== ''
				? response.title.trim()
				: 'SoundCloud player';
		return { src: new URL(srcValue), title, height };
	}

	static async fetchEmbed(
		url: URL | string,
		signal?: AbortSignal
	): Promise<SoundCloudEmbed | undefined> {
		const requestUrl = this.getOEmbedUrl(url);
		if (requestUrl === undefined) {
			return undefined;
		}

		try {
			const response = await fetch(requestUrl, {
				headers: { Accept: 'application/json' },
				signal
			});
			if (!response.ok) {
				return undefined;
			}

			const contentType = response.headers.get('Content-Type')?.split(';')[0].trim();
			if (contentType?.toLowerCase() !== 'application/json') {
				return undefined;
			}

			return this.parseOEmbedResponse(await response.json());
		} catch {
			return undefined;
		}
	}
}
