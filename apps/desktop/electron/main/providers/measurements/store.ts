/**
 * [INPUT]: Depends on DurableJson and the measured-capability contract.
 * [OUTPUT]: Provides MeasurementStore (`<userData>/provider-measurements.json`): per Provider, the records of its current identity only; replacing a Provider's records drops every older identity (P2).
 * [POS]: providers/measurements' durable truth, written by the service after a probe run and read for role admission and effective guarantees.
 */
import { join } from "node:path";
import { z } from "zod";
import { measuredCapabilitySchema, type MeasuredCapability } from "@ai-chat/cloud-protocol/contracts/provider";
import { DurableJson } from "../../persistence/durable-json";

const fileSchema = z.object({ schemaVersion: z.literal(1), records: z.array(measuredCapabilitySchema).max(128) }).strict();
type MeasurementFile = z.infer<typeof fileSchema>;

export class MeasurementStore {
  private readonly file: DurableJson<MeasurementFile>;
  constructor(userData: string) {
    this.file = new DurableJson(join(userData, "provider-measurements.json"), fileSchema, () => ({ schemaVersion: 1, records: [] }));
  }
  initialize() { return this.file.initialize(); }
  closeAndFlush() { return this.file.closeAndFlush(); }
  forProvider(providerId: string): MeasuredCapability[] { return this.file.read(state => state.records.filter(record => record.providerId === providerId)); }
  /** One identity per Provider: the new records replace every earlier one for that Provider. */
  async replace(providerId: string, records: readonly MeasuredCapability[]) {
    if (records.some(record => record.providerId !== providerId)) throw new Error("measurement-provider-mismatch");
    await this.file.mutate(state => { state.records = [...state.records.filter(record => record.providerId !== providerId), ...records]; });
  }
}
