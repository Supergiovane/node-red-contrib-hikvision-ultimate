const http = require('http');
const https = require('https');
const { PassThrough } = require('stream');
const { URL } = require('url');
const crypto = require('crypto');

const DEFAULT_QOP = 'auth';
const SUPPORTED_ALGORITHMS = ['MD5', 'MD5-SESS', 'SHA-256', 'SHA-256-SESS', 'SHA-512-256', 'SHA-512-256-SESS'];

function cloneHeaders(init = {}) {
    const headers = {};
    Object.keys(init || {}).forEach((key) => {
        const value = init[key];
        if (typeof value !== 'undefined' && value !== null) {
            headers[key] = value;
        }
    });
    return headers;
}

function hasHeader(headers, name) {
    const target = name.toLowerCase();
    return Object.keys(headers).some(key => key.toLowerCase() === target);
}

function ensureContentLength(headers, bodyBuffer) {
    if (!bodyBuffer || bodyBuffer.length === 0) return headers;
    if (!hasHeader(headers, 'content-length')) {
        headers['Content-Length'] = Buffer.byteLength(bodyBuffer);
    }
    return headers;
}

function normalizeBody(body) {
    if (body === null || body === undefined) return null;
    if (Buffer.isBuffer(body)) return Buffer.from(body);
    if (typeof body === 'string') return Buffer.from(body, 'utf8');
    if (body instanceof Uint8Array) return Buffer.from(body);
    if (typeof body === 'object' && typeof body.toString === 'function') {
        return Buffer.from(body.toString(), 'utf8');
    }
    throw new Error('Unsupported request body type for HTTP client');
}

function parseChallenge(rawHeader) {
    if (!rawHeader) return null;
    const trimmed = rawHeader.trim();
    const prefixMatch = trimmed.match(/^digest\s+/i);
    const paramsPart = prefixMatch ? trimmed.slice(prefixMatch[0].length) : trimmed;
    const regex = /([a-z0-9_-]+)=("(?:[^"\\]|\\.)*"|[^,]*)/ig;
    const challenge = {};
    let match;

    while ((match = regex.exec(paramsPart)) !== null) {
        const key = match[1];
        let value = match[2].trim();
        if (value.startsWith('"') && value.endsWith('"')) {
            value = value.slice(1, -1);
        }
        challenge[key] = value;
    }

    return challenge;
}

function pickQop(qopString) {
    if (!qopString) return null;
    const qops = qopString.split(',').map(q => q.trim().toLowerCase()).filter(Boolean);
    if (qops.includes('auth')) return 'auth';
    if (qops.includes('auth-int')) return 'auth-int';
    return qops[0] || DEFAULT_QOP;
}

function toNodeAlgorithm(algorithm) {
    switch (algorithm) {
        case 'MD5':
        case 'MD5-SESS':
            return 'md5';
        case 'SHA-256':
        case 'SHA-256-SESS':
            return 'sha256';
        case 'SHA-512-256':
        case 'SHA-512-256-SESS':
            return 'sha512-256';
        default:
            return 'md5';
    }
}

function hashWithAlgorithm(algorithm, data) {
    return crypto.createHash(toNodeAlgorithm(algorithm)).update(data).digest('hex');
}

function buildDigestHeader({
    challenge,
    username,
    password,
    method,
    uri,
    bodyBuffer,
    nonceCount
}) {
    const algorithm = (challenge.algorithm || 'MD5').toUpperCase();
    const isSess = algorithm.endsWith('-SESS');
    const baseAlgorithm = isSess ? algorithm.replace('-SESS', '') : algorithm;

    if (!SUPPORTED_ALGORITHMS.includes(algorithm)) {
        throw new Error(`Unsupported digest algorithm: ${algorithm}`);
    }

    const cnonce = crypto.randomBytes(16).toString('hex');
    const realm = challenge.realm || '';
    const nonce = challenge.nonce || '';
    const opaque = challenge.opaque;
    const qop = pickQop(challenge.qop);
    const ncString = nonceCount.toString(16).padStart(8, '0');

    let ha1 = hashWithAlgorithm(baseAlgorithm, `${username}:${realm}:${password}`);
    if (isSess) {
        ha1 = hashWithAlgorithm(baseAlgorithm, `${ha1}:${nonce}:${cnonce}`);
    }

    let ha2Input = `${method}:${uri}`;
    if (qop === 'auth-int') {
        const entityHash = hashWithAlgorithm(baseAlgorithm, bodyBuffer || Buffer.alloc(0));
        ha2Input = `${ha2Input}:${entityHash}`;
    }
    const ha2 = hashWithAlgorithm(baseAlgorithm, ha2Input);

    let response;
    if (qop) {
        response = hashWithAlgorithm(baseAlgorithm, `${ha1}:${nonce}:${ncString}:${cnonce}:${qop}:${ha2}`);
    } else {
        response = hashWithAlgorithm(baseAlgorithm, `${ha1}:${nonce}:${ha2}`);
    }

    const params = [
        `username="${username}"`,
        `realm="${realm}"`,
        `nonce="${nonce}"`,
        `uri="${uri}"`,
        `response="${response}"`
    ];

    if (opaque) {
        params.push(`opaque="${opaque}"`);
    }
    if (challenge.algorithm) {
        params.push(`algorithm="${challenge.algorithm}"`);
    } else {
        params.push('algorithm="MD5"');
    }
    if (qop) {
        params.push(`qop=${qop}`);
        params.push(`nc=${ncString}`);
        params.push(`cnonce="${cnonce}"`);
    }

    return `Digest ${params.join(', ')}`;
}

function streamToBuffer(stream) {
    return new Promise((resolve, reject) => {
        const chunks = [];

        function onData(chunk) {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        }

        function onError(err) {
            cleanup();
            reject(err);
        }

        function onEnd() {
            cleanup();
            resolve(Buffer.concat(chunks));
        }

        function cleanup() {
            stream.removeListener('data', onData);
            stream.removeListener('error', onError);
            stream.removeListener('end', onEnd);
        }

        stream.on('data', onData);
        stream.once('error', onError);
        stream.once('end', onEnd);
        stream.resume();
    });
}

class SimpleHeaders {
    constructor(rawHeaders = {}) {
        this._headers = new Map();
        Object.keys(rawHeaders).forEach((key) => {
            const normalizedKey = key.toLowerCase();
            const value = rawHeaders[key];
            if (Array.isArray(value)) {
                this._headers.set(normalizedKey, value.join(', '));
            } else if (typeof value !== 'undefined') {
                this._headers.set(normalizedKey, value);
            }
        });
    }

    get(name) {
        if (!name) return null;
        return this._headers.get(name.toLowerCase()) || null;
    }

    has(name) {
        if (!name) return false;
        return this._headers.has(name.toLowerCase());
    }
}

class SimpleResponse {
    constructor(status, statusText, headers, bodyStream) {
        this.status = status;
        this.statusText = statusText;
        this.ok = status >= 200 && status <= 299;
        this.headers = new SimpleHeaders(headers);
        this.body = bodyStream;
        this.bodyUsed = false;
        this._bufferPromise = null;
    }

    buffer() {
        if (!this._bufferPromise) {
            if (this.bodyUsed) {
                return Promise.reject(new Error('Body already used'));
            }
            this.bodyUsed = true;
            this._bufferPromise = streamToBuffer(this.body);
        }
        return this._bufferPromise;
    }

    async text() {
        const buf = await this.buffer();
        return buf.toString('utf8');
    }

    async json() {
        const text = await this.text();
        if (!text) return {};
        return JSON.parse(text);
    }
}

class HttpClient {
    constructor({ username = '', password = '', authentication = 'digest', logger } = {}) {
        this.username = username;
        this.password = password;
        this.authentication = authentication;
        this.logger = logger;
        this._nonceCount = 0;
    }

    async fetch(url, options = {}) {
        const normalizedOptions = {
            method: options.method || 'GET',
            headers: cloneHeaders(options.headers),
            body: options.body,
            agent: options.agent,
            timeout: options.timeout,
            signal: options.signal
        };

        const bodyBuffer = normalizeBody(normalizedOptions.body);
        delete normalizedOptions.body;

        if (this.authentication === 'basic') {
            const authHeader = `Basic ${Buffer.from(`${this.username}:${this.password}`).toString('base64')}`;
            normalizedOptions.headers = cloneHeaders({
                ...normalizedOptions.headers,
                Authorization: authHeader
            });
            const requestOptions = {
                ...normalizedOptions,
                headers: ensureContentLength(cloneHeaders(normalizedOptions.headers), bodyBuffer)
            };
            return this._doRequest(url, requestOptions, bodyBuffer);
        }

        if (this.authentication === 'none' || !this.authentication) {
            const requestOptions = {
                ...normalizedOptions,
                headers: ensureContentLength(cloneHeaders(normalizedOptions.headers), bodyBuffer)
            };
            return this._doRequest(url, requestOptions, bodyBuffer);
        }

        // Digest auth flow
        const initialOptions = {
            ...normalizedOptions,
            headers: ensureContentLength(cloneHeaders(normalizedOptions.headers), bodyBuffer)
        };

        const firstResponse = await this._doRequest(url, initialOptions, bodyBuffer);

        if (firstResponse.status !== 401) {
            return firstResponse;
        }

        firstResponse.body.resume();

        const wwwAuth = firstResponse.headers.get('www-authenticate');
        if (this.logger) this.logger.info('WWW-Authenticate header: ' + wwwAuth);
        if (!wwwAuth || !/^digest/i.test(wwwAuth.trim())) {
            if (this.logger) this.logger.warn('Digest authentication requested but challenge is missing or not supported.');
            return firstResponse;
        }

        const challenge = parseChallenge(wwwAuth);
        if (!challenge) {
            if (this.logger) this.logger.warn('Unable to parse WWW-Authenticate challenge.');
            return firstResponse;
        }

        this._nonceCount = (this._nonceCount + 1) % 0xffffffff;
        const urlObj = new URL(url);
        const uri = `${urlObj.pathname}${urlObj.search}`;
        const method = (normalizedOptions.method || 'GET').toUpperCase();

        const authorization = buildDigestHeader({
            challenge,
            username: this.username,
            password: this.password,
            method,
            uri,
            bodyBuffer,
            nonceCount: this._nonceCount || 1
        });

        const authenticatedHeaders = cloneHeaders(normalizedOptions.headers);
        authenticatedHeaders.Authorization = authorization;

        const authenticatedOptions = {
            ...normalizedOptions,
            headers: ensureContentLength(authenticatedHeaders, bodyBuffer)
        };

        const finalResponse = await this._doRequest(url, authenticatedOptions, bodyBuffer);
        if (finalResponse.status === 401 && this.logger) {
            this.logger.warn('Digest authentication failed with 401 response.');
        }
        return finalResponse;
    }

    _doRequest(url, options, bodyBuffer) {
        const urlObj = new URL(url);
        const isHttps = urlObj.protocol === 'https:';
        const transport = isHttps ? https : http;
        const headers = cloneHeaders(options.headers);
        ensureContentLength(headers, bodyBuffer);

        const requestOptions = {
            protocol: urlObj.protocol,
            hostname: urlObj.hostname,
            port: urlObj.port || (isHttps ? 443 : 80),
            path: `${urlObj.pathname}${urlObj.search}`,
            method: options.method || 'GET',
            headers,
            agent: options.agent
        };

        return new Promise((resolve, reject) => {
            const req = transport.request(requestOptions, (res) => {
                const passThrough = new PassThrough();
                res.pipe(passThrough);
                res.on('error', (err) => passThrough.emit('error', err));

                const response = new SimpleResponse(res.statusCode, res.statusMessage, res.headers, passThrough);
                resolve(response);
            });

            req.on('error', (err) => {
                reject(err);
            });

            if (options.timeout && options.timeout > 0) {
                req.setTimeout(options.timeout, () => {
                    req.destroy(new Error('Request timed out'));
                });
            }

            if (options.signal) {
                if (options.signal.aborted) {
                    req.destroy(new Error('Request aborted'));
                    return;
                }
                const abortHandler = () => {
                    req.destroy(new Error('Request aborted'));
                };
                options.signal.addEventListener('abort', abortHandler, { once: true });
                req.on('close', () => {
                    options.signal.removeEventListener('abort', abortHandler);
                });
            }

            if (bodyBuffer && bodyBuffer.length > 0) {
                req.write(bodyBuffer);
            }
            req.end();
        });
    }
}

function createHttpClient(options) {
    return new HttpClient(options);
}

module.exports = {
    HttpClient,
    createHttpClient
};
