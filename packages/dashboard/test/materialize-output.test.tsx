import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MaterializePanel } from "../src/components/MaterializePanel";

afterEach(cleanup);

it.each([
  ["\u001b[1mworkdir:\u001b[0m proxy", "workdir: proxy"],
  ["\u001b[?25l\u001b[2K\u001b[38;2;20;30;40mPASS\u001b[0m\u001b[?25h", "PASS"],
  ["\u001b]0;private terminal title\u0007\u001b]8;;https://example.com\u001b\\test result\u001b]8;;\u001b\\", "test result"],
  ["[1] tests [passed]\n<script>plain text</script>", "[1] tests [passed]\n<script>plain text</script>"],
])("renders readable job output: %s", (line, expected) => {
  render(<MaterializePanel job={{ jobId: "job_1", phase: "codex", lines: [line, "Next line"] }} retry={() => {}} pending={false} connected />);
  const output = screen.getByLabelText("Materialize job output");
  expect(output.textContent).toBe(`${expected}\nNext line`);
  expect(output.querySelector("script")).toBeNull();
});
