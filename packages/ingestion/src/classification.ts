import type { ArchiveEntry, DocumentClassifier, DocumentKind } from './types.js';
import { safeLower } from './utils.js';

const FILE_HINTS: Array<{ kind: DocumentKind; patterns: RegExp[] }> = [
  {
    kind: 'rfq',
    patterns: [/^rfq/i, /request for quote/i, /request for proposal/i, /invitation to bid/i],
  },
  {
    kind: 'addendum',
    patterns: [/addendum/i, /addenda/i, /bulletin/i, /clarification/i],
  },
  {
    kind: 'drawing',
    patterns: [
      /drawing/i,
      /sheet/i,
      /plan/i,
      /detail/i,
      /section/i,
      /elevation/i,
      /permit set/i,
      /bid set/i,
    ],
  },
  {
    kind: 'schedule',
    patterns: [/schedule/i, /bid form/i, /price schedule/i, /unit price/i, /allowance/i],
  },
  {
    kind: 'estimate_book',
    patterns: [/estimating/i, /handbook/i, /manual/i, /mechanical pipefitting/i, /labor unit/i],
  },
  {
    kind: 'spec',
    patterns: [/spec/i, /specification/i, /division/i, /section/i, /project manual/i],
  },
  {
    kind: 'email',
    patterns: [/email/i, /mail/i, /message/i, /correspondence/i],
  },
];

function inferFromFileName(entry: ArchiveEntry): DocumentKind | null {
  const name = safeLower(entry.name);
  const path = safeLower(entry.path);
  const merged = `${path} ${name}`;

  for (const hint of FILE_HINTS) {
    if (hint.patterns.some((pattern) => pattern.test(merged))) {
      return hint.kind;
    }
  }

  if (entry.extension === 'pdf') {
    return 'unknown';
  }

  if (['dwg', 'dxf', 'ifc', 'rvt'].includes(entry.extension)) {
    return 'drawing';
  }

  return null;
}

function inferFromText(text: string | undefined): DocumentKind | null {
  if (!text) {
    return null;
  }

  const sample = safeLower(text.slice(0, 6000));

  if (/request for quotation|rfq|bid due|submit your quote/i.test(sample)) {
    return 'rfq';
  }
  if (/addendum|bulletin|clarification/i.test(sample)) {
    return 'addendum';
  }
  if (/division\s+\d+|section\s+\d+|part\s+\d+/i.test(sample)) {
    return 'spec';
  }
  if (/drawing no\.?|sheet\s+[a-z0-9-]+|scale:/i.test(sample)) {
    return 'drawing';
  }
  if (/estimate book|pipefitting|labor unit|manual/i.test(sample)) {
    return 'estimate_book';
  }
  if (/schedule of values|price schedule|bid form/i.test(sample)) {
    return 'schedule';
  }

  return null;
}

export function classifyDocument(entry: ArchiveEntry, extractedText?: string): DocumentKind {
  return inferFromText(extractedText) ?? inferFromFileName(entry) ?? 'unknown';
}

export class HeuristicDocumentClassifier implements DocumentClassifier {
  classify(entry: ArchiveEntry, extractedText?: string): DocumentKind {
    return classifyDocument(entry, extractedText);
  }
}
