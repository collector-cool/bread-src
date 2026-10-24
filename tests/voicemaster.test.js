const assert = require("assert");
const crypto = require("crypto");
const db = require("quick.db");
const { _test } = require("../voicemaster");

async function main() {
  const suffix = crypto.randomBytes(6).toString("hex");
  const guildA = `guild_a_${suffix}`;
  const guildB = `guild_b_${suffix}`;
  const userA = `user_a_${suffix}`;
  const userB = `user_b_${suffix}`;
  const persistentKey = `vm_test_restart_${suffix}`;

  // User-to-channel indexes are scoped by both guild and user.
  assert.notStrictEqual(_test.ownerKey(guildA, userA), _test.ownerKey(guildA, userB));
  assert.notStrictEqual(_test.ownerKey(guildA, userA), _test.ownerKey(guildB, userA));

  // Parallel duplicate trigger events share one in-flight room creation.
  const locks = new Set();
  let release;
  let calls = 0;
  const pending = _test.singleFlight(locks, `${guildA}:${userA}`, async () => {
    calls += 1;
    await new Promise(resolve => { release = resolve; });
  });
  await Promise.resolve();
  const duplicate = await _test.singleFlight(locks, `${guildA}:${userA}`, async () => { calls += 1; });
  assert.strictEqual(duplicate, false);
  assert.strictEqual(calls, 1);
  release();
  assert.strictEqual(await pending, true);
  assert.strictEqual(locks.size, 0);

  // Cleanup only accepts an empty voice channel with a matching managed record.
  const managed = { id: "voice_a", type: "voice" };
  assert.strictEqual(_test.isManagedRoom(guildA, managed, { guildId: guildA, channelId: managed.id }), true);
  assert.strictEqual(_test.isManagedRoom(guildA, { id: "ordinary", type: "voice" }, null), false);
  assert.strictEqual(_test.isManagedRoom(guildB, managed, { guildId: guildA, channelId: managed.id }), false);
  assert.strictEqual(_test.isManagedRoom(guildA, { id: "text", type: "text" }, { guildId: guildA, channelId: "text" }), false);
  assert.strictEqual(_test.isManagedRoom(guildA, managed, null), false);

  // A freshly loaded database connection can recover persisted ownership data.
  db.set(persistentKey, { guildId: guildA, ownerId: userA, channelId: "voice_a", createdAt: Date.now() });
  delete require.cache[require.resolve("quick.db")];
  const reloadedDb = require("quick.db");
  const restored = reloadedDb.get(persistentKey);
  assert.strictEqual(restored.guildId, guildA);
  assert.strictEqual(restored.ownerId, userA);
  reloadedDb.delete(persistentKey);

  console.log("VoiceMaster unit checks passed (guild/user isolation, duplicate guard, managed-channel validation, restart persistence).");
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
