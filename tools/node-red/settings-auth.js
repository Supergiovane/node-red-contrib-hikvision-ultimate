const path = require('path');
const fs = require('fs');

const defaultUserDir = (process.env.HOME || process.env.USERPROFILE)
    ? path.resolve(process.env.HOME || process.env.USERPROFILE, '.node-red')
    : path.resolve(process.cwd(), '.node-red');
const userDir = process.env.NODE_RED_USER_DIR || defaultUserDir;
const uiPort = process.env.PORT || 1880;
const flowFile = process.env.NODE_RED_FLOW_FILE || 'flows.json';
let credentialSecret = process.env.NODE_RED_CREDENTIAL_SECRET;
const adminUser = process.env.NODE_RED_ADMIN_USER || 'admin';
const adminPassHash = process.env.NODE_RED_ADMIN_PASS_HASH
    || '$2y$08$UZDYcMPFJKzh.YoN5FS2yej17VOpCIxjJp4ruAg8oWSAs/LuguHUC'; // hash della parola "admin"

if (!credentialSecret) {
    const runtimeConfigPath = path.join(userDir, '.config.runtime.json');
    try {
        const runtimeConfig = JSON.parse(fs.readFileSync(runtimeConfigPath, 'utf8'));
        if (runtimeConfig) {
            if (runtimeConfig.credentialSecret) credentialSecret = runtimeConfig.credentialSecret;
            else if (runtimeConfig._credentialSecret) credentialSecret = runtimeConfig._credentialSecret;
        }
    } catch (err) {
        // Il file di runtime potrebbe non esistere (prima esecuzione)
    }
}

if (!credentialSecret) {
    credentialSecret = 'hikvision-ultimate-dev-secret';
    // eslint-disable-next-line no-console
    console.warn('[hikvision-ultimate] NODE_RED_CREDENTIAL_SECRET non impostata. Uso chiave di sviluppo predefinita.');
}

if (!process.env.NODE_RED_ADMIN_PASS_HASH) {
    // eslint-disable-next-line no-console
    console.warn('[hikvision-ultimate] NODE_RED_ADMIN_PASS_HASH non impostata. Viene usata la password di default "admin" solo per test.');
}

const settings = {
    flowFile,
    flowFilePretty: true,
    userDir,
    uiPort,
    logging: {
        console: {
            level: process.env.NODE_RED_LOG_LEVEL || 'info',
            metrics: false,
            audit: false
        }
    },
    editorTheme: {},
    functionGlobalContext: {},
    adminAuth: {
        type: 'credentials',
        users: [
            {
                username: adminUser,
                password: adminPassHash,
                permissions: '*'
            }
        ]
    }
};

const httpNodeUser = process.env.NODE_RED_HTTP_USER || 'admin';
const httpNodePassHash = process.env.NODE_RED_HTTP_PASS_HASH || adminPassHash;

settings.httpNodeAuth = {
    user: httpNodeUser,
    pass: httpNodePassHash
};

settings.credentialSecret = credentialSecret;

module.exports = settings;
