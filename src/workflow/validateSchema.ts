/**
 * Workflow schema validator — backward-compatible re-export.
 *
 * This file delegates to the new strict validator (schemaValidator.ts)
 * while preserving the original import path and interface shape.
 */
import {
  validateWorkflowSchema as strictValidate,
  type SchemaValidationResult,
} from "./schemaValidator";

export interface ValidationResult {
  ok: boolean;
  valid: boolean;
  errors: string[];
}

export function validateWorkflowSchema(schema: unknown): ValidationResult {
  const result: SchemaValidationResult = strictValidate(schema);
  return { ok: result.valid, valid: result.valid, errors: result.errors };
}
