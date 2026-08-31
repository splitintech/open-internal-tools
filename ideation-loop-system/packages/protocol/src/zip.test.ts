import { describe, expect, it } from "vitest";
import { zipStore } from "./zip.ts";

describe("zipStore", () => {
  it("writes an uncompressed zip with AUDIT.md", () => {
    const zip = zipStore([{ name: "AUDIT.md", data: "# audit\n" }]);
    expect(zip.readUInt32LE(0)).toBe(0x04034b50);
    expect(zip.includes(Buffer.from("AUDIT.md"))).toBe(true);
    expect(zip.includes(Buffer.from("# audit\n"))).toBe(true);
  });
});
