import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { checkCase } from "./check_final_answer.mjs";

// Repository-only Qwen Code runner. Each invocation creates a fresh sandbox.
// Usage: node run_eval.mjs <skill-directory> <case-id> <new-output-directory>
const [skillArg, caseId, outputArg] = process.argv.slice(2);
if (!skillArg || !caseId || !outputArg) throw new Error("Expected skill directory, case id and new output directory");
const skill = path.resolve(skillArg);
const output = path.resolve(outputArg);
const model = process.env.QWEN_EVAL_MODEL;
if (!model || !process.env.OPENAI_API_KEY || !process.env.OPENAI_BASE_URL) {
  throw new Error("Set QWEN_EVAL_MODEL, OPENAI_API_KEY and OPENAI_BASE_URL in the execution environment; credentials are never stored in fixtures.");
}
const cases = JSON.parse(await fs.readFile(new URL("./evals.json", import.meta.url), "utf8")).evals;
const testCase = cases.find(item => String(item.id) === caseId);
if (!testCase) throw new Error(`Unknown case ${caseId}`);
await fs.mkdir(path.dirname(output), { recursive: true });
await fs.mkdir(output); // Do not overwrite an earlier evaluation.
const sandbox = path.join(output, "sandbox");
const installed = path.join(sandbox, ".qwen/skills/markdown-chart");
await fs.mkdir(path.dirname(installed), { recursive: true });
await fs.cp(skill, installed, { recursive: true });
await fs.mkdir(path.join(output, "outputs"));
await fs.writeFile(path.join(output, "eval_metadata.json"), JSON.stringify(testCase, null, 2));
const prompt = `先读取 ${installed}/SKILL.md 并按其说明完成用户请求。这是仅有已给数据的图表生成任务，不需要联网或查询外部系统。需要写文件时可以使用 edit 工具（old_string为空创建文件）；所有写入和命令只限当前临时目录及其中的 Skill。最终回答直接返回给用户，不要把回答另存为文件。\n\n${testCase.prompt}`;
const started = Date.now();
const child = spawn("qwen", ["--bare", "--auth-type", "openai", "--model", model, "--approval-mode", "yolo", "--output-format", "stream-json", "--max-wall-time", "180s"], {
  cwd: sandbox, stdio: ["pipe", "pipe", "pipe"],
});
child.stdin.end(prompt);
let stdout = "";
let stderr = "";
child.stdout.on("data", chunk => { stdout += chunk; });
child.stderr.on("data", chunk => { stderr += chunk; });
const code = await new Promise((resolve, reject) => { child.on("close", resolve); child.on("error", reject); });
await fs.writeFile(path.join(output, "output.jsonl"), stdout);
await fs.writeFile(path.join(output, "stderr.log"), stderr);
const duration = Date.now() - started;
await fs.writeFile(path.join(output, "timing.json"), JSON.stringify({ duration_ms: duration, total_duration_seconds: duration / 1000, exit_code: code, model }));
let response;
let events = [];
try {
  events = stdout.split(/\r?\n/).filter(line => line.trim()).map(line => JSON.parse(line));
  response = events.findLast(event => event.type === "result");
} catch { throw new Error(`Qwen did not return complete JSONL; inspect ${output}`); }
if (!response || code !== 0 || response.is_error) {
  await fs.writeFile(path.join(output, "run-status.json"), JSON.stringify({ status: "runtime-error", exit_code: code, error: response?.error }));
  throw new Error(`Qwen generation did not complete; not a Skill quality score. Inspect ${output}`);
}
// Qwen Code headless JSON uses the terminal result, not intermediate messages.
const answer = typeof response.result === "string" ? response.result : "";
await fs.writeFile(path.join(output, "outputs/final-answer.md"), answer);
const checks = checkCase(answer, testCase);
const passed = code === 0 && !response.is_error && checks.ok;
const toolCalls = events.flatMap(event => event.message?.content ?? []).filter(block => block.type === "tool_use");
await fs.writeFile(path.join(output, "timing.json"), JSON.stringify({
  duration_ms: duration, total_duration_seconds: duration / 1000, exit_code: code,
  model: events.find(event => event.type === "system" && event.subtype === "init")?.model ?? model,
  total_tokens: response.usage?.total_tokens,
}));
const grading = {
  expectations: [
    { text: "Qwen completed the generation", passed: code === 0 && !response.is_error, evidence: `exit=${code}` },
    { text: "Final chart JSON, encoding and source values pass", passed: checks.ok, evidence: JSON.stringify(checks.errors) },
  ],
  summary: { passed: 1 + Number(checks.ok), failed: Number(!checks.ok), total: 2, pass_rate: (1 + Number(checks.ok)) / 2 },
  execution_metrics: {
    total_tool_calls: toolCalls.length,
    tool_calls: toolCalls.reduce((counts, call) => { counts[call.name] = (counts[call.name] ?? 0) + 1; return counts; }, {}),
    output_chars: answer.length,
  },
};
await fs.writeFile(path.join(output, "grading.json"), JSON.stringify(grading, null, 2));
console.log(JSON.stringify({ caseId, output, passed, errors: checks.errors, duration_ms: Date.now() - started }));
process.exitCode = passed ? 0 : 1;
