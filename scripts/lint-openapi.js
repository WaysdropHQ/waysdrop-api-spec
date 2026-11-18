#!/usr/bin/env node
/**
 * Zero-dependency OpenAPI 3.1 lint for openapi/*.yaml (CI gate).
 *
 * Checks, per document:
 *  - parses with the repo's YAML subset parser (scripts/lib/yaml.js)
 *  - openapi is 3.1.x; info.title and info.version are set
 *  - every $ref resolves (local and relative-file refs)
 *  - every component schema compiles with the repo validator (no unknown
 *    keywords, valid patterns, no OpenAPI 3.0-only syntax such as `nullable`)
 *  - operationIds exist, are unique and camelCase
 *  - path template parameters and `in: path` parameters match exactly, and
 *    path parameters are required
 *  - every operation has a tag, at least one 2xx (or 3xx) response, and a
 *    security requirement naming declared schemes (an explicit [] is allowed)
 *  - partner-api.yaml only: every `x-error-codes` entry is a member of
 *    components.schemas.ErrorCode, every ErrorCode member is used by at
 *    least one operation or listed in `x-generic` (codes any /v2 operation can return), and every `example` on a
 *    components.responses media type validates against its schema
 *
 * Usage: node scripts/lint-openapi.js [files…]   (default: openapi/*.yaml)
 */
"use strict";

const fs = require("fs");
const path = require("path");
const yaml = require("./lib/yaml");
const { Validator, pointer } = require("./lib/jsonschema");

const ROOT = path.join(__dirname, "..");
const METHODS = ["get", "put", "post", "delete", "options", "head", "patch", "trace"];
const loadAny = (p) => (/\.ya?ml$/.test(p) ? yaml.parse(fs.readFileSync(p, "utf8")) : JSON.parse(fs.readFileSync(p, "utf8")));

function lint(file) {
    const problems = [];
    const bad = (m) => problems.push(m);
    const abs = path.resolve(file);
    let doc;
    try {
        doc = loadAny(abs);
    } catch (e) {
        return [`parse error: ${e.message}`];
    }
    const v = new Validator(loadAny);
    v.docs.set(abs, doc);

    if (!/^3\.1\.\d+$/.test(String(doc.openapi))) bad(`openapi must be 3.1.x, got ${doc.openapi}`);
    if (!doc.info || !doc.info.title || !doc.info.version) bad("info.title and info.version are required");

    // $refs anywhere in the document.
    const walkRefs = (node, at) => {
        if (Array.isArray(node)) return node.forEach((x, i) => walkRefs(x, `${at}[${i}]`));
        if (!node || typeof node !== "object") return;
        if (typeof node.$ref === "string") {
            try {
                v.resolve(node.$ref, { file: abs });
            } catch (e) {
                bad(`${at}: ${e.message}`);
            }
        }
        if (Object.prototype.hasOwnProperty.call(node, "nullable")) bad(`${at}: "nullable" is OpenAPI 3.0; use type: [T, "null"]`);
        for (const [k, x] of Object.entries(node)) walkRefs(x, `${at}.${k}`);
    };
    walkRefs(doc, "#");

    const schemas = (doc.components && doc.components.schemas) || {};
    for (const name of Object.keys(schemas)) {
        try {
            v.compile(abs, `/components/schemas/${name}`);
        } catch (e) {
            bad(`components.schemas.${name}: ${e.message}`);
        }
    }

    const schemes = new Set(Object.keys((doc.components && doc.components.securitySchemes) || {}));
    const checkSecurity = (sec, at) => {
        if (!Array.isArray(sec)) return bad(`${at}: security must be an array`);
        for (const req of sec) for (const k of Object.keys(req)) if (!schemes.has(k)) bad(`${at}: unknown security scheme ${k}`);
    };
    if (doc.security) checkSecurity(doc.security, "#.security");

    const opIds = new Map();
    const usedCodes = new Set();
    const resolveParam = (p) => {
        if (!p || !p.$ref) return p;
        try {
            return pointer(doc, p.$ref.replace(/^#/, ""), p.$ref);
        } catch {
            return {}; // reported by the $ref walk above
        }
    };
    for (const [route, item] of Object.entries(doc.paths || {})) {
        const templ = new Set([...route.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]));
        const shared = (item.parameters || []).map(resolveParam);
        for (const method of METHODS) {
            const op = item[method];
            if (!op) continue;
            const at = `${method.toUpperCase()} ${route}`;
            if (!op.operationId) bad(`${at}: missing operationId`);
            else {
                if (!/^[a-z][A-Za-z0-9]*$/.test(op.operationId)) bad(`${at}: operationId ${op.operationId} is not camelCase`);
                if (opIds.has(op.operationId)) bad(`${at}: duplicate operationId ${op.operationId} (also ${opIds.get(op.operationId)})`);
                opIds.set(op.operationId, at);
            }
            if (!Array.isArray(op.tags) || !op.tags.length) bad(`${at}: no tags`);
            const params = [...shared, ...(op.parameters || []).map(resolveParam)];
            const pathParams = params.filter((p) => p && p.in === "path");
            for (const p of pathParams) {
                if (!templ.has(p.name)) bad(`${at}: path parameter ${p.name} is not in the template`);
                if (p.required !== true) bad(`${at}: path parameter ${p.name} must be required`);
            }
            for (const n of templ) if (!pathParams.some((p) => p.name === n)) bad(`${at}: template {${n}} has no parameter`);
            const seen = new Set();
            for (const p of params) {
                const key = `${p.in}:${p.name}`;
                if (seen.has(key) && !shared.includes(p)) bad(`${at}: duplicate parameter ${key}`);
                seen.add(key);
            }
            const codes = Object.keys(op.responses || {});
            if (!codes.some((c) => /^[23]\d\d$/.test(c))) bad(`${at}: no 2xx/3xx response`);
            const sec = op.security !== undefined ? op.security : doc.security;
            if (sec === undefined) bad(`${at}: no security requirement`);
            else checkSecurity(sec, at);
            for (const c of op["x-error-codes"] || []) usedCodes.add(c);
        }
    }

    if (path.basename(file) === "partner-api.yaml") {
        const ec = schemas.ErrorCode;
        if (!ec || !Array.isArray(ec.enum)) bad("components.schemas.ErrorCode enum is required");
        else {
            const members = new Set(ec.enum);
            const reserved = new Set(ec["x-generic"] || []);
            for (const c of usedCodes) if (!members.has(c)) bad(`x-error-codes: ${c} is not in ErrorCode`);
            for (const c of members) if (!usedCodes.has(c) && !reserved.has(c)) bad(`ErrorCode ${c} is used by no operation (add it to an operation's x-error-codes or to x-generic)`);
            for (const c of members) if (!/^[A-Z][A-Z0-9_]{2,63}$/.test(c)) bad(`ErrorCode ${c} does not match ^[A-Z][A-Z0-9_]{2,63}$`);
        }
        for (const [name, resp] of Object.entries((doc.components && doc.components.responses) || {})) {
            for (const [mt, media] of Object.entries(resp.content || {})) {
                if (media.example === undefined || !media.schema) continue;
                const tmp = { ...doc, "x-lint-tmp": media.schema };
                v.docs.set(abs, tmp);
                const errs = v.validate(media.example, abs, "/x-lint-tmp");
                v.docs.set(abs, doc);
                for (const e of errs) bad(`components.responses.${name} ${mt} example: ${e}`);
            }
        }
    }
    return problems;
}

const files = process.argv.slice(2).length
    ? process.argv.slice(2)
    : fs
          .readdirSync(path.join(ROOT, "openapi"))
          .filter((f) => /\.ya?ml$/.test(f))
          .map((f) => path.join(ROOT, "openapi", f));

let total = 0;
for (const f of files) {
    const p = lint(f);
    total += p.length;
    for (const m of p) console.error(`${path.relative(ROOT, f)}: ${m}`);
    if (!p.length) console.log(`${path.relative(ROOT, f)}: OK`);
}
if (total) {
    console.error(`${total} OpenAPI lint problem(s).`);
    process.exit(1);
}
