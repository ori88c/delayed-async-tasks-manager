/**
 * Copyright 2024 Ori Cohen https://github.com/ori88c
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {
  DelayedAsyncTasksManager,
  DelayedTask
} from './delayed-async-tasks-manager';
  
type PromiseResolveCallbackType = (value?: unknown) => void;
type PromiseRejectCallbackType = (reason?: Error) => void;

interface CustomTaskError {
  taskID: number;
  message: string;
}

/**
 * resolveFast
 * 
 * The one-and-only purpose of this function, is triggerring an event-loop iteration.
 * It is relevant whenever a test needs to simulate tasks from the Node.js' micro-tasks queue.
 */
const resolveFast = async () => { expect(14).toBeGreaterThan(3); };

const ITH_TASK_DELAY_FACTOR = 100;

describe('DelayedAsyncTask tests', () => {
  let setTimeoutSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.useFakeTimers();
    setTimeoutSpy = jest.spyOn(global, 'setTimeout');
  });
  
  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });
  
  describe('Happy path tests', () => {
    test('validates task status getters throughout the lifecycle of a single task, from scheduling to completion', async () => {
      const key = 'MOCK_KEY';
      const delayMs = 40 * 1000;
      const manager = new DelayedAsyncTasksManager();

       // Verify the initial state before task scheduling.
      expect(setTimeoutSpy).toHaveBeenCalledTimes(0);
      expect(manager.isExecuting(key)).toBe(false);
      expect(manager.isPending(key)).toBe(false);
      expect(manager.isManaged(key)).toBe(false);
      expect(manager.pendingTasksCount).toBe(0);
      expect(manager.currentlyExecutingTasksCount).toBe(0);
      expect(manager.uncaughtErrorsCount).toBe(0);
      expect(manager.tryAbortPendingTask(key)).toBe(false); // Should fail to abort an ongoing task.
      await manager.awaitCompletionOfAllCurrentlyExecutingTasks(); // Should resolve immediately.

      // We create an unresolved promise, simulating an async work in progress.
      // It will be resolved later, once we want to simulate completion of the async work.
      let taskResolveCallback: PromiseResolveCallbackType;
      const task: DelayedTask = () => new Promise<void>(
        res => taskResolveCallback = res
      );

      manager.addTask(key, task, delayMs);
      expect(setTimeoutSpy).toHaveBeenCalledTimes(1);

      // Verify the intermediate state: the task is pending execution.
      expect(manager.isExecuting(key)).toBe(false);
      expect(manager.isPending(key)).toBe(true);
      expect(manager.isManaged(key)).toBe(true);
      expect(await manager.awaitTaskCompletion(key)).toBe(false); // Does not wait if the task is pending.
      expect(manager.pendingTasksCount).toBe(1);
      expect(manager.currentlyExecutingTasksCount).toBe(0);
      expect(manager.uncaughtErrorsCount).toBe(0);
      await manager.awaitCompletionOfAllCurrentlyExecutingTasks(); // Should resolve immediately because no task is in-progress.
      
      // Advance the system clock to trigger the task execution at the expected time.
      await jest.advanceTimersByTimeAsync(delayMs);
      // Note that this would have worked as well:
      // await jest.advanceTimersToNextTimerAsync(1);

      // Verify the intermediate state: the task is currently in progress.
      expect(manager.isExecuting(key)).toBe(true);
      expect(manager.isPending(key)).toBe(false);
      expect(manager.isManaged(key)).toBe(true);
      expect(manager.pendingTasksCount).toBe(0);
      expect(manager.currentlyExecutingTasksCount).toBe(1);
      expect(manager.uncaughtErrorsCount).toBe(0);

      // Simulate completion of the async work.
      taskResolveCallback();
      await manager.awaitCompletionOfAllCurrentlyExecutingTasks();

      // Verify the final state: the task is no longer managed by the instance
      // after completion, as the manager does not retain any memory of past executions.
      expect(manager.isExecuting(key)).toBe(false);
      expect(manager.isPending(key)).toBe(false);
      expect(manager.isManaged(key)).toBe(false);
      expect(manager.pendingTasksCount).toBe(0);
      expect(manager.currentlyExecutingTasksCount).toBe(0);
      expect(manager.uncaughtErrorsCount).toBe(0);
      expect(manager.tryAbortPendingTask(key)).toBe(false);
      expect(setTimeoutSpy).toHaveBeenCalledTimes(1);
    });

    test('mixed scenario: getters should accurately reflect the number of pending and executing tasks', async () => {
      const totalTasksCount = 35;
      const executingTasksCount = 20; // Only 20 tasks will execute; the remaining tasks will be aborted before starting.
      const taskResolveCallbacks: PromiseResolveCallbackType[] = [];
      const getTaskKey = (ithTask: number): string => `UNIQUE_TASK_KEY_${ithTask}`;

      const manager = new DelayedAsyncTasksManager();
      for (let ithTask = 1; ithTask <= totalTasksCount; ++ithTask) {
        const key = getTaskKey(ithTask);
        const delayMs = ithTask * ITH_TASK_DELAY_FACTOR;

        // We create unresolved promises, simulating an async work in progress.
        // They will be resolved later, once we want to simulate completion of the async work.
        const task: DelayedTask = () => new Promise<void>(
          res => taskResolveCallbacks.push(res)
        );

        manager.addTask(key, task, delayMs);
        expect(setTimeoutSpy).toHaveBeenCalledTimes(ithTask);
        expect(manager.pendingTasksCount).toBe(ithTask);
        expect(manager.currentlyExecutingTasksCount).toBe(0);
        expect(await manager.awaitTaskCompletion(key)).toBe(false); // Does not wait if the task is pending.
      }

       // Advance the system clock to trigger the execution of the first `executingTasksCount` tasks.
      await jest.advanceTimersByTimeAsync(executingTasksCount * ITH_TASK_DELAY_FACTOR);
      // Note that this would have worked as well:
      // await jest.advanceTimersToNextTimerAsync(executingTasksCount);

      expect(taskResolveCallbacks.length).toBe(executingTasksCount);
      expect(manager.currentlyExecutingTasksCount).toBe(executingTasksCount);
      expect(manager.pendingTasksCount).toBe(totalTasksCount - executingTasksCount);
      
      // Verify the state of all currently executing tasks.
      for (let ithTask = 1; ithTask <= executingTasksCount; ++ithTask) {
        const key = getTaskKey(ithTask);
        expect(manager.isExecuting(key)).toBe(true);
        expect(manager.isPending(key)).toBe(false);
        expect(manager.isManaged(key)).toBe(true);
        expect(manager.tryAbortPendingTask(key)).toBe(false);
      }

      // Traverse all currently pending tasks and abort each one.
      let expectedPendingTasksCount = totalTasksCount - executingTasksCount;
      for (let ithTask = executingTasksCount + 1; ithTask <= totalTasksCount; ++ithTask) {
        expect(manager.pendingTasksCount).toBe(expectedPendingTasksCount);
        const key = getTaskKey(ithTask);
        expect(manager.isExecuting(key)).toBe(false);
        expect(manager.isPending(key)).toBe(true);
        expect(manager.isManaged(key)).toBe(true);
        expect(manager.tryAbortPendingTask(key)).toBe(true); // Pending tasks can be aborted.
        --expectedPendingTasksCount;
      }

      expect(manager.pendingTasksCount).toBe(0);
      expect(manager.currentlyExecutingTasksCount).toBe(executingTasksCount);

      // Complete the running tasks one by one in a FILO order, resolving the most
      // recently executing task first.
      let expectedExecutingTasksCount = executingTasksCount;
      for (let ithTask = executingTasksCount; ithTask > 0; --ithTask) {
        const key = getTaskKey(ithTask);
        expect(manager.isExecuting(key)).toBe(true);

        const awaitTaskCompletionPromise: Promise<boolean> = manager.awaitTaskCompletion(key);

        const resolveIthTaskCallback = taskResolveCallbacks.pop();
        resolveIthTaskCallback();
        expect(await awaitTaskCompletionPromise).toBe(true);

        --expectedExecutingTasksCount;
        expect(manager.isExecuting(key)).toBe(false);
        expect(manager.isPending(key)).toBe(false);
        expect(manager.isManaged(key)).toBe(false);
        expect(manager.currentlyExecutingTasksCount).toBe(expectedExecutingTasksCount);
      }

      expect(manager.currentlyExecutingTasksCount).toBe(0);
      expect(manager.pendingTasksCount).toBe(0);
      expect(manager.uncaughtErrorsCount).toBe(0);
      expect(setTimeoutSpy).toHaveBeenCalledTimes(totalTasksCount);

      for (let ithTask = 1; ithTask <= totalTasksCount; ++ithTask) {
        const key = getTaskKey(ithTask);

        // The task is not managed by the instance and is not currently executing.
        // Therefore, `awaitTaskCompletion` is expected to resolve immediately.
        expect(await manager.awaitTaskCompletion(key)).toBe(false);
      }
    });

    test(
      'awaitCompletionOfAllCurrentlyExecutingTasks should resolve only after all currently executing ' +
      'tasks have completed (either resolved or rejected)', async () => {
      const successfulTasksCount = 18;
      const rejectingTasksCount = 17;
      const totalTasksCount = successfulTasksCount + rejectingTasksCount;
      const taskResolveCallbacks: PromiseResolveCallbackType[] = [];
      const taskRejectCallbacks: PromiseRejectCallbackType[] = [];

      // Range of succeeding task keys: [1, successfulTasksCount].
      // Range of rejecting task keys: [successfulTasksCount + 1, totalTasksCount].
      const manager = new DelayedAsyncTasksManager();
      for (let ithTask = 1; ithTask <= totalTasksCount; ++ithTask) {
        const key = ithTask;
        const delayMs = ithTask * ITH_TASK_DELAY_FACTOR;
        let task: DelayedTask;
        
        if (ithTask <= successfulTasksCount) {
          task = () => new Promise<void>(
            res => taskResolveCallbacks.push(res)
          );
        } else {
          task = () => new Promise<void>(
            (_, rej) => taskRejectCallbacks.push(rej)
          );
        }

        manager.addTask(key, task, delayMs);
        expect(setTimeoutSpy).toHaveBeenCalledTimes(ithTask);
      }

      // Advance the system clock to initiate the execution of all tasks.
      await jest.advanceTimersToNextTimerAsync(totalTasksCount);
      // Note that this would have worked as well:
      // await jest.advanceTimersByTimeAsync(totalTasksCount * ITH_TASK_DELAY_FACTOR);

      expect(manager.pendingTasksCount).toBe(0);
      expect(manager.currentlyExecutingTasksCount).toBe(totalTasksCount);

      let didAllTasksComplete = false;
      const awaitCompletionOfAllTasks: Promise<void> = (async () => {
        await manager.awaitCompletionOfAllCurrentlyExecutingTasks();
        didAllTasksComplete = true;
      })();

      // First, resolve all successful tasks.
      let expectedExecutingTasksCount = totalTasksCount;
      while (taskResolveCallbacks.length > 0) {
        const resolveTaskCallback = taskResolveCallbacks.pop();
        resolveTaskCallback();
        await Promise.race([awaitCompletionOfAllTasks, resolveFast()]); // Trigger the event-loop.

        --expectedExecutingTasksCount;
        expect(manager.currentlyExecutingTasksCount).toBe(expectedExecutingTasksCount);
        expect(didAllTasksComplete).toBe(false);
      }

      // Now, resolve all rejecting tasks.
      let expectedUncaughtErrorsCount = 0;
      while (taskRejectCallbacks.length > 0) {
        const rejectTaskCallback = taskRejectCallbacks.pop();
        rejectTaskCallback(new Error(`Error no. ${1 + expectedExecutingTasksCount}`));
        await Promise.race([awaitCompletionOfAllTasks, resolveFast()]); // Trigger the event-loop.

        --expectedExecutingTasksCount;
        ++expectedUncaughtErrorsCount;
        expect(manager.currentlyExecutingTasksCount).toBe(expectedExecutingTasksCount);
        expect(manager.uncaughtErrorsCount).toBe(expectedUncaughtErrorsCount);

        if (taskRejectCallbacks.length === 0) {
          break;
        }

        expect(didAllTasksComplete).toBe(false);
      }

      await awaitCompletionOfAllTasks;
      expect(didAllTasksComplete).toBe(true);

      expect(manager.currentlyExecutingTasksCount).toBe(0);
      expect(manager.pendingTasksCount).toBe(0);
      expect(manager.uncaughtErrorsCount).toBe(rejectingTasksCount);
      const uncaughtErrors = manager.extractUncaughtErrors();
      expect(uncaughtErrors.length).toBe(rejectingTasksCount);
      expect(setTimeoutSpy).toHaveBeenCalledTimes(totalTasksCount);
    });

    test('abortAllPendingTasks should cancel all pending tasks', async () => {
      const totalTasksCount = 53;
      const delayMs = 36 * 1000;
      const getIthKey = (ithTask: number) => `MOCK_KEY_${ithTask}`;
      const manager = new DelayedAsyncTasksManager();

      for (let ithTask = 1; ithTask <= totalTasksCount; ++ithTask) {
        manager.addTask(
          getIthKey(ithTask),
          () => Promise.resolve(),
          delayMs
        );
        expect(setTimeoutSpy).toHaveBeenCalledTimes(ithTask);
        expect(manager.currentlyExecutingTasksCount).toBe(0);
      }

      expect(manager.pendingTasksCount).toBe(totalTasksCount);
      manager.abortAllPendingTasks();
      expect(manager.pendingTasksCount).toBe(0);
      expect(manager.currentlyExecutingTasksCount).toBe(0);
      expect(manager.uncaughtErrorsCount).toBe(0);
      expect(setTimeoutSpy).toHaveBeenCalledTimes(totalTasksCount);
    });

    test(
      'awaitTaskCompletion should resolve only when the task completes: ' +
      'mixed scenario with both fulfilled and rejected tasks', async () => {
        const successfulTaskKey = "SUCCESSFUL_TASK_KEY";
        const successfulTaskDelay = 4000;
        let successfulTaskResolveCallback: PromiseResolveCallbackType;

        const rejectingTaskKey = "REJECTING_TASK_KEY";
        const rejectingTaskDelay = successfulTaskDelay + 2345;
        let rejectingTaskRejectCallback: PromiseRejectCallbackType;
  
        const manager = new DelayedAsyncTasksManager();

        manager.addTask(
          successfulTaskKey,
          () => new Promise(res => successfulTaskResolveCallback = res),
          successfulTaskDelay
        );
        expect(setTimeoutSpy).toHaveBeenCalledTimes(1);

        manager.addTask(
          rejectingTaskKey,
          () => new Promise((_, rej) => rejectingTaskRejectCallback = rej),
          rejectingTaskDelay
        );
        expect(setTimeoutSpy).toHaveBeenCalledTimes(2);
  
        // Advance the system timer, triggering the execution of the successful task.
        await jest.advanceTimersByTimeAsync(successfulTaskDelay);

        // Verify the precise resolve time of `awaitTaskCompletion` when the task completes successfully.
        expect(manager.isExecuting(successfulTaskKey)).toBe(true);
        let isSuccessfulTaskCompleted = false;
        const awaitSuccessfulTaskCompletionPromise: Promise<void> = (async () => {
          isSuccessfulTaskCompleted = await manager.awaitTaskCompletion(successfulTaskKey);
        })();
        await Promise.race([awaitSuccessfulTaskCompletionPromise, resolveFast()]);
        expect(isSuccessfulTaskCompleted).toBe(false);
        successfulTaskResolveCallback(); // Trigger completion.
        await awaitSuccessfulTaskCompletionPromise;
        expect(isSuccessfulTaskCompleted).toBe(true);

        // Advance the system timer, triggering the execution of the rejecting task.
        await jest.advanceTimersByTimeAsync(rejectingTaskDelay - successfulTaskDelay);

        // Verify the precise resolve time of `awaitTaskCompletion` when the task fails 
        // (rejects, i.e., throws an error).
        expect(manager.isExecuting(rejectingTaskKey)).toBe(true);
        let isRejectingTaskCompleted = false;
        const awaitRejectingTaskCompletionPromise: Promise<void> = (async () => {
          isRejectingTaskCompleted = await manager.awaitTaskCompletion(rejectingTaskKey);
        })();
        await Promise.race([awaitRejectingTaskCompletionPromise, resolveFast()]);
        expect(isRejectingTaskCompleted).toBe(false);
        rejectingTaskRejectCallback(); // Trigger completion.
        await awaitRejectingTaskCompletionPromise;
        expect(isRejectingTaskCompleted).toBe(true);

        expect(manager.currentlyExecutingTasksCount).toBe(0);
    });
  });
  
  describe('Negative path tests', () => {
    test('should throw an error when the scheduled task corresponds to a currently managed key', async () => {
      const existingKey = 'MOCK_KEY';
      const delayMs = 36 * 1000;
      const manager = new DelayedAsyncTasksManager();

      manager.addTask(existingKey, () => Promise.resolve(), delayMs);
      expect(setTimeoutSpy).toHaveBeenCalledTimes(1);

      expect(
        () => manager.addTask(existingKey, () => Promise.resolve(), delayMs)
      ).toThrow();
      expect(manager.tryAbortPendingTask(existingKey)).toBe(true);
      expect(setTimeoutSpy).toHaveBeenCalledTimes(1);
    });

    test('should capture uncaught exceptions thrown during task execution', async () => {
      const totalTasksCount = 56; // All tasks will reject.
      const delayMs = 14 * 1000; // All tasks will have the same execution delay.

      const manager = new DelayedAsyncTasksManager<CustomTaskError>();
      const expectedUncaughtErrorsInOrder: CustomTaskError[] = [];
      const createTaskError = (ithTask: number): CustomTaskError => ({
        message: `Mock error message no. ${ithTask}`,
        taskID: ithTask
      });

      for (let ithTask = 1; ithTask <= totalTasksCount; ++ithTask) {
        const key = ithTask;

        const task: DelayedTask = () => Promise.reject(
          createTaskError(ithTask)
        );
        expectedUncaughtErrorsInOrder.push(createTaskError(ithTask));

        manager.addTask(key, task, delayMs);
        expect(setTimeoutSpy).toHaveBeenCalledTimes(ithTask);
        expect(await manager.awaitTaskCompletion(key)).toBe(false); // Does not wait if the task is pending.
      }

      // Advance the system clock to trigger the execution of all tasks.
      await jest.advanceTimersToNextTimerAsync(totalTasksCount);

      await manager.awaitCompletionOfAllCurrentlyExecutingTasks();
      expect(manager.uncaughtErrorsCount).toBe(totalTasksCount);
      expect(manager.extractUncaughtErrors()).toEqual(expectedUncaughtErrorsInOrder);
      expect(manager.currentlyExecutingTasksCount).toBe(0);
    });
  });
});
