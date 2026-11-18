"use strict";
/**
 * Zero-dependency parser for the YAML subset this repo's OpenAPI files use:
 * block mappings and sequences, plain / single- / double-quoted scalars,
 * literal and folded block scalars (| |- |+ > >- >+), flow sequences and
 * flow mappings, comments, and multi-line plain scalars.
 *
 * Anything outside the subset (anchors, aliases, tags, multi-document
 * streams, complex keys, tabs in indentation) is a hard error, never a
 * silent misparse. `npm`-free on purpose: CI runs it with a bare Node.
 * The scripts/selftest.js differential check compares it to js-yaml when
 * that package happens to be resolvable locally.
 *
 * Complexity: O(n) in the input length (each line is visited a bounded
 * number of times).
 */

class YamlError extends Error {
    constructor(message, line) {
        super(line === undefined ? message : `line ${line + 1}: ${message}`);
        this.name = "YamlError";
    }
}

/** Index of a comment `#` (start of line or after whitespace) outside quotes, else -1. */
function commentStart(s) {
    let quote = null;
    for (let i = 0; i < s.length; i++) {
        const c = s[i];
        if (quote) {
            if (quote === '"' && c === "\\") i++;
            else if (c === quote) {
                if (quote === "'" && s[i + 1] === "'") i++;
                else quote = null;
            }
        } else if (c === '"' || c === "'") {
            // A quote opens a quoted scalar only at a token start.
            const prev = i === 0 ? " " : s[i - 1];
            if (/[\s:\[{,-]/.test(prev)) quote = c;
        } else if (c === "#" && (i === 0 || /\s/.test(s[i - 1]))) return i;
    }
    return -1;
}

function stripComment(s) {
    const i = commentStart(s);
    return (i === -1 ? s : s.slice(0, i)).replace(/\s+$/, "");
}

function indentOf(s) {
    let n = 0;
    while (n < s.length && s[n] === " ") n++;
    if (s[n] === "\t") throw new YamlError("tab in indentation");
    return n;
}

const INT = /^[-+]?(0|[1-9][0-9]*)$/;
const FLOAT = /^[-+]?(\.[0-9]+|[0-9]+(\.[0-9]*)?)([eE][-+]?[0-9]+)?$/;

function plainScalar(raw, line) {
    const s = raw.trim();
    if (s === "" || s === "~" || s === "null" || s === "Null" || s === "NULL") return null;
    if (s === "true" || s === "True" || s === "TRUE") return true;
    if (s === "false" || s === "False" || s === "FALSE") return false;
    if (INT.test(s)) return Number(s);
    if (FLOAT.test(s)) return Number(s);
    if (s === ".inf" || s === "+.inf") return Infinity;
    if (s === "-.inf") return -Infinity;
    if (s === ".nan") return NaN;
    if (/^[&*!%@`|>]/.test(s)) throw new YamlError(`unsupported YAML construct: ${s.slice(0, 20)}`, line);
    return s;
}

function doubleQuoted(s, line) {
    // YAML double-quoted escapes are a superset of JSON's; map the extras.
    const json = s
        .replace(/\\\//g, "/")
        .replace(/\\x([0-9a-fA-F]{2})/g, (_, h) => `\\u00${h}`)
        .replace(/\\0/g, "\\u0000")
        .replace(/\\e/g, "\\u001b")
        .replace(/\\ /g, " ");
    try {
        return JSON.parse(json);
    } catch {
        throw new YamlError(`bad double-quoted scalar ${s.slice(0, 30)}`, line);
    }
}

/** Parses one flow value starting at s[i]; returns [value, nextIndex]. */
function flowValue(s, i, line) {
    while (s[i] === " ") i++;
    const c = s[i];
    if (c === "[") {
        const out = [];
        i++;
        for (;;) {
            while (s[i] === " ") i++;
            if (s[i] === "]") return [out, i + 1];
            const [v, j] = flowValue(s, i, line);
            out.push(v);
            i = j;
            while (s[i] === " ") i++;
            if (s[i] === ",") i++;
            else if (s[i] !== "]") throw new YamlError("bad flow sequence", line);
        }
    }
    if (c === "{") {
        const out = {};
        i++;
        for (;;) {
            while (s[i] === " ") i++;
            if (s[i] === "}") return [out, i + 1];
            const [k, j] = flowKey(s, i, line);
            i = j;
            while (s[i] === " ") i++;
            if (s[i] !== ":") throw new YamlError("bad flow mapping", line);
            const [v, j2] = flowValue(s, i + 1, line);
            setKey(out, k, v, line);
            i = j2;
            while (s[i] === " ") i++;
            if (s[i] === ",") i++;
            else if (s[i] !== "}") throw new YamlError("bad flow mapping", line);
        }
    }
    if (c === '"' || c === "'") return quoted(s, i, line);
    let j = i;
    while (j < s.length && !/[,\]}]/.test(s[j])) j++;
    return [plainScalar(s.slice(i, j), line), j];
}

function flowKey(s, i, line) {
    if (s[i] === '"' || s[i] === "'") {
        const [k, j] = quoted(s, i, line);
        return [String(k), j];
    }
    let j = i;
    while (j < s.length && s[j] !== ":" && s[j] !== "," && s[j] !== "}") j++;
    return [s.slice(i, j).trim(), j];
}

function quoted(s, i, line) {
    const q = s[i];
    let j = i + 1;
    for (; j < s.length; j++) {
        if (q === '"' && s[j] === "\\") j++;
        else if (s[j] === q) {
            if (q === "'" && s[j + 1] === "'") j++;
            else break;
        }
    }
    if (j >= s.length) throw new YamlError("unterminated quoted scalar", line);
    const body = s.slice(i + 1, j);
    const v = q === '"' ? doubleQuoted(`"${body}"`, line) : body.replace(/''/g, "'");
    return [v, j + 1];
}

function setKey(obj, key, value, line) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) throw new YamlError(`duplicate key "${key}"`, line);
    Object.defineProperty(obj, key, { value, enumerable: true, writable: true, configurable: true });
}

/** Splits `key: rest` at the first mapping colon outside quotes and brackets; null if not a mapping line. */
function splitKey(t) {
    let i = 0;
    let key;
    if (t[0] === '"' || t[0] === "'") {
        const [k, j] = quoted(t, 0);
        key = String(k);
        i = j;
        if (t[i] !== ":") return null;
    } else {
        for (; i < t.length; i++) {
            if (t[i] === ":" && (i + 1 === t.length || t[i + 1] === " ")) break;
            if (i === 0 && (t[i] === "[" || t[i] === "{")) return null;
        }
        if (i === t.length) return null;
        key = t.slice(0, i).trim();
        if (key === "" || key.startsWith("? ")) return null;
    }
    return { key, rest: t.slice(i + 1).trim() };
}

function parse(text) {
    const raw = text.replace(/\r\n?/g, "\n").split("\n");
    if (raw.some((l) => /^(---|\.\.\.)(\s|$)/.test(l) && l !== raw[0])) throw new YamlError("multi-document streams are not supported");
    if (/^---\s*$/.test(raw[0])) raw[0] = "";
    // Logical lines keep their source text for block scalars.
    const lines = raw.map((src, n) => ({ src, n, text: stripComment(src) }));
    let pos = 0;

    const skipBlank = () => {
        while (pos < lines.length && lines[pos].text.trim() === "") pos++;
    };

    function blockScalar(header, parentIndent, line) {
        const m = /^([|>])([+-]?)$/.exec(header);
        if (!m) throw new YamlError(`unsupported block scalar header ${header}`, line);
        const [, style, chomp] = m;
        const body = [];
        let ind = -1;
        while (pos < lines.length) {
            const src = lines[pos].src;
            if (src.trim() === "") {
                body.push("");
                pos++;
                continue;
            }
            const n = indentOf(src);
            if (n <= parentIndent) break;
            if (ind === -1) ind = n;
            if (n < ind) break;
            body.push(src.slice(ind));
            pos++;
        }
        // Trailing blank lines belong to chomping, not to the next node.
        let trailing = 0;
        while (body.length && body[body.length - 1] === "") {
            body.pop();
            trailing++;
        }
        let out;
        if (style === "|") out = body.join("\n");
        else {
            out = "";
            for (let k = 0; k < body.length; k++) {
                const l = body[k];
                const prev = body[k - 1];
                if (k === 0) out = l;
                else if (l === "") out += "\n";
                else if (prev === "") out += l;
                else if (/^\s/.test(l) || /^\s/.test(prev)) out += "\n" + l;
                else out += " " + l;
            }
        }
        if (body.length === 0) return "";
        if (chomp === "-") return out;
        if (chomp === "+") return out + "\n".repeat(trailing + 1);
        return out + "\n";
    }

    /** Inline value after `key:` or `- `; may consume continuation lines of a plain scalar. */
    function inlineValue(rest, ownIndent, line) {
        if (rest === "") return undefined;
        if (rest[0] === "|" || rest[0] === ">") return blockScalar(rest, ownIndent, line);
        if (rest[0] === "[" || rest[0] === "{" || rest[0] === '"' || rest[0] === "'") {
            let acc = rest;
            // Flow collections and quoted scalars may span lines.
            for (;;) {
                try {
                    const [v, j] = flowValue(acc, 0, line);
                    if (acc.slice(j).trim() !== "") throw new YamlError(`trailing text after value: ${acc.slice(j).trim()}`, line);
                    return v;
                } catch (e) {
                    if (pos >= lines.length || indentOf(lines[pos].src) <= ownIndent || !/^\s*[\[{"']/.test(rest)) throw e;
                    acc += (acc.endsWith("[") || acc.endsWith("{") ? "" : " ") + lines[pos].text.trim();
                    pos++;
                }
            }
        }
        let s = rest;
        while (pos < lines.length) {
            const t = lines[pos].text;
            if (t.trim() === "") break;
            if (indentOf(t) <= ownIndent) break;
            s += " " + t.trim();
            pos++;
        }
        return plainScalar(s, line);
    }

    function node(indent) {
        skipBlank();
        if (pos >= lines.length) return null;
        const t = lines[pos].text;
        const n = indentOf(t);
        if (n < indent) return null;
        const body = t.slice(n);
        if (body === "-" || body.startsWith("- ")) return sequence(n);
        if (splitKey(body)) return mapping(n);
        const line = lines[pos].n;
        pos++;
        return inlineValue(body, n - 1, line);
    }

    function mapping(indent) {
        const out = {};
        for (;;) {
            skipBlank();
            if (pos >= lines.length) break;
            const t = lines[pos].text;
            const n = indentOf(t);
            if (n < indent) break;
            if (n > indent) throw new YamlError("bad indentation", lines[pos].n);
            const body = t.slice(n);
            if (body === "-" || body.startsWith("- ")) break;
            const kv = splitKey(body);
            if (!kv) throw new YamlError(`expected "key: value", got: ${body.slice(0, 40)}`, lines[pos].n);
            const line = lines[pos].n;
            pos++;
            let v = inlineValue(kv.rest, indent, line);
            if (v === undefined) {
                skipBlank();
                if (pos < lines.length) {
                    const nt = lines[pos].text;
                    const nn = indentOf(nt);
                    const nb = nt.slice(nn);
                    const isSeq = nb === "-" || nb.startsWith("- ");
                    if (nn > indent || (nn === indent && isSeq)) v = node(nn);
                    else v = null;
                } else v = null;
            }
            setKey(out, kv.key, v, line);
        }
        return out;
    }

    function sequence(indent) {
        const out = [];
        for (;;) {
            skipBlank();
            if (pos >= lines.length) break;
            const t = lines[pos].text;
            const n = indentOf(t);
            if (n !== indent) {
                if (n > indent) throw new YamlError("bad indentation in sequence", lines[pos].n);
                break;
            }
            const body = t.slice(n);
            if (!(body === "-" || body.startsWith("- "))) break;
            const rest = body.slice(1).trimStart();
            const line = lines[pos].n;
            if (rest === "") {
                pos++;
                out.push(node(indent + 1));
                continue;
            }
            const restIndent = n + body.length - rest.length;
            if (rest.startsWith("- ") || splitKey(rest)) {
                // `- key: v` / `- - x`: re-read the line as a nested block at the item's column.
                lines[pos] = { ...lines[pos], text: " ".repeat(restIndent) + rest };
                out.push(node(restIndent));
                continue;
            }
            pos++;
            out.push(inlineValue(rest, indent, line));
        }
        return out;
    }

    const doc = node(0);
    skipBlank();
    if (pos < lines.length) throw new YamlError("unexpected content", lines[pos].n);
    return doc;
}

module.exports = { parse, YamlError };
