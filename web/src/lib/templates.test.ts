import { describe, expect, it } from "vitest";

import type { Task } from "@/lib/api";
import {
  deleteTemplate,
  findTemplate,
  MAX_TEMPLATES,
  saveTemplate,
  templateFromTask,
  templateToInput,
  type TaskTemplate,
} from "@/lib/templates";

const tpl = (name: string, over: Partial<TaskTemplate> = {}): TaskTemplate => ({
  name, description: "", intervalSeconds: null, tags: [], folder: "", ...over,
});

const task = {
  id: 1, name: "Water the fern", description: "The big one",
  intervalSeconds: 604_800, tags: ["plants"], folder: "Home",
  colorFresh: "#123456", colorOverdue: "#654321",
} as unknown as Task;

describe("templateFromTask", () => {
  it("keeps the setup and drops the decoration", () => {
    const t = templateFromTask(task, "  Houseplant  ");
    expect(t).toEqual({
      name: "Houseplant", description: "The big one",
      intervalSeconds: 604_800, tags: ["plants"], folder: "Home",
    });
    expect(t).not.toHaveProperty("colorFresh");
  });

  it("copies the tags rather than sharing them", () => {
    const t = templateFromTask(task, "x");
    t.tags.push("mutated");
    expect(task.tags).toEqual(["plants"]);
  });
});

describe("templateToInput", () => {
  it("produces what the create form needs", () => {
    expect(templateToInput(tpl("Bike service", { intervalSeconds: 100, tags: ["bike"], folder: "Garage" })))
      .toEqual({ name: "Bike service", description: "", intervalSeconds: 100, tags: ["bike"], folder: "Garage" });
  });
});

describe("saveTemplate", () => {
  it("adds to an empty list", () => {
    expect(saveTemplate(undefined, tpl("a"))).toHaveLength(1);
  });

  it("replaces by name, ignoring case", () => {
    const list = saveTemplate([tpl("Plant", { folder: "Old" })], tpl("plant", { folder: "New" }));
    expect(list).toHaveLength(1);
    expect(list[0].folder).toBe("New");
  });

  it("trims the name it stores", () => {
    expect(saveTemplate([], tpl("  spaced  "))[0].name).toBe("spaced");
  });

  it("refuses a blank name rather than storing an unnameable template", () => {
    expect(saveTemplate([tpl("a")], tpl("   "))).toEqual([tpl("a")]);
  });

  it("caps the list, dropping the oldest", () => {
    let list: TaskTemplate[] = [];
    for (let i = 0; i < MAX_TEMPLATES + 5; i++) list = saveTemplate(list, tpl(`t${i}`));
    expect(list).toHaveLength(MAX_TEMPLATES);
    expect(list[0].name).toBe("t5");
    expect(list[list.length - 1].name).toBe(`t${MAX_TEMPLATES + 4}`);
  });

  it("re-saving keeps the list the same length", () => {
    let list = [tpl("a"), tpl("b")];
    list = saveTemplate(list, tpl("a", { folder: "Home" }));
    expect(list.map((t) => t.name)).toEqual(["b", "a"]);
  });
});

describe("deleteTemplate / findTemplate", () => {
  const list = [tpl("Plant"), tpl("Bike")];
  it("deletes by name, ignoring case", () => {
    expect(deleteTemplate(list, "plant").map((t) => t.name)).toEqual(["Bike"]);
  });
  it("finds by name, ignoring case and padding", () => {
    expect(findTemplate(list, "  BIKE ")?.name).toBe("Bike");
    expect(findTemplate(list, "nope")).toBeNull();
    expect(findTemplate(undefined, "Bike")).toBeNull();
  });
});
