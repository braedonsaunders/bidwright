declare module "libarchive.js/dist/libarchive-node.mjs" {
  export const Archive: {
    open(file: Blob): Promise<{
      hasEncryptedData(): Promise<boolean | null>;
      getFilesArray(): Promise<Array<{
        path?: string;
        file?: {
          name?: string;
          size?: number;
          lastModified?: number;
          extract?: () => Promise<File>;
        };
      }>>;
      close(): Promise<void>;
    }>;
  };
}
