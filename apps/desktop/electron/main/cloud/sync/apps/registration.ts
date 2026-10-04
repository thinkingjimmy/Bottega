/**
 * [INPUT]: Depends on trusted main-frame IPC and closed conversion schemas.
 * [OUTPUT]: Registers bounded conversion review and reviewed keep-original actions.
 * [POS]: Cloud conversion boundary; App windows and child frames cannot manage Chat conversion.
 */
import { z } from "zod";
import { rendererIpc } from "../../../registration/ipc-registrar";
import { CONVERSION_CHANNEL, conversionRequestSchema, conversionReviewSchema, projectPromotionReviewSchema, projectRescueRequestSchema, projectRescueReviewSchema, keepOriginalSchema } from "../../../../../shared/cloud/conversion/model";
import { replying } from "../../replies";
import type { CloudConversionReview } from "./review";
export function registerCloudConversion(service: CloudConversionReview, rendererUrl: string) {
  const ipc = rendererIpc(rendererUrl, "Conversion access denied").roles("main");
  ipc.handle(CONVERSION_CHANNEL.rescueReview, replying(projectRescueReviewSchema.nullable(), (...args) => service.rescueReview(z.tuple([projectRescueRequestSchema]).parse(args)[0])));
  ipc.handle(CONVERSION_CHANNEL.keepRescueOriginal, (...args) => service.keepRescueOriginal(z.tuple([keepOriginalSchema]).parse(args)[0]));
  ipc.handle(CONVERSION_CHANNEL.projectReview, replying(projectPromotionReviewSchema.nullable(), (...args) => service.projectReview(z.tuple([conversionRequestSchema]).parse(args)[0])));
  ipc.handle(CONVERSION_CHANNEL.keepProjectOriginal, (...args) => service.keepProjectOriginal(z.tuple([keepOriginalSchema]).parse(args)[0]));
  ipc.handle(CONVERSION_CHANNEL.review, replying(conversionReviewSchema.nullable(), (...args) => service.review(z.tuple([conversionRequestSchema]).parse(args)[0])));
  ipc.handle(CONVERSION_CHANNEL.keepOriginal, (...args) => service.keepOriginal(z.tuple([keepOriginalSchema]).parse(args)[0]));
}
