// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../cpp/", import.meta.url));
const target = join(root, "build/target/release");
const cache = join(target, "CMakeCache.txt");
const cachedGenerator = existsSync(cache)
    ? readFileSync(cache, "utf8").match(/^CMAKE_GENERATOR:INTERNAL=(.+)$/m)?.[1]
    : undefined;
const ninjaAvailable = spawnSync("ninja", ["--version"], { stdio: "ignore" }).status === 0;
const generator =
    cachedGenerator ??
    (ninjaAvailable ? "Ninja" : process.platform === "win32" ? "NMake Makefiles" : "Unix Makefiles");
function run(args) {
    const result = spawnSync("cmake", args, { cwd: root, stdio: "inherit" });
    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status ?? 1);
}
run([
    "-S",
    root,
    "-B",
    target,
    "-G",
    generator,
    `-DCMAKE_TOOLCHAIN_FILE=${join(root, "build/emsdk/upstream/emscripten/cmake/Modules/Platform/Emscripten.cmake")}`,
    "-DCMAKE_BUILD_TYPE=Release",
]);
run(["--build", target, "--target", "install", "--parallel", String(Math.min(4, availableParallelism()))]);
