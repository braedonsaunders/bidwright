"use client";

import type { ProjectListItem } from "@/lib/api";
import { ZipDropzone } from "@/components/zip-dropzone";
import { motion } from "motion/react";

export function ProjectIntake({
  projects,
}: {
  projects: ProjectListItem[];
}) {
  return (
    <section className="relative flex min-h-[calc(100vh-2.5rem)] flex-1 overflow-y-auto text-fg xl:min-h-0 xl:overflow-hidden">
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.34, ease: "easeOut" }}
        className="relative z-10 flex min-h-[760px] min-w-0 flex-1 xl:min-h-0"
      >
        <ZipDropzone projects={projects} />
      </motion.div>
    </section>
  );
}
