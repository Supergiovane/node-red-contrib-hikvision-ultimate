const path = require('path');
const fs = require('fs');

const defaultUserDir = (process.env.HOME || process.env.USERPROFILE)
    ? path.resolve(process.env.HOME || process.env.USERPROFILE, '.node-red')
    : path.resolve(process.cwd(), '.node-red');
const userDir = process.env.NODE_RED_USER_DIR || defaultUserDir;
const flowFile = process.env.NODE_RED_FLOW_FILE || 'flows.json';
let credentialSecret = process.env.NODE_RED_CREDENTIAL_SECRET;

if (!credentialSecret) {
    const runtimeConfigPath = path.join(userDir, '.config.runtime.json');
    try {
        const runtimeConfig = JSON.parse(fs.readFileSync(runtimeConfigPath, 'utf8'));
        if (runtimeConfig) {
            if (runtimeConfig.credentialSecret) credentialSecret = runtimeConfig.credentialSecret;
            else if (runtimeConfig._credentialSecret) credentialSecret = runtimeConfig._credentialSecret;
        }
    } catch (err) {
        // Il file potrebbe non esistere ancora: ignoriamo l'errore
    }
}

if (!credentialSecret) {
    credentialSecret = 'hikvision-ultimate-dev-secret';
    // eslint-disable-next-line no-console
    console.warn('[hikvision-ultimate] NODE_RED_CREDENTIAL_SECRET non impostata. Uso chiave di sviluppo predefinita.');
}

const settings = {
    flowFile,
    flowFilePretty: true,
    userDir,
    uiPort: process.env.PORT || 1880,
    logging: {
        console: {
            level: process.env.NODE_RED_LOG_LEVEL || 'info',
            metrics: false,
            audit: false
        }
    },
    editorTheme: {},
    functionGlobalContext: {},
};

settings.credentialSecret = credentialSecret;

module.exports = settings;
