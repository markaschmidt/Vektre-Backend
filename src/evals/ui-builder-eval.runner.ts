import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  EvalDatasetCaseSchema,
  SolverInputSchema,
  SolverResultSchema,
  VektreUIDocumentV2Schema,
  canonicalSha256,
  validateDocumentPatchProposal,
  validateVektreUIDocument,
  type DocumentPatchProposal,
  type EvalDatasetCase,
  type JsonValue,
  type VektreUIDocumentV2,
} from '@markaschmidt/ui-builder-contracts';

export interface EvalRunResult {
  caseId: string;
  datasetId: string;
  kind: EvalDatasetCase['kind'];
  blocking: boolean;
  status: 'passed' | 'failed' | 'skipped';
  errors: string[];
}

const packageRoot = join(process.cwd(), 'evals/ui-builder/v1');
const fixtureRoot = join(process.cwd(), 'contracts/ui-builder/fixtures');

export function evalDatasetDirectory(override?: string): string {
  return override ?? packageRoot;
}

export function loadEvalCases(directory = evalDatasetDirectory()): EvalDatasetCase[] {
  const files = readdirSync(directory)
    .filter((name) => name.endsWith('.jsonl'))
    .sort();
  const cases: EvalDatasetCase[] = [];
  for (const file of files) {
    const text = readFileSync(join(directory, file), 'utf8');
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      cases.push(EvalDatasetCaseSchema.parse(JSON.parse(line)));
    }
  }
  return cases;
}

export function runEvalCase(evalCase: EvalDatasetCase): EvalRunResult {
  if (evalCase.kind === 'model_quality' || evalCase.kind === 'vlm_review') {
    return {
      caseId: evalCase.caseId,
      datasetId: evalCase.datasetId,
      kind: evalCase.kind,
      blocking: evalCase.blocking,
      status: 'skipped',
      errors: evalCase.blocking
        ? [`${evalCase.kind} evaluations must not be CI blocking`]
        : [],
    };
  }
  try {
    if (evalCase.kind === 'contract') runContractCase(evalCase);
    if (evalCase.kind === 'patch_preservation') runPatchCase(evalCase);
    if (evalCase.kind === 'solver') runSolverCase(evalCase);
    return {
      caseId: evalCase.caseId,
      datasetId: evalCase.datasetId,
      kind: evalCase.kind,
      blocking: evalCase.blocking,
      status: 'passed',
      errors: [],
    };
  } catch (error) {
    return {
      caseId: evalCase.caseId,
      datasetId: evalCase.datasetId,
      kind: evalCase.kind,
      blocking: evalCase.blocking,
      status: 'failed',
      errors: [error instanceof Error ? error.message : String(error)],
    };
  }
}

export function runBlockingEvals(directory?: string): EvalRunResult[] {
  return loadEvalCases(directory)
    .filter((item) => item.blocking)
    .map(runEvalCase);
}

function runContractCase(evalCase: EvalDatasetCase): void {
  const document = loadFixture(evalCase);
  const parsed = VektreUIDocumentV2Schema.parse(document);
  if (parsed.documentKind !== evalCase.documentKind) {
    throw new Error(
      `documentKind ${parsed.documentKind} != ${evalCase.documentKind}`,
    );
  }
  const issues = validateVektreUIDocument(parsed);
  if (issues.length > 0) {
    throw new Error(issues.map((issue) => issue.code).join(', '));
  }
  if (evalCase.fixtureHash && canonicalSha256(parsed) !== evalCase.fixtureHash) {
    throw new Error('fixture hash mismatch');
  }
}

function runPatchCase(evalCase: EvalDatasetCase): void {
  const document = loadFixture(evalCase) as Record<string, unknown>;
  const patch = evalCase.expected.patch as DocumentPatchProposal | undefined;
  if (!patch) throw new Error('patch case missing expected.patch');
  const issues = validateDocumentPatchProposal(patch);
  if (issues.length > 0) {
    throw new Error(issues.map((issue) => issue.code).join(', '));
  }
  const before = structuredClone(document);
  applyJsonPatch(document, patch);
  for (const path of patch.intentionallyPreservedPaths) {
    if (JSON.stringify(pointer(before, path)) !== JSON.stringify(pointer(document, path))) {
      throw new Error(`preserved path changed: ${path}`);
    }
  }
  const afterIssues = validateVektreUIDocument(
    VektreUIDocumentV2Schema.parse(document),
  );
  if (afterIssues.length > 0) {
    throw new Error(afterIssues.map((issue) => issue.code).join(', '));
  }
}

function runSolverCase(evalCase: EvalDatasetCase): void {
  const input = SolverInputSchema.parse(evalCase.expected.input);
  const result = SolverResultSchema.parse(evalCase.expected.result);
  if (input.solverVersion !== result.solverVersion) {
    throw new Error('solver version mismatch');
  }
  const assigned = new Set<string>();
  for (const assignment of result.assignments) {
    if (assigned.has(assignment.functionalNodeId)) {
      throw new Error(`duplicate assignment ${assignment.functionalNodeId}`);
    }
    assigned.add(assignment.functionalNodeId);
  }
  if (evalCase.expected.status && result.status !== evalCase.expected.status) {
    throw new Error(`status ${result.status} != ${evalCase.expected.status}`);
  }
}

function loadFixture(evalCase: EvalDatasetCase): VektreUIDocumentV2 {
  if (!evalCase.fixtureName) throw new Error('fixtureName required');
  const raw = JSON.parse(
    readFileSync(join(fixtureRoot, evalCase.fixtureName), 'utf8'),
  ) as JsonValue;
  return VektreUIDocumentV2Schema.parse(raw);
}

function applyJsonPatch(
  document: Record<string, unknown>,
  patch: DocumentPatchProposal,
): void {
  for (const operation of patch.operations) {
    if (operation.op === 'test') {
      if (JSON.stringify(pointer(document, operation.path)) !== JSON.stringify(operation.value)) {
        throw new Error(`test failed ${operation.path}`);
      }
      continue;
    }
    if (operation.op === 'replace') {
      setPointer(document, operation.path, operation.value);
    }
  }
}

function pointer(root: unknown, path: string): unknown {
  const segments = path
    .slice(1)
    .split('/')
    .filter(Boolean)
    .map((segment) => segment.replaceAll('~1', '/').replaceAll('~0', '~'));
  let current: unknown = root;
  for (const segment of segments) {
    if (!current || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function setPointer(root: Record<string, unknown>, path: string, value: unknown): void {
  const segments = path
    .slice(1)
    .split('/')
    .filter(Boolean)
    .map((segment) => segment.replaceAll('~1', '/').replaceAll('~0', '~'));
  let current: Record<string, unknown> = root;
  for (const segment of segments.slice(0, -1)) {
    current = current[segment] as Record<string, unknown>;
  }
  current[segments[segments.length - 1]!] = value;
}
