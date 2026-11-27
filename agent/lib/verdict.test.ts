import assert from "node:assert/strict";
import test from "node:test";
import { keccak256, stringToHex } from "viem";
import {
  canonicalJson,
  canonicalName,
  confusableSkeleton,
  diffName,
  metadataHash,
  nameHash,
  stripInvisible,
} from "./verdict.js";

test("canonicalName applies NFKC, strips invisibles, casefolds and collapses whitespace", () => {
  assert.equal(canonicalName(" Ａcme\u200B  TREASURY "), "acme treasury");
  assert.equal(canonicalName("Acme\u202ETreasury"), "acmetreasury");
  assert.equal(canonicalName("Straße  GmbH"), "strasse gmbh");
  assert.equal(stripInvisible("a\u2066b\u2069c"), "abc");
});

test("confusableSkeleton folds Cyrillic/Greek homoglyphs, digits and lookalike pairs", () => {
  assert.equal(confusableSkeleton("Аcme Trеasury"), confusableSkeleton("Acme Treasury"));
  assert.equal(confusableSkeleton("Αcme Trеasury"), confusableSkeleton("Acme Treasury")); // Greek Alpha
  assert.equal(confusableSkeleton("r0rn1vv"), "romlw");
  assert.equal(confusableSkeleton("l1I"), "lll");
  assert.equal(confusableSkeleton("w"), confusableSkeleton("vv"));
});

test("nameHash is byte-exact NFKC, not casefolded or skeleton-based", () => {
  const name = " Ａcme Treasury ";
  assert.equal(nameHash(name), keccak256(stringToHex(name.normalize("NFKC").trim())));
  assert.notEqual(nameHash("Acme Treasury"), nameHash("acme treasury"));
  assert.notEqual(nameHash("Аcme Treasury"), nameHash("Acme Treasury"));
});

test("metadataHash ignores volatile fields and key order", () => {
  const base = {
    fetchedAt: "2026-01-01T00:00:00.000Z",
    name: "Acme Treasury",
    active: true,
    type: "Organization",
    services: ["payments", "invoicing"],
    registrations: [{ chainId: 44005, address: "0xabc" }],
  };
  const refreshed = {
    registrations: base.registrations,
    services: base.services,
    active: true,
    type: "Organization",
    name: "Acme Treasury",
    fetchedAt: "2026-11-27T00:00:00.000Z",
  };
  assert.equal(metadataHash(base), metadataHash(refreshed));
  assert.notEqual(metadataHash(base), metadataHash({ ...base, name: "Acme Treasure" }));
  assert.equal(canonicalJson({ b: 1, a: 2 }), '{"a":2,"b":1}');
});

test("diffName reports a lookalike as skeleton match but not exact", () => {
  const diff = diffName("Аcme Trеasury", "Acme Treasury");
  assert.equal(diff.exact, false);
  assert.equal(diff.skeletonMatch, true);
  assert.ok(diff.differences.includes("canonical name differs"));

  const invisible = diffName("Acme\u200BTreasury", "Acme Treasury");
  assert.equal(invisible.invisibleCharacters, 1);
  assert.equal(invisible.skeletonMatch, true);

  const exact = diffName("Acme Treasury", "Acme Treasury");
  assert.equal(exact.exact, true);
  assert.equal(exact.differences.length, 0);
});
