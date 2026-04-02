/**
 * Workflow Engine
 *
 * 提供可组合的步骤管道，支持条件执行、错误策略和进度回调。
 * 每个步骤是一个普通的 async 函数，通过共享 context 传递数据。
 */

// ============ 类型定义 ============

export interface WorkflowStep<TCtx = any> {
  /** Human-readable step name */
  name: string;
  /** The async function to execute */
  execute: (ctx: TCtx) => Promise<any>;
  /** Error strategy: 'fail' (default) stops the workflow, 'retry' retries, 'skip' continues */
  onError?: 'fail' | 'retry' | 'skip';
  /** Number of retry attempts (only when onError='retry'). Default 1. */
  retries?: number;
  /** Delay between retries in ms. Default 1000. */
  retryDelay?: number;
  /** Condition: step is skipped if this returns false */
  condition?: (ctx: TCtx) => boolean;
  /** Key under which the step output is stored in context. Defaults to step name. */
  outputKey?: string;
}

export interface WorkflowOptions {
  /** Workflow name for identification */
  name: string;
  /** Steps to execute in order */
  steps: WorkflowStep[];
  /** Called after each step completes */
  onStepComplete?: (stepName: string, result: any, ctx: any) => void;
  /** Called when a step fails (before error strategy is applied) */
  onStepError?: (stepName: string, error: Error, ctx: any) => void;
}

export interface StepResult {
  name: string;
  status: 'completed' | 'skipped' | 'failed' | 'retried';
  output?: any;
  error?: string;
  durationMs: number;
}

export interface WorkflowResult<T = Record<string, any>> {
  success: boolean;
  /** The final context after all steps */
  context: T;
  /** Per-step results */
  steps: StepResult[];
  totalDurationMs: number;
}

export interface Workflow {
  name: string;
  execute<T extends Record<string, any>>(initialContext: T): Promise<WorkflowResult<T>>;
}

// ============ 实现 ============

/**
 * 创建一个可执行的工作流
 *
 * @example
 * ```ts
 * const workflow = createWorkflow({
 *   name: 'save-paper',
 *   steps: [
 *     {
 *       name: 'fetch',
 *       execute: async (ctx) => addById(ctx.doi),
 *       onError: 'retry',
 *       retries: 2,
 *     },
 *     {
 *       name: 'tag',
 *       execute: async (ctx) => updateItem(ctx.fetch.key, { tags: [{ tag: 'new' }] }),
 *     },
 *     {
 *       name: 'sync',
 *       execute: async (ctx) => sync(),
 *       condition: (ctx) => ctx.autoSync !== false,
 *     },
 *   ],
 * });
 *
 * const result = await workflow.execute({ doi: '10.1038/nature23477', autoSync: true });
 * ```
 */
export function createWorkflow(options: WorkflowOptions): Workflow {
  return {
    name: options.name,

    async execute<T extends Record<string, any>>(
      initialContext: T,
    ): Promise<WorkflowResult<T>> {
      const startTime = Date.now();
      const ctx = { ...initialContext } as any;
      const stepResults: StepResult[] = [];
      let success = true;

      for (const step of options.steps) {
        const stepStart = Date.now();
        const outputKey = step.outputKey ?? step.name;

        // Check condition
        if (step.condition && !step.condition(ctx)) {
          stepResults.push({
            name: step.name,
            status: 'skipped',
            durationMs: Date.now() - stepStart,
          });
          continue;
        }

        // Execute with error strategy
        const maxAttempts = step.onError === 'retry' ? (step.retries ?? 1) + 1 : 1;
        const retryDelay = step.retryDelay ?? 1000;
        let lastError: Error | null = null;
        let output: any;
        let stepStatus: StepResult['status'] = 'completed';

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
          try {
            output = await step.execute(ctx);
            ctx[outputKey] = output;
            ctx.lastOutput = output;

            if (attempt > 1) stepStatus = 'retried';
            lastError = null;
            break;
          } catch (err) {
            lastError = err instanceof Error ? err : new Error(String(err));

            if (options.onStepError) {
              options.onStepError(step.name, lastError, ctx);
            }

            // Retry if not the last attempt
            if (attempt < maxAttempts) {
              await sleep(retryDelay);
              continue;
            }
          }
        }

        if (lastError) {
          // All attempts failed — apply error strategy
          const strategy = step.onError ?? 'fail';

          if (strategy === 'skip') {
            stepResults.push({
              name: step.name,
              status: 'skipped',
              error: lastError.message,
              durationMs: Date.now() - stepStart,
            });
            continue;
          }

          // 'fail' or exhausted retries
          stepResults.push({
            name: step.name,
            status: 'failed',
            error: lastError.message,
            durationMs: Date.now() - stepStart,
          });
          success = false;
          break;
        } else {
          stepResults.push({
            name: step.name,
            status: stepStatus,
            output,
            durationMs: Date.now() - stepStart,
          });

          if (options.onStepComplete) {
            options.onStepComplete(step.name, output, ctx);
          }
        }
      }

      return {
        success,
        context: ctx as T,
        steps: stepResults,
        totalDurationMs: Date.now() - startTime,
      };
    },
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
