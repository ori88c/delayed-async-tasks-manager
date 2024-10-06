<h2 align="middle">Delayed Async Tasks Manager</h2>

The `DelayedAsyncTasksManager` class offers a scheduler for **one-time** (non-periodic) asynchronous tasks, designed to manage the delayed execution of multiple tasks. Each task is uniquely identified by a user-defined key, preventing redundant scheduling and ensuring efficient task management.

It controls the complete lifecycle of tasks and their promises by:
* Capturing uncaught errors to prevent them from propagating to the event loop. Uncaught errors are easily accessible via the method `extractUncaughtError`.
* Communicating the current execution state through designated methods, such as `isPending`, `isExecuting`, etc.
* Supporting **deterministic and graceful termination** by awaiting the completion of a specific task or all currently executing tasks.

This class is particularly well-suited for scenarios that demand precise control over the execution and termination of asynchronous tasks. It is an extension of the [delayed-async-task](https://www.npmjs.com/package/delayed-async-task) package, offering broader capabilities for managing multiple tasks.

## Table of Contents

* [Key Features](#key-features)
* [API](#api)
* [Execution Status Getters](#execution-status-getters)
* [Use Case Example: Security Incident Response System](#use-case-example)
* [Design Decision: Task Manager per Use Case](#design-decision)
* [Graceful and Deterministic Termination](#graceful-termination)
* [Non-Persistent Scheduling](#non-persistent-scheduling)
* [Error Handling](#error-handling)
* [License](#license)

## Key Features :sparkles:<a id="key-features"></a>

* __Modern Substitute for Javascript's 'setTimeout'__: Specifically designed for scheduling asynchronous tasks, i.e., callbacks that return a Promise.
* __Execution Status Getters__: Allows users to check the task's execution status, helping to prevent potential race conditions.
* __Graceful and Deterministic Termination__: The `awaitCompletionOfAllCurrentlyExecutingTasks` method resolves once all the currently executing tasks complete, or resolves immediately if the task is not executing. The `awaitTaskCompletion` method allows you to wait for the completion of a specific task, uniquely identified by its key.
* __Robust Error Handling__: If a task throws an uncaught error, the error is captured and accessible via the `extractUncaughtErrors` method.
* __Comprehensive Documentation :books:__: The class is thoroughly documented, enabling IDEs to provide helpful tooltips that enhance the coding experience.
- __Metrics :bar_chart:__: The class offers various metrics through getter methods, providing insights into the scheduler's current state.
* __Fully Tested :test_tube:__: Extensively covered by unit tests.
* __No External Runtime Dependencies__: This component provides a lightweight, dependency-free solution. Only development dependencies are used, for testing purpose.
* Non-Durable Scheduling: Scheduling stops if the application crashes or goes down.
* ES2020 Compatibility.
* TypeScript support.

## API :globe_with_meridians:<a id="api"></a>

The `DelayedAsyncTasksManager` class provides the following methods:

* __addTask__: Schedules a new one-time delayed task, uniquely identified by the provided key. This method throws an Error if a task is already pending or executing under the given key.
* __isPending__: Indicates whether the task identified by the given key is currently managed by this instance and has not yet started execution.
* __isExecuting__: Indicates whether the task identified by the given key is being executed by this instance, i.e., the task is neither pending nor completed.
* __isManaged__: Indicates whether the task identified by the given key is being managed by this instance, i.e., the task is *either* pending or executing.
* __tryAbortPendingTask__: Attempts to abort a pending task. The abort will succeed only if the task is currently managed by the instance and is in a pending state (i.e., it has not yet started execution).
* __awaitTaskCompletion__: Resolves once the specified task has completed execution, either by resolving or rejecting. If no currently managed task is associated with the provided key, the method resolves immediately.
* __abortAllPendingTasks__: Aborts all tasks currently in a pending state (i.e., tasks that have not yet started execution) managed by this instance.
* __awaitCompletionOfAllCurrentlyExecutingTasks__: Resolves once all *currently* executing tasks have completed. If no tasks are in progress, it resolves immediately. Note: This method only waits for tasks that are already in execution at the time of the call. Pending tasks will not be awaited.
* __extractUncaughtErrors__: Returns an array of uncaught errors, captured by this instance while executing delayed tasks. The instance will no longer hold these error references once extracted. In other words, ownership of these uncaught errors shifts to the caller, while the `DelayedAsyncTasksManager` instance clears its list of uncaught errors.

If needed, refer to the code documentation for a more comprehensive description of each method.

## Execution Status Getters :mag:<a id="execution-status-getters"></a>

The `DelayedAsyncTasksManager` class provides the following getter methods to reflect the current manager's state:

* __pendingTasksCount__: The number of tasks in a pending state. i.e., managed tasks which did not start their execution yet.
* __currentlyExecutingTasksCount__: The number of tasks managed by this instance that are currently executing, i.e., tasks that are neither pending nor completed.
* __uncaughtErrorsCount__: The number of uncaught task errors, that are currently stored by the instance. These errors have not yet been extracted using `extractUncaughtErrors`. Knowing the number of uncaught errors allows users to decide whether to process them immediately or wait for further accumulation.

To eliminate any ambiguity, all getter methods have **O(1)** time and space complexity, meaning they do **not** iterate through all currently managed tasks with each call. The metrics are maintained by the tasks themselves.

## Use Case Example: Security Incident Response System :man_technologist:<a id="use-case-example"></a>

Consider a Security Incident Response System, that schedules delayed actions such as disabling compromised user accounts, revoking access tokens, or blocking suspicious IP addresses. Each task is associated with a unique key (e.g., user ID, token ID), enabling security teams to **delay and manage responses** based on evolving threat intelligence. Tasks can be **canceled or adjusted** if the threat is mitigated before the action is triggered.

In real-world scenarios, responses to security incidents are often immediate to minimize damage. However, delayed tasks could be applicable in cases where actions aren't taken immediately to gather more context or prevent premature actions based on incomplete information. For example, the delay could be used to notify administrators or confirm suspicious behavior before taking disruptive measures, like blocking access or disabling accounts.

Please note that this example is overly simplified. Real-world usage examples can be more complex, often involving persistency and synchronization with external resources.

```ts
import {
  DelayedAsyncTasksManager,
  DelayedTask
} from 'delayed-async-tasks-manager';

class IncidentResponseSystem {
  private readonly _taskManager = new DelayedAsyncTasksManager();
  
  // Report an incident and schedule a delayed response.
  public reportIncident(userId: string, delayMs: number): void {
    const task: DelayedTask = () => this.disableAccount(userId);
    this._taskManager.addTask(userId, task, delayMs);
    console.info(`Scheduled disabling account for user ${userId} in ${delayMs} ms`);
  }

  // Try to mitigate the incident (abort the task if not yet executed).
  public async mitigateIncident(userId: string): Promise<void> {
    const success = this._taskManager.tryAbortPendingTask(userId);
    if (success) {
      console.info(`Successfully aborted the task to disable the account for user ${userId}`);
      return;
    }

    console.info(
      `Failed to abort the task to disable the account task for ` +
      `user ${userId}; it has already been executed`
    );
    // Graceful Termination:
    // To prevent potential race conditions, we wait for the account disable
    // operation to complete (if it is currently executing) before re-enabling the account.
    await this._taskManager.awaitTaskCompletion(userId);
    await this._enableAccount(userId);
  }

  // Gracefully abort all pending tasks and wait for the completion of 
  // all currently executing tasks.
  public async shutdown(): Promise<void> {
    this._taskManager.abortAllPendingTasks();
    await this._taskManager.awaitCompletionOfAllCurrentlyExecutingTasks();
  }

  // Simulate account disabling.
  private async _disableAccount(userId: string): Promise<void> {
    // Business logic.
    console.info(`Account for user ${userId} has been disabled`);
  }

  // Simulate account enabling.
  private async _enableAccount(userId: string): Promise<void> {
    // Business logic.
    console.info(`Account for user ${userId} has been enabled`);
  }
}
```

## Design Decision: Task Manager per Use Case<a id="design-decision"></a>

Separating code into small, single-responsibility building blocks improves testability and readability. While it may seem simpler to use a single scheduler as a 'single source of truth' for all task types, this approach can lead to increased complexity as the application scales.

For instance, the *Incident Response System* code example above could benefit from employing two task managers instead of one:
* Enable Account Manager
* Disable Account Manager

One benefit is the ability to gather operation-specific metrics, such as periodically sampling the number of pending Disable Account actions through the `pendingTasksCount` getter.

## Graceful and Deterministic Termination :hourglass:<a id="graceful-termination"></a>

In the context of asynchronous tasks and schedulers, graceful and deterministic termination is **often overlooked**. `DelayedAsyncTasksManager` provides an out-of-the-box mechanism to await the completion of an asynchronous task that has already started but has not yet finished, using either the `awaitTaskCompletion` or `awaitCompletionOfAllCurrentlyExecutingTasks` method.

Without deterministic termination, leftover references from incomplete executions can cause issues such as unexpected behavior during unit tests. A clean state is essential for each test, as ongoing tasks from a previous test can interfere with subsequent ones.

This feature is crucial whenever your component has a `stop`, `terminate`, `shutdown` or `dispose` method. Consider the following example:
```ts
const TASK_A_DELAY_MS = 8000;
const TASK_B_DELAY_MS = 12 * 1000;

class Component {
  private _timeoutA: NodeJS.Timeout;
  private _timeoutB: NodeJS.Timeout;

  public start(): void {
    this._timeoutA = setTimeout(this._prolongedTaskA.bind(this), TASK_A_DELAY_MS);
    this._timeoutB = setTimeout(this._prolongedTaskB.bind(this), TASK_B_DELAY_MS);
  }

  /**
   * Ideally, the `stop` method should resolve only after all tasks initiated by this instance 
   * have been settled.
   */
  public async stop(): Promise<void> {
    if (this._timeoutA) {
      clearTimeout(this._timeoutA);
      this._timeoutA = undefined;
      // The dangling promise of _prolongedTaskA might still be running in the
      // background, leading to non-deterministic termination and potential
      // race conditions or unexpected behavior.
    }

    if (this._timeoutB) {
      // Similar handling with potential unintended side effects.
    }
  }

  private async _prolongedTaskA(): Promise<void> {
    // Task A implementation.
  }

  private async _prolongedTaskB(): Promise<void> {
    // Task B implementation.
  }
}
```

While it is possible to manually address this issue by **avoiding dangling promises** and introducing more state properties, doing so can compromise the **Single Responsibility Principle** of your component. It can also **decrease readability** and likely introduce code duplication, as this need is frequent.  
The above example can be fixed using the `DelayedAsyncTasksManager` class as follows:
```ts
import { DelayedAsyncTasksManager } from 'delayed-async-tasks-manager';

const TASK_A_KEY = "A";
const TASK_B_KEY = "B";

const TASK_A_DELAY_MS = 8000;
const TASK_B_DELAY_MS = 12 * 1000;

class Component {
  private readonly _delayedTasksManager = new DelayedAsyncTasksManager();

  public start(): void {
    this._delayedTasksManager.addTask(
      TASK_A_KEY,
      this._prolongedTaskA.bind(this),
      TASK_A_DELAY_MS
    );

    this._delayedTasksManager.addTask(
      TASK_B_KEY,
      this._prolongedTaskB.bind(this),
      TASK_B_DELAY_MS
    );
  }

  public async stop(): Promise<void> {
    // Abort tasks that have not started execution, i.e., pending tasks.
    _delayedTasksManager.abortAllPendingTasks();

    // Await tasks that are currently running, i.e., cannot be aborted.
    await _delayedTasksManager.awaitCompletionOfAllCurrentlyExecutingTasks();
  }

  private async _prolongedTaskA(): Promise<void> {
    // Task A implementation.
  }

  private async _prolongedTaskB(): Promise<void> {
    // Task B implementation.
  }
}
```

Another scenario where this feature is highly recommended is when a schedule might be aborted, such as in an abort-and-reschedule situation. If the task is currently executing (which can be checked via the `isExecuting` method), it cannot be aborted. In such cases, you can ignore the reschedule request, await the current execution to complete using `awaitTaskCompletion`, or implement any other business logic that suits your requirements.

## Non-Persistent Scheduling<a id="non-persistent-scheduling"></a>

This component features non-durable scheduling, which means that if the application crashes or goes down, scheduling stops.

If you need to guarantee durability over a multi-node deployment, consider other custom-made solutions for that purpose.

## Error Handling :warning:<a id="error-handling"></a>

Unlike `setTimeout` in Node.js, where errors from rejected promises propagate to the event loop and trigger an `uncaughtRejection` event, this package offers robust error handling:

* Any error thrown during a task's execution is captured. All errors currently stored by the instance can be accessed via the `extractUncaughtErrors` method.
* Use the `uncaughtErrorsCount` getter to determine the number of uncaught errors accumulated by the instance since the last call to `extractUncaughtErrors`.

Ideally, a delayed task should handle its own errors and **avoid** throwing uncaught exceptions.

## License :scroll:<a id="license"></a>

[Apache 2.0](LICENSE)
