#!/usr/bin/env node
/**
 * Validates every fixture against its schema (CI gate). Zero dependencies.
 *
 * `fixtures/manifest.json` maps each fixture to a schema:
 *   { "fixture": "fixtures/x.json", "schema": "schemas/y.json#/definitions/Z", "at": "/payload" }
 * `schema` may point into an OpenAPI YAML file
 * ("openapi/partner-api.yaml#/components/schemas/Problem"); `at` (optional)
 * selects a JSON pointer inside the fixture. A fixture can be listed more
 * than once (e.g. once against its event schema and once against the
 * envelope).
 *
 * Also enforced:
 *  - every *.json under fixtures/ (except manifest.json) is listed, so no
 *    fixture can go unvalidated;
 *  - every schema under schemas/ compiles (no unsupported keyword, no
 *    dangling $ref);
 *  - webhooks v2: one schema per catalogue type, one fixture per type, and
 *    each fixture's `type` matches its file name.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const yaml = require("./lib/yaml");
const { Validator, pointer } = require("./lib/jsonschema");

const ROOT = path.join(__dirname, "..");
const rel = (p) => path.relative(ROOT, p);
const loadAny = (p) => (/\.ya?ml$/.test(p) ? yaml.parse(fs.readFileSync(p, "utf8")) : JSON.parse(fs.readFileSync(p, "utf8")));
const listJson = (dir) =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
        const p = path.join(dir, d.name);
        return d.isDirectory() ? listJson(p) : d.name.endsWith(".json") ? [p] : [];
    });

const problems = [];
const v = new Validator(loadAny);

// 1. Every JSON Schema file compiles.
for (const file of listJson(path.join(ROOT, "schemas"))) {
    const doc = loadAny(file);
    if (!doc.$schema && !doc.definitions && !doc.$defs) continue; // data files such as catalogue.json
    try {
        v.compile(file);
    } catch (e) {
        problems.push(`${rel(file)}: ${e.message}`);
    }
}

// 2. Manifest coverage and validation.
const manifestPath = path.join(ROOT, "fixtures", "manifest.json");
const manifest = loadAny(manifestPath);
const listed = new Set(manifest.fixtures.map((m) => path.resolve(ROOT, m.fixture)));
for (const f of listJson(path.join(ROOT, "fixtures"))) {
    if (f !== manifestPath && !listed.has(f)) problems.push(`${rel(f)}: not listed in fixtures/manifest.json`);
}
let checked = 0;
for (const m of manifest.fixtures) {
    const fixturePath = path.resolve(ROOT, m.fixture);
    const [schemaFile, ptr = ""] = m.schema.split("#");
    let value;
    try {
        value = loadAny(fixturePath);
        if (m.at) value = pointer(value, m.at, `${m.fixture}#${m.at}`);
    } catch (e) {
        problems.push(`${m.fixture}: ${e.message}`);
        continue;
    }
    try {
        const errs = v.validate(value, path.resolve(ROOT, schemaFile), ptr);
        for (const e of errs) problems.push(`${m.fixture}${m.at || ""} vs ${m.schema}: ${e}`);
        checked++;
    } catch (e) {
        problems.push(`${m.fixture} vs ${m.schema}: ${e.message}`);
    }
}

// 3. Webhooks v2 catalogue ⇔ schemas ⇔ fixtures.
const catalogue = loadAny(path.join(ROOT, "schemas/webhooks/v2/catalogue.json"));
const envelope = loadAny(path.join(ROOT, "schemas/webhooks/v2/envelope.json"));
const types = catalogue.types.map((t) => t.type);
const envTypes = envelope.$defs.EventType.enum;
if (JSON.stringify([...types].sort()) !== JSON.stringify([...envTypes].sort())) {
    problems.push("schemas/webhooks/v2: catalogue.json types differ from envelope.json EventType enum");
}
for (const t of catalogue.types) {
    const schemaPath = path.join(ROOT, "schemas/webhooks/v2", t.schema);
    if (!fs.existsSync(schemaPath)) {
        problems.push(`catalogue: ${t.type}: missing ${rel(schemaPath)}`);
        continue;
    }
    const s = loadAny(schemaPath);
    if (!s.properties || !s.properties.type || s.properties.type.const !== t.type) problems.push(`${rel(schemaPath)}: type const is not ${t.type}`);
    const obj = s.$defs && s.$defs.Object && s.$defs.Object.properties && s.$defs.Object.properties.object;
    if (!obj || obj.const !== t.object) problems.push(`${rel(schemaPath)}: data.object.object is not "${t.object}"`);
    const fx = path.join(ROOT, "fixtures/webhooks/v2", `${t.type}.json`);
    if (!fs.existsSync(fx)) problems.push(`catalogue: ${t.type}: missing fixture ${rel(fx)}`);
    else if (loadAny(fx).type !== t.type) problems.push(`${rel(fx)}: type is not ${t.type}`);
}
for (const f of fs.readdirSync(path.join(ROOT, "schemas/webhooks/v2"))) {
    const m = /^(.+)\.v1\.json$/.exec(f);
    if (m && !types.includes(m[1])) problems.push(`schemas/webhooks/v2/${f}: not in catalogue.json`);
}

if (problems.length) {
    for (const p of problems) console.error(p);
    console.error(`${problems.length} fixture/schema problem(s).`);
    process.exit(1);
}
console.log(`Fixtures valid: ${checked} fixture/schema pairs; ${types.length} webhook v2 types consistent.`);
