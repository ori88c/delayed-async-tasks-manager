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

export type DelayedTask = () => Promise<void>;
export type TaskUniqueKey = string | number;

interface IExecutionInfo {
    timer: undefined | ReturnType<typeof setTimeout>;
    executionPromise: undefined | Promise<void>;
}

/**
 * DelayedAsyncTasksManager
 * 
 * A one-time scheduler for asynchronous tasks, designed to manage delayed executions
 * of multiple tasks. Each task is identified by a unique user-defined key, preventing
 * redundant scheduling.
 * 
 * ### Key Features
 * - Status getters to track the task’s execution state.
 * - Ability to abort a specific pending task (by key) or all pending tasks.
 * - Gracefully await the completion of a specific or all ongoing tasks.
 * - Captures uncaught errors, accessible via the `extractUncaughtErrors` method.
 * - Fully covered by unit tests.
 * - No runtime dependencies; only dev-dependencies for testing.
 * - TypeScript support, targeting ES2020.
 * 
 * ### Motivation
 * The built-in `setTimeout` function lacks proper handling of asynchronous tasks (Promises), 
 * particularly for tracking their execution status (pending, executing, fulfilled or rejected).
 * Additionally, `setTimeout` does not offer an out-of-the-box mechanism to await the completion
 * of an asynchronous task that has already started.
 * Graceful termination is often required to ensure a clean state, such as between unit tests where
 * we want to avoid any tasks from previous tests running in the background.
 * The `DelayedAsyncTasksManager` class addresses these gaps by managing the lifecycle of tasks and
 * their promises. It stores uncaught errors, preventing them from bubbling to the event loop, thus
 * enabling more robust asynchronous task scheduling for complex scenarios.
 */
export class DelayedAsyncTasksManager<UncaughtErrorType = Error> {
    private readonly _keyToExecutionInfo = new Map<TaskUniqueKey, IExecutionInfo>();

    private _uncaughtErrors: UncaughtErrorType[] = [];
    private _pendingTasksCount = 0;
    private _currentlyExecutingTasksCount = 0;

    /**
     * pendingTasksCount
     * 
     * 
     * @returns The number of tasks in a pending state. i.e., managed tasks which
     *          did not start their execution yet.
     */
    public get pendingTasksCount(): number {
        return this._pendingTasksCount;
    }

    /**
     * currentlyExecutingTasksCount
     * 
     * 
     * @returns The number of tasks managed by this instance that are currently
     *          executing, i.e., tasks that are neither pending nor completed.
     */
    public get currentlyExecutingTasksCount(): number {
        return this._currentlyExecutingTasksCount;
    }

    /**
     * uncaughtErrorsCount
     * 
     * Indicates the number of uncaught task errors, that are currently stored by the instance.
     * These errors have not yet been extracted using `extractUncaughtErrors`.
     * 
     * Knowing the number of uncaught errors allows users to decide whether to process them
     * immediately or wait for further accumulation.
     * 
     * @returns The number of uncaught task errors stored by this instance.
     */	
    public get uncaughtErrorsCount(): number {
        return this._uncaughtErrors.length;
    }

    /**
     * isPending
     * 
     * Indicates whether the task identified by the given key is currently managed
     * by this instance and has not yet started execution.
     * 
     * @param key The unique key identifying the task.
     * @returns `true` if the task associated with the given key is in a pending state;
     *          otherwise, `false`.
     */
    public isPending(uniqueKey: TaskUniqueKey): boolean {
        const executionInfo = this._keyToExecutionInfo.get(uniqueKey);
        return executionInfo?.timer !== undefined;
    }

    /**
     * isExecuting
     * 
     * Indicates whether the task identified by the given key is being executed
     * by this instance, i.e., the task is neither pending nor completed.
     * 
     * @param key The unique key identifying the task.
     * @returns `true` if the task associated with the given key is currently executing;
     *          otherwise, `false`.
     */
    public isExecuting(uniqueKey: TaskUniqueKey): boolean {
        const executionInfo = this._keyToExecutionInfo.get(uniqueKey);
        return executionInfo?.executionPromise !== undefined;
    }

    /**
     * isManaged
     * 
     * Indicates whether the task identified by the given key is being managed
     * by this instance, i.e., the task is *either* pending or executing.
     * 
     * @param key The unique key identifying the task.
     * @returns `true` if the task associated with the given key is being managed
     *          by this instance; otherwise, `false`.
     */
    public isManaged(uniqueKey: TaskUniqueKey): boolean {
        return this._keyToExecutionInfo.get(uniqueKey) !== undefined;
    }

    /**
     * addTask
     * 
     * Schedules a new one-time delayed task, uniquely identified by the provided key. 
     * The unique key prevents redundant tasks from being scheduled. For instance, when scheduling 
     * an aggregation task for a user, it's often unnecessary to schedule multiple future tasks 
     * for the same user. In such cases, a suitable unique key could be the user ID.
     * 
     * This method throws an Error if a task is already pending or executing under the given key.
     * To avoid this, the `isManaged` method can be called beforehand to check the task's status.
     * 
     * @param uniqueKey A unique identifier for the task. No other task can use this key until the 
     *                  current task is either aborted or completed.
     * @param task The task to be executed after the delay.
     * @param delayMs The delay in milliseconds before the task is executed.
     * @throws If a task with the given key is already pending or executing.
     */
    public addTask(uniqueKey: TaskUniqueKey, task: DelayedTask, delayMs: number): void {
        let executionInfo = this._keyToExecutionInfo.get(uniqueKey);
        if (executionInfo) {
            const isPending = executionInfo.timer !== undefined;
            throw new Error(
                `DelayedAsyncTasksManager cannot schedule key ${uniqueKey} as there is a ` +
                `${isPending ? "pending" : "currently executing"} task associated with that key`
            );
        }

        ++this._pendingTasksCount;
        executionInfo = { timer: undefined, executionPromise: undefined };
        const executeAndUpdateInternalState = async (): Promise<void> => {
            try {
                await task();
            } catch (err) {
                this._uncaughtErrors.push(err);
            } finally {
                this._keyToExecutionInfo.delete(uniqueKey);
                --this._currentlyExecutingTasksCount;
            }
        }

        executionInfo.timer = setTimeout(
            () => {
                --this._pendingTasksCount;
                ++this._currentlyExecutingTasksCount;
                executionInfo.timer = undefined; // Cannot abort from now.
                executionInfo.executionPromise = executeAndUpdateInternalState();
            },
            delayMs
        );

        this._keyToExecutionInfo.set(uniqueKey, executionInfo);
    }

    /**
     * tryAbortPendingTask
     * 
     * Attempts to abort a pending task.
     * 
     * This method tries to abort a task identified by the provided unique key.
     * The abort will succeed only if the task is currently managed by the instance
     * and is in a pending state (i.e., it has not yet started execution).
     * 
     * @param uniqueKey - A unique identifier for the task.
     * @returns `true` if the task was successfully aborted; otherwise, `false`.
     */
    public tryAbortPendingTask(uniqueKey: TaskUniqueKey): boolean {
        const executionInfo = this._keyToExecutionInfo.get(uniqueKey);
        if (!executionInfo) {
            // Either never scheduled, or already completed.
            return false;
        }

        const { timer } = executionInfo;
        if (!timer) {
            // Task has already began execution, cannot be aborted.
            return false;
        }

        clearTimeout(timer);
        executionInfo.timer = undefined;
        this._keyToExecutionInfo.delete(uniqueKey);
        --this._pendingTasksCount;
        return true;
    }

    /**
     * awaitTaskCompletion
     * 
     * Resolves once the specified task has completed execution, either by resolving or rejecting.
     * If no currently managed task is associated with the provided key, the method resolves immediately 
     * and returns `false`.
     * 
     * Note that even if the associated task rejects, this method will not throw an error. Any thrown 
     * errors can be extracted using `extractUncaughtErrors`.
     * 
     * @param uniqueKey - A unique identifier for the task.
     * @returns `true` if the task was executing during the call; otherwise, `false`.
     */
    public async awaitTaskCompletion(uniqueKey: TaskUniqueKey): Promise<boolean> {
        const executionInfo = this._keyToExecutionInfo.get(uniqueKey);
        if (!executionInfo) {
            // Either never scheduled, or already completed.
            return false;
        }

        const { executionPromise } = executionInfo;
        if (!executionPromise) {
            // Task has not started execution yet; it is in a pending state.
            return false;
        }

        await executionPromise;
        return true;
    }

    /**
     * abortAllPendingTasks
     * 
     * Aborts all tasks currently in a pending state (i.e., tasks that have not yet 
     * started execution) managed by this instance.
     */
    public abortAllPendingTasks(): void {
        const abortedKeys: TaskUniqueKey[] = []; // To avoid deletion during iteration, as it may corrupt the iterator.

        for (const [key, info] of this._keyToExecutionInfo) {
            const { timer } = info;
            if (!timer) {
                continue;
            }

            clearTimeout(timer);
            info.timer = undefined;
            abortedKeys.push(key);
        }

        this._pendingTasksCount -= abortedKeys.length;
        for (const key of abortedKeys) {
            this._keyToExecutionInfo.delete(key);
        }
    }

    /**
     * awaitCompletionOfAllCurrentlyExecutingTasks
     * 
     * Resolves once all *currently* executing tasks have completed. If no tasks are in progress,
     * it resolves immediately.
     * Note: This method only waits for tasks that are already in execution at the time of the call.
     * Pending tasks will not be awaited.
     * 
     * ### Graceful Termination
     * Graceful termination is important to ensure a clean state, particularly in scenarios like
     * unit test validation, where background executions may interfere with tests.
     * Consider IoT device updates as an example:
     * Before pushing a firmware update to an IoT device, it's crucial to ensure that no critical tasks 
     * (e.g., sensor data collection) are being executed, to avoid leaving the device in an unstable state.
     * 
     * @returns A promise that resolves once all currently executing tasks have completed, if any exist.
     */
    public async awaitCompletionOfAllCurrentlyExecutingTasks(): Promise<void> {
        const executingTasks: Promise<void>[] = [];
        
        for (const [_, info] of this._keyToExecutionInfo) {
            const { executionPromise } = info;
            if (executionPromise) {
                executingTasks.push(executionPromise);
            }
        }

        // Note: no need for Promise.allStteled as our wrapper never rejects.
        await Promise.all(executingTasks);
    }

    /**
     * extractUncaughtErrors
     * 
     * Returns an array of uncaught errors, captured by this instance while executing delayed tasks.
     * The term `extract` implies that the instance will no longer hold these error references once
     * extracted, unlike `get`. In other words, ownership of these uncaught errors shifts to the caller,
     * while the instance clears its internal list of uncaught errors.
     *
     * Even if the user does not intend to perform error-handling with these uncaught errors, it is 
     * important to periodically call this method to prevent the accumulation of errors in memory.
     * However, there are a few exceptional cases where the user can safely avoid extracting
     * uncaught errors:
     * - The number of tasks is relatively small and the process is short-lived.
     * - The tasks never throw errors, thus no uncaught errors are possible.
     * 
     * @returns An array of uncaught errors from delayed tasks.
     */
    public extractUncaughtErrors(): UncaughtErrorType[] {
        const errors = this._uncaughtErrors;
        this._uncaughtErrors = [];
        return errors;
    }
}
