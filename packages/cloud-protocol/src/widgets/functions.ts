/**
 * [INPUT]: Depends on authenticated immutable-space headers and exact Widget transfer/receipt schemas.
 * [OUTPUT]: Provides the closed Widget prepare/commit/read/retire and paged account catalog function contracts.
 * [POS]: Private delivery registry; no function approves receiver execution, configuration or data access.
 */
import {z} from 'zod';
import {encryptedBusinessHeaderSchema} from '../spaces';
import {widgetPackageSubjectSchema,widgetPackageRefSchema,widgetPackagePlanSchema,widgetPackageDeliverySchema,widgetDefinitionReceiptSchema,widgetPackageResultSchema} from './model';
import {widgetCatalogPageSchema} from './catalog';
const base=encryptedBusinessHeaderSchema.extend({subject:widgetPackageSubjectSchema}).strict();
const requested=base.extend({reference:widgetPackageRefSchema}).strict();
export const widgetPackageFunctions={
 'widgets/api:prepare':{kind:'mutation',args:encryptedBusinessHeaderSchema.extend({plan:widgetPackagePlanSchema}).strict(),result:z.null()},
 'widgets/api:commit':{kind:'mutation',args:requested,result:widgetPackageDeliverySchema},
 'widgets/api:get':{kind:'query',args:requested,result:widgetPackageResultSchema},
 'widgets/api:retire':{kind:'mutation',args:base.extend({operationId:z.string().regex(/^[A-Za-z0-9_-]{8,128}$/)}).strict(),result:widgetDefinitionReceiptSchema},
 'widgets/api:catalog':{kind:'query',args:encryptedBusinessHeaderSchema.extend({cursor:z.string().max(8192).nullable()}).strict(),result:widgetCatalogPageSchema},
 'widgets/api:head':{kind:'query',args:encryptedBusinessHeaderSchema,result:z.object({revision:z.number().int().nonnegative()}).strict()},
}as const;
