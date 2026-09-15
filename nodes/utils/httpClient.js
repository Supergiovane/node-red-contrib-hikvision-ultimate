const http = require('http');
const https = require('https');
const { Transform } = require('stream');
const { URL } = require('url');
const crypto = require('crypto');

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
    if (typeof rawHeader !== 'string') return null;
    // Split only at unquoted commas: qop and escaped realms may contain commas.
    const fields = rawHeader.match(/(?:[^,"\\]|\\.|"(?:[^"\\]|\\.)*")+/g) || [];
    const start = fields.findIndex(field => /^\s*digest\s+/i.test(field));
    if (start < 0) return null;
    const challenge = Object.create(null);
    for (let i = start; i < fields.length; i++) {
        const field = i === start ? fields[i].replace(/^\s*digest\s+/i, '') : fields[i];
        const match = field.match(/^\s*([a-z0-9_-]+)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^\s"]+))\s*$/i);
        if (!match) break; // A subsequent authentication scheme is not part of Digest.
        challenge[match[1].toLowerCase()] = match[2] === undefined ? match[3] : match[2].replace(/\\(.)/g, '$1');
    }
    return typeof challenge.realm === 'string' && challenge.nonce ? challenge : null;
}

function pickQop(qopString) {
    if (!qopString) return null;
    const qops = qopString.split(',').map(q => q.trim().toLowerCase()).filter(Boolean);
    if (qops.includes('auth')) return 'auth';
    if (qops.includes('auth-int')) return 'auth-int';
    throw new Error(`Unsupported digest qop: ${qopString}`);
}

function quoteDigest(value) {
    return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
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
        `username="${quoteDigest(username)}"`,
        `realm="${quoteDigest(realm)}"`,
        `nonce="${quoteDigest(nonce)}"`,
        `uri="${quoteDigest(uri)}"`,
        `response="${response}"`
    ];

    if (opaque) {
        params.push(`opaque="${quoteDigest(opaque)}"`);
    }
    params.push(`algorithm=${algorithm}`);
    if (qop) {
        params.push(`qop=${qop}`);
        params.push(`nc=${ncString}`);
    }
    // Session algorithms need cnonce even when an older camera omits qop.
    if (qop || isSess) params.push(`cnonce="${cnonce}"`);

    return `Digest ${params.join(', ')}`;
}

function requestError(message, code, name = 'Error') {
    const error = new Error(message);
    error.code = code;
    error.name = name;
    return error;
}

function streamToBuffer(stream, discard = false) {
    return new Promise((resolve, reject) => {
        if (stream.errored) return reject(stream.errored);
        if (stream.readableEnded) return resolve(Buffer.alloc(0));
        if (stream.destroyed) return reject(requestError('Response closed before completion', 'ERR_STREAM_PREMATURE_CLOSE'));
        const chunks = [];

        function onData(chunk) {
            if (!discard) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        }
        function onError(err) {
            cleanup();
            reject(err);
        }
        function onEnd() {
            cleanup();
            resolve(Buffer.concat(chunks));
        }
        function onClose() {
            onError(requestError('Response closed before completion', 'ERR_STREAM_PREMATURE_CLOSE'));
        }
        function cleanup() {
            stream.removeListener('data', onData);
            stream.removeListener('error', onError);
            stream.removeListener('end', onEnd);
            stream.removeListener('close', onClose);
        }
        stream.on('data', onData);
        stream.once('error', onError);
        stream.once('end', onEnd);
        stream.once('close', onClose);
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
        this._nonceCounts = new Map();
    }

    async fetch(url, options = {}) {
        const normalizedOptions = {
            method: options.method || 'GET',
            headers: cloneHeaders(options.headers),
            body: options.body,
            agent: options.agent,
            timeout: options.timeout,
            connectTimeout: options.connectTimeout,
            size: options.size,
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

        let response = await this._doRequest(url, initialOptions, bodyBuffer);
        const urlObj = new URL(url);
        const uri = `${urlObj.pathname}${urlObj.search}`;
        const method = (normalizedOptions.method || 'GET').toUpperCase();

        // One challenge response, plus at most one retry for an expired nonce.
        for (let attempt = 0; attempt < 2 && response.status === 401; attempt++) {
            const challenge = parseChallenge(response.headers.get('www-authenticate'));
            if (!challenge || (attempt > 0 && String(challenge.stale).toLowerCase() !== 'true')) break;
            let authorization;
            try {
                const nonceKey = JSON.stringify([urlObj.origin, challenge.realm, challenge.nonce, challenge.algorithm || 'MD5']);
                const nonceCount = ((this._nonceCounts.get(nonceKey) || 0) % 0xffffffff) + 1;
                this._nonceCounts.delete(nonceKey);
                this._nonceCounts.set(nonceKey, nonceCount);
                if (this._nonceCounts.size > 64) this._nonceCounts.delete(this._nonceCounts.keys().next().value);
                authorization = buildDigestHeader({
                    challenge,
                    username: this.username,
                    password: this.password,
                    method,
                    uri,
                    bodyBuffer,
                    nonceCount
                });
            } catch (err) {
                response.body.destroy();
                throw err;
            }

            // Finish the 401 before retrying, so a keep-alive agent with a single
            // socket can reuse the same connection. Discard without buffering.
            response.bodyUsed = true;
            // A 401 is part of connection setup, even for an indefinite event
            // stream whose ordinary body inactivity timeout is disabled.
            const drainTimeout = Number(normalizedOptions.connectTimeout) > 0
                ? Number(normalizedOptions.connectTimeout) : Number(normalizedOptions.timeout);
            let drainTimer;
            if (drainTimeout > 0) {
                const challengedBody = response.body;
                drainTimer = setTimeout(() => challengedBody.destroy(requestError('Digest challenge body timed out', 'ETIMEDOUT')), drainTimeout);
                drainTimer.unref();
            }
            try {
                await streamToBuffer(response.body, true);
            } finally {
                clearTimeout(drainTimer);
            }
            const authenticatedHeaders = cloneHeaders(normalizedOptions.headers);
            Object.keys(authenticatedHeaders).forEach(key => {
                if (key.toLowerCase() === 'authorization') delete authenticatedHeaders[key];
            });
            authenticatedHeaders.Authorization = authorization;
            response = await this._doRequest(url, {
                ...normalizedOptions,
                headers: ensureContentLength(authenticatedHeaders, bodyBuffer)
            }, bodyBuffer);
        }
        if (response.status === 401 && this.logger) {
            this.logger.warn('Digest authentication failed or no supported challenge was provided.');
        }
        return response;
    }

    _doRequest(url, options, bodyBuffer) {
        const urlObj = new URL(url);
        const isHttps = urlObj.protocol === 'https:';
        const transport = isHttps ? https : http;
        const headers = cloneHeaders(options.headers);
        ensureContentLength(headers, bodyBuffer);

        const requestOptions = {
            protocol: urlObj.protocol,
            // WHATWG URLs keep IPv6 brackets; http.request expects the bare address.
            hostname: urlObj.hostname.replace(/^\[|\]$/g, ''),
            port: urlObj.port || (isHttps ? 443 : 80),
            path: `${urlObj.pathname}${urlObj.search}`,
            method: options.method || 'GET',
            headers,
            agent: options.agent
        };

        return new Promise((resolve, reject) => {
            let responseBody;
            let incoming;
            let headerTimer;
            let completed = false;
            const signal = options.signal;
            const timeout = Number(options.timeout) > 0 ? Number(options.timeout) : 0;
            const connectTimeout = options.connectTimeout === undefined ? timeout : Number(options.connectTimeout);
            const maxSize = Number(options.size) > 0 ? Number(options.size) : 0;

            const cleanup = () => {
                clearTimeout(headerTimer);
                if (signal) signal.removeEventListener('abort', abortHandler);
            };
            const fail = (err) => {
                if (completed) return;
                completed = true;
                cleanup();
                if (responseBody) responseBody.destroy(err);
                req.destroy(err);
                reject(err); // After headers, rejection is delivered through body.
            };
            const abortHandler = () => fail(requestError('Request aborted', 'ABORT_ERR', 'AbortError'));
            const req = transport.request(requestOptions, (res) => {
                if (completed) {
                    res.destroy();
                    return;
                }
                incoming = res;
                clearTimeout(headerTimer);
                let receivedBytes = 0;
                responseBody = new Transform({
                    transform(chunk, encoding, callback) {
                        receivedBytes += chunk.length;
                        if (maxSize && receivedBytes > maxSize) {
                            callback(requestError(`Response exceeds maximum size of ${maxSize} bytes`, 'ERR_RESPONSE_TOO_LARGE'));
                        } else {
                            callback(null, chunk);
                        }
                    }
                });
                // The peer can fail before the caller has attached body listeners.
                // Keep the error on the destroyed stream for a later text()/buffer().
                responseBody.on('error', fail);
                responseBody.once('close', () => {
                    if (!completed) fail(requestError('Response body closed before completion', 'ERR_STREAM_PREMATURE_CLOSE'));
                });
                res.once('aborted', () => fail(requestError('Response aborted before completion', 'ECONNRESET')));
                res.on('error', fail);
                res.once('end', () => {
                    if (!res.complete) {
                        fail(requestError('Response closed before completion', 'ERR_STREAM_PREMATURE_CLOSE'));
                        return;
                    }
                    completed = true;
                    cleanup();
                });
                res.once('close', () => {
                    if (!res.complete) fail(requestError('Response closed before completion', 'ERR_STREAM_PREMATURE_CLOSE'));
                });
                res.pipe(responseBody);
                resolve(new SimpleResponse(res.statusCode, res.statusMessage, res.headers, responseBody));
            });

            req.on('error', fail);
            req.once('close', () => {
                if (!incoming && !completed) fail(requestError('Request closed before receiving a response', 'ECONNRESET'));
            });
            if (connectTimeout > 0) {
                // Unlike socket.setTimeout, this also covers DNS, TCP/TLS setup,
                // waiting for an agent socket, and a peer that trickles headers.
                headerTimer = setTimeout(() => fail(requestError('Request timed out before response headers', 'ETIMEDOUT')), connectTimeout);
                headerTimer.unref();
            }
            if (timeout) {
                req.setTimeout(timeout, () => fail(requestError('Request timed out', 'ETIMEDOUT')));
            }
            if (signal) {
                if (signal.aborted) {
                    abortHandler();
                    return;
                }
                signal.addEventListener('abort', abortHandler, { once: true });
            }
            if (bodyBuffer && bodyBuffer.length > 0) req.write(bodyBuffer);
            req.end();
        });
    }
}

function createHttpClient(options) {
    return new HttpClient(options);
}

module.exports = {
    HttpClient,
    createHttpClient,
    parseChallenge,
    buildDigestHeader
};
