/**
 * tRPC wiring. Pass the host's own `router` and `protectedProcedure` (server/_core/trpc) so authentication stays NEXUS's.
 *   reports: router({ ...createReportCardProcedures({ router, protectedProcedure }) })  // or mount as `reportCards`
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { buildReportBatch, getReportOptions, ReportError, saveReportCardComments } from "./reportCardService";
import { REPORT_ERRORS } from "../shared/reportCard";

const input = z.object({
  academicYear: z.number().int().min(2000).max(2100),
  term: z.string().min(1).max(40),
  assessmentType: z.enum(["mid_term", "end_term"]),
  includeFees: z.boolean(),
  target: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("learner"), learnerId: z.number().int().positive() }),
    z.object({ kind: z.literal("class"), gradeId: z.number().int().positive() }),
    z.object({ kind: z.literal("grade"), gradeName: z.string().min(1).max(80) }),
  ]),
});
const commentInput = z.object({
  learnerId: z.number().int().positive(), academicYear: z.number().int().min(2000).max(2100),
  term: z.string().min(1).max(40), assessmentType: z.enum(["mid_term", "end_term"]).default("end_term"),
  classTeacherComment: z.string().max(1000).nullable().optional(), headTeacherComment: z.string().max(1000).nullable().optional(),
});

const toTrpc = (e: unknown): never => {
  if (e instanceof ReportError) {
    const code = e.code === "REPORT_PERMISSION_DENIED" || e.code === "REPORT_SCOPE_FORBIDDEN" || e.code === "COMMENT_PERMISSION_DENIED"
      ? "FORBIDDEN" : e.code === "SCHOOL_SETTINGS_NOT_CONFIGURED" ? "PRECONDITION_FAILED" : "NOT_FOUND";
    throw new TRPCError({ code, message: REPORT_ERRORS[e.code], cause: e });
  }
  throw e;
};

export function createReportCardProcedures(t: { router: any; protectedProcedure: any }) {
  return {
    options: t.protectedProcedure.query(({ ctx }: any) => getReportOptions(ctx.user.id).catch(toTrpc)),
    generate: t.protectedProcedure.input(input).query(({ input: i, ctx }: any) => buildReportBatch(i, ctx.user.id).catch(toTrpc)),
    saveReportCardComments: t.protectedProcedure.input(commentInput).mutation(({ input: i, ctx }: any) => saveReportCardComments(i, ctx.user.id).catch(toTrpc)),
  };
}
