#!/usr/bin/env node
/**
 * Webhook signature test vectors shared by all six SDKs.
 *
 *   node scripts/compute-signature-fixture.js          # verify (CI): exit 1 on any mismatch
 *   node scripts/compute-signature-fixture.js --write  # regenerate the expected values
 *
 * Legacy (`fixtures/signature.json`):
 *   x-waysdrop-signature = hex(HMAC-SHA256(apiSecretKey, rawBody))
 * v2 (`fixtures/webhooks/v2/signature.json`):
 *   Waysdrop-Signature = t=<unix s>,v1=<hex>[,v1=<hex>]
 *   v1 = hex(HMAC-SHA256(secret, `${t}.${rawBody}`)), one per active secret, current first.
 *
 * The verification cases encode the reference verifier's rules (server
 * src/modules/partner-webhooks/delivery/signing.ts and the contract's
 * verify.node.ts) so every SDK can assert the same outcome per case.
 * No dependencies.
 */
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const WRITE = process.argv.includes("--write");
const ROOT = path.join(__dirname, "..");
let failures = 0;

const hmacHex = (key, data) =>
    crypto.createHmac("sha256", key).update(data, "utf8").digest("hex");

function check(label, actual, expected) {
    if (actual !== expected) {
        failures++;
        console.error(`MISMATCH ${label}\n  expected ${expected}\n  actual   ${actual}`);
    }
}

function readJson(rel) {
    return JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf8"));
}

function writeJson(rel, value) {
    fs.writeFileSync(path.join(ROOT, rel), JSON.stringify(value, null, 2) + "\n");
}

// ---- legacy -------------------------------------------------------------
{
    const rel = "fixtures/signature.json";
    const f = readJson(rel);
    if (f.rawBody !== JSON.stringify(f.payload)) {
        failures++;
        console.error(`MISMATCH ${rel}: rawBody is not JSON.stringify(payload)`);
    }
    const sig = hmacHex(f.apiKey, f.rawBody);
    if (WRITE) {
        f.signature = sig;
        writeJson(rel, f);
    } else check(`${rel} signature`, f.signature, sig);
}

// ---- v2 -----------------------------------------------------------------
function v2Header(secrets, t, rawBody) {
    return [`t=${t}`, ...secrets.map((s) => `v1=${hmacHex(s, `${t}.${rawBody}`)}`)].join(",");
}

/** Reference verifier (the outcome every SDK must reproduce). */
function verify(rawBody, header, secrets, toleranceSec, nowSec) {
    if (!header) return "MISSING_HEADER";
    const usable = secrets.filter((s) => typeof s === "string" && s.length > 0);
    if (!usable.length) return "NO_SECRETS";
    if (header.length > 1024) return "MALFORMED_HEADER";
    let t = null;
    const sigs = [];
    for (const part of header.split(",")) {
        const eq = part.indexOf("=");
        if (eq <= 0) continue;
        const k = part.slice(0, eq).trim();
        const v = part.slice(eq + 1).trim();
        if (k === "t") {
            if (!/^\d{1,12}$/.test(v)) return "MALFORMED_HEADER";
            t = Number(v);
        } else if (k === "v1" && /^[0-9a-f]{64}$/.test(v) && sigs.length < 8) {
            sigs.push(Buffer.from(v, "hex"));
        }
    }
    if (t === null || sigs.length === 0) return "MALFORMED_HEADER";
    if (Math.abs(nowSec - t) > toleranceSec) return "TIMESTAMP_OUT_OF_TOLERANCE";
    const signed = Buffer.from(`${t}.${rawBody}`, "utf8");
    let ok = false;
    for (const s of usable) {
        const expected = crypto.createHmac("sha256", s).update(signed).digest();
        for (const sig of sigs) {
            if (sig.length === expected.length && crypto.timingSafeEqual(sig, expected)) ok = true;
        }
    }
    if (!ok) return "SIGNATURE_MISMATCH";
    try {
        JSON.parse(rawBody);
    } catch {
        return "INVALID_JSON";
    }
    return "OK";
}

{
    const rel = "fixtures/webhooks/v2/signature.json";
    const pingBody = JSON.stringify(readJson("fixtures/webhooks/v2/ping.json"));
    const T = 1764064800;
    const signing = [
        { name: "single-secret", secrets: ["whsec_test_secret_1"], timestamp: T, rawBody: '{"id":"evt_1","type":"ping"}' },
        {
            name: "rotation-two-secrets",
            secrets: ["whsec_test_secret_1", "whsec_test_secret_2"],
            timestamp: T,
            rawBody: '{"id":"evt_1","type":"ping"}',
        },
        { name: "ping-fixture-body", secrets: ["whsec_test_secret_1"], timestamp: T, rawBody: pingBody },
        {
            name: "utf8-body",
            secrets: ["whsec_test_secret_1"],
            timestamp: T,
            rawBody: '{"id":"evt_2","note":"Ìbàdàn – café ✓"}',
        },
    ];
    for (const c of signing) c.header = v2Header(c.secrets, c.timestamp, c.rawBody);

    const body = signing[0].rawBody;
    const h1 = signing[0].header;
    const hRot = signing[1].header;
    const verification = [
        { name: "valid", header: h1, secrets: ["whsec_test_secret_1"], now: T },
        { name: "valid-rotation-old-secret-only", header: hRot, secrets: ["whsec_test_secret_2"], now: T },
        { name: "valid-any-secret-of-several", header: h1, secrets: ["whsec_other", "whsec_test_secret_1"], now: T },
        { name: "tolerance-boundary-inclusive", header: h1, secrets: ["whsec_test_secret_1"], now: T + 300 },
        { name: "too-old", header: h1, secrets: ["whsec_test_secret_1"], now: T + 301 },
        { name: "from-the-future", header: h1, secrets: ["whsec_test_secret_1"], now: T - 301 },
        { name: "wrong-secret", header: h1, secrets: ["whsec_wrong"], now: T },
        { name: "tampered-body", header: h1, secrets: ["whsec_test_secret_1"], now: T, rawBody: body.replace("ping", "pong") },
        {
            name: "reserialised-body",
            header: h1,
            secrets: ["whsec_test_secret_1"],
            now: T,
            rawBody: JSON.stringify(JSON.parse(body), null, 1),
        },
        {
            name: "timestamp-moved",
            header: h1.replace(`t=${T}`, `t=${T + 1}`),
            secrets: ["whsec_test_secret_1"],
            now: T,
        },
        { name: "missing-header", header: "", secrets: ["whsec_test_secret_1"], now: T },
        { name: "no-secrets", header: h1, secrets: [], now: T },
        { name: "empty-secret-only", header: h1, secrets: [""], now: T },
        { name: "garbage-header", header: "garbage", secrets: ["whsec_test_secret_1"], now: T },
        { name: "no-v1", header: `t=${T}`, secrets: ["whsec_test_secret_1"], now: T },
        { name: "non-numeric-t", header: h1.replace(`t=${T}`, "t=abc"), secrets: ["whsec_test_secret_1"], now: T },
        {
            name: "unknown-scheme-ignored",
            header: `${h1},v2=deadbeef`,
            secrets: ["whsec_test_secret_1"],
            now: T,
        },
        {
            name: "signed-but-not-json",
            header: v2Header(["whsec_test_secret_1"], T, "not json"),
            secrets: ["whsec_test_secret_1"],
            now: T,
            rawBody: "not json",
        },
        {
            name: "uppercase-hex-ignored",
            header: `t=${T},v1=${h1.split("v1=")[1].toUpperCase()}`,
            secrets: ["whsec_test_secret_1"],
            now: T,
        },
    ].map((c) => {
        const rawBody = c.rawBody ?? body;
        return { ...c, rawBody, toleranceSec: 300, expected: verify(rawBody, c.header, c.secrets, 300, c.now) };
    });

    const fixture = {
        description:
            "Waysdrop webhooks v2 signature vectors. Waysdrop-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256(secret, t + '.' + rawBody)>[,v1=…]. Verify against the raw body bytes; accept when any v1 matches any configured secret (constant-time) and |now - t| <= toleranceSec. Unknown schemes and non-lowercase-hex v1 values are ignored. `expected` is OK or the error code the SDK must raise.",
        algorithm: "HMAC-SHA256",
        header: "Waysdrop-Signature",
        defaultToleranceSec: 300,
        errorCodes: [
            "MISSING_HEADER",
            "MALFORMED_HEADER",
            "NO_SECRETS",
            "TIMESTAMP_OUT_OF_TOLERANCE",
            "SIGNATURE_MISMATCH",
            "INVALID_JSON",
        ],
        signing,
        verification,
    };

    if (WRITE) writeJson(rel, fixture);
    else {
        const committed = readJson(rel);
        check(rel, JSON.stringify(committed), JSON.stringify(fixture));
        // The server's own signing spec pins this exact header.
        check(
            `${rel} server vector`,
            committed.signing[0].header,
            "t=1764064800,v1=2d8c9de56f2119e98f2d7a387ed72076c1ac7cc613657e59acbcd83540bc523f",
        );
    }
}

if (failures) {
    console.error(`${failures} signature vector mismatch(es). Run with --write only for an intentional change.`);
    process.exit(1);
}
console.log(WRITE ? "Signature vectors written." : "Signature vectors verified.");
