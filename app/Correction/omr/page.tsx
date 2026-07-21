"use client";

import { useState } from "react";
import { AnswerKeyStatus } from "./_components/AnswerKeyStatus";
import { ExamSelectorCard } from "./_components/ExamSelectorCard";
import { OmrHeader } from "./_components/OmrHeader";
import { OmrProcessedResultsSection } from "./_components/OmrProcessedResultsSection";
import { ReviewQueuePanel } from "./_components/ReviewQueuePanel";
import { UploadPdfCard } from "./_components/UploadPdfCard";
import { useOmrPageData } from "./useOmrPageData";

export default function CorrectionOmrPage() {
  const [openDebugPage, setOpenDebugPage] = useState<number | null>(null);
  const {
    rows,
    loadingRows,
    selectedExamId,
    setSelectedExamId,
    setPdfFile,
    busy,
    error,
    data,
    keyLoading,
    keyInfo,
    keyError,
    queue,
    queueLoading,
    selectedReviewId,
    setSelectedReviewId,
    reviewDetail,
    reviewBusy,
    manualCode,
    setManualCode,
    manualAnswers,
    setManualAnswers,
    debugMode,
    setDebugMode,
    selectedExam,
    keyReady,
    loadReviewDetail,
    processPdf,
    saveReview,
  } = useOmrPageData();

  const showReviewQueue = Boolean(selectedExamId || queue.length > 0);

  return (
    <main dir="rtl" className="min-h-screen bg-slate-100 p-4 sm:p-8">
      <div className="mx-auto max-w-7xl space-y-5">
        <OmrHeader />

        <ExamSelectorCard
          rows={rows}
          loadingRows={loadingRows}
          selectedExamId={selectedExamId}
          setSelectedExamId={setSelectedExamId}
          selectedExam={selectedExam}
        />

        <AnswerKeyStatus
          selectedExam={selectedExam}
          keyLoading={keyLoading}
          keyInfo={keyInfo}
          keyError={keyError}
          selectedExamId={selectedExamId}
        />

        <UploadPdfCard
          setPdfFile={setPdfFile}
          busy={busy}
          keyLoading={keyLoading}
          keyReady={keyReady}
          processPdf={processPdf}
          setDebugMode={setDebugMode}
          debugMode={debugMode}
          error={error}
        />

        <OmrProcessedResultsSection data={data} openDebugPage={openDebugPage} setOpenDebugPage={setOpenDebugPage} />

        {showReviewQueue ? (
          <ReviewQueuePanel
            queue={queue}
            queueLoading={queueLoading}
            selectedReviewId={selectedReviewId}
            setSelectedReviewId={setSelectedReviewId}
            reviewDetail={reviewDetail}
            reviewBusy={reviewBusy}
            manualCode={manualCode}
            setManualCode={setManualCode}
            manualAnswers={manualAnswers}
            setManualAnswers={setManualAnswers}
            loadReviewDetail={loadReviewDetail}
            saveReview={saveReview}
          />
        ) : null}
      </div>
    </main>
  );
}
