"use strict";

function normalizeAddress(value) {
  return String(value || "").trim().replace(/^::ffff:/i, "");
}

function selectLockedAddress(socketAddress, availableAddresses) {
  const address = normalizeAddress(socketAddress);
  const available = new Set((availableAddresses || []).map(normalizeAddress));
  return address && available.has(address) ? address : "";
}

function isDiscoveryAddress(address) {
  return normalizeAddress(address) === "0.0.0.0";
}

module.exports = {
  isDiscoveryAddress,
  normalizeAddress,
  selectLockedAddress,
};
