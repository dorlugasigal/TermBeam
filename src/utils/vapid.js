const fs = require('fs');
const path = require('path');
const webpush = require('web-push');
const log = require('./logger');

/**
 * Load existing VAPID keys from configDir/vapid.json or generate new ones.
 * Keys are persisted so they survive server restarts.
 * @param {string} configDir - Directory to store vapid.json
 * @returns {{ publicKey: string, privateKey: string, subject: string }}
 */
function getOrCreateVapidKeys(configDir) {
  const vapidPath = path.join(configDir, 'vapid.json');
  const subject = 'https://termbeam.dev';

  try {
    const raw = fs.readFileSync(vapidPath, 'utf8');
    const keys = JSON.parse(raw);
    if (keys.publicKey && keys.privateKey) {
      log.debug('Loaded existing VAPID keys');
      return { publicKey: keys.publicKey, privateKey: keys.privateKey, subject };
    }
  } catch {
    // File doesn't exist or is invalid — generate new keys
  }

  log.info('Generating new VAPID keys');
  const keys = webpush.generateVAPIDKeys();

  try {
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(
      vapidPath,
      JSON.stringify({ publicKey: keys.publicKey, privateKey: keys.privateKey }, null, 2),
      { mode: 0o600 },
    );
    log.debug(`VAPID keys saved to ${vapidPath}`);
  } catch (err) {
    log.warn(`Could not save VAPID keys to ${vapidPath}: ${err.message}`);
  }

  return { publicKey: keys.publicKey, privateKey: keys.privateKey, subject };
}

module.exports = { getOrCreateVapidKeys };
