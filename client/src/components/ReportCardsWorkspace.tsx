import { useMemo } from "react";
import { trpc } from "@/lib/trpc";
import ReportCardPage, { type ReportCardClient } from "../../../server/reportCards/client/ReportCardPage";

type ReportProcedures = {
  smis: {
    reports: {
      options: { query: ReportCardClient["options"] };
      generate: { query: ReportCardClient["generate"] };
      saveReportCardComments: { mutate: NonNullable<ReportCardClient["saveComments"]> };
    };
  };
};

export function ReportCardsWorkspace() {
  const utils = trpc.useUtils();
  const commentAccess = trpc.smis.assessments.commentAccess.useQuery();
  const client = useMemo<ReportCardClient>(() => {
    const procedures = utils.client as unknown as ReportProcedures;
    return {
      options: () => procedures.smis.reports.options.query(),
      generate: input => procedures.smis.reports.generate.query(input),
      saveComments: input => procedures.smis.reports.saveReportCardComments.mutate(input),
    };
  }, [utils]);

  return <ReportCardPage client={client} canEditComments={commentAccess.data === true} />;
}
