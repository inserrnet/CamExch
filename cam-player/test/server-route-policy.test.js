"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  isDiscoveryAddress,
  normalizeAddress,
  selectLockedAddress,
} = require("../lib/server-route-policy");

const main = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf8");

test("normalizes IPv4-mapped socket addresses", () => {
  assert.equal(normalizeAddress("::ffff:10.42.236.58"), "10.42.236.58");
  assert.equal(normalizeAddress("192.168.4.132"), "192.168.4.132");
});

test("locks only to the interface used by Source", () => {
  const available = ["192.168.4.132", "10.42.236.58"];
  assert.equal(selectLockedAddress("::ffff:10.42.236.58", available), "10.42.236.58");
  assert.equal(selectLockedAddress("192.168.56.1", available), "");
});

test("wildcard listening is reserved for discovery", () => {
  assert.equal(isDiscoveryAddress("0.0.0.0"), true);
  assert.equal(isDiscoveryAddress("10.42.236.58"), false);
  assert.match(main, /pathname === "\/lock-route"/);
  assert.match(main, /rebindServer\(localAddress, "Source locked active route"\)/);
  assert.match(main, /rebindServer\("0\.0\.0\.0", "Source released route"\)/);
  assert.match(main, /server\.listen\(PORT, host/);
  assert.match(main, /host === serverTargetHost/);
  assert.match(main, /serverTargetHost = host/);
  assert.doesNotMatch(main, /server\.listen\(PORT, "0\.0\.0\.0"/);
});
