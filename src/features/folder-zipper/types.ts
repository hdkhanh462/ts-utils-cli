export type FileEntry = {
  fullPath: string;
  relativePath: string;
  size: number;
};

export type CliOptions = {
  prefix?: string;
  suffix?: string;
  output?: string;
  delete?: boolean;
  maxParts?: number;
};
