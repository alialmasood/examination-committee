"use client";

import type { Dispatch, SetStateAction } from "react";
import type { OMRPageResult, ProcessResponse } from "../_types";
import { DebugPanel } from "./DebugPanel";
import { ProcessingSummaryCard } from "./ProcessingSummaryCard";
import { ResultsTable } from "./ResultsTable";
import { SuspiciousResultsPanel } from "./SuspiciousResultsPanel";

export type OmrProcessedResultsSectionProps = {
  data: ProcessResponse | null;
  openDebugPage: number | null;
  setOpenDebugPage: Dispatch<SetStateAction<number | null>>;
};

function resolveOmrResults(data: ProcessResponse | null): OMRPageResult[] | null {
  if (!data?.success || !data.results || data.results.length === 0) return null;
  return data.results;
}

export function OmrProcessedResultsSection({
  data,
  openDebugPage,
  setOpenDebugPage,
}: OmrProcessedResultsSectionProps) {
  const omrResults = resolveOmrResults(data);
  if (omrResults === null || !data) return null;

  const showDebugPanel =
    openDebugPage != null && omrResults.some((r) => r.pageIndex === openDebugPage);

  return (
    <>
      <ProcessingSummaryCard
        exam={data.exam}
        results={omrResults}
        totalPages={data.totalPages}
        successPages={data.successPages}
        failedPages={data.failedPages}
        manualReviewPages={data.manualReviewPages}
      />
      <ResultsTable
        results={omrResults}
        openDebugPage={openDebugPage}
        setOpenDebugPage={setOpenDebugPage}
      />
      {showDebugPanel ? <DebugPanel results={omrResults} openDebugPage={openDebugPage} /> : null}
      <SuspiciousResultsPanel results={omrResults} />
    </>
  );
}
