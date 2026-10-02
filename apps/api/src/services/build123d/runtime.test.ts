import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { CadProgram } from "@bidwright/domain";
import { executeCadProgram, getCadApiDocs } from "./runtime.js";

const enabled = Boolean(process.env.BIDWRIGHT_CAD_PYTHON);
const options = { skip: !enabled, timeout: 180000 };
function program(
	source: string,
	parameters: Record<string, number> = {},
): CadProgram {
	return {
		version: 1,
		engine: "build123d",
		name: "Fabrication assembly",
		units: "mm",
		parameters,
		source,
		imports: {},
		removedParts: [],
		assumptions: [],
	};
}
const assembly = program(
	`from build123d import *
with BuildPart() as hopper:
    with BuildSketch(Plane.XY):
        Rectangle(80, 60)
    with BuildSketch(Plane.XY.offset(180)):
        Rectangle(parameters['mouth_width'], 220)
    loft()
    offset(amount=-3, openings=hopper.faces().sort_by(Axis.Z)[-1])
with BuildLine() as route:
    Line((0,0), (60,0))
    RadiusArc((60,0), (100,40), 40)
with BuildPart() as pipe:
    with BuildSketch(Plane.YZ):
        Circle(10)
        Circle(8, mode=Mode.SUBTRACT)
    sweep(path=route.line)
parts = {'hopper': hopper.part, 'curved_pipe': Pos(220,0,0)*pipe.part}
for i in range(24):
    parts[f'bracket_{i}'] = Pos(i*35,250,0) * (Box(25,20,4) - Cylinder(3,10))
`,
	{ mouth_width: 300 },
);

test(
	"completed parts stream automatically before execution finishes without explicit preview calls",
	options,
	async () => {
		const counts: number[] = [];
		let completed = false;
		const build = await executeCadProgram(
			program(`from build123d import *
import time
parts={}
parts['rail']=Box(2000,100,100)-Box(2010,88,88)
time.sleep(0.8)
parts['floor']=Pos(0,0,55)*Box(2000,1400,10)
time.sleep(0.8)
`),
			{},
			undefined,
			(parts) => {
				assert.equal(completed, false);
				assert.ok(parts.every((p) => p.volumeMm3 > 0));
				counts.push(parts.length);
			},
		);
		completed = true;
		assert.ok(
			counts.includes(1),
			"the first rail appears before the rest of the program finishes",
		);
		assert.ok(counts.includes(2));
		assert.equal(build.parts.length, 2);
	},
);

test(
	"installed full API includes lofts, sweeps, selectors and sheet metal",
	options,
	async () => {
		const docs = await getCadApiDocs(
			"loft sweep make_brake_formed Shape.faces",
		);
		assert.equal(docs.version, "0.13.0");
		for (const name of [
			"loft",
			"sweep",
			"make_brake_formed",
			"Spline",
			"Compound",
		])
			assert.ok(docs.symbols.includes(name));
		assert.match(JSON.stringify(docs.reference), /signature/);
	},
);
test(
	"real lofted/shelled hopper, hollow swept pipe and patterned assembly generate valid exact solids",
	options,
	async () => {
		const build = await executeCadProgram(assembly, {});
		assert.equal(build.parts.length, 26);
		assert.equal(build.libraryVersion, "0.13.0");
		assert.equal(build.kernelVersion, "8.0.1");
		assert.ok(
			build.preview.startsWith("iVBOR"),
			"a real PNG preview is produced",
		);
		assert.ok(
			build.parts.every(
				(p) => p.volumeMm3 > 0 && p.brep.includes("CASCADE Topology"),
			),
		);
		assert.ok(Math.abs(build.parts[0].sizeMm[0] - 300) < 1e-4);
		assert.ok(Math.abs(build.parts[1].sizeMm[0] - 110) < 1e-4);
		const repeat = await executeCadProgram(assembly, {});
		assert.deepEqual(
			build.parts.map((p) => p.fingerprint),
			repeat.parts.map((p) => p.fingerprint),
			"stable fingerprints preserve native nodes for unchanged parts",
		);
		const changed = await executeCadProgram(
			{ ...assembly, parameters: { mouth_width: 340 } },
			{},
		);
		assert.notEqual(build.parts[0].fingerprint, changed.parts[0].fingerprint);
		assert.deepEqual(
			build.parts.slice(1).map((p) => p.fingerprint),
			changed.parts.slice(1).map((p) => p.fingerprint),
			"only the hopper changes when its mouth width changes",
		);
	},
);
test(
	"exact source snapshots preserve existing holes and reproduce later parameter edits",
	options,
	async () => {
		const base = await executeCadProgram(
			program(
				"from build123d import *\nparts={'plate': Box(100,80,10) - Pos(25,0,0)*Cylinder(5,20)}",
			),
			{},
		);
		const edit = {
			...program(
				"from build123d import *\nplate=existing('plate_before_drilling')\nplate -= Pos(-25,parameters['hole_y'],0)*Cylinder(3,20)\nparts={'plate':{'shape':plate,'nodeId':'native-plate','name':'Edited plate'}}",
				{ hole_y: 0 },
			),
			imports: { plate_before_drilling: "native-plate" },
		};
		const drilled = await executeCadProgram(edit, {
			geometry: { "native-plate": base.parts[0].brep },
		});
		assert.equal(drilled.parts[0].nodeId, "native-plate");
		assert.ok(
			Math.abs(
				base.parts[0].volumeMm3 - drilled.parts[0].volumeMm3 - Math.PI * 9 * 10,
			) < 1e-4,
		);
		const moved = await executeCadProgram(
			{ ...edit, parameters: { hole_y: 15 } },
			{
				sources: drilled.sources,
				geometry: { "native-plate": drilled.parts[0].brep },
			},
		);
		assert.ok(
			Math.abs(moved.parts[0].volumeMm3 - drilled.parts[0].volumeMm3) < 1e-4,
			"moving a generated hole does not leave the old hole behind",
		);
		assert.equal(moved.sources.plate_before_drilling.brep, base.parts[0].brep);
	},
);
test(
	"generated code cannot read private host files or inherit credentials",
	options,
	async () => {
		const directory = await mkdtemp(join(tmpdir(), "cad-private-canary-"));
		const path = join(directory, "private.txt");
		await writeFile(path, "host-only-test-canary");
		const before = process.env.BIDWRIGHT_CAD_TEST_SECRET;
		process.env.BIDWRIGHT_CAD_TEST_SECRET = "do-not-inherit";
		try {
			await assert.rejects(
				executeCadProgram(
					program(
						`from pathlib import Path\nPath(${JSON.stringify(path)}).read_text()`,
					),
					{},
				),
				/Permission|not permitted|No such file/i,
			);
			const build = await executeCadProgram(
				program(
					"import os\nassert 'BIDWRIGHT_CAD_TEST_SECRET' not in os.environ\nfrom build123d import *\nparts={'ok':Box(1,2,3)}",
				),
				{},
			);
			assert.equal(build.parts[0].volumeMm3, 6);
		} finally {
			if (before === undefined) delete process.env.BIDWRIGHT_CAD_TEST_SECRET;
			else process.env.BIDWRIGHT_CAD_TEST_SECRET = before;
			await rm(directory, { recursive: true, force: true });
		}
	},
);
test("CAD sandbox cannot reach a host loopback service", options, async () => {
	const server = createServer();
	await new Promise<void>((accept) => server.listen(0, "127.0.0.1", accept));
	const port = (server.address() as { port: number }).port;
	try {
		await assert.rejects(
			executeCadProgram(
				program(
					`import socket\ns=socket.socket()\ns.settimeout(2)\ns.connect(('127.0.0.1',${port}))`,
				),
				{},
			),
			/Permission|not permitted|refused|timed out/i,
		);
	} finally {
		await new Promise<void>((accept, reject) =>
			server.close((error) => (error ? reject(error) : accept())),
		);
	}
});
test(
	"CAD output symlinks cannot make the API read a host file",
	options,
	async () => {
		await assert.rejects(
			executeCadProgram(
				program(
					"import os\nos.symlink('/etc/passwd','result.json')\nfrom build123d import *\nparts={'ok':Box(1,2,3)}",
				),
				{},
			),
			/Invalid CAD output|sandbox exited/i,
		);
	},
);

test(
	"real validated geometry is published while Python is still building",
	options,
	async () => {
		let completed = false;
		const checkpoints: number[] = [];
		const build = await executeCadProgram(
			program(`from build123d import *
import time
parts={'chassis':Box(100,50,5)}
preview(parts,'Chassis')
time.sleep(0.8) # Test-only delay to prove previews arrive before completion.
parts['body']=Pos(0,0,25)*Box(100,50,30)
preview(parts,'Dump body')
time.sleep(0.8)
`),
			{},
			undefined,
			(parts, label) => {
				assert.equal(completed, false);
				assert.ok(
					parts.every(
						(p) => p.volumeMm3 > 0 && p.brep.includes("CASCADE Topology"),
					),
				);
				assert.ok(label);
				checkpoints.push(parts.length);
			},
		);
		completed = true;
		assert.ok(checkpoints.includes(1));
		assert.ok(checkpoints.includes(2));
		assert.equal(build.parts.length, 2);
	},
);

test(
	"live preview symlinks cannot publish private host file content",
	options,
	async () => {
		const directory = await mkdtemp(join(tmpdir(), "cad-preview-canary-"));
		const path = join(directory, "preview.json");
		const base = await executeCadProgram(
			program(
				"from build123d import *\nparts={'private_host_part':Box(1,2,3)}",
			),
			{},
		);
		await writeFile(
			path,
			JSON.stringify({
				parts: base.parts,
				label: "Private host content",
				sequence: 100,
			}),
		);
		const names: string[] = [];
		try {
			await executeCadProgram(
				program(`import os,time
os.symlink(${JSON.stringify(path)},'preview.json')
time.sleep(0.8)
from build123d import *
parts={'safe':Box(2,3,4)}
`),
				{},
				undefined,
				(parts) => names.push(...parts.map((p) => p.id)),
			);
			assert.ok(!names.includes("private_host_part"));
			assert.ok(names.includes("safe"));
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	},
);
