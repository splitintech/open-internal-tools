import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { main } from "../src/cli";
import { EmptyCidrListError, EmptyInviteListError } from "../src/core/errors";

describe("cli", () => {
  it("refuses to mint a share until the group has members and cidrs", async () => {
    const dir = await mkdtemp(join(tmpdir(), "group-share-cli-"));
    process.env.GROUP_SHARE_DATA_DIR = dir;
    const add = await main(["groups", "add", "design", "ada@example.com"]);
    expect(add).toBe(0);
    await expect(main(["share", "--group", "design", "--origin", "http://127.0.0.1:4010"])).rejects.toBeInstanceOf(
      EmptyCidrListError,
    );
    const allow = await main(["allow", "design", "203.0.113.0/24"]);
    expect(allow).toBe(0);
    const emptyMembersDir = await mkdtemp(join(tmpdir(), "group-share-cli-"));
    process.env.GROUP_SHARE_DATA_DIR = emptyMembersDir;
    await main(["allow", "lonely", "203.0.113.0/24"]);
    await expect(main(["share", "--group", "lonely", "--origin", "http://127.0.0.1:4010"])).rejects.toBeInstanceOf(
      EmptyInviteListError,
    );
    await writeFile(join(dir, "keep"), "", "utf8");
  });
});
