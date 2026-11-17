#!/usr/bin/env node
/**
 * Self-test for the zero-dependency tooling in scripts/lib (CI runs it first,
 * so a broken validator can never turn the other gates green).
 *
 * - YAML: fixed cases with known results; when `js-yaml` happens to be
 *   resolvable (never required), every openapi/*.yaml is also compared with it.
 * - JSON Schema: must-pass and must-fail cases for every supported keyword,
 *   plus a mutated copy of each webhook v2 fixture that must be rejected.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const assert = require("assert");
const yaml = require("./lib/yaml");
const { Validator } = require("./lib/jsonschema");

const ROOT = path.join(__dirname, "..");
let n = 0;
const ok = (name, fn) => {
    try {
        fn();
        n++;
    } catch (e) {
        console.error(`FAIL ${name}: ${e.message}`);
        process.exitCode = 1;
    }
};

// ---- YAML ---------------------------------------------------------------
const Y = [
    ["a: 1\nb: [x, \"y\", 3]\nc:\n  - d: 1\n    e: two\n  - 3\n", { a: 1, b: ["x", "y", 3], c: [{ d: 1, e: "two" }, 3] }],
    ["k: |\n  l1\n    ind\n\n  l3\nn: >-\n  folded\n  text\n\n  para\nz: end # c\n", { k: "l1\n  ind\n\nl3\n", n: "folded text\npara", z: "end" }],
    ["q: \"a # no\"\nr: 'it''s'\ns: {a: 1, b: [1, 2]}\nt:\n- a\n- b\n", { q: "a # no", r: "it's", s: { a: 1, b: [1, 2] }, t: ["a", "b"] }],
    ["m: plain\n  more\nu: https://x.y/#f\n\"200\":\n  d: ok\ne:\n/p/{id}/x:\n  get: 1\n", { m: "plain more", u: "https://x.y/#f", 200: { d: "ok" }, e: null, "/p/{id}/x": { get: 1 } }],
    ["s:\n    -   $ref: a\n        x: 1\n    -   b\n", { s: [{ $ref: "a", x: 1 }, "b"] }],
];
Y.forEach(([src, want], i) => ok(`yaml case ${i}`, () => assert.deepStrictEqual(JSON.parse(JSON.stringify(yaml.parse(src))), want)));
for (const bad of ["a: &x 1\n", "a: *x\n", "a: 1\na: 2\n", "a: !!str 1\n", "a:\n\t- 1\n"]) {
    ok(`yaml rejects ${JSON.stringify(bad)}`, () => assert.throws(() => yaml.parse(bad)));
}
let jsYaml = null;
try {
    jsYaml = require("js-yaml");
} catch {
    /* optional */
}
if (jsYaml) {
    for (const f of fs.readdirSync(path.join(ROOT, "openapi"))) {
        const t = fs.readFileSync(path.join(ROOT, "openapi", f), "utf8");
        ok(`yaml == js-yaml on ${f}`, () => assert.deepStrictEqual(JSON.parse(JSON.stringify(yaml.parse(t))), JSON.parse(JSON.stringify(jsYaml.load(t)))));
    }
}

// ---- JSON Schema --------------------------------------------------------
const v = new Validator((p) => {
    throw new Error(`unexpected load ${p}`);
});
const check = (schema, value) => {
    v.docs.set("/selftest.json", schema);
    return v.validate(value, "/selftest.json").length === 0;
};
const S = [
    [{ type: "string" }, "x", 1],
    [{ type: ["string", "null"] }, null, 0],
    [{ type: "integer" }, 2, 2.5],
    [{ type: "number" }, 2.5, "2"],
    [{ enum: ["A", "B"] }, "A", "C"],
    [{ const: true }, true, false],
    [{ type: "object", required: ["a"] }, { a: 1 }, {}],
    [{ type: "object", properties: { a: { type: "string" } }, additionalProperties: false }, { a: "x" }, { a: "x", b: 1 }],
    [{ type: "object", additionalProperties: { type: "integer" } }, { x: 1 }, { x: "1" }],
    [{ type: "array", items: { type: "integer" }, minItems: 1, maxItems: 2 }, [1], [1, 2, 3]],
    [{ type: "array", uniqueItems: true }, [1, 2], [1, 1]],
    [{ type: "string", minLength: 2, maxLength: 3 }, "ab", "abcd"],
    [{ type: "string", pattern: "^[A-Z]{3}$" }, "NGN", "ngn"],
    [{ type: "number", minimum: 0, maximum: 10 }, 10, 11],
    [{ type: "number", exclusiveMinimum: 0 }, 1, 0],
    [{ type: "string", format: "date-time" }, "2026-11-25T10:00:00.000Z", "2026-11-25 10:00"],
    [{ type: "string", format: "uuid" }, "0193b2f4-0000-7000-8000-00000000d001", "not-a-uuid"],
    [{ anyOf: [{ type: "string" }, { type: "null" }] }, null, 1],
    [{ oneOf: [{ type: "integer" }, { type: "number" }] }, 1.5, 1],
    [{ allOf: [{ required: ["a"] }, { required: ["b"] }] }, { a: 1, b: 1 }, { a: 1 }],
    [{ not: { const: 0 } }, 1, 0],
    [{ $defs: { M: { type: "string" } }, $ref: "#/$defs/M" }, "x", 1],
    [{ if: { properties: { k: { const: "A" } } }, then: { required: ["a"] }, else: { required: ["b"] } }, { k: "B", b: 1 }, { k: "A" }],
];
S.forEach(([schema, good, bad], i) => {
    ok(`schema case ${i} accepts`, () => assert.ok(check(schema, good), JSON.stringify(schema)));
    ok(`schema case ${i} rejects`, () => assert.ok(!check(schema, bad), JSON.stringify(schema)));
});
ok("unknown keyword is an error", () => assert.throws(() => check({ type: "string", nullable: true }, "x")));
ok("boolean exclusiveMinimum is an error", () => assert.throws(() => check({ type: "number", exclusiveMinimum: true }, 1)));
ok("unknown format is an error", () => assert.throws(() => check({ type: "string", format: "ipv9" }, "x")));

// Every webhook v2 fixture must fail once it carries an extra key or a float amount.
const disk = new Validator();
const dir = path.join(ROOT, "fixtures/webhooks/v2");
for (const f of fs.readdirSync(dir).filter((f) => f !== "signature.json")) {
    const ev = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
    const schema = path.join(ROOT, "schemas/webhooks/v2", `${ev.type}.v1.json`);
    ok(`${f} extra key rejected`, () => assert.ok(disk.validate({ ...ev, extra: 1 }, schema).length > 0));
    ok(`${f} extra data.object key rejected`, () =>
        assert.ok(disk.validate({ ...ev, data: { ...ev.data, object: { ...ev.data.object, leaked: "x" } } }, schema).length > 0),
    );
}
const money = JSON.parse(fs.readFileSync(path.join(dir, "payment.succeeded.json"), "utf8"));
money.data.object.amount.amountMinor = 1500.5;
ok("float amountMinor rejected", () => assert.ok(disk.validate(money, path.join(ROOT, "schemas/webhooks/v2/payment.succeeded.v1.json")).length > 0));

if (process.exitCode) console.error("selftest failed");
else console.log(`selftest passed (${n} checks${jsYaml ? ", js-yaml differential on" : ""}).`);
