export interface YulConfig {
  version: string;
  details?: Record<string, unknown> & {
    yulDetails?: {
      optimizerSteps?: string;
    };
  };
  yulDetails?: {
    optimizerSteps?: string;
  };
}
