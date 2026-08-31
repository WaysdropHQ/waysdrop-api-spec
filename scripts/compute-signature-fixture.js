#!/usr/bin/env node
/**
 * Compute signature test vector for waysdrop-api-spec/fixtures/signature.json
 */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const fixturePath = path.join(__dirname, "../fixtures/signature.json");
const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
const rawBody = fixture.rawBody;
const signature = crypto
    .createHmac("sha256", fixture.apiKey)
    .update(rawBody)
    .digest("hex");

fixture.signature = signature;
fs.writeFileSync(fixturePath, JSON.stringify(fixture, null, 2) + "\n");
console.log("Updated signature:", signature);
