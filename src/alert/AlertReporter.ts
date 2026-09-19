import type { AlertFaultItem, KeyFamilySummary } from "./SlackWebhookReporter";

export interface AlertReportResult {
  readonly success: boolean;
  readonly status?: number | null;
  readonly error?: string;
}

export interface AlertReporter {
  report(
    destination: string,
    items: readonly AlertFaultItem[],
    familySummaries?: readonly KeyFamilySummary[],
    signal?: AbortSignal,
  ): Promise<AlertReportResult>;
}
