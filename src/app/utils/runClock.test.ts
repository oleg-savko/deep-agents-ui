import { describe, expect, it } from "vitest";
import {
  clearRunStart,
  readRunStart,
  writeRunStart,
} from "@/app/utils/runClock";

describe("runClock", () => {
  it("round-trips a start timestamp per thread", () => {
    expect(readRunStart("t1")).toBeNull();
    writeRunStart("t1", 1234);
    expect(readRunStart("t1")).toBe(1234);
    localStorage.setItem("run-started:t2", "nope");
    localStorage.setItem("run-started:t3", "0");
    expect(readRunStart("t2")).toBeNull();
    expect(readRunStart("t3")).toBeNull();
    clearRunStart("t1");
    expect(readRunStart("t1")).toBeNull();
  });
});
