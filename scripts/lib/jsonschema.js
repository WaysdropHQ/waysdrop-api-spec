"use strict";
/**
 * Zero-dependency JSON Schema (draft 2020-12 subset) validator for this
 * repo's schemas and the component schemas inside the OpenAPI files.
 *
 * Supported assertions: type, enum, const, required, properties,
 * additionalProperties, patternProperties, items, prefixItems, minItems,
 * maxItems, uniqueItems, minLength, maxLength, pattern, minimum, maximum,
 * exclusiveMinimum, exclusiveMaximum, multipleOf, minProperties,
 * maxProperties, allOf, anyOf, oneOf, not, if/then/else, $ref,
 * format (date-time, date, uuid, email, uri).
 * Annotations are ignored: title, description, examples, example, default,
 * deprecated, readOnly, writeOnly, $comment, $schema, $id, $defs,
 * definitions, discriminator, xml, externalDocs, x-*.
 * Any other keyword is an error ("unsupported keyword"), so a schema can
 * never silently pass because the validator skipped a rule it didn't know.
 *
 * $ref: "#/json/pointer" within the current document, or
 * "relative/file.json#/pointer" resolved against the current file.
 *
 * Complexity: O(size of instance × size of the applicable schema); oneOf is
 * evaluated fully (it must count matches). Refs are cached per document.
 */

const fs = require("fs");
const path = require("path");

const ANNOTATIONS = new Set([
    "title",
    "description",
    "examples",
    "example",
    "default",
    "deprecated",
    "readOnly",
    "writeOnly",
    "$comment",
    "$schema",
    "$id",
    "$defs",
    "definitions",
    "discriminator",
    "xml",
    "externalDocs",
    "contentMediaType",
    "contentEncoding",
]);

const ASSERTIONS = new Set([
    "type",
    "enum",
    "const",
    "required",
    "properties",
    "additionalProperties",
    "patternProperties",
    "items",
    "prefixItems",
    "minItems",
    "maxItems",
    "uniqueItems",
    "minLength",
    "maxLength",
    "pattern",
    "minimum",
    "maximum",
    "exclusiveMinimum",
    "exclusiveMaximum",
    "multipleOf",
    "minProperties",
    "maxProperties",
    "allOf",
    "anyOf",
    "oneOf",
    "not",
    "if",
    "then",
    "else",
    "$ref",
    "format",
]);

const FORMATS = {
    "date-time": (s) =>
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/i.test(s) && !Number.isNaN(Date.parse(s)),
    date: (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)),
    uuid: (s) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s),
    email: (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s),
    uri: (s) => /^[a-z][a-z0-9+.-]*:[^\s]*$/i.test(s),
};

function typeOf(v) {
    if (v === null) return "null";
    if (Array.isArray(v)) return "array";
    if (typeof v === "number") return Number.isInteger(v) ? "integer" : "number";
    return typeof v;
}

function deepEqual(a, b) {
    if (a === b) return true;
    if (typeof a !== typeof b || a === null || b === null || typeof a !== "object") return false;
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    return ka.length === kb.length && ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && deepEqual(a[k], b[k]));
}

function pointer(doc, ptr, where) {
    if (ptr === "" || ptr === "/") return doc;
    let cur = doc;
    for (const raw of ptr.replace(/^\//, "").split("/")) {
        const seg = decodeURIComponent(raw).replace(/~1/g, "/").replace(/~0/g, "~");
        if (cur === null || typeof cur !== "object" || !(seg in cur)) throw new Error(`unresolvable $ref ${where}`);
        cur = cur[seg];
    }
    return cur;
}

class Validator {
    /** @param loadFile (absPath) => parsed document; defaults to JSON files on disk. */
    constructor(loadFile) {
        this.docs = new Map();
        this.loadFile = loadFile || ((p) => JSON.parse(fs.readFileSync(p, "utf8")));
    }

    doc(file) {
        if (!this.docs.has(file)) this.docs.set(file, this.loadFile(file));
        return this.docs.get(file);
    }

    resolve(ref, ctx) {
        const [filePart, frag = ""] = ref.split("#");
        const file = filePart ? path.resolve(path.dirname(ctx.file), filePart) : ctx.file;
        const schema = pointer(this.doc(file), frag, `${ref} (from ${ctx.file})`);
        return { schema, ctx: { file } };
    }

    /** Validates `value` against the schema at `file#ptr`; returns an array of error strings. */
    validate(value, file, ptr = "") {
        const ctx = { file: path.resolve(file) };
        const schema = pointer(this.doc(ctx.file), ptr, `${file}#${ptr}`);
        const errors = [];
        this.check(value, schema, ctx, "$", errors);
        return errors;
    }

    check(v, s, ctx, at, errors) {
        if (s === true) return;
        if (s === false) {
            errors.push(`${at}: no value allowed`);
            return;
        }
        if (s === null || typeof s !== "object") throw new Error(`${at}: schema is not an object (${ctx.file})`);
        for (const k of Object.keys(s)) {
            if (!ASSERTIONS.has(k) && !ANNOTATIONS.has(k) && !k.startsWith("x-")) {
                throw new Error(`unsupported keyword "${k}" at ${at} in ${ctx.file}`);
            }
        }
        const err = (m) => errors.push(`${at}: ${m}`);
        const t = typeOf(v);

        if (s.$ref !== undefined) {
            const r = this.resolve(s.$ref, ctx);
            this.check(v, r.schema, r.ctx, at, errors);
        }
        if (s.type !== undefined) {
            const types = Array.isArray(s.type) ? s.type : [s.type];
            const ok = types.some((ty) => ty === t || (ty === "number" && t === "integer"));
            if (!ok) err(`expected ${types.join("|")}, got ${t}`);
        }
        if (s.enum !== undefined && !s.enum.some((e) => deepEqual(e, v))) err(`not one of ${JSON.stringify(s.enum).slice(0, 200)}`);
        if (s.const !== undefined && !deepEqual(s.const, v)) err(`expected const ${JSON.stringify(s.const)}`);

        if (t === "string") {
            const len = [...v].length;
            if (s.minLength !== undefined && len < s.minLength) err(`shorter than ${s.minLength}`);
            if (s.maxLength !== undefined && len > s.maxLength) err(`longer than ${s.maxLength}`);
            if (s.pattern !== undefined && !new RegExp(s.pattern, "u").test(v)) err(`does not match ${s.pattern}`);
            if (s.format !== undefined) {
                const f = FORMATS[s.format];
                if (!f) throw new Error(`unsupported format "${s.format}" at ${at} in ${ctx.file}`);
                if (!f(v)) err(`not a valid ${s.format}`);
            }
        }
        if (t === "number" || t === "integer") {
            if (s.minimum !== undefined && v < s.minimum) err(`< minimum ${s.minimum}`);
            if (s.maximum !== undefined && v > s.maximum) err(`> maximum ${s.maximum}`);
            if (typeof s.exclusiveMinimum === "number" && v <= s.exclusiveMinimum) err(`<= exclusiveMinimum ${s.exclusiveMinimum}`);
            if (typeof s.exclusiveMaximum === "number" && v >= s.exclusiveMaximum) err(`>= exclusiveMaximum ${s.exclusiveMaximum}`);
            if (typeof s.exclusiveMinimum === "boolean" || typeof s.exclusiveMaximum === "boolean") {
                throw new Error(`boolean exclusiveMinimum/Maximum is OpenAPI 3.0 syntax, not 3.1, at ${at} in ${ctx.file}`);
            }
            if (s.multipleOf !== undefined && Math.abs(v / s.multipleOf - Math.round(v / s.multipleOf)) > 1e-9) err(`not a multiple of ${s.multipleOf}`);
        }
        if (t === "array") {
            if (s.minItems !== undefined && v.length < s.minItems) err(`fewer than ${s.minItems} items`);
            if (s.maxItems !== undefined && v.length > s.maxItems) err(`more than ${s.maxItems} items`);
            if (s.uniqueItems && v.some((x, i) => v.findIndex((y) => deepEqual(x, y)) !== i)) err("items are not unique");
            const prefix = s.prefixItems || [];
            prefix.forEach((ps, i) => i < v.length && this.check(v[i], ps, ctx, `${at}[${i}]`, errors));
            if (s.items !== undefined) {
                for (let i = prefix.length; i < v.length; i++) this.check(v[i], s.items, ctx, `${at}[${i}]`, errors);
            }
        }
        if (t === "object") {
            const keys = Object.keys(v);
            if (s.minProperties !== undefined && keys.length < s.minProperties) err(`fewer than ${s.minProperties} properties`);
            if (s.maxProperties !== undefined && keys.length > s.maxProperties) err(`more than ${s.maxProperties} properties`);
            for (const r of s.required || []) if (!Object.prototype.hasOwnProperty.call(v, r)) err(`missing required "${r}"`);
            const props = s.properties || {};
            const pats = Object.entries(s.patternProperties || {}).map(([p, ps]) => [new RegExp(p, "u"), ps]);
            for (const k of keys) {
                let matched = false;
                if (Object.prototype.hasOwnProperty.call(props, k)) {
                    matched = true;
                    this.check(v[k], props[k], ctx, `${at}.${k}`, errors);
                }
                for (const [re, ps] of pats) {
                    if (re.test(k)) {
                        matched = true;
                        this.check(v[k], ps, ctx, `${at}.${k}`, errors);
                    }
                }
                if (!matched && s.additionalProperties !== undefined) {
                    if (s.additionalProperties === false) err(`unexpected property "${k}"`);
                    else this.check(v[k], s.additionalProperties, ctx, `${at}.${k}`, errors);
                }
            }
        }

        if (s.allOf) s.allOf.forEach((sub) => this.check(v, sub, ctx, at, errors));
        if (s.anyOf && !s.anyOf.some((sub) => this.passes(v, sub, ctx, at))) err("matches none of anyOf");
        if (s.oneOf) {
            const n = s.oneOf.filter((sub) => this.passes(v, sub, ctx, at)).length;
            if (n !== 1) err(`matches ${n} of oneOf (expected exactly 1)`);
        }
        if (s.not !== undefined && this.passes(v, s.not, ctx, at)) err("matches a schema under not");
        if (s.if !== undefined) {
            if (this.passes(v, s.if, ctx, at)) {
                if (s.then !== undefined) this.check(v, s.then, ctx, at, errors);
            } else if (s.else !== undefined) this.check(v, s.else, ctx, at, errors);
        }
    }

    passes(v, s, ctx, at) {
        const e = [];
        this.check(v, s, ctx, at, e);
        return e.length === 0;
    }

    /** Walks a schema and its local $refs, throwing on unsupported keywords or dangling refs. */
    compile(file, ptr = "") {
        const seen = new Set();
        const walk = (s, ctx, at) => {
            if (typeof s === "boolean") return;
            if (s === null || typeof s !== "object" || Array.isArray(s)) throw new Error(`${at}: schema is not an object (${ctx.file})`);
            for (const k of Object.keys(s)) {
                if (!ASSERTIONS.has(k) && !ANNOTATIONS.has(k) && !k.startsWith("x-")) throw new Error(`unsupported keyword "${k}" at ${at} in ${ctx.file}`);
            }
            if (s.format !== undefined && !FORMATS[s.format]) throw new Error(`unsupported format "${s.format}" at ${at} in ${ctx.file}`);
            if (s.pattern !== undefined) new RegExp(s.pattern, "u");
            if (typeof s.exclusiveMinimum === "boolean" || typeof s.exclusiveMaximum === "boolean") {
                throw new Error(`boolean exclusiveMinimum/Maximum is OpenAPI 3.0 syntax, not 3.1, at ${at} in ${ctx.file}`);
            }
            if (Object.prototype.hasOwnProperty.call(s, "nullable")) throw new Error(`"nullable" is OpenAPI 3.0 syntax at ${at} in ${ctx.file}`);
            if (s.$ref !== undefined) {
                const key = `${ctx.file}|${s.$ref}`;
                if (!seen.has(key)) {
                    seen.add(key);
                    const r = this.resolve(s.$ref, ctx);
                    walk(r.schema, r.ctx, `${at}→${s.$ref}`);
                }
            }
            for (const k of ["properties", "patternProperties", "$defs", "definitions"]) {
                for (const [n, sub] of Object.entries(s[k] || {})) walk(sub, ctx, `${at}.${k}.${n}`);
            }
            for (const k of ["items", "additionalProperties", "not", "if", "then", "else"]) {
                if (s[k] !== undefined && typeof s[k] !== "boolean") walk(s[k], ctx, `${at}.${k}`);
            }
            for (const k of ["allOf", "anyOf", "oneOf", "prefixItems"]) (s[k] || []).forEach((sub, i) => walk(sub, ctx, `${at}.${k}[${i}]`));
        };
        const abs = path.resolve(file);
        walk(pointer(this.doc(abs), ptr, `${file}#${ptr}`), { file: abs }, `${path.basename(file)}#${ptr}`);
    }
}

module.exports = { Validator, deepEqual, pointer };
