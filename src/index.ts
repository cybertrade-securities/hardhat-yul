import { TASK_COMPILE_GET_COMPILATION_TASKS } from "hardhat/builtin-tasks/task-names";
import { extendConfig, subtask } from "hardhat/config";

import { TASK_COMPILE_YUL } from "./task-names";
import "./type-extensions";

extendConfig((config) => {
  const defaultConfig = { version: "latest" };
  config.yul = { ...defaultConfig, ...config.yul };
});

// add new task: compile:yul
subtask(
  TASK_COMPILE_GET_COMPILATION_TASKS,
  async (_, __, runSuper): Promise<string[]> => {
    const otherTasks = await runSuper();
    return [...otherTasks, TASK_COMPILE_YUL];
  }
);

// handle the newly added compile:yul
subtask(TASK_COMPILE_YUL, async (_flags, { config, artifacts, run }) => {
  const { compileYul } = await import("./compilation");
  await compileYul(config.yul, config.paths, artifacts, run);
});
