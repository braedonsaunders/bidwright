import Link from "next/link";
import type { CatalogSummary, ProjectListItem } from "@/lib/api";
import { ZipDropzone } from "@/components/zip-dropzone";
import { Badge, Card, CardBody, CardHeader, CardTitle, EmptyState } from "@/components/ui";
import { formatDateTime } from "@/lib/format";

export function ProjectIntake({
  projects,
  catalogs,
}: {
  projects: ProjectListItem[];
  catalogs: CatalogSummary[];
}) {
  return (
    <div className="space-y-5">
      {/* Upload */}
      <Card>
        <CardHeader>
          <CardTitle>Upload bid package</CardTitle>
        </CardHeader>
        <CardBody>
          <ZipDropzone projects={projects} />
        </CardBody>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* Existing projects */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Existing projects</CardTitle>
              <Badge>{projects.length}</Badge>
            </div>
          </CardHeader>
          <CardBody>
            {projects.length === 0 ? (
              <EmptyState>No projects</EmptyState>
            ) : (
              <div className="divide-y divide-line">
                {projects.map((project) => (
                  <Link
                    key={project.id}
                    href={`/projects/${project.id}`}
                    className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0 hover:bg-panel2/30 -mx-5 px-5 transition-colors"
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">{project.name}</div>
                      <div className="text-[11px] text-fg/40">
                        {project.clientName} · {project.quote.quoteNumber}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-[11px] text-fg/30">{formatDateTime(project.updatedAt)}</span>
                      <Badge tone="default">{project.ingestionStatus}</Badge>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </CardBody>
        </Card>

        {/* Catalogs */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Reference catalogs</CardTitle>
              <Badge>{catalogs.length}</Badge>
            </div>
          </CardHeader>
          <CardBody>
            {catalogs.length === 0 ? (
              <EmptyState>No catalogs loaded</EmptyState>
            ) : (
              <div className="divide-y divide-line">
                {catalogs.map((catalog) => (
                  <div key={catalog.id} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">{catalog.name}</div>
                      <div className="text-[11px] text-fg/40">{catalog.description}</div>
                    </div>
                    <Badge>{catalog.kind.replace("_", " ")}</Badge>
                  </div>
                ))}
              </div>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
