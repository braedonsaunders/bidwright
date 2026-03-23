"use client";

import type { ProjectListItem } from "@/lib/api";
import { ZipDropzone } from "@/components/zip-dropzone";
import { Card, CardBody, CardHeader, CardTitle, FadeIn } from "@/components/ui";

export function ProjectIntake({
  projects,
}: {
  projects: ProjectListItem[];
}) {
  return (
    <div className="flex flex-1 flex-col gap-5 min-h-0 overflow-hidden">
      <FadeIn>
      <Card className="flex flex-1 flex-col min-h-0">
        <CardHeader>
          <CardTitle>Upload bid package</CardTitle>
        </CardHeader>
        <CardBody className="flex-1 min-h-0">
          <ZipDropzone projects={projects} />
        </CardBody>
      </Card>
      </FadeIn>
    </div>
  );
}
