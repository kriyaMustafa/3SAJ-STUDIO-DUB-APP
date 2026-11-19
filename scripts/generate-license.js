/**
 * 3SAJ Studio Standalone License Key Generator
 * Usage:
 *   node scripts/generate-license.js [tier] [duration] [count]
 *
 * Examples:
 *   node scripts/generate-license.js flash 1week
 *   node scripts/generate-license.js pro 1month
 *   node scripts/generate-license.js pro 2months
 *   node scripts/generate-license.js premium 3months 5
 */

const crypto = require('crypto');

const MASTER_SALT = '3SAJ_STUDIO_DUBBING_MASTER_LICENSE_SALT_2026';

const TIERS = {
  flash: { name: 'FLASH', display: 'Flash', quota: '1 Hour / Day' },
  flush: { name: 'FLASH', display: 'Flash', quota: '1 Hour / Day' },
  pro: { name: 'PRO', display: 'Pro', quota: '3 Hours / Day' },
  premium: { name: 'PREMIUM', display: 'Premium', quota: '6 Hours / Day' },
  premeam: { name: 'PREMIUM', display: 'Premium', quota: '6 Hours / Day' },
};

const DURATIONS = {
  '1w': 7,
  '1week': 7,
  '7d': 7,
  '7days': 7,
  '1m': 30,
  '1month': 30,
  '30d': 30,
  '30days': 30,
  '2m': 60,
  '2month': 60,
  '2months': 60,
  '60d': 60,
  '60days': 60,
  '3m': 90,
  '3month': 90,
  '3months': 90,
  '90d': 90,
  '90days': 90,
};

function generateKey(tierName, days, customId) {
  const cleanId = (customId || Math.random().toString(36).substring(2, 7))
    .toUpperCase()
    .slice(0, 5)
    .padEnd(5, 'X');

  const payload = `${tierName}:${days}:${cleanId}`;
  const sig = crypto
    .createHmac('sha256', MASTER_SALT)
    .update(payload)
    .digest('hex')
    .slice(0, 8)
    .toUpperCase();

  return `3SAJ-${tierName}-${days}D-${cleanId}-${sig}`;
}

const args = process.argv.slice(2);
const tierInput = (args[0] || 'pro').toLowerCase();
const durationInput = (args[1] || '1month').toLowerCase();
const count = parseInt(args[2], 10) || 1;

const tierConfig = TIERS[tierInput];
const days = DURATIONS[durationInput];

if (!tierConfig) {
  console.error(`❌ Invalid tier: "${args[0]}". Choose from: flash, pro, premium`);
  process.exit(1);
}

if (!days) {
  console.error(`❌ Invalid duration: "${args[1]}". Choose from: 1week, 1month, 2months, 3months`);
  process.exit(1);
}

console.log('\n======================================================');
console.log('       🎬 3SAJ STUDIO LICENSE GENERATOR 🔑             ');
console.log('======================================================');
console.log(`Plan Tier:       ${tierConfig.display} (${tierConfig.quota})`);
console.log(`Duration:        ${days} Days (${durationInput})`);
console.log(`Keys Generated:  ${count}`);
console.log('------------------------------------------------------\n');

for (let i = 1; i <= count; i++) {
  const key = generateKey(tierConfig.name, days);
  console.log(`[Key #${i}]`);
  console.log(`License Key: ${key}`);
  console.log(`Customer Message:`);
  console.log(`------------------------------------------------------`);
  console.log(`🎉 3SAJ Studio License Key Activated!`);
  console.log(`• Plan: ${tierConfig.display} Plan (${tierConfig.quota})`);
  console.log(`• Duration: ${days} Days`);
  console.log(`• Key: ${key}`);
  console.log(`\nInstructions:`);
  console.log(`1. Open 3SAJ Studio app`);
  console.log(`2. Paste your license key`);
  console.log(`3. Enjoy AI Translation & Khmer Voice-Over Dubbing!`);
  console.log(`------------------------------------------------------\n`);
}
