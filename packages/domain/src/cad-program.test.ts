import assert from "node:assert/strict";
import test from "node:test";
import {
	type CadProgram,
	cadNodeId,
	validateCadBuild,
	validateCadProgram,
} from "./cad-program.js";

const program: CadProgram = {
	version: 1,
	engine: "build123d",
	name: "Lofted hopper",
	units: "mm",
	parameters: { wall: 3 },
	source: "from build123d import *\nparts = {'hopper': loft([])}",
	imports: {},
	removedParts: [],
	assumptions: [],
};

test("full Python CAD source is supported without a hand-maintained operation enum", () => {
	validateCadProgram(program);
	validateCadProgram({
		...program,
		source:
			"from build123d import *\n# future upstream APIs remain available\nparts = build_custom_assembly(parameters)",
	});
	assert.equal(cadNodeId({ id: "hopper" }), "cad-hopper");
	assert.equal(
		cadNodeId({ id: "hopper", nodeId: "imported-original" }),
		"imported-original",
	);
});
test("malformed, oversized and non-finite CAD programs are rejected", () => {
	assert.throws(
		() => validateCadProgram({ ...program, parameters: { wall: Infinity } }),
		/parameter/,
	);
	assert.throws(
		() => validateCadProgram({ ...program, source: "x".repeat(150001) }),
		/source/,
	);
	assert.throws(
		() => validateCadProgram({ ...program, imports: { base: "" } }),
		/snapshot/,
	);
	assert.throws(
		() => validateCadProgram({ ...program, removedParts: ["../outside"] }),
		/removed/,
	);
});
test("build transport validates identities, solids and immutable input coverage", () => {
	const part = {
		id: "hopper",
		name: "Hopper",
		brep: "DBRep_DrawableShape\nCASCADE Topology V3\n",
		fingerprint: "a".repeat(64),
		volumeMm3: 20,
		minMm: [0, 0, 0],
		maxMm: [1, 2, 10],
		sizeMm: [1, 2, 10],
	};
	const build = {
		program,
		parts: [part],
		sources: {},
		libraryVersion: "0.13.0",
		kernelVersion: "8.0.1",
	};
	validateCadBuild(build);
	assert.throws(
		() =>
			validateCadBuild({
				...build,
				parts: [part, { ...part, id: "other", nodeId: "cad-hopper" }],
			}),
		/same node/,
	);
	assert.throws(
		() => validateCadBuild({ ...build, parts: [{ ...part, volumeMm3: 0 }] }),
		/volume/,
	);
	assert.throws(
		() =>
			validateCadBuild({
				...build,
				program: { ...program, imports: { base: "native" } },
			}),
		/immutable/,
	);
});
