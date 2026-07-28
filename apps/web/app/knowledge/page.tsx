"use client";

import { Suspense, useEffect, useState } from "react";
import { KnowledgePage } from "@/components/knowledge-page";
import {
  listKnowledgeBooks,
  listKnowledgeDocuments,
  listKnowledgeLibraryCabinets,
  listDatasets,
  type KnowledgeBookRecord,
  type KnowledgeDocumentRecord,
  type KnowledgeLibraryCabinetRecord,
  type DatasetRecord,
} from "@/lib/api";

export default function KnowledgeRoute() {
  const [books, setBooks] = useState<KnowledgeBookRecord[]>([]);
  const [documents, setDocuments] = useState<KnowledgeDocumentRecord[]>([]);
  const [cabinets, setCabinets] = useState<KnowledgeLibraryCabinetRecord[]>([]);
  const [datasets, setDatasets] = useState<DatasetRecord[]>([]);

  useEffect(() => {
    Promise.allSettled([listKnowledgeBooks(), listKnowledgeDocuments(), listKnowledgeLibraryCabinets(), listDatasets()]).then(
      ([booksResult, documentsResult, cabinetsResult, datasetsResult]) => {
        if (booksResult.status === "fulfilled") setBooks(booksResult.value);
        if (documentsResult.status === "fulfilled") setDocuments(documentsResult.value);
        if (cabinetsResult.status === "fulfilled") setCabinets(cabinetsResult.value);
        if (datasetsResult.status === "fulfilled") setDatasets(datasetsResult.value);
      },
    );
  }, []);

  return (
    <Suspense fallback={<div className="px-6 py-10 text-sm text-fg/40">Loading knowledge...</div>}>
      <KnowledgePage initialBooks={books} initialDocuments={documents} initialCabinets={cabinets} initialDatasets={datasets} />
    </Suspense>
  );
}
