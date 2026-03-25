#!/usr/bin/env python3
"""
Kemira Brantford AGENT end-to-end testing harness.

Spawns the actual Claude CLI agent with MCP tools and gives it natural-language
prompts to count symbols. Measures:
  - Total tool calls (render, zoom, count, find)
  - Wasted turns (zoom calls, re-renders, retries)
  - Time to first countSymbols call
  - Time to completion
  - Whether it got the right answer

This is the REAL test — not "can the CV pipeline count?" but
"can the agent efficiently use the tools to arrive at the right count?"
"""
import sys, os, json, time, subprocess, re, argparse
from dataclasses import dataclass, field, asdict
from typing import Optional

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../.."))
MCP_SERVER = os.path.join(REPO_ROOT, "packages/mcp-server/src/index.ts")

API_URL = os.environ.get("BIDWRIGHT_API_URL", "http://localhost:4001")
AUTH_TOKEN = os.environ.get("BIDWRIGHT_AUTH_TOKEN", "d9b2a503650d0f334caf9bf45ff444320068a374c8931c343343557d5180913b")
PROJECT_ID = os.environ.get("BIDWRIGHT_PROJECT_ID", "project-36dcd430-0910-4e97-a8be-126fc833e348")

OUT = os.path.join(os.path.dirname(__file__), "kemira_agent_output")
os.makedirs(OUT, exist_ok=True)


@dataclass
class AgentTrace:
    """Full trace of an agent session."""
    prompt: str = ""
    tool_calls: list = field(default_factory=list)  # [{tool, input_summary, timestamp}]
    messages: list = field(default_factory=list)     # [{role, content_preview, timestamp}]
    thinking: list = field(default_factory=list)     # [{content_preview, timestamp}]
    errors: list = field(default_factory=list)

    # Metrics
    total_tool_calls: int = 0
    render_calls: int = 0
    zoom_calls: int = 0
    count_calls: int = 0
    find_calls: int = 0
    list_calls: int = 0
    other_calls: int = 0

    time_to_first_count_s: Optional[float] = None
    total_time_s: float = 0
    final_count: Optional[int] = None
    final_message: str = ""
    status: str = "unknown"  # ok, fail, timeout

    # Efficiency score
    wasted_turns: int = 0  # zooms + re-renders beyond the minimum needed


@dataclass
class TestCase:
    name: str
    prompt: str
    min_expected: int
    max_expected: int
    desc: str


# ═══════════════════════════════════════════════════════════════
# TEST CASES — natural language prompts for the agent
# ═══════════════════════════════════════════════════════════════

TEST_CASES = [
    TestCase(
        name="tank_nozzle_flanges",
        prompt="Look at the new tank drawing (new-tank-drawing.pdf) page 1. Count all the nozzle flange symbols — the small rectangular detail symbols showing pipe connections. Report the count.",
        min_expected=2, max_expected=6,
        desc="Agent must find and count nozzle flanges on tank drawing",
    ),
    TestCase(
        name="tank_nozzle_callouts",
        prompt="On new-tank-drawing.pdf page 1, count all the nozzle identification callout boxes (the rectangular labels like N7, N9 etc that label each nozzle). Report the count.",
        min_expected=2, max_expected=10,
        desc="Agent must find and count nozzle ID callout boxes",
    ),
    TestCase(
        name="ct_section_markers",
        prompt="On Z1064957_B.pdf page 1, count all the small circular section reference bubble markers. These are small circles with letters inside, used to reference cross-sections. Report the count.",
        min_expected=3, max_expected=8,
        desc="Agent must find section bubbles on CT detail drawing",
    ),
    TestCase(
        name="pid_symbols",
        prompt="On 17041-100-2024-10-11-Issued.pdf page 1, look in the bottom-right area of the drawing for any process flow symbols (squares, rectangles, or boxes). Find one and count how many similar symbols exist on this page. Report the count.",
        min_expected=1, max_expected=5,
        desc="Agent must discover and count PID symbols",
    ),
    TestCase(
        name="crane_detail",
        prompt="On PENG-STAMPED-SO35080-01-2TON-TR-SG-38FT-SPAN-CRANE-GENERAL-LAYOUT-Model.pdf, find any repeating detail symbols or section markers and count them. Report what you found and the count.",
        min_expected=1, max_expected=4,
        desc="Agent explores crane layout for repeating symbols",
    ),
]


def run_agent(prompt: str, timeout_s: int = 300, model: str = "sonnet") -> AgentTrace:
    """Spawn the Claude CLI agent and trace its behavior."""
    trace = AgentTrace(prompt=prompt)

    # Build MCP config
    mcp_config = json.dumps({
        "mcpServers": {
            "bidwright": {
                "command": "npx",
                "args": ["tsx", MCP_SERVER],
                "env": {
                    "BIDWRIGHT_API_URL": API_URL,
                    "BIDWRIGHT_AUTH_TOKEN": AUTH_TOKEN,
                    "BIDWRIGHT_PROJECT_ID": PROJECT_ID,
                },
            },
        },
    })

    # Project dir (agent CWD — needs .claude/settings.json)
    project_dir = os.path.join(REPO_ROOT, "data", "bidwright-api", "projects", PROJECT_ID)
    os.makedirs(os.path.join(project_dir, ".claude"), exist_ok=True)

    # Write settings for MCP discovery
    settings = {
        "permissions": {"allow": ["mcp__bidwright__*"]},
        "mcpServers": {
            "bidwright": {
                "command": "npx",
                "args": ["tsx", MCP_SERVER],
                "env": {
                    "BIDWRIGHT_API_URL": API_URL,
                    "BIDWRIGHT_AUTH_TOKEN": AUTH_TOKEN,
                    "BIDWRIGHT_PROJECT_ID": PROJECT_ID,
                },
            },
        },
    }
    with open(os.path.join(project_dir, ".claude", "settings.json"), "w") as f:
        json.dump(settings, f, indent=2)

    cmd = [
        "claude",
        "-p", prompt,
        "--output-format", "stream-json",
        "--dangerously-skip-permissions",
        "--verbose",
        "--max-turns", "30",  # Cap to prevent runaway
        "--model", model,
        "--mcp-config", mcp_config,
    ]

    start = time.time()
    first_count_time = None

    try:
        proc = subprocess.Popen(
            cmd,
            cwd=project_dir,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            env={**os.environ, "BIDWRIGHT_PROJECT_ID": PROJECT_ID},
        )

        # Read stream-json output line by line
        for line in proc.stdout:
            line = line.strip()
            if not line:
                continue

            elapsed = time.time() - start
            if elapsed > timeout_s:
                proc.kill()
                trace.status = "timeout"
                break

            try:
                msg = json.loads(line)
            except json.JSONDecodeError:
                continue

            msg_type = msg.get("type", "")

            if msg_type == "assistant":
                content = msg.get("content", msg.get("message", {}).get("content", []))
                if isinstance(content, list):
                    for block in content:
                        if block.get("type") == "tool_use":
                            tool_name = block.get("name", "")
                            tool_input = block.get("input", {})

                            trace.total_tool_calls += 1
                            call_record = {
                                "tool": tool_name,
                                "input_keys": list(tool_input.keys()) if isinstance(tool_input, dict) else [],
                                "timestamp": round(elapsed, 2),
                            }

                            # Classify tool call
                            if "renderDrawingPage" in tool_name:
                                trace.render_calls += 1
                                call_record["dpi"] = tool_input.get("dpi")
                                call_record["docId"] = str(tool_input.get("documentId", ""))[:20]
                            elif "zoomDrawingRegion" in tool_name:
                                trace.zoom_calls += 1
                                call_record["region"] = tool_input.get("region", {})
                            elif "countSymbols" in tool_name and "AllPages" not in tool_name:
                                trace.count_calls += 1
                                call_record["bbox"] = tool_input.get("boundingBox", {})
                                call_record["threshold"] = tool_input.get("threshold")
                                if first_count_time is None:
                                    first_count_time = elapsed
                                    trace.time_to_first_count_s = round(elapsed, 2)
                            elif "countSymbolsAllPages" in tool_name:
                                trace.count_calls += 1
                                if first_count_time is None:
                                    first_count_time = elapsed
                                    trace.time_to_first_count_s = round(elapsed, 2)
                            elif "findSymbolCandidates" in tool_name:
                                trace.find_calls += 1
                            elif "listDrawingPages" in tool_name:
                                trace.list_calls += 1
                            else:
                                trace.other_calls += 1

                            trace.tool_calls.append(call_record)

                        elif block.get("type") == "text":
                            text = block.get("text", "")
                            trace.messages.append({
                                "role": "assistant",
                                "preview": text[:200],
                                "timestamp": round(elapsed, 2),
                            })
                            trace.final_message = text

                        elif block.get("type") in ("thinking", "reasoning"):
                            text = block.get("thinking", block.get("text", ""))
                            trace.thinking.append({
                                "preview": text[:150],
                                "timestamp": round(elapsed, 2),
                            })

                elif isinstance(content, str):
                    trace.messages.append({
                        "role": "assistant",
                        "preview": content[:200],
                        "timestamp": round(elapsed, 2),
                    })
                    trace.final_message = content

            elif msg_type == "tool":
                # Tool result — check for count results
                content = msg.get("content", msg.get("message", {}).get("content", ""))
                if isinstance(content, list):
                    for block in content:
                        if block.get("type") == "text":
                            try:
                                data = json.loads(block.get("text", ""))
                                if "totalCount" in data:
                                    trace.final_count = data["totalCount"]
                            except (json.JSONDecodeError, TypeError):
                                pass
                elif isinstance(content, str):
                    try:
                        data = json.loads(content)
                        if "totalCount" in data:
                            trace.final_count = data["totalCount"]
                    except (json.JSONDecodeError, TypeError):
                        pass

            elif msg_type == "result":
                pass  # Session done

        proc.wait(timeout=30)
        trace.total_time_s = round(time.time() - start, 2)

        if trace.status != "timeout":
            trace.status = "ok" if proc.returncode == 0 else "fail"

        # Read stderr for errors
        stderr = proc.stderr.read()
        if stderr.strip():
            trace.errors.append(stderr[:500])

    except subprocess.TimeoutExpired:
        proc.kill()
        trace.status = "timeout"
        trace.total_time_s = timeout_s
    except Exception as e:
        trace.status = "fail"
        trace.errors.append(str(e))
        trace.total_time_s = round(time.time() - start, 2)

    # Calculate wasted turns: anything beyond [list + render + count] is overhead
    min_tools = 1 + 1 + 1  # list + render + count
    trace.wasted_turns = max(0, trace.total_tool_calls - min_tools)

    return trace


def run_test_case(case: TestCase, model: str = "sonnet", timeout_s: int = 300, verbose: bool = True) -> dict:
    """Run a single test case and evaluate."""
    if verbose:
        print(f"\n  ── {case.name} ──")
        print(f"  Prompt: {case.prompt[:80]}...")

    trace = run_agent(case.prompt, timeout_s=timeout_s, model=model)

    # Evaluate
    got_count = trace.final_count is not None
    in_range = (case.min_expected <= (trace.final_count or 0) <= case.max_expected) if got_count else False

    # Efficiency grade
    if trace.total_tool_calls <= 4:
        efficiency = "A"  # list + render + count (+ maybe 1 zoom)
    elif trace.total_tool_calls <= 6:
        efficiency = "B"  # A few extra steps
    elif trace.total_tool_calls <= 10:
        efficiency = "C"  # Moderate flailing
    else:
        efficiency = "D"  # Lots of back-and-forth

    # Save full trace for debugging
    trace_path = os.path.join(OUT, f"trace_{case.name}.json")
    with open(trace_path, "w") as f:
        json.dump(asdict(trace), f, indent=2)

    result = {
        "name": case.name,
        "status": trace.status,
        "count": trace.final_count,
        "in_range": in_range,
        "expected": f"{case.min_expected}-{case.max_expected}",
        "total_tools": trace.total_tool_calls,
        "renders": trace.render_calls,
        "zooms": trace.zoom_calls,
        "counts": trace.count_calls,
        "finds": trace.find_calls,
        "lists": trace.list_calls,
        "wasted": trace.wasted_turns,
        "efficiency": efficiency,
        "time_to_count_s": trace.time_to_first_count_s,
        "total_time_s": trace.total_time_s,
        "errors": trace.errors if trace.errors else None,
    }

    if verbose:
        flag = "✓" if in_range else "✗"
        print(f"  {flag} count={trace.final_count} (expected {case.min_expected}-{case.max_expected})")
        print(f"    Tools: {trace.total_tool_calls} total "
              f"(list={trace.list_calls} render={trace.render_calls} zoom={trace.zoom_calls} "
              f"count={trace.count_calls} find={trace.find_calls})")
        print(f"    Efficiency: {efficiency} ({trace.wasted_turns} wasted turns)")
        print(f"    Time: {trace.total_time_s:.1f}s total, "
              f"{trace.time_to_first_count_s or '?'}s to first count")

        # Show tool call sequence
        print(f"    Sequence: ", end="")
        for tc in trace.tool_calls:
            short = tc["tool"].replace("mcp__bidwright__", "").replace("DrawingPage", "").replace("Drawing", "")
            print(f"{short}", end=" → ")
        print("done")

    return result


def run_full_eval(model: str = "sonnet", timeout_s: int = 300, verbose: bool = True):
    """Run all test cases."""
    print("█" * 70)
    print(f"KEMIRA AGENT HARNESS (model={model}, timeout={timeout_s}s)")
    print("█" * 70)

    all_results = []
    total_in_range = 0
    total_run = 0
    total_wasted = 0
    efficiency_counts = {"A": 0, "B": 0, "C": 0, "D": 0}

    for case in TEST_CASES:
        r = run_test_case(case, model=model, timeout_s=timeout_s, verbose=verbose)
        all_results.append(r)

        if r["status"] == "ok":
            total_run += 1
            if r["in_range"]:
                total_in_range += 1
            total_wasted += r["wasted"]
            efficiency_counts[r["efficiency"]] += 1

    # Summary
    accuracy = total_in_range / total_run if total_run > 0 else 0
    avg_wasted = total_wasted / total_run if total_run > 0 else 0
    avg_time = sum(r["total_time_s"] for r in all_results) / len(all_results) if all_results else 0

    print(f"\n{'█' * 70}")
    print("AGENT HARNESS RESULTS")
    print(f"{'█' * 70}")
    print(f"  Accuracy:   {total_in_range}/{total_run} ({accuracy:.0%})")
    print(f"  Avg wasted: {avg_wasted:.1f} turns")
    print(f"  Avg time:   {avg_time:.1f}s")
    print(f"  Efficiency: A={efficiency_counts['A']} B={efficiency_counts['B']} "
          f"C={efficiency_counts['C']} D={efficiency_counts['D']}")

    # Save results
    with open(os.path.join(OUT, "agent_results.json"), "w") as f:
        json.dump({
            "model": model,
            "accuracy": accuracy,
            "avg_wasted_turns": avg_wasted,
            "avg_time_s": avg_time,
            "efficiency": efficiency_counts,
            "results": all_results,
        }, f, indent=2)

    return all_results


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Kemira agent behavior test harness")
    parser.add_argument("mode", nargs="?", default="full",
                       choices=["full", "single"],
                       help="full: all test cases | single: one test case")
    parser.add_argument("--model", default="sonnet", help="Claude model to use")
    parser.add_argument("--timeout", type=int, default=300, help="Timeout per test (seconds)")
    parser.add_argument("--case", type=int, default=0, help="Test case index (for single mode)")
    args = parser.parse_args()

    if args.mode == "single":
        case = TEST_CASES[args.case]
        run_test_case(case, model=args.model, timeout_s=args.timeout)
    else:
        run_full_eval(model=args.model, timeout_s=args.timeout)
