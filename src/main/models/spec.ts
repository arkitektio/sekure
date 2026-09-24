// A downloadable model, pinned to a revision. No imports: protocol files embed specs.

export interface ModelFile {
  path: string
  size: number
  sha256: string
}

export interface ModelSpec {
  /** Folder name under `userData/models`. */
  id: string
  repo: string
  revision: string
  files: readonly ModelFile[]
}

export const modelBytes = (spec: ModelSpec) => spec.files.reduce((n, f) => n + f.size, 0)
