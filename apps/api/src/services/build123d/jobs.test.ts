import test from "node:test";
import assert from "node:assert/strict";
import { startCadJob, getCadJob, cancelCadJob } from "./jobs.js";

test("CAD results and cancellation are isolated to the requesting user, organization and project", async () => {
	const scope = {
		userId: "alice",
		organizationId: "shop-a",
		projectId: "job-1",
	};
	const run = startCadJob(scope, null, { prompt: "Hopper" }, async () => ({
		message: "What thickness?",
		build: null,
	}));
	await new Promise((accept) => setImmediate(accept));
	assert.equal(getCadJob(scope, run.id)?.status, "completed");
	for (const other of [
		{ ...scope, userId: "bob" },
		{ ...scope, organizationId: "shop-b" },
		{ ...scope, projectId: "job-2" },
	]) {
		assert.equal(getCadJob(other, run.id), null);
		assert.equal(cancelCadJob(other, run.id), false);
	}
	assert.equal(cancelCadJob(scope, run.id), true);
	assert.equal(getCadJob(scope, run.id), null);
});
test("stopping a design aborts its generator and prevents a late result from changing the job", async () => {
	const scope = {
		userId: "stop-test",
		organizationId: "shop-a",
		projectId: "job-1",
	};
	let signal: AbortSignal | undefined;
	let complete: (value: { message: string; build: null }) => void = () => {};
	const run = startCadJob(
		scope,
		null,
		{ prompt: "Hopper" },
		async (_config, _input, options) => {
			signal = options?.signal;
			return new Promise((accept) => {
				complete = accept;
			});
		},
	);
	assert.throws(
		() => startCadJob(scope, null, { prompt: "Another" }),
		/already running/,
	);
	assert.equal(cancelCadJob(scope, run.id), true);
	assert.equal(signal?.aborted, true);
	complete({ message: "Late", build: null });
	await new Promise((accept) => setImmediate(accept));
	assert.equal(getCadJob(scope, run.id), null);
});

test("live previews use a cursor, retain only the latest geometry and ignore cancelled callbacks", async () => {
	const scope = {
		userId: "preview-test",
		organizationId: "shop-a",
		projectId: "job-1",
	};
	let options: Parameters<NonNullable<Parameters<typeof startCadJob>[3]>>[2];
	let complete!: (value: { message: string; build: null }) => void;
	const run = startCadJob(
		scope,
		null,
		{ prompt: "Trailer" },
		async (_c, _i, o) => {
			options = o;
			return new Promise((resolve) => (complete = resolve));
		},
	);
	options?.activity?.({ text: "Building chassis", draftCharacters: 123 });
	options?.preview?.([], "Chassis");
	const first = getCadJob(scope, run.id)!;
	assert.equal(first.live.text, "Building chassis");
	assert.equal(first.live.draftCharacters, 123);
	assert.ok(Object.hasOwn(first.live, "preview"));
	assert.equal(
		Object.hasOwn(
			getCadJob(scope, run.id, first.live.previewRevision)!.live,
			"preview",
		),
		false,
	);
	options?.preview?.(null);
	assert.equal(
		getCadJob(scope, run.id, first.live.previewRevision)!.live.preview,
		null,
	);
	cancelCadJob(scope, run.id);
	options?.preview?.([], "Late");
	complete({ message: "Late", build: null });
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(getCadJob(scope, run.id), null);
});

test("a design can remain active past an hour without a wall-clock abort", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
	const scope = {
		userId: "long-design",
		organizationId: "shop-a",
		projectId: "long-job",
	};
	let signal: AbortSignal | undefined;
	let complete!: (value: { message: string; build: null }) => void;
	const run = startCadJob(
		scope,
		null,
		{ prompt: "Dump trailer" },
		async (_c, _i, o) => {
			signal = o?.signal;
			return new Promise((resolve) => (complete = resolve));
		},
		() => {},
	);
	t.mock.timers.tick(90 * 60_000);
	assert.equal(signal?.aborted, false);
	assert.equal(getCadJob(scope, run.id)?.status, "running");
	complete({ message: "Finished", build: null });
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(getCadJob(scope, run.id)?.status, "completed");
	cancelCadJob(scope, run.id);
});
