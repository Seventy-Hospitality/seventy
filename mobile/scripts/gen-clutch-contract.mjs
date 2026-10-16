#!/usr/bin/env node
/**
 * Generate src/lib/clutch/contract.gen.ts (zod 4 schemas + inferred types)
 * from Clutch's published OpenAPI document.
 *
 *   npm run contract:pull     # copy docs/api/openapi.json from a Clutch checkout
 *   npm run contract:gen      # regenerate contract.gen.ts from clutch/openapi.json
 *
 * Rules:
 * - Objects are zod objects that strip unknown keys: Clutch may add fields
 *   without breaking the app (the document says clients must ignore them).
 * - A property not in `required` is optional; `anyOf [X, null]` is nullable.
 * - Formats are not enforced (a date-time is a string); enums and consts are.
 * - Ids are branded (src/lib/clutch/ids.ts) by the rules in BRANDS below, so a
 *   group id can never stand in for a club id.
 *
 * The output is deterministic, and contract.gen.test.ts fails when it is
 * stale against clutch/openapi.json.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, '..');
export const SPEC_PATH = resolve(ROOT, 'clutch/openapi.json');
export const SOURCE_PATH = resolve(ROOT, 'clutch/openapi.source.json');
export const OUT_PATH = resolve(ROOT, 'src/lib/clutch/contract.gen.ts');

/** Property names that always carry one kind of id. */
const PROPERTY_BRANDS = {
  club_id: 'ClubId',
  court_id: 'CourtId',
  new_court_id: 'CourtId',
  booking_id: 'BookingId',
  group_id: 'GroupId',
  user_id: 'UserId',
  organizer_id: 'UserId',
  tier_id: 'TierId',
};

/** Arrays of ids, by property name. */
const ARRAY_BRANDS = {
  invited: 'UserId',
  invitee_user_ids: 'UserId',
  user_ids: 'UserId',
  player_ids: 'UserId',
};

/** What `id` means, by the schema (or schema.path) it sits in. */
const ID_BRANDS = {
  ClubDetail: 'ClubId',
  ClubListing: 'ClubId',
  ClubMembership: 'ClubId',
  Court: 'CourtId',
  'BookingDetail.court': 'CourtId',
  Booking: 'BookingId',
  BookingRecord: 'BookingId',
  BookingDetail: 'BookingId',
  MyBooking: 'BookingId',
  Group: 'GroupId',
  GroupSummary: 'GroupId',
  GroupInvitation: 'GroupInvitationId',
  MembershipTier: 'TierId',
  TierRef: 'TierId',
  Profile: 'UserId',
};

const IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

function key(name) {
  return IDENT.test(name) ? name : JSON.stringify(name);
}

function comment(text, indent) {
  if (!text) return '';
  const safe = String(text).replace(/\*\//g, '* /').replace(/—/g, ':');
  const lines = safe.split('\n');
  if (lines.length === 1) return `${indent}/** ${lines[0]} */\n`;
  return `${indent}/**\n${lines.map((l) => `${indent} * ${l}`.trimEnd()).join('\n')}\n${indent} */\n`;
}

function isNull(s) {
  return s && (s.type === 'null' || (Array.isArray(s.type) && s.type.length === 1 && s.type[0] === 'null'));
}

/** zod expression for a schema. `ctx` = { owner: 'Schema.path', prop } */
function expr(s, ctx, indent) {
  if (!s || Object.keys(s).length === 0) return 'z.unknown()';
  if (s.$ref) return `${s.$ref.split('/').pop()}Schema`;

  if (s.anyOf || s.oneOf) {
    const opts = s.anyOf ?? s.oneOf;
    const nonNull = opts.filter((o) => !isNull(o));
    const nullable = nonNull.length !== opts.length;
    let inner;
    if (nonNull.length === 1) inner = expr(nonNull[0], ctx, indent);
    else inner = `z.union([${nonNull.map((o) => expr(o, ctx, indent)).join(', ')}])`;
    return nullable ? `${inner}.nullable()` : inner;
  }
  if (s.allOf) {
    const parts = s.allOf.map((o) => expr(o, ctx, indent));
    return parts.reduce((a, b) => `z.intersection(${a}, ${b})`);
  }
  if (Array.isArray(s.type)) {
    const types = s.type.filter((t) => t !== 'null');
    const inner =
      types.length === 1
        ? expr({ ...s, type: types[0] }, ctx, indent)
        : `z.union([${types.map((t) => expr({ ...s, type: t }, ctx, indent)).join(', ')}])`;
    return s.type.includes('null') ? `${inner}.nullable()` : inner;
  }
  if (s.const !== undefined) return `z.literal(${JSON.stringify(s.const)})`;
  if (s.enum) return `z.enum([${s.enum.map((v) => JSON.stringify(v)).join(', ')}])`;

  switch (s.type) {
    case 'string': {
      const brand = ctx.prop === 'id' ? ID_BRANDS[ctx.owner] : PROPERTY_BRANDS[ctx.prop];
      return brand ? `${brand}Schema` : 'z.string()';
    }
    case 'integer':
      return 'z.number().int()';
    case 'number':
      return 'z.number()';
    case 'boolean':
      return 'z.boolean()';
    case 'null':
      return 'z.null()';
    case 'array': {
      const brand = ARRAY_BRANDS[ctx.prop];
      const item = brand && s.items?.type === 'string' ? `${brand}Schema` : expr(s.items, { owner: ctx.owner, prop: undefined }, indent);
      return `z.array(${item})`;
    }
    case 'object':
      return objectExpr(s, ctx, indent);
    default:
      if (s.properties) return objectExpr(s, ctx, indent);
      return 'z.unknown()';
  }
}

function objectExpr(s, ctx, indent) {
  const props = s.properties ?? {};
  const names = Object.keys(props);
  if (names.length === 0) {
    if (s.additionalProperties && typeof s.additionalProperties === 'object') {
      return `z.record(z.string(), ${expr(s.additionalProperties, { owner: ctx.owner }, indent)})`;
    }
    return 'z.record(z.string(), z.unknown())';
  }
  const required = new Set(s.required ?? []);
  const inner = indent + '  ';
  const owner = ctx.prop ? `${ctx.owner}.${ctx.prop}` : ctx.owner;
  const body = names
    .map((name) => {
      const p = props[name];
      let e = expr(p, { owner, prop: name }, inner);
      if (!required.has(name)) e += '.optional()';
      return `${comment(p.description, inner)}${inner}${key(name)}: ${e},`;
    })
    .join('\n');
  return `z.object({\n${body}\n${indent}})`;
}

/** Order component schemas so every $ref is declared before use. */
function order(schemas) {
  const deps = new Map();
  for (const [name, s] of Object.entries(schemas)) {
    const found = new Set();
    JSON.stringify(s, (k, v) => {
      if (k === '$ref' && typeof v === 'string') found.add(v.split('/').pop());
      return v;
    });
    found.delete(name);
    deps.set(name, found);
  }
  const out = [];
  const state = new Map();
  const visit = (n) => {
    if (state.get(n) === 2) return;
    if (state.get(n) === 1) throw new Error(`cyclic $ref through ${n}`);
    state.set(n, 1);
    for (const d of [...deps.get(n)].sort()) visit(d);
    state.set(n, 2);
    out.push(n);
  };
  for (const n of Object.keys(schemas).sort()) visit(n);
  return out;
}

export function generate(spec, source) {
  const schemas = spec.components?.schemas ?? {};
  const codes = schemas.ErrorCode?.enum;
  if (!codes) throw new Error('openapi.json has no components.schemas.ErrorCode enum');

  const brands = new Set([
    ...Object.values(PROPERTY_BRANDS),
    ...Object.values(ARRAY_BRANDS),
    ...Object.values(ID_BRANDS),
  ]);

  let out = '';
  out += `/**
 * GENERATED by scripts/gen-clutch-contract.mjs from clutch/openapi.json.
 * Do not edit by hand: run \`npm run contract:pull && npm run contract:gen\`.
 *
 * Source: ${source.repo} ${source.ref} @ ${source.commit}
 * API: ${spec.info?.title} ${spec.info?.version}
 *
 * Operations that are not in this document yet (Clutch branches not merged
 * into it) live in contract.pending.ts, hand-written from those branches.
 */
/* eslint-disable */
import { z } from 'zod';
import {
${[...brands].sort().map((b) => `  ${b}Schema,`).join('\n')}
} from './ids';

/** Every value \`error\` can take (components.schemas.ErrorCode). */
export const GENERATED_ERROR_CODES = [
${codes.map((c) => `  ${JSON.stringify(c)},`).join('\n')}
] as const;

`;
  for (const name of order(schemas)) {
    if (name === 'ErrorCode') continue;
    const s = schemas[name];
    const e =
      name === 'Error'
        ? // details carry strings on most codes and objects on a few (step-up,
          // deletion blockers); the envelope keeps whatever arrives.
          `z.object({\n  error: z.string(),\n  message: z.string(),\n  details: z.record(z.string(), z.unknown()).optional(),\n  request_id: z.string().optional(),\n})`
        : expr(s, { owner: name }, '');
    out += comment(s.description, '');
    out += `export const ${name}Schema = ${e};\n`;
    out += `export type ${name} = z.infer<typeof ${name}Schema>;\n\n`;
  }
  return out;
}

function main() {
  const spec = JSON.parse(readFileSync(SPEC_PATH, 'utf8'));
  const source = JSON.parse(readFileSync(SOURCE_PATH, 'utf8'));
  const out = generate(spec, source);
  if (process.argv.includes('--check')) {
    if (readFileSync(OUT_PATH, 'utf8') !== out) {
      console.error('contract.gen.ts is stale: run npm run contract:gen');
      process.exit(1);
    }
    console.log('contract.gen.ts is up to date');
    return;
  }
  writeFileSync(OUT_PATH, out);
  console.log(`wrote ${OUT_PATH}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
